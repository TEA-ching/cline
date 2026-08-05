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
import { createTool } from '@sctg/cline-agents'
import { z } from 'zod'
import type { AgentTool } from '@sctg/cline-agents'

export function createEncodingTool(): AgentTool<any, any> {
  return createTool({
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
  })
}
