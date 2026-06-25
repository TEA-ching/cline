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
import React, { useState, useEffect, useMemo, useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Button, Drawer } from '@heroui/react'
import { Settings, PanelLeftOpen, PanelLeftClose, History, Wrench, Plus, UserRoundKey, Brain, FileText, RotateCcwKey } from 'lucide-react'

import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { ThinkingIndicator } from './ThinkingIndicator'
import { FollowUpChips } from './FollowUpChips'
import { ContextBar } from './ContextBar'
import { SystemPromptBanner } from './SystemPromptBanner'
import { ResearchPlanBanner } from './ResearchPlanBanner'
import { ToolApprovalDialog } from '@/components/approval/ToolApprovalDialog'
import { AskQuestionDialog } from '@/components/approval/AskQuestionDialog'
import { FileManager } from '@/components/files/FileManager'
import { FileViewerModal } from '@/components/files/FileViewerModal'
import { DropZone } from '@/components/files/DropZone'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { SessionBrowser } from '@/components/sessions/SessionBrowser'
import { ToolManager } from '@/components/optional-tools/ToolManager'
import { ByokConfigEditor } from '@/components/byok/ByokConfigEditor'
import { SourcesPanel, type Source } from './SourcesPanel'
import { Toast } from '@heroui/react';

import { useAgent } from '@/hooks/useAgent'
import type { ChatMessage } from '@/hooks/useAgent'
import { useVirtualFS } from '@/hooks/useVirtualFS'
import { useVault } from '@/hooks/useVault'
import { VaultApi } from '@/lib/vault-api'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import { useKeypoolRotation } from '@/hooks/useKeypoolRotation'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { listChatModels, modelSupportsImages, getFirecrawlKeys } from '@/lib/model-utils'
import { estimateTokens } from '@/lib/token-count'
import { BUILTIN_OPTONAL_TOOLS } from '@/tools/builtin'
import { FOCUS_MODES } from '@/tools/focus-modes'
import type { FocusMode } from '@/tools/focus-modes'
import { recordKeyUsage, recordKeyError, extractErrorCode } from '@/lib/keypool-usage'
import { SessionStore } from '@/session/session-store'
import type { Session } from '@/session/session-store'
import type { AiConfig } from '@/types/ai-config'

// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_PROMPT = `You are an expert AI research assistant with access to web search, browsing, and file management tools.

**Web Research:**
- Use search_web for quick lookups (up to 5 results)
- Use deep_research for complex questions requiring multiple sources and deep analysis (e.g. comparisons, best practices, market overviews)
- Use fetch_web_content to read a specific page
- When citing sources, use [citation:N] format where N is the source number (e.g. "According to recent benchmarks [citation:1]...")

**Source Reliability (A4):**
Each passage from deep_research is tagged [Source N, agree=M]. When M=0, the fact comes from a single source — flag it explicitly: ⚠️ *Single source*. Prioritize facts confirmed by ≥2 sources (agree≥1). Sources are pre-sorted by reliability (.edu/.gov/journals > Wikipedia > general web).

**After Research:**
After answering a research question, call suggest_followups with 2-4 relevant follow-up questions.

**File Management:**
Use vfs_* tools to read and write files. When asked to create files, use vfs_editor and they will be available for download.`

export const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/clear', desc: 'Clear current conversation' },
  { cmd: '/new', desc: 'Start a new conversation' },
  { cmd: '/undo', desc: 'Remove last message pair' },
  { cmd: '/compact', desc: 'Ask AI to summarize conversation (saves context)' },
  { cmd: '/sessions', desc: 'Browse & restore saved conversations' },
  { cmd: '/tools', desc: 'Manage optional tools' },
  { cmd: '/prompt', desc: '/prompt <text> — view or set system prompt' },
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
  const { firecrawlKeys, mode: vaultMode } = useVault()

  const { selectedProviderId, selectedModelId, handleModelChange } = useModelSelection(vaultConfig)
  const [showSettings, setShowSettings] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showSkills, setShowTools] = useState(false)
  const [showByokConfig, setShowByokConfig] = useState(false)
  const [showReasoning, setShowReasoning] = useLocalStorageState('show_reasoning', false)
  const [sources, setSources] = useState<Source[]>([])
  const [showSources, setShowSources] = useState(false)
  const [sessionId, setSessionId] = useState(() => `sess_${Date.now()}`)
  const [systemPrompt, setSystemPrompt] = useLocalStorageState('chatbot_system_prompt', DEFAULT_SYSTEM_PROMPT)
  const [enabledTools, setEnabledTools] = useLocalStorageState<string[]>('chatbot_enabled_optional_tools', [])
  const [focusMode, setFocusMode] = useLocalStorageState<FocusMode>('chatbot_focus_mode', 'web')

  // Detect mobile screen size
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [showFiles, setShowFiles] = useState(!isMobile)
  const [sidebarWidth, setSidebarWidth] = useState(224) // w-56 = 224px
  const sidebarResizingRef = useRef(false)
  const sidebarResizeStartX = useRef(0)
  const sidebarResizeStartWidth = useRef(0)

  const handleSidebarResizeStart = useCallback((e: ReactMouseEvent) => {
    sidebarResizingRef.current = true
    sidebarResizeStartX.current = e.clientX
    sidebarResizeStartWidth.current = sidebarWidth
    e.preventDefault()
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!sidebarResizingRef.current) return
      const delta = e.clientX - sidebarResizeStartX.current
      setSidebarWidth(Math.max(120, Math.min(480, sidebarResizeStartWidth.current + delta)))
    }
    const onUp = () => { sidebarResizingRef.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

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
    const focusLabel = FOCUS_MODES[focusMode]?.label ?? 'Web'
    const focusDomainNote = focusMode !== 'web'
      ? `\n\n**Active focus: ${FOCUS_MODES[focusMode]?.icon ?? ''} ${focusLabel}** — search and deep_research are restricted to ${focusLabel.toLowerCase()} sources.`
      : ''
    return {
      providerId: selectedProviderId,
      modelId: selectedModelId,
      apiKey: currentKey?.key ?? selectedProvider.keys[0]?.key ?? '',
      baseUrl: selectedProvider.endpoint,
      systemPrompt: systemPrompt + focusDomainNote,
      firecrawlKeys: firecrawlKeys.length > 0 ? firecrawlKeys : getFirecrawlKeys(vaultConfig),
      firecrawlEndpoint,
      focusMode,
      enabledTools: enabledTools.filter(toolId => {
        const meta = BUILTIN_OPTONAL_TOOLS.find(t => t.id === toolId)
        if (!meta?.filter) return true
        return selectedModel ? meta.filter(selectedModel, selectedProviderId) : false
      }),
      vaultToken: vaultMode === 'vault' ? (VaultApi.getToken() ?? undefined) : undefined,
      corsProxyUrl: vaultMode === 'vault' ? `${new URL(import.meta.env.KEYPOOL_VAULT_URL).origin}/v1/keypool/corsproxy` : undefined,
      weatherApiKeys: vaultConfig.weatherApi?.keys?.map(k => ({
        key: k.key,
        sharedSecret: k.sharedSecret,
        signatureType: k.signatureType,
      })),
      weatherApiEndpoint: vaultConfig.weatherApi?.endpoint,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedProviderId,
    selectedModelId,
    selectedProvider?.endpoint,
    currentKey?.key,
    systemPrompt,
    focusMode,
    firecrawlEndpoint,
    vaultMode,
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable serialisation
    JSON.stringify(firecrawlKeys),
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable serialisation
    JSON.stringify(enabledTools),
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable serialisation
    JSON.stringify(vaultConfig.weatherApi?.keys),
    vaultConfig.weatherApi?.endpoint,
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
    getReasoningSteps,
    researchPlan,
    followUpQuestions,
    queueRetryAfterRotation,
    getLastAgentMessages,
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
    }, vaultMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTurnUsage, vaultMode])

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
    }, vaultMode)
    markKeyFailedAndRotate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKeyError, vaultMode])

  // -------------------------------------------------------------------------
  // Keypool: fast key rotation on rate-limit when another key is available.
  // On the first rate_limited event of a turn, if the pool has multiple keys,
  // queue the pending user message as a retry and rotate immediately — the new
  // worker will auto-send it via the worker_ready handler in useAgent.
  // -------------------------------------------------------------------------
  // Guard against queuing more than one rotation per turn
  const hasQueuedRotationRef = useRef(false)
  useEffect(() => {
    if (!rateLimitRetryAt) {
      // Turn ended / new turn started — reset the guard
      hasQueuedRotationRef.current = false
      return
    }
    if (poolSize <= 1 || hasQueuedRotationRef.current) return

    hasQueuedRotationRef.current = true
    queueRetryAfterRotation()
    markKeyFailedAndRotate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLimitRetryAt, poolSize])

  const vfs = useVirtualFS(syncVfsFile)

  // -------------------------------------------------------------------------
  // File viewer modal
  // -------------------------------------------------------------------------
  const [viewingFile, setViewingFile] = useState<{
    path: string; mimeType: string; content?: string; blobUrl?: string
  } | null>(null)

  const handleViewWorkspaceFile = useCallback((path: string) => {
    const content = vfs.readFile(path)
    const file = vfs.files.find(f => f.path === path)
    setViewingFile({ path, mimeType: file?.mimeType ?? 'text/plain', content: content ?? undefined })
  }, [vfs])

  const handleViewGeneratedFile = useCallback((file: import('@/hooks/useAgent').GeneratedFile) => {
    const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    }
    const mimeType = mimeMap[ext] ?? 'text/plain'
    setViewingFile({ path: file.path, mimeType, blobUrl: file.blobUrl })
  }, [])

  // -------------------------------------------------------------------------
  // Research plan: filter plan tool calls out of the main message list
  // -------------------------------------------------------------------------
  const planToolIds = useMemo(
    () => new Set(researchPlan?.toolCallIds ?? []),
    [researchPlan],
  )

  const visibleMessages = useMemo(() => {
    return messages.filter(m => {
      if (m.role !== 'tool') return true
      if (m.toolName === 'suggest_followups') return false
      if (m.toolName === 'plan_research' || m.toolName === 'complete_research_step') return false
      if (researchPlan && planToolIds.has(m.id)) return false
      return true
    })
  }, [messages, researchPlan, planToolIds])

  const planToolMessages = useMemo(
    () => messages.filter(m => planToolIds.has(m.id)),
    [messages, planToolIds],
  )

  // -------------------------------------------------------------------------
  // Context window estimation — calibrated per model family
  // -------------------------------------------------------------------------
  const contextUsedTokens = useMemo(() => {
    const mid = selectedModelId ?? ''
    const msgTokens = messages.reduce((sum, m) => {
      let t = estimateTokens(m.content, mid)
      if (m.toolInput) t += estimateTokens(JSON.stringify(m.toolInput), mid)
      if (m.toolResult) t += estimateTokens(JSON.stringify(m.toolResult), mid)
      return sum + t
    }, 0)
    return msgTokens + estimateTokens(systemPrompt, mid)
  }, [messages, systemPrompt, selectedModelId])

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
  // Extract sources from tool messages — deduplicated by normalized URL
  // -------------------------------------------------------------------------
  useEffect(() => {
    const normalizeUrl = (url: string): string => {
      try {
        const u = new URL(url)
        const host = u.hostname.replace(/^www\./, '')
        return `${host}${u.pathname}`.replace(/\/+$/, '').toLowerCase()
      } catch {
        return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')
      }
    }
    const safeHostname = (url: string): string => {
      try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
    }

    const seen = new Map<string, Source>()
    let nextId = 1

    const addSource = (url: string, title: string, snippet: string) => {
      if (!url) return
      const key = normalizeUrl(url)
      if (seen.has(key)) return
      const domain = safeHostname(url)
      seen.set(key, {
        id: nextId++,
        title: title || 'Source',
        url,
        snippet: snippet.slice(0, 300),
        domain,
        favicon: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : undefined,
      })
    }

    // biome-ignore lint/suspicious/noExplicitAny: dynamic tool results
    messages.forEach((msg: any) => {
      if (msg.toolName === 'search_web' && msg.toolResult) {
        const results: any[] = Array.isArray(msg.toolResult) ? msg.toolResult : msg.toolResult?.results ?? []
        results.forEach((r: any) => {
          addSource(r.url || '', r.title || 'Source', r.description || r.markdown?.slice(0, 200) || '')
        })
      } else if (msg.toolName === 'fetch_web_content' && msg.toolResult) {
        const r: any = msg.toolResult
        addSource(r.url || '', r.title || r.metadata?.title || 'Web Content', r.markdown?.slice(0, 200) || '')
      } else if (msg.toolName === 'deep_research' && msg.toolResult) {
        const r: any = msg.toolResult
        const srcs: any[] = Array.isArray(r.sources) ? r.sources : []
        srcs.forEach((s: any) => {
          addSource(s.url || '', s.title || 'Source', s.snippet || '')
        })
      }
    })

    setSources(Array.from(seen.values()))
  }, [messages])

  // -------------------------------------------------------------------------
  // Session auto-save
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (messages.length === 0) return
    const firstUser = messages.find(m => m.role === 'user')
    // Auto-title from the first user turn, capped at 60 chars
    const title = firstUser?.content?.trim().slice(0, 60) ?? 'Conversation'
    // Only persist non-blob URLs (blob: URLs die on page reload)
    const generatedFileUrls = generatedFiles
      .filter(f => !f.blobUrl.startsWith('blob:'))
      .map(f => ({ path: f.path, url: f.blobUrl, timestamp: f.timestamp }))

    SessionStore.save({
      id: sessionId,
      title,
      messages,
      agentMessages: getLastAgentMessages() ?? undefined,
      generatedFileUrls: generatedFileUrls.length > 0 ? generatedFileUrls : undefined,
      providerId: selectedProviderId,
      modelId: selectedModelId,
      createdAt: Number(sessionId.replace('sess_', '')),
      updatedAt: Date.now(),
      vfsSnapshot: vfs.toSnapshot(),
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (/quota|storage/i.test(msg)) {
        console.error('[session] Storage quota exceeded — consider clearing old sessions.', msg)
      } else {
        console.error('[session] Auto-save failed:', msg)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionId, selectedProviderId, selectedModelId, vfs.files, generatedFiles])

  // -------------------------------------------------------------------------
  // Session load
  // -------------------------------------------------------------------------
  const handleLoadSession = useCallback((session: Session) => {
    setSessionId(session.id)
    loadMessages(session.messages, session.agentMessages ? [...session.agentMessages] : undefined)
    handleModelChange(session.providerId, session.modelId)
    vfs.loadSnapshot(session.vfsSnapshot)
    setShowSessions(false)
  }, [loadMessages, handleModelChange, vfs.loadSnapshot])

  const handleForkAtMessage = useCallback((messageId: string) => {
    const forkIndex = messages.findIndex(m => m.id === messageId)
    if (forkIndex === -1) return
    const forkedMessages = messages.slice(0, forkIndex + 1)
    setSessionId(`sess_${Date.now()}`)
    loadMessages(forkedMessages)
  }, [messages, loadMessages])

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const contextWindow = selectedModel?.contextWindow ?? 0

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
          vfs.clear()
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

    // Block normal messages when the context window is effectively full (≥97%)
    if (contextWindow > 0 && contextUsedTokens >= contextWindow * 0.97) {
      const sysMsg: ChatMessage = {
        id: uid(),
        role: 'system',
        content: '⛔ Context window is full. Use /compact to summarise the conversation before sending a new message.',
        timestamp: Date.now(),
      }
      loadMessages([...messages, sysMsg])
      return
    }

    agentSend(trimmed, images)
  }, [
    agentSend, clearMessages, reset, removeLastExchange,
    loadMessages, messages, systemPrompt, setSystemPrompt,
    contextWindow, contextUsedTokens,
  ])

  const handleFollowUp = useCallback((question: string) => {
    agentSend(question)
  }, [agentSend])

  const handleCompact = useCallback(() => {
    agentSend(
      'Produce a concise summary of our conversation so far, capturing all important ' +
      'decisions, context, and information. This will serve as a compressed record.',
    )
  }, [agentSend])

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

  return (
    <>
      <Toast.Provider placement="bottom end" />
      <DropZone onDrop={vfs.uploadFiles}>
        <div className="flex h-screen overflow-hidden bg-background">

          {/* File sidebar */}
          {showFiles && (
            <div style={{ width: sidebarWidth }} className="shrink-0 border-r border-default-200 overflow-hidden relative">
              <FileManager
                files={vfs.files}
                generatedFiles={generatedFiles}
                onRemove={path => { vfs.removeFile(path); removeVfsFile(path) }}
                onViewFile={handleViewWorkspaceFile}
                onViewGeneratedFile={handleViewGeneratedFile}
              />
              {/* Horizontal resize handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-400/60 active:bg-primary-500/80 transition-colors"
                onMouseDown={handleSidebarResizeStart}
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
                onPress={() => { reset(); vfs.clear(); setSessionId(`sess_${Date.now()}`) }}
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
              {vaultMode === 'byok' && (
                <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowByokConfig(true)} aria-label="BYOK Configuration">
                  <UserRoundKey className="h-4 w-4" />
                </Button>
              )}
              <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowSources(v => !v)} aria-label="Afficher les sources" className={showSources ? 'text-primary-500' : ''}>
                <FileText className="h-4 w-4" />
              </Button>
              <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowReasoning(v => !v)} aria-label="Afficher le raisonnement" className={showReasoning ? 'text-blue-300' : ''}>
                <Brain className="h-4 w-4" />
              </Button>
              <Button isIconOnly variant="ghost" size="sm" onPress={() => rotateKey()} aria-label="Rotate API key">
                <RotateCcwKey className="h-4 w-4" />
              </Button>
              <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowSettings(v => !v)} aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Button>
            </div>

            {/* Context bar */}
            {contextWindow > 0 && (
              <ContextBar usedTokens={contextUsedTokens} totalTokens={contextWindow} onCompact={handleCompact} />
            )}

            {/* Messages + thinking indicator */}
            <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
              <SystemPromptBanner systemPrompt={systemPrompt} defaultSystemPrompt={DEFAULT_SYSTEM_PROMPT} onUpdate={setSystemPrompt} />
              {researchPlan && <ResearchPlanBanner plan={researchPlan} isRunning={isRunning} toolMessages={planToolMessages} />}
              <MessageList
                messages={visibleMessages}
                onImageCaptured={handleImageCaptured}
                onFork={handleForkAtMessage}
                showReasoning={showReasoning}
                getReasoningSteps={getReasoningSteps}
                sources={sources}
              />
              <ThinkingIndicator startedAt={turnStartedAt} streamedTokens={streamedTokens} />
            </div>

            {/* Follow-up question chips */}
            {!isRunning && followUpQuestions.length > 0 && (
              <FollowUpChips questions={followUpQuestions} onPick={handleFollowUp} />
            )}

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
              focusMode={focusMode}
              onFocusChange={setFocusMode}
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
                      mode={vaultMode}
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

          {/* BYOK Configuration Drawer */}
          <Drawer>
            <Drawer.Backdrop isOpen={showByokConfig} onOpenChange={setShowByokConfig}>
              <Drawer.Content placement="right">
                <Drawer.Dialog>
                  <Drawer.CloseTrigger />
                  <Drawer.Header>
                    <Drawer.Heading>BYOK Configuration</Drawer.Heading>
                  </Drawer.Header>
                  <Drawer.Body>
                    <ByokConfigEditor onClose={() => setShowByokConfig(false)} />
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

          {/* Sources Drawer */}
          <SourcesPanel sources={sources} onClose={() => setShowSources(false)} isOpen={showSources} />

          {/* File viewer */}
          {viewingFile && (
            <FileViewerModal
              path={viewingFile.path}
              mimeType={viewingFile.mimeType}
              content={viewingFile.content}
              blobUrl={viewingFile.blobUrl}
              onClose={() => setViewingFile(null)}
            />
          )}
        </div>
      </DropZone>
    </>
  )
}
