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
import type { QuickJSWASMModule } from 'quickjs-emscripten'
import singlefileVariant from '@jitl/quickjs-singlefile-browser-release-sync'
import asyncifyVariant from '@jitl/quickjs-singlefile-browser-release-asyncify'
import { transform } from 'sucrase'
import type { VirtualFS } from '@/vfs/virtual-fs'

const TIMEOUT_MS = 30_000
const ASYNC_TIMEOUT_MS = 120_000
const FETCH_TIMEOUT_MS = 30_000
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024 // 64 MB
const MAX_STACK_BYTES = 1024 * 1024          // 1 MB

let modulePromise: Promise<QuickJSWASMModule> | null = null

function getModule(): Promise<QuickJSWASMModule> {
  return (modulePromise ??= newQuickJSWASMModuleFromVariant(singlefileVariant))
}

// Do NOT cache the async WASM module. quickjs-emscripten's asyncify state is
// module-global: after a runtime is disposed the asyncify bookkeeping inside the
// shared module can be left in a dirty state, causing "Lifetime not alive" on the
// next invocation. Creating a fresh module per call matches the library's own
// newAsyncRuntime() approach and guarantees a clean asyncify context every time.

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
  // Fresh module per call — asyncify state is module-global, shared modules corrupt across calls.
  // Use newContext() directly on the module so the runtime is owned by the context and
  // disposed atomically with ctx.dispose() — avoids double-dispose of runtime.
  const QuickJS = await newQuickJSAsyncWASMModuleFromVariant(asyncifyVariant)
  // biome-ignore lint/suspicious/noExplicitAny: QuickJSAsyncContext type not re-exported from variant
  const ctx = (QuickJS as any).newContext()
  // biome-ignore lint/suspicious/noExplicitAny: runtime type not re-exported from quickjs-emscripten variant
  const runtime = (ctx as any).runtime
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
  runtime.setMaxStackSize(MAX_STACK_BYTES)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ASYNC_TIMEOUT_MS))
  const logs: string[] = []

  injectConsoleBridge(ctx, logs)
  if (vfs) injectVfsBridge(ctx, vfs, filesWritten)

  // Two-phase fetch bridge to avoid "Lifetime not alive" in asyncified callbacks.
  //
  // Root cause: quickjs-emscripten marks argument handles passed to
  // newAsyncifiedFunction callbacks as not-alive when the WASM stack is
  // suspended by asyncify. Accessing args[0] (even before the first await)
  // calls assertAlive() on a dead handle and throws.
  //
  // Fix: extract the URL via a synchronous native function (__setFetchUrl) that
  // runs during normal QuickJS execution (no asyncify involved). The asyncified
  // __doFetch() then reads from the host variable without touching any QuickJS
  // argument handles.
  //
  // IMPORTANT: do NOT create ctx.newFunction() inside the __doFetch callback —
  // quickjs-emscripten does not support HostRefs inside asyncified callbacks.
  let pendingFetchUrl = ''

  const setUrlFn = ctx.newFunction('__setFetchUrl', (...args: any[]) => {
    const url = ctx.dump(args[0])
    if (typeof url === 'string') pendingFetchUrl = url
    return ctx.undefined
  })
  ctx.setProp(ctx.global, '__setFetchUrl', setUrlFn)
  setUrlFn.dispose()

  const fetchFn = ctx.newAsyncifiedFunction('__doFetch', async () => {
    const url = pendingFetchUrl
    pendingFetchUrl = ''
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    const response = await globalThis.fetch(url, { signal })
    const body = await response.text()

    const resp = ctx.newObject()

    const sh = ctx.newNumber(response.status); ctx.setProp(resp, 'status', sh); sh.dispose()
    ctx.setProp(resp, 'ok', response.ok ? ctx.true : ctx.false)
    const st = ctx.newString(response.statusText); ctx.setProp(resp, 'statusText', st); st.dispose()
    const b = ctx.newString(body); ctx.setProp(resp, '_body', b); b.dispose()

    const headersObj = ctx.newObject()
    response.headers.forEach((value, name) => {
      const v = ctx.newString(value)
      ctx.setProp(headersObj, name.toLowerCase(), v)
      v.dispose()
    })
    ctx.setProp(resp, '_headers', headersObj)
    headersObj.dispose()

    return resp
  })
  ctx.setProp(ctx.global, '__doFetch', fetchFn)
  fetchFn.dispose()

  // Pure-JS shim: calls __setFetchUrl (sync) then __doFetch (async, no args).
  // text()/json()/headers are pure QuickJS closures — no native HostRefs.
  const shimResult = ctx.evalCode(
    'var fetch=async function(u){__setFetchUrl(u);var r=await __doFetch();' +
    'r.text=function(){return Promise.resolve(r._body);};' +
    'r.json=function(){return Promise.resolve(JSON.parse(r._body));};' +
    'r.headers={' +
    'get:function(n){return Object.prototype.hasOwnProperty.call(r._headers,n.toLowerCase())?r._headers[n.toLowerCase()]:null;},' +
    'entries:function(){return Object.entries(r._headers);},' +
    'keys:function(){return Object.keys(r._headers);},' +
    'values:function(){return Object.values(r._headers);}' +
    '};return r;};'
  )
  if (isFail(shimResult)) {
    // biome-ignore lint/suspicious/noExplicitAny: QuickJS error handle type varies by version
    ;(shimResult.error as any)?.dispose?.()
    ctx.dispose()
    runtime.dispose()
    return { output: '', error: 'Failed to initialize network layer', filesWritten }
  }
  shimResult.value.dispose()

  // Wrap user code in an async IIFE so evalCodeAsync awaits all async operations
  // (including floating top-level async function calls) before returning, preventing
  // ctx.dispose() from running while QuickJS Promise callbacks are still in-flight.
  const wrappedJs = `;(async function __sandbox__(){\n${js}\n})();`

  let output = ''
  let error: string | undefined

  try {
    // biome-ignore lint/suspicious/noExplicitAny: evalCodeAsync return type varies by version
    let result: any
    try {
      result = await (ctx as any).evalCodeAsync(wrappedJs, 'sandbox.js')
    } catch (hostErr) {
      // evalCodeAsync itself threw a host-side exception (not a QuickJS script error)
      return { output: '', error: `Sandbox host error: ${hostErr instanceof Error ? hostErr.message : String(hostErr)}`, filesWritten }
    }

    if (isFail(result)) {
      // biome-ignore lint/suspicious/noExplicitAny: QuickJS error handle type varies by version
      const errHandle = result.error as any
      let errVal: unknown
      try {
        errVal = ctx.dump(errHandle)
      } catch (dumpErr) {
        // The error handle is a dead Lifetime — asyncify cleanup race inside quickjs-emscripten.
        // Report the dump error itself rather than crashing the whole call.
        errVal = { name: 'InternalError', message: dumpErr instanceof Error ? dumpErr.message : String(dumpErr) }
      }
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
      // result.value is the eval result (the IIFE's Promise handle or undefined).
      // Guard against a dead handle in case quickjs-emscripten races during cleanup.
      let val: unknown
      try {
        val = ctx.dump(result.value)
        result.value.dispose()
      } catch { /* dead handle — console output captured in logs is still valid */ }
      output = buildOutput(logs, val)
    }
  } finally {
    // ctx owns the runtime (created via module.newContext()), so one dispose suffices.
    // Suppress the spurious "not found when trying to free HostRef" error that
    // quickjs-emscripten emits for the asyncify suspension-key sentinel (id = INT_MIN).
    try { ctx.dispose() } catch { /* suppress asyncify cleanup error */ }
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
