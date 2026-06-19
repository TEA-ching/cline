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
import {
  newQuickJSWASMModuleFromVariant,
  newQuickJSAsyncWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  isFail,
} from 'quickjs-emscripten'
import type { QuickJSWASMModule, QuickJSAsyncWASMModule } from 'quickjs-emscripten'
import singlefileVariant from '@jitl/quickjs-singlefile-browser-release-sync'
import asyncifyVariant from '@jitl/quickjs-singlefile-browser-release-asyncify'
import { transform } from 'sucrase'
import type { VirtualFS } from '@/vfs/virtual-fs'

const TIMEOUT_MS = 5_000
const ASYNC_TIMEOUT_MS = 25_000
const FETCH_TIMEOUT_MS = 15_000
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024 // 64 MB
const MAX_STACK_BYTES = 1024 * 1024          // 1 MB

let modulePromise: Promise<QuickJSWASMModule> | null = null
let asyncModulePromise: Promise<QuickJSAsyncWASMModule> | null = null

function getModule(): Promise<QuickJSWASMModule> {
  return (modulePromise ??= newQuickJSWASMModuleFromVariant(singlefileVariant))
}

function getAsyncModule(): Promise<QuickJSAsyncWASMModule> {
  return (asyncModulePromise ??= newQuickJSAsyncWASMModuleFromVariant(asyncifyVariant))
}

export interface SandboxResult {
  output: string
  error?: string
  filesWritten: string[]
}

function serializeValue(val: unknown): string {
  if (val === undefined || val === null) return String(val)
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

// biome-ignore lint/suspicious/noExplicitAny: QuickJS context types share the same API but differ in generics
function injectConsoleBridge(ctx: any, logs: string[]): void {
  const logFn = ctx.newFunction('log', (...args: any[]) => {
    const parts = args.map((a: any) => serializeValue(ctx.dump(a)))
    logs.push(parts.join(' '))
  })
  const consoleHandle = ctx.newObject()
  for (const method of ['log', 'warn', 'error', 'info']) {
    ctx.setProp(consoleHandle, method, logFn)
  }
  ctx.setProp(ctx.global, 'console', consoleHandle)
  logFn.dispose()
  consoleHandle.dispose()
}

// biome-ignore lint/suspicious/noExplicitAny: QuickJS context types share the same API but differ in generics
function injectVfsBridge(ctx: any, vfs: VirtualFS, filesWritten: string[]): void {
  const vfsHandle = ctx.newObject()

  const vfsReadFn = ctx.newFunction('read', (...args: any[]) => {
    try {
      if (args.length === 0) return ctx.newString('Error: path argument required')
      const path = ctx.dump(args[0])
      if (typeof path !== 'string') return ctx.newString('Error: path must be a string')
      const content = vfs.read(path)
      return content === null ? ctx.null : ctx.newString(content)
    } catch (err) {
      return ctx.newString(`Error reading file: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const vfsWriteFn = ctx.newFunction('write', (...args: any[]) => {
    try {
      if (args.length < 2) return ctx.newString('Error: path and content arguments required')
      const path = ctx.dump(args[0])
      const content = ctx.dump(args[1])
      if (typeof path !== 'string' || typeof content !== 'string') {
        return ctx.newString('Error: path and content must be strings')
      }
      vfs.write(path, content)
      filesWritten.push(path)
      return ctx.true
    } catch (err) {
      return ctx.newString(`Error writing file: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const vfsListFn = ctx.newFunction('list', (...args: any[]) => {
    try {
      let prefix: string | undefined
      if (args.length > 0) {
        const prefixArg = ctx.dump(args[0])
        if (typeof prefixArg === 'string') prefix = prefixArg
      }
      const files = vfs.list(prefix)
      const resultArray = ctx.newArray()
      files.forEach((file: string, index: number) => {
        ctx.setProp(resultArray, index, ctx.newString(file))
      })
      return resultArray
    } catch (err) {
      return ctx.newString(`Error listing files: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const vfsDeleteFn = ctx.newFunction('delete', (...args: any[]) => {
    try {
      if (args.length === 0) return ctx.newString('Error: path argument required')
      const path = ctx.dump(args[0])
      if (typeof path !== 'string') return ctx.newString('Error: path must be a string')
      return vfs.delete(path) ? ctx.true : ctx.false
    } catch (err) {
      return ctx.newString(`Error deleting file: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const vfsExistsFn = ctx.newFunction('exists', (...args: any[]) => {
    try {
      if (args.length === 0) return ctx.false
      const path = ctx.dump(args[0])
      if (typeof path !== 'string') return ctx.false
      return vfs.read(path) !== null ? ctx.true : ctx.false
    } catch {
      return ctx.false
    }
  })

  ctx.setProp(vfsHandle, 'read', vfsReadFn)
  ctx.setProp(vfsHandle, 'write', vfsWriteFn)
  ctx.setProp(vfsHandle, 'list', vfsListFn)
  ctx.setProp(vfsHandle, 'delete', vfsDeleteFn)
  ctx.setProp(vfsHandle, 'exists', vfsExistsFn)
  ctx.setProp(ctx.global, 'vfs', vfsHandle)

  vfsReadFn.dispose()
  vfsWriteFn.dispose()
  vfsListFn.dispose()
  vfsDeleteFn.dispose()
  vfsExistsFn.dispose()
  vfsHandle.dispose()
}

function buildOutput(logs: string[], rawResult: unknown): string {
  const lastExpr = rawResult !== undefined ? serializeValue(rawResult) : undefined
  const stdout = logs.join('\n')
  if (stdout && lastExpr !== undefined && lastExpr !== 'undefined') return `${stdout}\n${lastExpr}`
  if (stdout) return stdout
  if (lastExpr !== undefined && lastExpr !== 'undefined') return lastExpr
  return ''
}

async function runSync(js: string, vfs: VirtualFS | undefined, filesWritten: string[]): Promise<SandboxResult> {
  const QuickJS = await getModule()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
  runtime.setMaxStackSize(MAX_STACK_BYTES)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIMEOUT_MS))

  const ctx = runtime.newContext()
  const logs: string[] = []

  injectConsoleBridge(ctx, logs)
  if (vfs) injectVfsBridge(ctx, vfs, filesWritten)

  let output = ''
  let error: string | undefined

  try {
    const result = ctx.evalCode(js, 'sandbox.js')
    if (isFail(result)) {
      const errVal = ctx.dump(result.error)
      result.error.dispose()
      const isTimeout =
        typeof errVal === 'object' &&
        errVal !== null &&
        (errVal as Record<string, unknown>).name === 'InternalError'
      error = isTimeout
        ? `Execution timed out after ${TIMEOUT_MS / 1000}s`
        : typeof errVal === 'object' && errVal !== null
          ? String((errVal as Record<string, unknown>).message ?? JSON.stringify(errVal))
          : String(errVal)
    } else {
      const val = ctx.dump(result.value)
      result.value.dispose()
      output = buildOutput(logs, val)
    }
  } finally {
    ctx.dispose()
    runtime.dispose()
  }

  return { output, error, filesWritten }
}

async function runAsync(js: string, vfs: VirtualFS | undefined, filesWritten: string[]): Promise<SandboxResult> {
  const QuickJS = await getAsyncModule()
  // QuickJSAsyncWASMModule.newRuntime() returns QuickJSAsyncRuntime which has newAsyncContext()
  // biome-ignore lint/suspicious/noExplicitAny: async runtime type not re-exported from quickjs-emscripten
  const runtime = QuickJS.newRuntime() as any
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
  runtime.setMaxStackSize(MAX_STACK_BYTES)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ASYNC_TIMEOUT_MS))

  const ctx = await runtime.newAsyncContext()
  const logs: string[] = []

  injectConsoleBridge(ctx, logs)
  if (vfs) injectVfsBridge(ctx, vfs, filesWritten)

  // Inject async fetch bridge
  const fetchFn = ctx.newAsyncifiedFunction('fetch', async (...args: any[]) => {
    const url = String(ctx.dump(args[0]))
    let responseText: string
    let status: number
    let ok: boolean
    let statusText: string

    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    const response = await globalThis.fetch(url, { signal })
    status = response.status
    ok = response.ok
    statusText = response.statusText
    responseText = await response.text()

    const resp = ctx.newObject()

    const statusHandle = ctx.newNumber(status)
    ctx.setProp(resp, 'status', statusHandle)
    statusHandle.dispose()

    ctx.setProp(resp, 'ok', ok ? ctx.true : ctx.false)

    const statusTextHandle = ctx.newString(statusText)
    ctx.setProp(resp, 'statusText', statusTextHandle)
    statusTextHandle.dispose()

    const body = responseText
    const textFn = ctx.newFunction('text', () => ctx.newString(body))
    ctx.setProp(resp, 'text', textFn)
    textFn.dispose()

    const jsonFn = ctx.newFunction('json', () => {
      const parsed = ctx.evalCode(`(${body})`)
      if (isFail(parsed)) {
        // biome-ignore lint/suspicious/noExplicitAny: QuickJS error handle type varies by version
        ;(parsed.error as any).dispose?.()
        throw new Error('Response body is not valid JSON')
      }
      return parsed.value
    })
    ctx.setProp(resp, 'json', jsonFn)
    jsonFn.dispose()

    return resp
  })
  ctx.setProp(ctx.global, 'fetch', fetchFn)
  fetchFn.dispose()

  let output = ''
  let error: string | undefined

  try {
    const result = await ctx.evalCodeAsync(js, 'sandbox.js')
    if (isFail(result)) {
      // biome-ignore lint/suspicious/noExplicitAny: QuickJS error handle type varies by version
      const errHandle = result.error as any
      const errVal = ctx.dump(errHandle)
      errHandle.dispose?.()
      const isTimeout =
        typeof errVal === 'object' &&
        errVal !== null &&
        (errVal as Record<string, unknown>).name === 'InternalError'
      error = isTimeout
        ? `Execution timed out after ${ASYNC_TIMEOUT_MS / 1000}s`
        : typeof errVal === 'object' && errVal !== null
          ? String((errVal as Record<string, unknown>).message ?? JSON.stringify(errVal))
          : String(errVal)
    } else {
      const val = ctx.dump(result.value)
      result.value.dispose()
      output = buildOutput(logs, val)
    }
  } finally {
    ctx.dispose()
    runtime.dispose()
  }

  return { output, error, filesWritten }
}

export async function runInSandbox(
  code: string,
  language: 'javascript' | 'typescript',
  vfs?: VirtualFS,
  allowNetwork?: boolean,
): Promise<SandboxResult> {
  let js: string
  try {
    js = language === 'typescript'
      ? transform(code, { transforms: ['typescript'] }).code
      : code
  } catch (err) {
    return { output: '', error: `TypeScript transpilation error: ${err instanceof Error ? err.message : String(err)}`, filesWritten: [] }
  }

  const filesWritten: string[] = []
  return allowNetwork
    ? runAsync(js, vfs, filesWritten)
    : runSync(js, vfs, filesWritten)
}
