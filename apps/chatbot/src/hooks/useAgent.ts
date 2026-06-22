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
  sendMessage: (text: string, images?: string[]) => void
  abort: () => void
  reset: () => void
  /** Remove the last user message and all subsequent messages. */
  removeLastExchange: () => void
  /** Clear all messages without resetting the worker. */
  clearMessages: () => void
  /** Load a saved message list without touching the worker. */
  loadMessages: (messages: ChatMessage[]) => void
  syncVfsFile: (path: string, content: string) => void
  removeVfsFile: (path: string) => void
  addGeneratedFile: (path: string, blobUrl: string) => void
}

// ---------------------------------------------------------------------------
// Worker message types (from worker to main thread)
// ---------------------------------------------------------------------------

type WorkerOutgoingMessage =
  | { type: 'event'; event: AgentRuntimeEvent }
  | { type: 'turn_complete'; messages: AgentMessage[]; usage?: AgentUsage }
  | { type: 'turn_error'; error: string }
  | { type: 'key_error'; error: string }
  | { type: 'rate_limited'; retryAfterSeconds: number; attempt: number; maxRetries: number }
  | { type: 'approval_req'; toolName: string; input: unknown; port: MessagePort }
  | { type: 'ask_question'; question: string; options: string[]; port: MessagePort }
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

  const streamingMsgIdRef = useRef<string | null>(null)

  // ---------------------------------------------------------------------------
  // Create / recreate worker when config changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    streamingMsgIdRef.current = null

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
    })

    // -------------------------------------------------------------------------
    // Message handler
    // -------------------------------------------------------------------------

    worker.onmessage = (ev: MessageEvent<WorkerOutgoingMessage>) => {
      const msg = ev.data
      console.log('[useAgent] onmessage ←', msg.type)

      switch (msg.type) {
        case 'event': {
          const event = msg.event
          if (event.type === 'assistant-text-delta') {
            const text = (event as any).text as string
            setStreamedTokens(prev => prev + Math.max(1, Math.round(text.length / 4)))
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
            const toolMsg: ChatMessage = {
              id: uid(),
              role: 'tool',
              content: `Calling tool: ${toolCall.toolName}`,
              toolName: toolCall.toolName,
              toolInput: toolCall.input,
              timestamp: Date.now(),
            }
            setMessages((prev) => [...prev, toolMsg])
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
          }
          break
        }

        case 'turn_complete': {
          setIsRunning(false)
          setTurnStartedAt(null)
          setRateLimitRetryAt(null)
          streamingMsgIdRef.current = null
          if (msg.usage) setLastTurnUsage(msg.usage)
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
          console.log('[agent.worker] ready — imports loaded successfully')
          break
        }
      }
    }

    worker.onerror = (err: ErrorEvent) => {
      console.error('Agent worker error:', err.message, err.filename, `L${err.lineno}:${err.colno}`, err.error ?? err)
      setIsRunning(false)
      setTurnStartedAt(null)
      streamingMsgIdRef.current = null
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
      streamingMsgIdRef.current = null
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
    streamingMsgIdRef.current = null
  }, [])

  const loadMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs)
    setTurnStartedAt(null)
    setStreamedTokens(0)
    streamingMsgIdRef.current = null
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
    sendMessage,
    abort,
    reset,
    removeLastExchange,
    clearMessages,
    loadMessages,
    syncVfsFile,
    removeVfsFile,
    addGeneratedFile,
  }
}
