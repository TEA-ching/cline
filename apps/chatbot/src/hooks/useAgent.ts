import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentRuntimeEvent, AgentMessage } from '@cline/agents'
import AgentWorkerClass from '../workers/agent.worker.ts?worker'

// Internal symbol to force worker re-creation on reset()
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
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
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
  sendMessage: (text: string, images?: string[]) => void
  abort: () => void
  reset: () => void
  syncVfsFile: (path: string, content: string) => void
  removeVfsFile: (path: string) => void
}

// ---------------------------------------------------------------------------
// Worker message types (from worker to main thread)
// ---------------------------------------------------------------------------

type WorkerOutgoingMessage =
  | { type: 'event'; event: AgentRuntimeEvent }
  | { type: 'turn_complete'; messages: AgentMessage[] }
  | { type: 'turn_error'; error: string }
  | {
      type: 'approval_req'
      toolName: string
      input: unknown
      port: MessagePort
    }
  | {
      type: 'ask_question'
      question: string
      options: string[]
      port: MessagePort
    }
  | { type: 'file_created'; path: string; content: string }
  | { type: 'worker_error'; error: string }
  | { type: 'worker_ready' }

// ---------------------------------------------------------------------------
// ID generation (no Node crypto)
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

  // Track the ID of the current streaming assistant message
  const streamingMsgIdRef = useRef<string | null>(null)

  // ---------------------------------------------------------------------------
  // Create / recreate worker when config changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    streamingMsgIdRef.current = null

    if (!config) return

    const worker = new AgentWorkerClass()

    // Send init message immediately
    worker.postMessage({
      type: 'init',
      providerId: config.providerId,
      modelId: config.modelId,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      firecrawlKeys: config.firecrawlKeys,
      firecrawlEndpoint: config.firecrawlEndpoint,
      systemPrompt: config.systemPrompt ?? '',
    })

    // ---------------------------------------------------------------------------
    // Message handler
    // ---------------------------------------------------------------------------

    worker.onmessage = (ev: MessageEvent<WorkerOutgoingMessage>) => {
      const msg = ev.data
      console.log('[useAgent] onmessage ←', msg.type)

      switch (msg.type) {
        case 'event': {
          const event = msg.event
          if (event.type === 'assistant-text-delta') {
            console.log('[useAgent] text-delta text:', JSON.stringify((event as any).text), 'streamingId:', streamingMsgIdRef.current)
            // Accumulate into the streaming assistant message
            setMessages((prev) => {
              const streamingId = streamingMsgIdRef.current

              if (streamingId) {
                // Append delta to existing streaming message
                return prev.map((m) =>
                  m.id === streamingId
                    ? { ...m, content: m.content + (event as any).text, isStreaming: true }
                    : m,
                )
              }

              // Create a new streaming message
              const newMsg: ChatMessage = {
                id: uid(),
                role: 'assistant',
                content: (event as any).text,
                isStreaming: true,
                timestamp: Date.now(),
              }
              streamingMsgIdRef.current = newMsg.id
              console.log('[useAgent] created streaming msg, messages will be:', prev.length + 1)
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
              // Update the most recent tool message for this toolCallId
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
          streamingMsgIdRef.current = null
          // Mark the last streaming message as done
          setMessages((prev) =>
            prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
          )
          break
        }

        case 'turn_error': {
          setIsRunning(false)
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
          const blobUrl = URL.createObjectURL(
            new Blob([content], { type: 'text/plain' }),
          )
          setGeneratedFiles((prev) => [
            ...prev,
            { path, blobUrl, timestamp: Date.now() },
          ])
          break
        }

        case 'worker_error': {
          console.error('[agent.worker] error:', msg.error)
          setIsRunning(false)
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
    // firecrawlKeys / firecrawlEndpoint are serialised each render — stringify to stabilise
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(config?.firecrawlKeys),
    config?.firecrawlEndpoint,
  ])

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    (text: string, images?: string[]) => {
      console.log('[useAgent] sendMessage called, workerRef.current:', !!workerRef.current, '| text:', text)
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
      streamingMsgIdRef.current = null
      console.log('[useAgent] postMessage run →', text)
      workerRef.current.postMessage({ type: 'run', message: text, images })
    },
    [],
  )

  const abort = useCallback(() => {
    workerRef.current?.postMessage({ type: 'abort' })
    setIsRunning(false)
    streamingMsgIdRef.current = null
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
    )
  }, [])

  const reset = useCallback(() => {
    // Clear UI state. The useEffect will terminate the old worker and create a
    // new one because resetKey changes.
    streamingMsgIdRef.current = null
    setMessages([])
    setIsRunning(false)
    setGeneratedFiles([])
    setPendingApproval(null)
    setPendingQuestion(null)
    setResetKey((k) => k + 1)
  }, [])

  const syncVfsFile = useCallback((path: string, content: string) => {
    workerRef.current?.postMessage({ type: 'vfs_add', path, content })
  }, [])

  const removeVfsFile = useCallback((path: string) => {
    workerRef.current?.postMessage({ type: 'vfs_remove', path })
  }, [])

  return {
    messages,
    isRunning,
    generatedFiles,
    pendingApproval,
    pendingQuestion,
    sendMessage,
    abort,
    reset,
    syncVfsFile,
    removeVfsFile,
  }
}
