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
import { createTool } from '@cline/agents'
import { z } from 'zod'
import type { AgentTool } from '@cline/agents'
import type { VirtualFS } from '@/vfs/virtual-fs'
import { runInSandbox } from '../js-sandbox'

interface JavascriptToolContext {
  vfs?: VirtualFS
  onFileCreated?: (path: string, content: string) => void
}

export function createJavascriptTool(ctx?: JavascriptToolContext): AgentTool<any, any> {
  return createTool({
    name: 'execute_js',
    description:
      'Execute JavaScript or TypeScript code in a secure sandbox (QuickJS WASM). ' +
      'Virtual filesystem is always available via the global `vfs` object:\n' +
      '  vfs.read(path) → string | null\n' +
      '  vfs.write(path, content) → boolean  (file appears in file manager immediately)\n' +
      '  vfs.list(prefix?) → string[]\n' +
      '  vfs.delete(path) → boolean\n' +
      '  vfs.exists(path) → boolean\n' +
      'Output: use console.log(); the last expression value is also returned.\n' +
      'Network: pass allow_network: true to enable global fetch(url) → Response ' +
      '(supports .status, .ok, .text(), .json()). Default: no network.\n' +
      'Timeout: 5 s (CPU) without network, 25 s wall-clock with network.\n' +
      'No DOM, no Node.js APIs. TypeScript type annotations are stripped automatically.',
    inputSchema: z.object({
      code: z.string().describe('JavaScript or TypeScript code to execute'),
      language: z.enum(['javascript', 'typescript']).default('javascript')
        .describe('Language of the code snippet'),
      allow_network: z.boolean().optional().default(false)
        .describe('Set to true to enable fetch() inside the sandbox. Increases timeout to 30 s.'),
    }),
    timeoutMs: 30_000,
    execute: async ({ code, language, allow_network }) => {
      const { output, error, filesWritten } = await runInSandbox(code, language, ctx?.vfs, allow_network)
      if (ctx?.onFileCreated && ctx.vfs) {
        for (const path of filesWritten) {
          const content = ctx.vfs.read(path)
          if (content !== null) ctx.onFileCreated(path, content)
        }
      }
      if (error) {
        return { success: false, error }
      }
      return { success: true, output: output || '(no output)' }
    },
  })
}
