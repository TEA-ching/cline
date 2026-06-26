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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentRuntimeEvent, AgentMessage, AgentUsage } from '@cline/agents'
import AgentWorkerClass from '../workers/agent.worker.ts?worker'
import { estimateTokens } from '@/lib/token-count'

export type { AgentMessage }

type ResetKey = number

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  providerId: string
  modelId: string
  apiKey: string
  baseUrl: string
  systemPrompt?: string
  firecrawlKeys: string[]
  firecrawlEndpoint: string
  enabledTools?: string[]
  focusMode?: string
  vaultToken?: string
  corsProxyUrl?: string
  weatherApiKeys?: Array<{ key: string; sharedSecret?: string; signatureType?: string }>
  weatherApiEndpoint?: string
  /** Optional embedding model config for semantic RAG (Level 2). */
  embeddingConfig?: { apiKey: string; baseUrl: string; modelId: string }
  /** GitHub personal access token or OAuth token for the GitHub Explorer tool. */
  githubToken?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  images?: string[]
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  isStreaming?: boolean
  timestamp: number
}

export interface ResearchStep {
  index: number
  title: string
  completed: boolean
}

export interface ResearchPlan {
  question: string
  steps: ResearchStep[]
  toolCallIds: string[]
}

export interface GeneratedFile {
  path: string
  blobUrl: string
  timestamp: number
}

export interface UseAgentReturn {
  messages: ChatMessage[]
  isRunning: boolean
  generatedFiles: GeneratedFile[]
  pendingApproval: {
    toolName: string
    input: unknown
    resolve: (approved: boolean) => void
  } | null
  pendingQuestion: {
    question: string
    options: string[]
    resolve: (answer: string) => void
  } | null
  /** Timestamp (ms) when the current agent turn started; null when idle. */
  turnStartedAt: number | null
  /** Estimated streamed token count for the current turn. */
  streamedTokens: number
  /** Actual token usage from the last completed turn; null before first turn. */
  lastTurnUsage: AgentUsage | null
  /**
   * Non-null when the last failed turn was caused by an auth/rate-limit key
   * error (401/403/429 or pattern match). Reset to null on the next sendMessage.
   */
  lastKeyError: string | null
  /**
   * Non-null while the worker is waiting for a rate-limit window to expire
   * before auto-retrying. Value is the Unix timestamp (ms) when the retry
   * will fire. Resets to null once the retry starts or the turn ends.
   */
  rateLimitRetryAt: number | null
  /** True once the worker has sent worker_ready; false while it initialises. */
  isWorkerReady: boolean
  sendMessage: (text: string, images?: string[]) => void
  abort: () => void
  reset: () => void
  /** Remove the last user message and all subsequent messages. */
  removeLastExchange: () => void
  /** Clear all messages without resetting the worker. */
  clearMessages: () => void
  /** Re-send the last user message, discarding the previous response. */
  regenerate: () => void
  /** Edit a user message (by id) and re-run from that point. */
  editAndResend: (messageId: string, newContent: string) => void
  /** Load a saved message list without touching the worker.
   * Pass agentMessages (SDK format) to fully restore tool call history. */
  loadMessages: (messages: ChatMessage[], agentMessages?: readonly AgentMessage[]) => void
  /** Returns the SDK-format messages from the last completed turn (for session persistence). */
  getLastAgentMessages: () => readonly AgentMessage[] | null
  syncVfsFile: (path: string, content: string) => void
  removeVfsFile: (path: string) => void
  addGeneratedFile: (path: string, blobUrl: string) => void
  /** Get the current reasoning steps (tool calls) for the current turn */
  getReasoningSteps: () => string[]
  /** Active research plan declared by plan_research; null when idle. */
  researchPlan: ResearchPlan | null
  /** Follow-up questions suggested by the last suggest_followups tool call. */
  followUpQuestions: string[]
  /**
   * Queue a message to be automatically re-sent after the next worker_ready
   * event (i.e. after key rotation spins up a new worker). The message is sent
   * without adding another user bubble to the chat.
   */
  /** No-arg version: snapshot comes from the most recent rate_limited message. */
  queueRetryAfterRotation: () => void
  /**
   * True when the GitHub Explorer tool has detected a rate-limit (60 req/h cap).
   * ChatView uses this to auto-open the GitHub auth modal.
   * Reset to false when a new githubToken is provided in agentConfig.
   */
  githubRateLimited: boolean
  /** Reset the githubRateLimited flag (e.g. after the modal is dismissed). */
  clearGithubRateLimit: () => void
}

// ---------------------------------------------------------------------------
// Worker message types (from worker to main thread)
// ---------------------------------------------------------------------------

type WorkerOutgoingMessage =
  | { type: 'event'; event: AgentRuntimeEvent }
  | { type: 'turn_complete'; messages: AgentMessage[]; usage?: AgentUsage }
  | { type: 'turn_error'; error: string }
  | { type: 'key_error'; error: string }
  | { type: 'rate_limited'; retryAfterSeconds: number; attempt: number; maxRetries: number; snapshot?: readonly AgentMessage[] }
  | { type: 'approval_req'; toolName: string; input: unknown; port: MessagePort }
  | { type: 'ask_question'; question: string; options: string[]; port: MessagePort }
  | { type: 'render_mermaid'; src: string; port: MessagePort }
  | { type: 'file_created'; path: string; content: string }
  | { type: 'image_generated'; url: string; vfsPath: string }
  | { type: 'worker_error'; error: string }
  | { type: 'worker_ready' }

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgent(config: AgentConfig | null): UseAgentReturn {
  const workerRef = useRef<Worker | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([])
  const [pendingApproval, setPendingApproval] = useState<UseAgentReturn['pendingApproval']>(null)
  const [pendingQuestion, setPendingQuestion] = useState<UseAgentReturn['pendingQuestion']>(null)
  const [resetKey, setResetKey] = useState<ResetKey>(0)
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null)
  const [streamedTokens, setStreamedTokens] = useState(0)
  const [lastTurnUsage, setLastTurnUsage] = useState<AgentUsage | null>(null)
  const [lastKeyError, setLastKeyError] = useState<string | null>(null)
  const [rateLimitRetryAt, setRateLimitRetryAt] = useState<number | null>(null)
  const [isWorkerReady, setIsWorkerReady] = useState(false)

  const [researchPlan, setResearchPlan] = useState<ResearchPlan | null>(null)
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([])
  const [githubRateLimited, setGithubRateLimited] = useState(false)
  const streamingMsgIdRef = useRef<string | null>(null)
  const reasoningStepsRef = useRef<string[]>([])
  // Stores the SDK-format message history from the last turn_complete.
  // Used to fully restore tool-call context when a session is reloaded.
  const lastAgentMessagesRef = useRef<readonly AgentMessage[] | null>(null)
  // Tracks the latest messages for access inside async worker handlers
  const messagesRef = useRef<ChatMessage[]>([])
  // Snapshot of agent messages at the point of the last rate-limit failure.
  // Sent by the worker inside the rate_limited message so the main thread can
  // restore context if it rotates to a new key.
  const pendingSnapshotRef = useRef<readonly AgentMessage[] | null>(null)
  // Set by queueRetryAfterRotation(); consumed by the next worker_ready.
  const pendingRotationRef = useRef(false)
  // Ref mirror of isWorkerReady for synchronous checks inside sendMessage.
  const isWorkerReadyRef = useRef(false)
  // Message queued while the worker was re-initialising (e.g. after key rotation).
  const pendingUserMessageRef = useRef<{ text: string; images?: string[] } | null>(null)

  // Keep messagesRef in sync so worker event handlers can read current messages
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // ---------------------------------------------------------------------------
  // Create / recreate worker when config changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    streamingMsgIdRef.current = null
    isWorkerReadyRef.current = false
    setIsWorkerReady(false)

    if (!config) return

    const worker = new AgentWorkerClass()

    worker.postMessage({
      type: 'init',
      providerId: config.providerId,
      modelId: config.modelId,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      firecrawlKeys: config.firecrawlKeys,
      firecrawlEndpoint: config.firecrawlEndpoint,
      systemPrompt: config.systemPrompt ?? '',
      enabledTools: config.enabledTools ?? [],
      focusMode: config.focusMode,
      vaultToken: config.vaultToken,
      corsProxyUrl: config.corsProxyUrl,
      weatherApiKeys: config.weatherApiKeys,
      weatherApiEndpoint: config.weatherApiEndpoint,
      embeddingConfig: config.embeddingConfig,
      githubToken: config.githubToken,
    })

    // -------------------------------------------------------------------------
    // Message handler
    // -------------------------------------------------------------------------

    worker.onmessage = (ev: MessageEvent<WorkerOutgoingMessage>) => {
      const msg = ev.data
      // console.log('[useAgent] onmessage ←', msg.type)

      switch (msg.type) {
        case 'event': {
          const event = msg.event
          if (event.type === 'assistant-text-delta') {
            const text = (event as any).text as string
            setStreamedTokens(prev => prev + estimateTokens(text, config.modelId))
            setMessages((prev) => {
              const streamingId = streamingMsgIdRef.current
              if (streamingId) {
                return prev.map((m) =>
                  m.id === streamingId
                    ? { ...m, content: m.content + text, isStreaming: true }
                    : m,
                )
              }
              const newMsg: ChatMessage = {
                id: uid(),
                role: 'assistant',
                content: text,
                isStreaming: true,
                timestamp: Date.now(),
              }
              streamingMsgIdRef.current = newMsg.id
              return [...prev, newMsg]
            })
          } else if (event.type === 'tool-started') {
            const toolCall = event.toolCall
            // Capture reasoning step
            reasoningStepsRef.current.push(`🔧 Calling tool "${toolCall.toolName}" with parameters: ${JSON.stringify(toolCall.input)}`)

            const msgId = uid()
            const toolMsg: ChatMessage = {
              id: msgId,
              role: 'tool',
              content: `Calling tool: ${toolCall.toolName}`,
              toolName: toolCall.toolName,
              toolInput: toolCall.input,
              timestamp: Date.now(),
            }
            setMessages((prev) => [...prev, toolMsg])
            if (toolCall.toolName !== 'plan_research' && toolCall.toolName !== 'complete_research_step') {
              setResearchPlan(prev => prev ? { ...prev, toolCallIds: [...prev.toolCallIds, msgId] } : prev)
            }
          } else if (event.type === 'tool-finished') {
            const toolCall = event.toolCall
            const toolResultPart = event.message.content.find(
              (p) => p.type === 'tool-result',
            )
            const output =
              toolResultPart?.type === 'tool-result' ? toolResultPart.output : undefined
            setMessages((prev) => {
              const idx = [...prev]
                .reverse()
                .findIndex(
                  (m) => m.role === 'tool' && m.toolName === toolCall.toolName,
                )
              if (idx === -1) return prev
              const realIdx = prev.length - 1 - idx
              const updated = [...prev]
              updated[realIdx] = {
                ...updated[realIdx],
                toolResult: output,
                content: `Tool: ${toolCall.toolName}`,
              }
              return updated
            })
            if (toolCall.toolName === 'plan_research' && output) {
              // biome-ignore lint/suspicious/noExplicitAny: dynamic tool output
              const o = output as any
              setResearchPlan({ question: o.question, steps: o.steps, toolCallIds: [] })
            }
            if (toolCall.toolName === 'complete_research_step' && output) {
              // biome-ignore lint/suspicious/noExplicitAny: dynamic tool output
              const idx = (output as any).step_index as number
              setResearchPlan(prev =>
                prev
                  ? { ...prev, steps: prev.steps.map(s => s.index === idx ? { ...s, completed: true } : s) }
                  : prev
              )
            }
            if (toolCall.toolName === 'suggest_followups' && output) {
              // biome-ignore lint/suspicious/noExplicitAny: dynamic tool output
              const questions = (output as any).questions
              if (Array.isArray(questions)) setFollowUpQuestions(questions as string[])
            }
            // GitHub rate-limit detection: tool returns { rateLimited: true }
            if (toolCall.toolName === 'github' && output) {
              // biome-ignore lint/suspicious/noExplicitAny: dynamic tool output
              if ((output as any).rateLimited === true) setGithubRateLimited(true)
            }
          }
          break
        }

        case 'turn_complete': {
          setIsRunning(false)
          setTurnStartedAt(null)
          setRateLimitRetryAt(null)
          streamingMsgIdRef.current = null
          if (msg.usage) setLastTurnUsage(msg.usage)
          lastAgentMessagesRef.current = msg.messages
          setMessages((prev) =>
            prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
          )
          break
        }

        case 'key_error': {
          setLastKeyError(msg.error)
          break
        }

        case 'rate_limited': {
          setRateLimitRetryAt(Date.now() + Math.ceil(msg.retryAfterSeconds) * 1000)
          if (msg.snapshot) {
            pendingSnapshotRef.current = msg.snapshot
          }
          break
        }

        case 'turn_error': {
          setIsRunning(false)
          setTurnStartedAt(null)
          setRateLimitRetryAt(null)
          streamingMsgIdRef.current = null
          const errorMsg: ChatMessage = {
            id: uid(),
            role: 'assistant',
            content: `Error: ${msg.error}`,
            isStreaming: false,
            timestamp: Date.now(),
          }
          setMessages((prev) => [
            ...prev.map((m) =>
              m.isStreaming ? { ...m, isStreaming: false } : m,
            ),
            errorMsg,
          ])
          break
        }

        case 'approval_req': {
          const { toolName, input, port } = msg
          setPendingApproval({
            toolName,
            input,
            resolve: (approved: boolean) => {
              port.postMessage({ approved })
              setPendingApproval(null)
            },
          })
          break
        }

        case 'ask_question': {
          const { question, options, port } = msg
          setPendingQuestion({
            question,
            options,
            resolve: (answer: string) => {
              port.postMessage({ answer })
              setPendingQuestion(null)
            },
          })
          break
        }

        case 'render_mermaid': {
          const { src, port } = msg
          ;(async () => {
            try {
              const { default: mermaid } = await import('mermaid')
              mermaid.initialize({ startOnLoad: false })
              const { svg } = await mermaid.render(`mermaid-pdf-${Date.now()}`, src)
              const canvas = document.createElement('canvas')
              const img = new Image()
              const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
              const svgUrl = URL.createObjectURL(svgBlob)
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve()
                img.onerror = () => reject(new Error('svg load failed'))
                img.src = svgUrl
              })
              URL.revokeObjectURL(svgUrl)
              canvas.width = img.naturalWidth || 800
              canvas.height = img.naturalHeight || 600
              const ctx2d = canvas.getContext('2d')!
              ctx2d.fillStyle = '#ffffff'
              ctx2d.fillRect(0, 0, canvas.width, canvas.height)
              ctx2d.drawImage(img, 0, 0)
              port.postMessage({ dataUrl: canvas.toDataURL('image/png') })
            } catch (e) {
              console.warn('[useAgent] Mermaid render failed:', e)
              port.postMessage({ dataUrl: '' })
            }
          })()
          break
        }

        case 'file_created': {
          const { path, content } = msg
          let blobUrl: string
          if (content.startsWith('data:')) {
            const commaIdx = content.indexOf(',')
            const mimeMatch = content.slice(0, commaIdx).match(/:(.*?);/)
            const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
            const u8arr = Uint8Array.from(atob(content.slice(commaIdx + 1)), c => c.charCodeAt(0))
            blobUrl = URL.createObjectURL(new Blob([u8arr], { type: mime }))
          } else {
            blobUrl = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
          }
          setGeneratedFiles((prev) => [
            ...prev,
            { path, blobUrl, timestamp: Date.now() },
          ])
          break
        }

        case 'image_generated': {
          const { url, vfsPath } = msg
          // Push a dedicated assistant message for the image (arrives before LLM text response)
          setMessages(prev => [...prev, {
            id: uid(),
            role: 'assistant' as const,
            content: '',
            images: [url],
            timestamp: Date.now(),
          }])
          // Store the signed URL as a text file in VFS — readable by the JS sandbox
          workerRef.current?.postMessage({ type: 'vfs_add', path: vfsPath, content: url })
          // Add to the file sidebar (Azure URL works as download link for JPEG)
          setGeneratedFiles(prev => {
            const entry = { path: vfsPath, blobUrl: url, timestamp: Date.now() }
            const idx = prev.findIndex(f => f.path === vfsPath)
            if (idx >= 0) { const u = [...prev]; u[idx] = entry; return u }
            return [...prev, entry]
          })
          break
        }

        case 'worker_error': {
          console.error('[agent.worker] error:', msg.error)
          setIsRunning(false)
          setTurnStartedAt(null)
          streamingMsgIdRef.current = null
          break
        }

        case 'worker_ready': {
          isWorkerReadyRef.current = true
          setIsWorkerReady(true)
          console.log('[agent.worker] ready — imports loaded successfully')
          if (pendingRotationRef.current && pendingSnapshotRef.current) {
            pendingRotationRef.current = false
            const snapshot = pendingSnapshotRef.current
            pendingSnapshotRef.current = null
            // Stop any in-progress streaming indicator from the old worker
            setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
            streamingMsgIdRef.current = null
            reasoningStepsRef.current = []
            // Restore the exact agent state at the point of failure (includes
            // all tool calls already done) so only the last LLM POST is re-sent.
            worker.postMessage({ type: 'restore_messages', messages: snapshot })
            // agent.continue() resumes from the last tool result instead of
            // restarting the whole agentic loop from the user message.
            worker.postMessage({ type: 'continue_run' })
            setIsRunning(true)
            setTurnStartedAt(Date.now())
            setStreamedTokens(0)
            setLastKeyError(null)
            setRateLimitRetryAt(null)
          } else if (pendingUserMessageRef.current) {
            // Drain a user message that arrived while the worker was initialising
            const { text, images } = pendingUserMessageRef.current
            pendingUserMessageRef.current = null
            worker.postMessage({ type: 'run', message: text, images })
          }
          break
        }
      }
    }

    worker.onerror = (err: ErrorEvent) => {
      console.error('Agent worker error:', err.message, err.filename, `L${err.lineno}:${err.colno}`, err.error ?? err)
      setIsRunning(false)
      setTurnStartedAt(null)
      streamingMsgIdRef.current = null
      // Terminate the dead worker so it doesn't become an orphan consuming memory.
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    worker.onmessageerror = (err) => {
      console.error('Agent worker message error:', err)
    }

    workerRef.current = worker

    return () => {
      worker.terminate()
      workerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resetKey,
    config?.providerId,
    config?.modelId,
    config?.apiKey,
    config?.baseUrl,
    config?.systemPrompt,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(config?.firecrawlKeys),
    config?.firecrawlEndpoint,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(config?.enabledTools),
    config?.vaultToken,
    config?.corsProxyUrl,
    config?.githubToken,
  ])

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    (text: string, images?: string[]) => {
      if (!workerRef.current) {
        console.warn('[useAgent] sendMessage: no worker — message dropped')
        return
      }
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text,
        images,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMsg])
      setIsRunning(true)
      setTurnStartedAt(Date.now())
      setStreamedTokens(0)
      setLastKeyError(null)
      setRateLimitRetryAt(null)
      setFollowUpQuestions([])
      streamingMsgIdRef.current = null
      reasoningStepsRef.current = []
      if (!isWorkerReadyRef.current) {
        // Worker is still loading — queue the message; worker_ready will drain it.
        pendingUserMessageRef.current = { text, images }
        return
      }
      workerRef.current.postMessage({ type: 'run', message: text, images })
    },
    [],
  )

  const abort = useCallback(() => {
    workerRef.current?.postMessage({ type: 'abort' })
    setIsRunning(false)
    setTurnStartedAt(null)
    streamingMsgIdRef.current = null
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
    )
  }, [])

  const reset = useCallback(() => {
    streamingMsgIdRef.current = null
    setMessages([])
    setIsRunning(false)
    setTurnStartedAt(null)
    setStreamedTokens(0)
    setGeneratedFiles([])
    setPendingApproval(null)
    setPendingQuestion(null)
    setFollowUpQuestions([])
    setResetKey((k) => k + 1)
  }, [])

  const removeLastExchange = useCallback(() => {
    setMessages(prev => {
      let lastUserIdx = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'user') { lastUserIdx = i; break }
      }
      return lastUserIdx === -1 ? prev : prev.slice(0, lastUserIdx)
    })
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setTurnStartedAt(null)
    setStreamedTokens(0)
    setFollowUpQuestions([])
    streamingMsgIdRef.current = null
  }, [])

  const loadMessages = useCallback((msgs: ChatMessage[], agentMsgs?: readonly AgentMessage[]) => {
    setMessages(msgs)
    setTurnStartedAt(null)
    setStreamedTokens(0)
    streamingMsgIdRef.current = null
    if (workerRef.current) {
      // Prefer SDK-format messages (full tool-call history) when available.
      // Fall back to reconstructing from ChatMessage[] for sessions saved before
      // this field existed (only user/assistant text is recovered in that case).
      const toRestore: AgentMessage[] = agentMsgs
        ? [...agentMsgs]
        : msgs
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => {
              const content: AgentMessage['content'] = [{ type: 'text', text: m.content }]
              if (m.role === 'user' && m.images?.length) {
                const imageParts = m.images.map((url) => ({
                  type: 'image' as const,
                  image: url,
                  mediaType: (url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg',
                }))
                return { id: m.id, role: m.role as AgentMessage['role'], content: [...content, ...imageParts], createdAt: m.timestamp }
              }
              return { id: m.id, role: m.role as AgentMessage['role'], content, createdAt: m.timestamp }
            })
      workerRef.current.postMessage({ type: 'restore_messages', messages: toRestore })
    }
  }, [])

  const getLastAgentMessages = useCallback((): readonly AgentMessage[] | null => {
    return lastAgentMessagesRef.current
  }, [])

  const syncVfsFile = useCallback((path: string, content: string) => {
    workerRef.current?.postMessage({ type: 'vfs_add', path, content })
  }, [])

  const removeVfsFile = useCallback((path: string) => {
    workerRef.current?.postMessage({ type: 'vfs_remove', path })
  }, [])

  const addGeneratedFile = useCallback((path: string, blobUrl: string) => {
    setGeneratedFiles(prev => {
      const entry = { path, blobUrl, timestamp: Date.now() }
      const idx = prev.findIndex(f => f.path === path)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = entry
        return updated
      }
      return [...prev, entry]
    })
  }, [])

  const getReasoningSteps = useCallback(() => {
    return [...reasoningStepsRef.current]
  }, [])

  const queueRetryAfterRotation = useCallback(() => {
    pendingRotationRef.current = true
  }, [])

  // Helper: build AgentMessage[] from a slice of ChatMessages (no SDK history)
  function buildAgentMessages(msgs: ChatMessage[]): AgentMessage[] {
    return msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const content: AgentMessage['content'] = [{ type: 'text', text: m.content }]
        if (m.role === 'user' && m.images?.length) {
          const imageParts = m.images.map(url => ({
            type: 'image' as const,
            image: url,
            mediaType: (url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg',
          }))
          return { id: m.id, role: m.role as AgentMessage['role'], content: [...content, ...imageParts], createdAt: m.timestamp }
        }
        return { id: m.id, role: m.role as AgentMessage['role'], content, createdAt: m.timestamp }
      })
  }

  function startRun(userMsg: ChatMessage, contextBefore: ChatMessage[]) {
    if (!workerRef.current) return
    setMessages([...contextBefore, userMsg])
    setIsRunning(true)
    setTurnStartedAt(Date.now())
    setStreamedTokens(0)
    setLastKeyError(null)
    setRateLimitRetryAt(null)
    setFollowUpQuestions([])
    streamingMsgIdRef.current = null
    reasoningStepsRef.current = []
    workerRef.current.postMessage({ type: 'restore_messages', messages: buildAgentMessages(contextBefore) })
    workerRef.current.postMessage({ type: 'run', message: userMsg.content, images: userMsg.images })
  }

  const regenerate = useCallback(() => {
    const msgs = messagesRef.current
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx === -1) return
    startRun(msgs[lastUserIdx], msgs.slice(0, lastUserIdx))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editAndResend = useCallback((messageId: string, newContent: string) => {
    const msgs = messagesRef.current
    const idx = msgs.findIndex(m => m.id === messageId)
    if (idx === -1) return
    const editedMsg: ChatMessage = { ...msgs[idx], content: newContent }
    startRun(editedMsg, msgs.slice(0, idx))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearGithubRateLimit = useCallback(() => setGithubRateLimited(false), [])

  return {
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
    isWorkerReady,
    sendMessage,
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
    regenerate,
    editAndResend,
    githubRateLimited,
    clearGithubRateLimit,
  }
}
