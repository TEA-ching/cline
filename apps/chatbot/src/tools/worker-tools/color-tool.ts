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

export function createColorTool(): AgentTool<any, any> {
  return createTool({
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
  })
}
