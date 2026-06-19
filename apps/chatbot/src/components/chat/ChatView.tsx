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
import { Button } from '@heroui/react'
import { Settings, PanelLeftOpen, PanelLeftClose, History, Zap, Plus } from 'lucide-react'

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
import { listChatModels, modelSupportsImages, getFirecrawlKeys } from '@/lib/model-utils'
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
  const [showFiles, setShowFiles] = useState(true)
  const [showSessions, setShowSessions] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [sessionId, setSessionId] = useState(() => `sess_${Date.now()}`)
  const [systemPrompt, setSystemPrompt] = useLocalStorageState('chatbot_system_prompt', DEFAULT_SYSTEM_PROMPT)
  const [enabledSkills, setEnabledSkills] = useLocalStorageState<string[]>('chatbot_enabled_optional_tools', [])

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
      enabledSkills,
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
    JSON.stringify(enabledSkills),
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
    sendMessage: agentSend,
    abort,
    reset,
    removeLastExchange,
    clearMessages,
    loadMessages,
    syncVfsFile,
    removeVfsFile,
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
          setShowSkills(true)
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
    setEnabledSkills(prev =>
      prev.includes(skillId) ? prev.filter(id => id !== skillId) : [...prev, skillId],
    )
  }, [setEnabledSkills])

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
                {enabledSkills.length > 0 && (
                  <span className="ml-1.5 text-primary-400">
                    +{enabledSkills.length} optional tool{enabledSkills.length !== 1 ? 's' : ''}
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
            <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowSkills(true)} aria-label="Optional tools">
              <Zap className="h-4 w-4" />
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
            <MessageList messages={messages} />
            <ThinkingIndicator startedAt={turnStartedAt} streamedTokens={streamedTokens} />
          </div>

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

        {/* Settings panel */}
        {showSettings && (
          <SettingsPanel
            config={vaultConfig}
            selectedProviderId={selectedProviderId}
            selectedModelId={selectedModelId}
            onModelChange={handleModelChange}
            onClose={() => setShowSettings(false)}
            currentKeyHint={currentKeyHint}
            canRotate={poolSize > 1}
            onRotateKey={rotateKey}
          />
        )}

        {/* Session browser */}
        {showSessions && (
          <SessionBrowser
            currentProviderId={selectedProviderId}
            currentModelId={selectedModelId}
            onLoad={handleLoadSession}
            onClose={() => setShowSessions(false)}
          />
        )}

        {/* Optional tool manager */}
        {showSkills && (
          <ToolManager
            enabledSkills={enabledSkills}
            onToggle={handleToggleSkill}
            onClose={() => setShowSkills(false)}
          />
        )}

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
