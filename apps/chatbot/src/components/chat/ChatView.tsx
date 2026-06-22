/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Button, Drawer } from '@heroui/react'
import { Settings, PanelLeftOpen, PanelLeftClose, History, Wrench, Plus } from 'lucide-react'

import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { ThinkingIndicator } from './ThinkingIndicator'
import { ContextBar } from './ContextBar'
import { SystemPromptBanner } from './SystemPromptBanner'
import { ToolApprovalDialog } from '@/components/approval/ToolApprovalDialog'
import { AskQuestionDialog } from '@/components/approval/AskQuestionDialog'
import { FileManager } from '@/components/files/FileManager'
import { DropZone } from '@/components/files/DropZone'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { SessionBrowser } from '@/components/sessions/SessionBrowser'
import { ToolManager } from '@/components/optional-tools/ToolManager'

import { useAgent } from '@/hooks/useAgent'
import type { ChatMessage } from '@/hooks/useAgent'
import { useVirtualFS } from '@/hooks/useVirtualFS'
import { useVault } from '@/hooks/useVault'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import { useKeypoolRotation } from '@/hooks/useKeypoolRotation'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { listChatModels, modelSupportsImages, getFirecrawlKeys } from '@/lib/model-utils'
import { BUILTIN_OPTONAL_TOOLS } from '@/tools/builtin'
import { recordKeyUsage, recordKeyError, extractErrorCode } from '@/lib/keypool-usage'
import { SessionStore } from '@/session/session-store'
import type { Session } from '@/session/session-store'
import type { AiConfig } from '@/types/ai-config'

// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to a virtual file system and web tools.
Use the vfs_* tools to read and write files. Use fetch_web_content and search_web to browse the internet.
When asked to create files, use vfs_editor and they will be available for download.`

export const SLASH_COMMANDS = [
  { cmd: '/help',     desc: 'Show available commands' },
  { cmd: '/clear',    desc: 'Clear current conversation' },
  { cmd: '/new',      desc: 'Start a new conversation' },
  { cmd: '/undo',     desc: 'Remove last message pair' },
  { cmd: '/compact',  desc: 'Ask AI to summarize conversation (saves context)' },
  { cmd: '/sessions', desc: 'Browse & restore saved conversations' },
  { cmd: '/tools',   desc: 'Manage optional tools' },
  { cmd: '/prompt',   desc: '/prompt <text> — view or set system prompt' },
]

const HELP_TEXT = SLASH_COMMANDS
  .map(c => `${c.cmd.padEnd(12)} ${c.desc}`)
  .join('\n')

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// ---------------------------------------------------------------------------

interface Props { vaultConfig: AiConfig }

export const ChatView: React.FC<Props> = ({ vaultConfig }) => {
  const { firecrawlKeys } = useVault()

  const { selectedProviderId, selectedModelId, handleModelChange } = useModelSelection(vaultConfig)
  const [showSettings, setShowSettings] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showSkills, setShowTools] = useState(false)
  const [sessionId, setSessionId] = useState(() => `sess_${Date.now()}`)
  const [systemPrompt, setSystemPrompt] = useLocalStorageState('chatbot_system_prompt', DEFAULT_SYSTEM_PROMPT)
  const [enabledTools, setEnabledTools] = useLocalStorageState<string[]>('chatbot_enabled_optional_tools', [])

  // Detect mobile screen size
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [showFiles, setShowFiles] = useState(!isMobile)

  // Update sidebar visibility when screen size changes
  useEffect(() => {
    if (isMobile) {
      setShowFiles(false)
    }
  }, [isMobile])

  const models = useMemo(() => listChatModels(vaultConfig), [vaultConfig])
  const selectedModel = models.find(
    m => m.providerId === selectedProviderId && m.model.id === selectedModelId,
  )?.model
  const selectedProvider = vaultConfig.providers[selectedProviderId] ?? null

  // Key rotation — round-robin, persisted in localStorage per provider
  const {
    currentKey,
    currentKeyHint,
    currentKeyOwner,
    poolSize,
    rotateKey,
    markKeyFailedAndRotate,
  } = useKeypoolRotation(selectedProviderId, selectedProvider)

  // Stable firecrawl endpoint from first crawler entry
  const firecrawlEndpoint = useMemo(
    () => Object.values(vaultConfig.crawlers)[0]?.endpoint ?? 'https://api.firecrawl.dev',
    [vaultConfig],
  )

  // Agent config — JSON.stringify guards prevent spurious worker restarts
  // Use currentKey from the pool instead of always keys[0]
  const agentConfig = useMemo(() => {
    if (!selectedProvider || !selectedModelId) return null
    return {
      providerId: selectedProviderId,
      modelId: selectedModelId,
      apiKey: currentKey?.key ?? selectedProvider.keys[0]?.key ?? '',
      baseUrl: selectedProvider.endpoint,
      systemPrompt,
      firecrawlKeys: firecrawlKeys.length > 0 ? firecrawlKeys : getFirecrawlKeys(vaultConfig),
      firecrawlEndpoint,
      enabledTools: enabledTools.filter(toolId => {
        const meta = BUILTIN_OPTONAL_TOOLS.find(t => t.id === toolId)
        if (!meta?.filter) return true
        return selectedModel ? meta.filter(selectedModel, selectedProviderId) : false
      }),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedProviderId,
    selectedModelId,
    selectedProvider?.endpoint,
    currentKey?.key,
    systemPrompt,
    firecrawlEndpoint,
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable serialisation
    JSON.stringify(firecrawlKeys),
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable serialisation
    JSON.stringify(enabledTools),
  ])

  const {
    messages,
    isRunning,
    generatedFiles,
    pendingApproval,
    pendingQuestion,
    turnStartedAt,
    streamedTokens,
    lastTurnUsage,
    lastKeyError,
    rateLimitRetryAt,
    sendMessage: agentSend,
    abort,
    reset,
    removeLastExchange,
    clearMessages,
    loadMessages,
    syncVfsFile,
    removeVfsFile,
    addGeneratedFile,
  } = useAgent(agentConfig)

  // -------------------------------------------------------------------------
  // Keypool: record usage after each successful turn
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!lastTurnUsage || !selectedProvider || !currentKey) return
    recordKeyUsage({
      provider: selectedProviderId,
      modelId: selectedModelId,
      keyOwner: currentKeyOwner,
      keyHint: currentKeyHint,
      promptTokens: lastTurnUsage.inputTokens,
      completionTokens: lastTurnUsage.outputTokens,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTurnUsage])

  // -------------------------------------------------------------------------
  // Keypool: detect key errors, record them, and rotate automatically
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!lastKeyError || !selectedProvider || !currentKey) return
    recordKeyError({
      provider: selectedProviderId,
      modelId: selectedModelId,
      keyOwner: currentKeyOwner,
      keyHint: currentKeyHint,
      errorCode: extractErrorCode(lastKeyError),
    })
    markKeyFailedAndRotate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKeyError])

  const vfs = useVirtualFS(syncVfsFile)

  // -------------------------------------------------------------------------
  // Context window estimation (chars / 4 ≈ tokens)
  // -------------------------------------------------------------------------
  const contextUsedTokens = useMemo(() => {
    const chars = messages.reduce((sum, m) => {
      let n = m.content.length
      if (m.toolInput) n += JSON.stringify(m.toolInput).length
      if (m.toolResult) n += JSON.stringify(m.toolResult).length
      return sum + n
    }, 0)
    return Math.round((chars + systemPrompt.length) / 4)
  }, [messages, systemPrompt])

  // -------------------------------------------------------------------------
  // Rate-limit countdown (ticks every second while waiting for auto-retry)
  // -------------------------------------------------------------------------
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState<number | null>(null)
  useEffect(() => {
    if (rateLimitRetryAt === null) {
      setRateLimitSecondsLeft(null)
      return
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((rateLimitRetryAt - Date.now()) / 1000))
      setRateLimitSecondsLeft(left)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [rateLimitRetryAt])

  // -------------------------------------------------------------------------
  // Session auto-save
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (messages.length === 0) return
    const title = messages.find(m => m.role === 'user')?.content?.slice(0, 60) ?? 'Conversation'
    void SessionStore.save({
      id: sessionId,
      title,
      messages,
      providerId: selectedProviderId,
      modelId: selectedModelId,
      createdAt: Number(sessionId.replace('sess_', '')),
      updatedAt: Date.now(),
    })
  }, [messages, sessionId, selectedProviderId, selectedModelId])

  // -------------------------------------------------------------------------
  // Session load
  // -------------------------------------------------------------------------
  const handleLoadSession = useCallback((session: Session) => {
    setSessionId(session.id)
    loadMessages(session.messages)
    handleModelChange(session.providerId, session.modelId)
    setShowSessions(false)
  }, [loadMessages, handleModelChange])

  const handleForkAtMessage = useCallback((messageId: string) => {
    const forkIndex = messages.findIndex(m => m.id === messageId)
    if (forkIndex === -1) return
    const forkedMessages = messages.slice(0, forkIndex + 1)
    setSessionId(`sess_${Date.now()}`)
    loadMessages(forkedMessages)
  }, [messages, loadMessages])

  // -------------------------------------------------------------------------
  // Slash command dispatch
  // -------------------------------------------------------------------------
  const handleSend = useCallback((text: string, images?: string[]) => {
    const trimmed = text.trim()

    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ')
      const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase()
      const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()

      const addSystem = (content: string) => {
        const sysMsg: ChatMessage = { id: uid(), role: 'system', content, timestamp: Date.now() }
        loadMessages([...messages, sysMsg])
      }

      switch (cmd) {
        case '/help':
          addSystem(`Available commands:\n\n${HELP_TEXT}`)
          return
        case '/clear':
          clearMessages()
          return
        case '/new':
          reset()
          setSessionId(`sess_${Date.now()}`)
          return
        case '/undo':
          removeLastExchange()
          return
        case '/compact':
          agentSend(
            arg ||
            'Produce a concise summary of our conversation so far, capturing all important ' +
            'decisions, context, and information. This will serve as a compressed record.',
          )
          return
        case '/sessions':
          setShowSessions(true)
          return
        case '/tools':
          setShowTools(true)
          return
        case '/prompt':
          if (arg) {
            setSystemPrompt(arg)
            addSystem(`System prompt updated. Use /new to start a fresh conversation with it.`)
          } else {
            addSystem(`Current system prompt:\n\n${systemPrompt}`)
          }
          return
        default:
          // Unknown command — fall through and send as normal message
          break
      }
    }

    agentSend(trimmed, images)
  }, [
    agentSend, clearMessages, reset, removeLastExchange,
    loadMessages, messages, systemPrompt, setSystemPrompt,
  ])

  // -------------------------------------------------------------------------
  // Skill toggle
  // -------------------------------------------------------------------------
  const handleToggleSkill = useCallback((skillId: string) => {
    setEnabledTools(prev =>
      prev.includes(skillId) ? prev.filter(id => id !== skillId) : [...prev, skillId],
    )
  }, [setEnabledTools])

  const handleImageCaptured = useCallback((path: string, dataUrl: string) => {
    // Canvas capture succeeded (CORS allowed) — overwrite the URL reference with actual pixel data
    syncVfsFile(path, dataUrl)
    // Also expose in the file manager for download
    const arr = dataUrl.split(',')
    const mimeMatch = arr[0].match(/:(.*?);/)
    if (!mimeMatch) return
    const u8arr = Uint8Array.from(atob(arr[1]), c => c.charCodeAt(0))
    const blob = new Blob([u8arr], { type: mimeMatch[1] })
    addGeneratedFile(path, URL.createObjectURL(blob))
  }, [syncVfsFile, addGeneratedFile])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const contextWindow = selectedModel?.contextWindow ?? 0

  return (
    <DropZone onDrop={vfs.uploadFiles}>
      <div className="flex h-screen overflow-hidden bg-background">

        {/* File sidebar */}
        {showFiles && (
          <div className="w-56 shrink-0 border-r border-default-200 overflow-hidden">
            <FileManager
              files={vfs.files}
              generatedFiles={generatedFiles}
              onRemove={path => { vfs.removeFile(path); removeVfsFile(path) }}
            />
          </div>
        )}

        {/* Main chat area */}
        <div className="flex flex-1 flex-col min-w-0">

          {/* Header */}
          <div className="flex items-center gap-1 border-b border-default-200 px-3 py-2 shrink-0">
            <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowFiles(v => !v)}>
              {showFiles
                ? <PanelLeftClose className="h-4 w-4" />
                : <PanelLeftOpen className="h-4 w-4" />}
            </Button>
            <div className="flex-1 min-w-0 px-1">
              <p className="text-xs text-default-500 truncate font-mono">
                {selectedModelId || 'No model selected'}
                {enabledTools.length > 0 && (
                  <span className="ml-1.5 text-primary-400">
                    +{enabledTools.length} optional tool{enabledTools.length !== 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>
            <Button
              isIconOnly variant="ghost" size="sm"
              onPress={() => { reset(); setSessionId(`sess_${Date.now()}`) }}
              aria-label="New conversation"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowSessions(true)} aria-label="Saved conversations">
              <History className="h-4 w-4" />
            </Button>
            <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowTools(true)} aria-label="Optional tools">
              <Wrench className="h-4 w-4" />
            </Button>
            <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowSettings(v => !v)} aria-label="Settings">
              <Settings className="h-4 w-4" />
            </Button>
          </div>

          {/* Context bar */}
          {contextWindow > 0 && (
            <ContextBar usedTokens={contextUsedTokens} totalTokens={contextWindow} />
          )}

          {/* Messages + thinking indicator */}
          <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
            <SystemPromptBanner systemPrompt={systemPrompt} defaultSystemPrompt={DEFAULT_SYSTEM_PROMPT} onUpdate={setSystemPrompt} />
            <MessageList messages={messages} onImageCaptured={handleImageCaptured} onFork={handleForkAtMessage} />
            <ThinkingIndicator startedAt={turnStartedAt} streamedTokens={streamedTokens} />
          </div>

          {/* Rate-limit retry banner */}
          {rateLimitSecondsLeft !== null && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-md bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 text-sm flex items-center gap-2">
              <span>⏳</span>
              <span>
                Rate limited — retrying automatically in{' '}
                <strong>{rateLimitSecondsLeft}s</strong>
              </span>
            </div>
          )}

          {/* Input */}
          <InputBar
            onSend={handleSend}
            onAbort={abort}
            isRunning={isRunning}
            supportsImages={!!selectedModel && modelSupportsImages(selectedModel)}
            onUploadFiles={vfs.uploadFiles}
            commands={SLASH_COMMANDS}
          />
        </div>

        {/* Settings Drawer */}
        <Drawer>
          <Drawer.Backdrop isOpen={showSettings} onOpenChange={setShowSettings}>
            <Drawer.Content placement="right">
              <Drawer.Dialog>
                <Drawer.CloseTrigger />
                <Drawer.Header>
                  <Drawer.Heading>Settings</Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body>
                  <SettingsPanel
                    config={vaultConfig}
                    selectedProviderId={selectedProviderId}
                    selectedModelId={selectedModelId}
                    onModelChange={handleModelChange}
                    currentKeyHint={currentKeyHint}
                    canRotate={poolSize > 1}
                    onRotateKey={rotateKey}
                  />
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>

        {/* Session Browser Drawer */}
        <Drawer>
          <Drawer.Backdrop isOpen={showSessions} onOpenChange={setShowSessions}>
            <Drawer.Content placement="right">
              <Drawer.Dialog>
                <Drawer.CloseTrigger />
                <Drawer.Header>
                  <Drawer.Heading>Sessions</Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body>
                  <SessionBrowser
                    currentProviderId={selectedProviderId}
                    currentModelId={selectedModelId}
                    onLoad={handleLoadSession}
                  />
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>

        {/* Tool Manager Drawer */}
        <Drawer>
          <Drawer.Backdrop isOpen={showSkills} onOpenChange={setShowTools}>
            <Drawer.Content placement="right">
              <Drawer.Dialog>
                <Drawer.CloseTrigger />
                <Drawer.Header>
                  <Drawer.Heading>Optional Tools</Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body>
                  <ToolManager
                    enabledTools={enabledTools}
                    onToggle={handleToggleSkill}
                    selectedModel={selectedModel}
                    selectedProviderId={selectedProviderId}
                  />
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>

        {/* Tool approval */}
        {pendingApproval && (
          <ToolApprovalDialog
            toolName={pendingApproval.toolName}
            input={pendingApproval.input}
            onApprove={() => pendingApproval.resolve(true)}
            onDeny={() => pendingApproval.resolve(false)}
          />
        )}

        {/* Ask question */}
        {pendingQuestion && (
          <AskQuestionDialog
            question={pendingQuestion.question}
            options={pendingQuestion.options}
            onAnswer={pendingQuestion.resolve}
          />
        )}
      </div>
    </DropZone>
  )
}
