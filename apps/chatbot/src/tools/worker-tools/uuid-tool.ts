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

export function createUuidTool(): AgentTool<any, any> {
  return createTool({
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
  })
}
