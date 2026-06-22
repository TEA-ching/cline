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
import type * as TypeScript from 'typescript'
import { runInSandbox } from './js-sandbox'
import {MarkdownDocx, Packer, type MarkdownDocxOptions } from 'markdown-docx'

const MATH_CTX = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow,
  abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
  trunc: Math.trunc, sign: Math.sign,
  log: Math.log, log2: Math.log2, log10: Math.log10, exp: Math.exp,
  min: Math.min, max: Math.max, hypot: Math.hypot,
  PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
  SQRT2: Math.SQRT2, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E,
  pi: Math.PI, e: Math.E, inf: Infinity, Infinity,
}

// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary
export function createOptionalTools(
  toolId: string[],
  ctx?: {
    vfs?: VirtualFS
    onFileCreated?: (path: string, content: string) => void
    apiKey?: string
    providerId?: string
    onImageGenerated?: (url: string, vfsPath: string) => void
  }
): AgentTool<any, any>[] {
  const tools: AgentTool<any, any>[] = []

  if (toolId.includes('calculator')) {
    tools.push(createTool({
      name: 'calculate',
      description:
        'Evaluate a mathematical expression. Supports arithmetic, trigonometry (sin, cos, tan), ' +
        'logarithms (log, log2, log10), sqrt, cbrt, pow, abs, ceil, floor, round, min, max, hypot. ' +
        'Constants: PI, E. Example: "sin(PI/6) + sqrt(3)".',
      inputSchema: z.object({
        expression: z.string().describe('Math expression to evaluate'),
      }),
      execute: async ({ expression }) => {
        try {
          const keys = Object.keys(MATH_CTX)
          const vals = Object.values(MATH_CTX)
          // biome-ignore lint/security/noGlobalEval: intentional safe math sandbox
          const fn = new Function(...keys, `"use strict"; return (${expression})`)
          const result = fn(...vals)
          return { expression, result: String(result), numeric: result }
        } catch (err) {
          return { expression, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }))
  }

  if (toolId.includes('datetime')) {
    tools.push(createTool({
      name: 'get_datetime',
      description: 'Get the current date/time in various formats and timezones.',
      inputSchema: z.object({
        format: z.enum(['iso', 'local', 'utc', 'timestamp', 'date', 'time']).default('iso').describe(
          'Output format: iso (ISO 8601), local (locale string), utc (UTC string), timestamp (ms), date, time'
        ),
        timezone: z.string().optional().describe('IANA timezone, e.g. "America/New_York"'),
        locale: z.string().optional().describe('BCP 47 locale, e.g. "fr-FR"'),
      }),
      execute: async ({ format, timezone, locale }) => {
        const now = new Date()
        const opts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {}
        switch (format) {
          case 'iso': return now.toISOString()
          case 'utc': return now.toUTCString()
          case 'timestamp': return now.getTime()
          case 'date': return now.toLocaleDateString(locale ?? 'en-US', opts)
          case 'time': return now.toLocaleTimeString(locale ?? 'en-US', opts)
          default: return now.toLocaleString(locale ?? 'en-US', opts)
        }
      },
    }))
  }

  if (toolId.includes('encoding')) {
    tools.push(createTool({
      name: 'encode_decode',
      description:
        'Encode or decode text. Operations: base64-encode, base64-decode, url-encode, url-decode, ' +
        'hex-encode, hex-decode, json-format (pretty-print), json-minify.',
      inputSchema: z.object({
        operation: z.enum([
          'base64-encode', 'base64-decode',
          'url-encode', 'url-decode',
          'hex-encode', 'hex-decode',
          'json-format', 'json-minify',
        ]),
        text: z.string().describe('Text to process'),
      }),
      execute: async ({ operation, text }) => {
        switch (operation) {
          case 'base64-encode': return btoa(unescape(encodeURIComponent(text)))
          case 'base64-decode':
            try { return decodeURIComponent(escape(atob(text))) }
            catch { return 'Error: invalid base64 input' }
          case 'url-encode': return encodeURIComponent(text)
          case 'url-decode':
            try { return decodeURIComponent(text) }
            catch { return 'Error: invalid URL-encoded input' }
          case 'hex-encode':
            return Array.from(new TextEncoder().encode(text))
              .map(b => b.toString(16).padStart(2, '0')).join('')
          case 'hex-decode': {
            const pairs = text.replace(/\s/g, '').match(/../g)
            if (!pairs) return 'Error: invalid hex input'
            try {
              return new TextDecoder().decode(new Uint8Array(pairs.map(h => parseInt(h, 16))))
            } catch { return 'Error: invalid hex input' }
          }
          case 'json-format':
            try { return JSON.stringify(JSON.parse(text), null, 2) }
            catch { return 'Error: invalid JSON' }
          case 'json-minify':
            try { return JSON.stringify(JSON.parse(text)) }
            catch { return 'Error: invalid JSON' }
        }
      },
    }))
  }

  if (toolId.includes('uuid')) {
    tools.push(createTool({
      name: 'generate_id',
      description: 'Generate unique identifiers: UUID v4, hex tokens, or random alphanumeric strings.',
      inputSchema: z.object({
        type: z.enum(['uuid', 'hex', 'alphanumeric']).default('uuid'),
        length: z.number().int().min(4).max(256).optional().default(32)
          .describe('Character length for hex/alphanumeric types'),
        count: z.number().int().min(1).max(100).optional().default(1),
      }),
      execute: async ({ type, length, count }) => {
        const results: string[] = []
        for (let i = 0; i < count; i++) {
          if (type === 'uuid') {
            results.push(crypto.randomUUID())
          } else if (type === 'hex') {
            const bytes = new Uint8Array(Math.ceil((length ?? 32) / 2))
            crypto.getRandomValues(bytes)
            results.push(
              Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, length)
            )
          } else {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
            const bytes = new Uint8Array(length ?? 32)
            crypto.getRandomValues(bytes)
            results.push(Array.from(bytes).map(b => chars[b % chars.length]).join(''))
          }
        }
        return count === 1 ? results[0] : results
      },
    }))
  }

  if (toolId.includes('color')) {
    tools.push(createTool({
      name: 'color_convert',
      description:
        'Convert colors between hex (#rrggbb or #rgb), rgb(r,g,b), and hsl(h,s%,l%) formats. ' +
        'Use to="all" to get all three representations at once.',
      inputSchema: z.object({
        color: z.string().describe('Color in hex (#fff or #ffffff), rgb(r,g,b), or hsl(h,s%,l%)'),
        to: z.enum(['hex', 'rgb', 'hsl', 'all']).default('all'),
      }),
      execute: async ({ color, to }) => {
        let r = 0, g = 0, b = 0
        const hexMatch = color.match(/^#([0-9a-f]{3,6})$/i)
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i)
        const hslMatch = color.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/i)

        if (hexMatch) {
          const h = hexMatch[1].length === 3
            ? hexMatch[1].split('').map(c => c + c).join('')
            : hexMatch[1]
          r = parseInt(h.slice(0, 2), 16)
          g = parseInt(h.slice(2, 4), 16)
          b = parseInt(h.slice(4, 6), 16)
        } else if (rgbMatch) {
          r = Number(rgbMatch[1]); g = Number(rgbMatch[2]); b = Number(rgbMatch[3])
        } else if (hslMatch) {
          const hh = Number(hslMatch[1]) / 360
          const s = Number(hslMatch[2]) / 100
          const l = Number(hslMatch[3]) / 100
          if (s === 0) {
            r = g = b = Math.round(l * 255)
          } else {
            const hue2rgb = (p: number, q: number, t: number) => {
              if (t < 0) t += 1; if (t > 1) t -= 1
              if (t < 1 / 6) return p + (q - p) * 6 * t
              if (t < 1 / 2) return q
              if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
              return p
            }
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s
            const p = 2 * l - q
            r = Math.round(hue2rgb(p, q, hh + 1 / 3) * 255)
            g = Math.round(hue2rgb(p, q, hh) * 255)
            b = Math.round(hue2rgb(p, q, hh - 1 / 3) * 255)
          }
        } else {
          return `Error: unrecognized color format "${color}"`
        }

        const toHex = () => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
        const toRgb = () => `rgb(${r}, ${g}, ${b})`
        const toHsl = () => {
          const rn = r / 255, gn = g / 255, bn = b / 255
          const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
          let h2 = 0, s2 = 0
          const l2 = (max + min) / 2
          if (max !== min) {
            const d = max - min
            s2 = l2 > 0.5 ? d / (2 - max - min) : d / (max + min)
            switch (max) {
              case rn: h2 = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break
              case gn: h2 = ((bn - rn) / d + 2) / 6; break
              case bn: h2 = ((rn - gn) / d + 4) / 6; break
            }
          }
          return `hsl(${Math.round(h2 * 360)}, ${Math.round(s2 * 100)}%, ${Math.round(l2 * 100)}%)`
        }

        if (to === 'hex') return toHex()
        if (to === 'rgb') return toRgb()
        if (to === 'hsl') return toHsl()
        return { hex: toHex(), rgb: toRgb(), hsl: toHsl() }
      },
    }))
  }

  if (toolId.includes('execute_js')) {
    tools.push(createTool({
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
    }))
  }

  if (toolId.includes('search_wikipedia')) {
    tools.push(createTool({
      name: 'search_wikipedia',
      description:
        'Search and extract articles from Wikipedia in various languages. ' +
        'Search for articles by title or keywords across different Wikipedia editions (fr, en, de, it, es, etc.). ' +
        'Retrieve article summaries, full content, or specific sections. ' +
        'Example: search for "Eiffel Tower" in English Wikipedia or "Tour Eiffel" in French Wikipedia.',
      inputSchema: z.object({
        query: z.string().describe('Search query or article title'),
        language: z.string().default('en').describe(
          'Wikipedia language edition (fr, en, de, it, es, etc.). Default: "en"'
        ),
        search_type: z.enum(['search', 'summary', 'content', 'sections']).default('summary').describe(
          'Type of search: search (find matching articles), summary (get article summary), ' +
          'content (get full article content), sections (get article sections)'
        ),
        limit: z.number().int().min(1).max(10).optional().default(3).describe(
          'Maximum number of results to return (for search type)'
        ),
      }),
      execute: async ({ query, language, search_type, limit }) => {
        try {
          // Wikipedia API base URL
          const baseUrl = `https://${language}.wikipedia.org/w/api.php`

          // Build API parameters based on search type
          const params = new URLSearchParams({
            action: search_type === 'search' ? 'query' : 'query',
            format: 'json',
            origin: '*',
          })

          if (search_type === 'search') {
            // Search for articles matching the query
            params.append('list', 'search')
            params.append('srsearch', query)
            params.append('srlimit', String(limit))
            params.append('srprop', 'size|wordcount|timestamp')

            const response = await fetch(`${baseUrl}?${params.toString()}`)
            const data = await response.json()

            if (data.query?.search) {
              return {
                success: true,
                results: data.query.search.map((item: any) => ({
                  title: item.title,
                  snippet: item.snippet,
                  wordcount: item.wordcount,
                  timestamp: item.timestamp,
                  size: item.size,
                  url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(item.title)}`
                }))
              }
            } else {
              return { success: false, error: 'No results found' }
            }
          }
          else if (search_type === 'summary') {
            // Get article summary (extracts)
            params.append('prop', 'extracts|info')
            params.append('titles', query)
            params.append('exintro', 'true')
            params.append('explaintext', 'true')
            params.append('inprop', 'url')

            const response = await fetch(`${baseUrl}?${params.toString()}`)
            const data = await response.json()

            const pages = data.query?.pages
            if (pages) {
              const pageId = Object.keys(pages)[0]
              const page = pages[pageId]

              if (page.missing) {
                return { success: false, error: 'Article not found' }
              }

              return {
                success: true,
                title: page.title,
                extract: page.extract,
                fullurl: page.fullurl,
                canonicalurl: page.canonicalurl,
                pageid: page.pageid
              }
            } else {
              return { success: false, error: 'Article not found' }
            }
          }
          else if (search_type === 'content') {
            // Get full article content
            params.append('prop', 'revisions')
            params.append('titles', query)
            params.append('rvprop', 'content')
            params.append('rvslots', 'main')

            const response = await fetch(`${baseUrl}?${params.toString()}`)
            const data = await response.json()

            const pages = data.query?.pages
            if (pages) {
              const pageId = Object.keys(pages)[0]
              const page = pages[pageId]

              if (page.missing) {
                return { success: false, error: 'Article not found' }
              }

              return {
                success: true,
                title: page.title,
                content: page.revisions?.[0]?.slots?.main?.content || '',
                pageid: page.pageid
              }
            } else {
              return { success: false, error: 'Article not found' }
            }
          }
          else if (search_type === 'sections') {
            // Get article sections
            params.append('prop', 'sections')
            params.append('titles', query)

            const response = await fetch(`${baseUrl}?${params.toString()}`)
            const data = await response.json()

            const pages = data.query?.pages
            if (pages) {
              const pageId = Object.keys(pages)[0]
              const page = pages[pageId]

              if (page.missing) {
                return { success: false, error: 'Article not found' }
              }

              return {
                success: true,
                title: page.title,
                sections: page.sections?.map((section: any) => ({
                  toclevel: section.toclevel,
                  level: section.level,
                  line: section.line,
                  number: section.number,
                  index: section.index,
                  fromtitle: section.fromtitle,
                  byteoffset: section.byteoffset,
                  anchor: section.anchor
                })) || [],
                pageid: page.pageid
              }
            } else {
              return { success: false, error: 'Article not found' }
            }
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch Wikipedia data'
          }
        }
      },
    }))
  }

  if (toolId.includes('validate_typescript')) {
    tools.push(createTool({
      name: 'validate_typescript',
      description:
        'Validate TypeScript code compilation using the TypeScript compiler API. ' +
        'Supports basic compilation with various target and module options. ' +
        'Returns compilation success status, JavaScript output, and any diagnostics.',
      inputSchema: z.object({
        code: z.string().describe('TypeScript code to validate'),
        file_path: z.string().optional().default('src/index.ts').describe(
          'Virtual file path for the TypeScript source (e.g., "src/index.ts")'
        ),
        target: z.enum(['ES3', 'ES5', 'ES2015', 'ES2016', 'ES2017', 'ES2018', 'ES2019', 'ES2020', 'ES2021', 'ES2022', 'ES2023', 'ES2024', 'ES2025', 'ESNext'])
          .default('ES2015').describe('ECMAScript target version'),
        module: z.enum(['None', 'CommonJS', 'AMD', 'UMD', 'System', 'ES2015', 'ES2020', 'ES2022', 'ESNext', 'Node16', 'Node18', 'Node20', 'NodeNext'])
          .default('CommonJS').describe('Module system target'),
        strict: z.boolean().optional().default(true).describe('Enable strict type-checking options'),
      }),
      execute: async ({ code, file_path, target, module, strict }) => {
        try {
          // Import TypeScript compiler API
          const ts = await import('typescript')

          // Convert target and module strings to TypeScript enums
          const targetMap: Record<string, any> = {
            'ES3': ts.ScriptTarget.ES3,
            'ES5': ts.ScriptTarget.ES5,
            'ES2015': ts.ScriptTarget.ES2015,
            'ES2016': ts.ScriptTarget.ES2016,
            'ES2017': ts.ScriptTarget.ES2017,
            'ES2018': ts.ScriptTarget.ES2018,
            'ES2019': ts.ScriptTarget.ES2019,
            'ES2020': ts.ScriptTarget.ES2020,
            'ES2021': ts.ScriptTarget.ES2021,
            'ES2022': ts.ScriptTarget.ES2022,
            'ES2023': ts.ScriptTarget.ES2023,
            'ES2024': ts.ScriptTarget.ES2024,
            'ES2025': ts.ScriptTarget.ES2025,
            'ESNext': ts.ScriptTarget.ESNext,
          }

          const moduleMap: Record<string, any> = {
            'None': ts.ModuleKind.None,
            'CommonJS': ts.ModuleKind.CommonJS,
            'AMD': ts.ModuleKind.AMD,
            'UMD': ts.ModuleKind.UMD,
            'System': ts.ModuleKind.System,
            'ES2015': ts.ModuleKind.ES2015,
            'ES2020': ts.ModuleKind.ES2020,
            'ES2022': ts.ModuleKind.ES2022,
            'ESNext': ts.ModuleKind.ESNext,
            'Node16': ts.ModuleKind.Node16,
            'Node18': ts.ModuleKind.Node18,
            'Node20': ts.ModuleKind.Node20,
            'NodeNext': ts.ModuleKind.NodeNext,
          }

          // Create compiler configuration
          const compilerOptions: TypeScript.CompilerOptions = {
            target: targetMap[target] || ts.ScriptTarget.ES2015,
            module: moduleMap[module] || ts.ModuleKind.CommonJS,
            strict: strict ?? true,
            esModuleInterop: true,
            skipLibCheck: false,
            allowJs: false,
          }

          // ts.sys is undefined in edge/worker environments (no filesystem access).
          // Use transpileModule (syntactic check + JS output, no semantic type-checking)
          // when sys is unavailable; fall back to full type-checking via createProgram
          // when sys is present (Node.js / Bun with real filesystem).
          if (!ts.sys) {
            const result = ts.transpileModule(code, {
              compilerOptions,
              fileName: file_path,
              reportDiagnostics: true,
            })
            const diags = result.diagnostics ?? []
            if (diags.length > 0) {
              return {
                success: false,
                diagnostics: diags.map(d => ({
                  message: typeof d.messageText === 'string'
                    ? d.messageText
                    : d.messageText.messageText,
                  line: 0,
                  character: 0,
                  severity: ts.DiagnosticCategory[d.category].toLowerCase(),
                })),
                error: 'TypeScript compilation failed',
                message: 'Compilation failed with diagnostics (syntactic check only)',
              }
            }
            return {
              success: true,
              compiled_code: result.outputText,
              diagnostics: [],
              message: 'TypeScript transpilation successful (syntactic check only — no semantic type-checking in this environment)',
            }
          }

          // Full type-checking path: ts.sys is available, use real TypeScript lib files.
          // Spread is intentionally avoided: createCompilerHost returns prototype-based
          // methods that are not own-enumerable and would be lost by object spread.
          const sourceFile = ts.createSourceFile(file_path, code, ts.ScriptTarget.Latest, true)
          const defaultHost = ts.createCompilerHost(compilerOptions)
          const compilerHost: TypeScript.CompilerHost = {
            getSourceFile: (fileName: string, languageVersion: TypeScript.ScriptTarget | TypeScript.CreateSourceFileOptions) =>
              fileName === file_path
                ? sourceFile
                : defaultHost.getSourceFile(fileName, languageVersion),
            writeFile: () => {},
            getDefaultLibFileName: (opts: TypeScript.CompilerOptions) => defaultHost.getDefaultLibFileName(opts),
            useCaseSensitiveFileNames: () => defaultHost.useCaseSensitiveFileNames(),
            getCanonicalFileName: (fileName: string) => defaultHost.getCanonicalFileName(fileName),
            getCurrentDirectory: () => defaultHost.getCurrentDirectory(),
            getNewLine: () => defaultHost.getNewLine(),
            fileExists: (fileName: string) => defaultHost.fileExists(fileName),
            readFile: (fileName: string) => defaultHost.readFile(fileName),
            directoryExists: defaultHost.directoryExists
              ? (dirName: string) => defaultHost.directoryExists!(dirName)
              : undefined,
            getDirectories: defaultHost.getDirectories
              ? (p: string) => defaultHost.getDirectories!(p)
              : undefined,
          }

          const program = ts.createProgram({ rootNames: [file_path], options: compilerOptions, host: compilerHost })
          const diagnostics = ts.getPreEmitDiagnostics(program)

          if (diagnostics.length > 0) {
            return {
              success: false,
              diagnostics: diagnostics.map(d => ({
                message: d.messageText.toString(),
                line: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
                character: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).character + 1 : 0,
                severity: ts.DiagnosticCategory[d.category].toLowerCase(),
              })),
              error: 'TypeScript compilation failed',
              message: 'Compilation failed with diagnostics'
            }
          }

          let compiledCode = ''
          const emitResult = program.emit(undefined, (fileName, data) => {
            if (fileName.endsWith('.js')) compiledCode = data
          })

          if (emitResult.emitSkipped || emitResult.diagnostics.length > 0) {
            return {
              success: false,
              diagnostics: emitResult.diagnostics.map(d => ({
                message: d.messageText.toString(),
                line: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
                character: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).character + 1 : 0,
                severity: ts.DiagnosticCategory[d.category].toLowerCase(),
              })),
              error: 'TypeScript emission failed',
              message: 'Emission failed with diagnostics'
            }
          }

          return {
            success: true,
            compiled_code: compiledCode,
            diagnostics: [],
            message: 'TypeScript compilation successful'
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to validate TypeScript code',
            message: 'TypeScript validation error'
          }
        }
      },
    }))
  }

  if (toolId.includes('generate_image')) {
    tools.push(createTool({
      name: 'generate_image',
      description:
        'Generate an image from a text description using Mistral image generation. ' +
        'The generated image is automatically displayed in the chat interface — do NOT write a markdown image ' +
        'tag (![...](...)) or any file path in your response. Simply confirm to the user that the image ' +
        'has been generated and describe it briefly. ' +
        'Only works with Mistral models that have image generation capability.',
      inputSchema: z.object({
        description: z.string().describe('Detailed text description of the image to generate'),
      }),
      timeoutMs: 60_000,
      execute: async ({ description }) => {
        if (!ctx?.apiKey) return { success: false, error: 'No API key configured.' }

        const response = await fetch('https://api.mistral.ai/v1/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ctx.apiKey}`,
          },
          body: JSON.stringify({
            model: ctx.providerId === 'mistral' ? 'mistral-medium-latest' : 'mistral-medium-latest',
            inputs: [{ role: 'user', content: description }],
            tools: [{ type: 'image_generation' }],
            completion_args: { temperature: 0.7, max_tokens: 2048 },
          }),
        })

        if (!response.ok) {
          const errText = await response.text().catch(() => '')
          return { success: false, error: `Mistral API error ${response.status}: ${errText}` }
        }

        // biome-ignore lint/suspicious/noExplicitAny: Mistral API response shape
        const data: any = await response.json()
        // biome-ignore lint/suspicious/noExplicitAny: Mistral API response shape
        const output = data.outputs?.find((o: any) => o.info?.result != null)
        if (!output) return { success: false, error: 'No image generated in the response.' }

        const { url } = JSON.parse(output.info.result) as { url: string }

        const vfsPath = `generated_images/img_${Date.now()}.jpg`
        // Pass URL and VFS path — display via <img> (no CORS needed), URL stored in VFS as text
        ctx.onImageGenerated?.(url, vfsPath)
        return {
          success: true,
          vfsPath,
          message: 'Image displayed in chat. Do NOT write a markdown image or file path — just confirm to the user.',
        }
      },
    }))
  }

  if (toolId.includes('create_docx')) {
    tools.push(createTool({
      name: 'create_docx',
      description:
        'Create a DOCX document from Markdown content. Converts Markdown to Word document format (DOCX). ' +
        'The generated DOCX file is saved to the virtual filesystem and can be downloaded by the user. ' +
        'Supports standard Markdown syntax including headings, lists, tables, links, and images.' +
        'DOCX documents cannot be edited after creation, so you need to create a new one if you want to make changes.',
      inputSchema: z.object({
        markdown: z.string().describe('Markdown content to convert to DOCX'),
        filename: z.string().optional().default('document.docx').describe(
          'Output filename for the DOCX file (e.g., "report.docx")'
        ),
      }),
      timeoutMs: 30_000,
      execute: async ({ markdown, filename }) => {
        try {
          // Convert Markdown to DOCX
          const converter = new MarkdownDocx(markdown)

          const config: MarkdownDocxOptions = { }

          const doc = await converter.toDocument()
          
          // Generate DOCX blob
          const blob = await Packer.toBlob(doc)

          // Convert blob to base64 for storage in VFS (browser-safe, no Buffer)
          const arrayBuffer = await blob.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          let binary = ''
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
          const base64Content = btoa(binary)
          const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          const dataUrl = `data:${mimeType};base64,${base64Content}`

          // Save to virtual filesystem
          const vfsPath = filename
          if (ctx?.vfs) {
            ctx.vfs.write(vfsPath, base64Content, mimeType)
            ctx.onFileCreated?.(vfsPath, dataUrl)
          }

          return {
            success: true,
            vfsPath,
            filename,
            size: blob.size,
            message: 'DOCX document created successfully and saved to virtual filesystem'
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to create DOCX document',
            message: 'DOCX creation error'
          }
        }
      },
    }))
  }

  return tools
}
