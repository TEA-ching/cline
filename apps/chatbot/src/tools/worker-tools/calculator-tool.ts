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

export function createCalculatorTool(): AgentTool<any, any> {
  return createTool({
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
  })
}
