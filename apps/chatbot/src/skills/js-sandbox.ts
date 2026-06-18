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
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, isFail } from 'quickjs-emscripten'
import type { QuickJSWASMModule } from 'quickjs-emscripten'
import singlefileVariant from '@jitl/quickjs-singlefile-browser-release-sync'
import { transform } from 'sucrase'

const TIMEOUT_MS = 5_000
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024 // 64 MB
const MAX_STACK_BYTES = 1024 * 1024          // 1 MB

let modulePromise: Promise<QuickJSWASMModule> | null = null

function getModule(): Promise<QuickJSWASMModule> {
  return (modulePromise ??= newQuickJSWASMModuleFromVariant(singlefileVariant))
}

export interface SandboxResult {
  output: string
  error?: string
}

function serializeValue(val: unknown): string {
  if (val === undefined || val === null) return String(val)
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

export async function runInSandbox(
  code: string,
  language: 'javascript' | 'typescript',
): Promise<SandboxResult> {
  let js: string
  try {
    js = language === 'typescript'
      ? transform(code, { transforms: ['typescript'] }).code
      : code
  } catch (err) {
    return { output: '', error: `TypeScript transpilation error: ${err instanceof Error ? err.message : String(err)}` }
  }

  const QuickJS = await getModule()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
  runtime.setMaxStackSize(MAX_STACK_BYTES)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIMEOUT_MS))

  const ctx = runtime.newContext()
  const logs: string[] = []

  // Bridge console.log / warn / error / info into the logs array
  const logFn = ctx.newFunction('log', (...args) => {
    const parts = args.map(a => serializeValue(ctx.dump(a)))
    logs.push(parts.join(' '))
  })
  const consoleHandle = ctx.newObject()
  for (const method of ['log', 'warn', 'error', 'info']) {
    ctx.setProp(consoleHandle, method, logFn)
  }
  ctx.setProp(ctx.global, 'console', consoleHandle)
  logFn.dispose()
  consoleHandle.dispose()

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
      const lastExpr = val !== undefined ? serializeValue(val) : undefined
      const stdout = logs.join('\n')
      if (stdout && lastExpr !== undefined && lastExpr !== 'undefined') {
        output = `${stdout}\n${lastExpr}`
      } else if (stdout) {
        output = stdout
      } else if (lastExpr !== undefined && lastExpr !== 'undefined') {
        output = lastExpr
      }
    }
  } finally {
    ctx.dispose()
    runtime.dispose()
  }

  return { output, error }
}
