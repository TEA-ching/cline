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
import { runInSandbox } from './js-sandbox'

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
  skillIds: string[],
  ctx?: { vfs?: VirtualFS }
): AgentTool<any, any>[] {
  const tools: AgentTool<any, any>[] = []

  if (skillIds.includes('calculator')) {
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

  if (skillIds.includes('datetime')) {
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

  if (skillIds.includes('encoding')) {
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

  if (skillIds.includes('uuid')) {
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

  if (skillIds.includes('color')) {
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

  if (skillIds.includes('execute_js')) {
    tools.push(createTool({
      name: 'execute_js',
      description:
        'Execute JavaScript or TypeScript code in a secure sandbox (QuickJS WASM). ' +
        'The sandbox has no network access, no external filesystem access, and a 5-second CPU timeout. ' +
        'When VFS is available, you can access virtual files using the global vfs object with methods: ' +
        'vfs.read(path), vfs.write(path, content), vfs.list(prefix), vfs.delete(path), vfs.exists(path). ' +
        'Use console.log() to print output. The return value of the last expression is also shown. ' +
        'Supports modern JS syntax and TypeScript type annotations.',
      inputSchema: z.object({
        code: z.string().describe('JavaScript or TypeScript code to execute'),
        language: z.enum(['javascript', 'typescript']).default('javascript')
          .describe('Language of the code snippet'),
      }),
      timeoutMs: 10_000,
      execute: async ({ code, language }) => {
        const { output, error } = await runInSandbox(code, language, ctx?.vfs)
        if (error) {
          return { success: false, error }
        }
        return { success: true, output: output || '(no output)' }
      },
    }))
  }

  return tools
}
