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
/// <reference lib="webworker" />

// ---------------------------------------------------------------------------
// Types for messages received by this worker
// ---------------------------------------------------------------------------

interface InitMessage {
  type: 'init'
  providerId: string
  modelId: string
  apiKey: string
  baseUrl: string
  firecrawlKeys: string[]
  firecrawlEndpoint: string
  systemPrompt: string
  enabledTools: string[]
  focusMode?: string
  vaultToken?: string
  corsProxyUrl?: string
  weatherApiKeys?: Array<{ key: string; sharedSecret?: string; signatureType?: string }>
  weatherApiEndpoint?: string
  embeddingConfig?: { apiKey: string; baseUrl: string; modelId: string }
  githubToken?: string
}

interface RunMessage {
  type: 'run'
  message: string
  images?: string[]
}

interface VfsAddMessage {
  type: 'vfs_add'
  path: string
  content: string
}

interface VfsRemoveMessage {
  type: 'vfs_remove'
  path: string
}

interface ContinueRunMessage {
  type: 'continue_run'
}

interface AbortMessage {
  type: 'abort'
}

interface ApprovalResponseMessage {
  type: 'approval_response'
  port: MessagePort
}

interface RestoreMessagesMessage {
  type: 'restore_messages'
  messages: unknown[]
}

type WorkerIncomingMessage =
  | InitMessage
  | RunMessage
  | ContinueRunMessage
  | VfsAddMessage
  | VfsRemoveMessage
  | AbortMessage
  | ApprovalResponseMessage
  | RestoreMessagesMessage

// ---------------------------------------------------------------------------
// Key error detection (mirrors isKeyRelatedError in lib/keypool-usage.ts)
// ---------------------------------------------------------------------------

function isKeyRelatedError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    /\b401\b/.test(m) ||
    /\b403\b/.test(m) ||
    /\b429\b/.test(m) ||
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('quota') ||
    m.includes('unauthorized') ||
    m.includes('forbidden') ||
    m.includes('too many requests') ||
    m.includes('throttle') ||
    m.includes('resource exhausted') ||
    m.includes('insufficient_quota')
  )
}

function parseRetryAfterSeconds(message: string): number | null {
  const match = message.match(/\[retry_after=(\d+(?:\.\d+)?)\]/)
  if (!match) return null
  const seconds = parseFloat(match[1])
  return isNaN(seconds) || seconds <= 0 ? null : seconds
}

// ---------------------------------------------------------------------------
// Imported types (type-only, erased at runtime)
// ---------------------------------------------------------------------------

import type { AgentRuntimeEvent, AgentMessage, ToolApprovalResult, Agent as AgentType, AgentUsage } from '@sctg/cline-agents'
import type { VirtualFS as VirtualFSType } from '@/vfs/virtual-fs'
import type { RagIndex as RagIndexType } from '@/lib/rag/rag-index'

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let vfs: VirtualFSType | null = null
let ragIndex: RagIndexType | null = null
let agent: AgentType | null = null

// Queue for vfs_add/vfs_remove messages that arrive before handleInit completes
type PendingVfsOp =
  | { type: 'add'; path: string; content: string }
  | { type: 'remove'; path: string }
const pendingVfsOps: PendingVfsOp[] = []

/** Index a file in the RAG index only if it looks like indexable text (not a binary data URL). */
function indexIfText(path: string, content: string): void {
  if (!ragIndex) return
  // Skip binary content sent as data: URLs
  if (content.startsWith('data:')) return
  // Skip empty content
  if (!content.trim()) return
  // Fire-and-forget; failures are silently swallowed inside RagIndex
  void ragIndex.indexDocument(path, content)
}

// ---------------------------------------------------------------------------
// Bridge helpers: communicate back to main thread
// ---------------------------------------------------------------------------

function postEvent(event: AgentRuntimeEvent): void {
  self.postMessage({ type: 'event', event })
}

function postTurnComplete(messages: readonly AgentMessage[], usage?: AgentUsage): void {
  self.postMessage({ type: 'turn_complete', messages, usage })
}

function postTurnError(error: string): void {
  self.postMessage({ type: 'turn_error', error })
}

function postKeyError(error: string): void {
  self.postMessage({ type: 'key_error', error })
}

function postRateLimited(
  retryAfterSeconds: number,
  attempt: number,
  maxRetries: number,
  snapshot: readonly AgentMessage[],
): void {
  self.postMessage({ type: 'rate_limited', retryAfterSeconds, attempt, maxRetries, snapshot })
}

function postFileCreated(path: string, content: string): void {
  self.postMessage({ type: 'file_created', path, content })
}

function postImageGenerated(url: string, vfsPath: string): void {
  self.postMessage({ type: 'image_generated', url, vfsPath })
}

function postWorkerError(error: string): void {
  self.postMessage({ type: 'worker_error', error })
}

// ---------------------------------------------------------------------------
// ask_question bridge
// ---------------------------------------------------------------------------

function onAskQuestion(question: string, options: string[]): Promise<string> {
  return new Promise<string>((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = (ev: MessageEvent<{ answer: string }>) => {
      port1.close()
      resolve(ev.data.answer)
    }
    self.postMessage({ type: 'ask_question', question, options, port: port2 }, [port2])
  })
}

// ---------------------------------------------------------------------------
// render_mermaid bridge
// ---------------------------------------------------------------------------

function renderMermaid(src: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = (ev: MessageEvent<{ dataUrl: string }>) => {
      port1.close()
      resolve(ev.data.dataUrl ?? '')
    }
    self.postMessage({ type: 'render_mermaid', src, port: port2 }, [port2])
  })
}

// ---------------------------------------------------------------------------
// requestToolApproval bridge
// ---------------------------------------------------------------------------

function requestToolApproval(
  toolName: string,
  input: unknown,
): Promise<ToolApprovalResult> {
  return new Promise<ToolApprovalResult>((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = (
      ev: MessageEvent<{ approved: boolean; reason?: string }>,
    ) => {
      port1.close()
      resolve({
        approved: ev.data.approved,
        reason: ev.data.reason,
      })
    }
    self.postMessage(
      { type: 'approval_req', toolName, input, port: port2 },
      [port2],
    )
  })
}

// ---------------------------------------------------------------------------
// Init handler — uses dynamic imports to surface actual error messages
// ---------------------------------------------------------------------------

async function handleInit(msg: InitMessage): Promise<void> {
  try {
    const [{ Agent }, { VirtualFS }, { RagIndex }, { createBrowserTools }, { createOptionalTools: createOptionalTools }] = await Promise.all([
      import('@sctg/cline-agents'),
      import('@/vfs/virtual-fs'),
      import('@/lib/rag/rag-index'),
      import('@/tools/index'),
      import('@/tools/worker-tools/index'),
    ])

    vfs = new VirtualFS()
    ragIndex = new RagIndex(msg.embeddingConfig)

    // Flush any vfs_add/vfs_remove messages that arrived before init completed
    for (const op of pendingVfsOps) {
      if (op.type === 'add') {
        vfs.write(op.path, op.content)
        indexIfText(op.path, op.content)
      } else {
        vfs.delete(op.path)
        ragIndex.removeDocument(op.path)
      }
    }
    pendingVfsOps.length = 0

    const tools = [
      ...createBrowserTools({
        vfs,
        firecrawlKeys: msg.firecrawlKeys,
        firecrawlEndpoint: msg.firecrawlEndpoint,
        onFileCreated: postFileCreated,
        onAskQuestion,
        enabledTools: msg.enabledTools ?? [],
        // biome-ignore lint/suspicious/noExplicitAny: FocusMode type lives in tools layer
        focusMode: msg.focusMode as any,
      }),
      ...createOptionalTools(msg.enabledTools ?? [], {
        vfs,
        ragIndex,
        onFileCreated: postFileCreated,
        apiKey: msg.apiKey,
        providerId: msg.providerId,
        onImageGenerated: postImageGenerated,
        onAskQuestion,
        vaultToken: msg.vaultToken,
        corsProxyUrl: msg.corsProxyUrl,
        weatherApiKeys: msg.weatherApiKeys,
        weatherApiEndpoint: msg.weatherApiEndpoint,
        renderMermaid,
        githubToken: msg.githubToken,
      }),
    ]

    // console.log('[agent.worker] Agent config:', {
    //   providerId: msg.providerId,
    //   modelId: msg.modelId,
    //   apiKeyLength: msg.apiKey?.length ?? 0,
    //   apiKeyPrefix: msg.apiKey?.slice(0, 8) + '...',
    //   baseUrl: msg.baseUrl,
    // })

    agent = new Agent({
      providerId: msg.providerId,
      modelId: msg.modelId,
      apiKey: msg.apiKey,
      baseUrl: msg.baseUrl,
      systemPrompt: msg.systemPrompt,
      tools,
      requestToolApproval: async (req) => {
        return requestToolApproval(req.toolName, req.input)
      },
    })

    agent.subscribe((event: AgentRuntimeEvent) => {
      if (event.type === 'run-failed') {
        const err = (event as any).error
        console.error('[agent.worker] run-failed error:', err?.message ?? err, '\nstack:', err?.stack)
        // Relay error to main thread immediately so user sees it
        postWorkerError(`run-failed: ${err?.message ?? String(err)}`)
      } else {
        // console.log('[agent.worker] event →', event.type)
      }
      postEvent(event)
    })

    self.postMessage({ type: 'worker_ready' })
  } catch (err) {
    const message = err instanceof Error
      ? `${err.message}\n${err.stack ?? ''}`
      : String(err)
    postWorkerError(`init failed: ${message}`)
  }
}

// ---------------------------------------------------------------------------
// Run handlers
// ---------------------------------------------------------------------------

const MAX_RATE_LIMIT_RETRIES = 5
const DEFAULT_RATE_LIMIT_WAIT_S = 30

/**
 * Shared retry loop used by both handleRun and handleContinueRun.
 *
 * - attempt 0  : calls firstCall() (agent.run or agent.continue)
 * - attempt 1+ : restores to result.messages from the previous attempt
 *                (preserves all tool calls already done) then calls
 *                agent.continue() — only the last LLM POST is re-sent.
 *
 * key_error is sent only on the final failure so it doesn't race with the
 * rate_limited-driven key rotation in the main thread.
 */
async function executeWithRetry(
  firstCall: () => Promise<Awaited<ReturnType<AgentType['run']>>>,
): Promise<void> {
  if (!agent) {
    postTurnError('Agent not initialized.')
    return
  }

  let prevResult: Awaited<ReturnType<AgentType['run']>> | null = null

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    let result: Awaited<ReturnType<AgentType['run']>>
    try {
      if (attempt === 0) {
        result = await firstCall()
      } else {
        // Restore to the exact state just before the failed LLM call, then
        // continue — this resumes from the last tool result, not from the
        // user's original message.
        if (prevResult) agent.restore(prevResult.messages)
        result = await agent.continue()
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[agent.worker] agent call threw:', errMsg)
      postTurnError(`Agent runtime error: ${errMsg}`)
      return
    }

    if (result.status !== 'failed') {
      // console.log('[agent.worker] completed, messages:', result.messages.length)
      postTurnComplete(result.messages, result.usage)
      return
    }

    prevResult = result

    const errorMsg = result.error?.message ?? 'Run failed'
    const retryAfter = parseRetryAfterSeconds(errorMsg)
    const isRateLimit = isKeyRelatedError(errorMsg)
    const cleanMsg = errorMsg.replace(/\n\[retry_after=\d+(?:\.\d+)?\]$/, '')

    if (isRateLimit && attempt < MAX_RATE_LIMIT_RETRIES) {
      const waitSeconds = retryAfter ?? DEFAULT_RATE_LIMIT_WAIT_S
      //console.log('[agent.worker] rate limited, retrying in', waitSeconds, 's (attempt', attempt + 1, '/', MAX_RATE_LIMIT_RETRIES, ')')
      // Include the current message snapshot so the main thread can restore
      // context if it decides to rotate to a new key.
      postRateLimited(waitSeconds, attempt + 1, MAX_RATE_LIMIT_RETRIES, result.messages)
      await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(waitSeconds) * 1000))
      continue
    }

    // Non-retryable error or all retries exhausted — send key_error only here
    // so the main-thread lastKeyError effect doesn't race with rate_limited.
    const fullMsg = result.error?.stack ? `${cleanMsg}\n${result.error.stack}` : cleanMsg
    console.error('[agent.worker] error:', fullMsg)
    if (isRateLimit) postKeyError(cleanMsg)
    postTurnError(cleanMsg)
    return
  }
}

async function handleRun(msg: RunMessage): Promise<void> {
  // console.log('[agent.worker] handleRun start, agent:', !!agent)
  if (!agent) {
    postTurnError('Agent not initialized. Send an init message first.')
    return
  }

  let runInput: string | AgentMessage
  if (msg.images && msg.images.length > 0) {
    runInput = {
      id: `user_${Date.now()}`,
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: msg.message },
        ...msg.images.map((url) => ({
          type: 'image' as const,
          image: url,
          mediaType: url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        })),
      ],
      createdAt: Date.now(),
    } satisfies AgentMessage
  } else {
    runInput = msg.message
  }

  await executeWithRetry(() => agent!.run(runInput))
}

async function handleContinueRun(): Promise<void> {
  // console.log('[agent.worker] handleContinueRun start, agent:', !!agent)
  if (!agent) {
    postTurnError('Agent not initialized. Send an init message first.')
    return
  }
  await executeWithRetry(() => agent!.continue())
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

self.onmessage = (ev: MessageEvent<WorkerIncomingMessage>) => {
  const msg = ev.data
  // console.log('[agent.worker] onmessage type:', msg.type)

  switch (msg.type) {
    case 'init':
      void handleInit(msg)
      break

    case 'run':
      void handleRun(msg)
      break

    case 'continue_run':
      void handleContinueRun()
      break

    case 'vfs_add':
      if (vfs) {
        vfs.write(msg.path, msg.content)
        indexIfText(msg.path, msg.content)
      } else {
        pendingVfsOps.push({ type: 'add', path: msg.path, content: msg.content })
      }
      break

    case 'vfs_remove':
      if (vfs) {
        vfs.delete(msg.path)
        ragIndex?.removeDocument(msg.path)
      } else {
        pendingVfsOps.push({ type: 'remove', path: msg.path })
      }
      break

    case 'abort':
      agent?.abort()
      break

    case 'approval_response':
      break

    case 'restore_messages':
      if (agent) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        agent.restore(msg.messages as any[])
      }
      break

    default: {
      const _exhaustive: never = msg
      void _exhaustive
    }
  }
}
