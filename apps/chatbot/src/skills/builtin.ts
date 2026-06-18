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
export interface SkillMeta {
  id: string
  name: string
  description: string
  icon: string
  tools: string[]
}

export const BUILTIN_SKILLS: SkillMeta[] = [
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Evaluate math expressions: sin, cos, sqrt, log, pow, etc. Constants PI and E.',
    icon: '🧮',
    tools: ['calculate'],
  },
  {
    id: 'datetime',
    name: 'Date & Time',
    description: 'Get current date/time in various formats and IANA timezones.',
    icon: '🕐',
    tools: ['get_datetime'],
  },
  {
    id: 'encoding',
    name: 'Encoding Tools',
    description: 'Base64, URL-encode, hex encode/decode; JSON format and minify.',
    icon: '🔐',
    tools: ['encode_decode'],
  },
  {
    id: 'uuid',
    name: 'ID Generator',
    description: 'Generate UUID v4, hex tokens, or random alphanumeric strings.',
    icon: '🎲',
    tools: ['generate_id'],
  },
  {
    id: 'color',
    name: 'Color Tools',
    description: 'Convert colors between hex, RGB, and HSL formats.',
    icon: '🎨',
    tools: ['color_convert'],
  },
  {
    id: 'execute_js',
    name: 'JS / TS Sandbox',
    description: 'Execute JavaScript or TypeScript in a secure QuickJS WASM sandbox. No network, no filesystem — pure computation.',
    icon: '⚡',
    tools: ['execute_js'],
  },
]
