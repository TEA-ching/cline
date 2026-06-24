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

export function createDatetimeTool(): AgentTool<any, any> {
  return createTool({
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
  })
}
