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
import React from 'react'

interface Props {
  usedTokens: number
  totalTokens: number
  /** Called when the user clicks "Compact now" in the 90%+ banner. */
  onCompact?: () => void
}

export const ContextBar: React.FC<Props> = ({ usedTokens, totalTokens, onCompact }) => {
  if (!totalTokens) return null
  const pct = Math.min(100, Math.round((usedTokens / totalTokens) * 100))
  const barColor =
    pct < 50 ? 'bg-success-400' : pct < 75 ? 'bg-warning-400' : 'bg-danger-400'

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1 border-b border-default-100 bg-background/80">
        <span className="text-xs text-default-400 shrink-0 w-10 text-right tabular-nums">{pct}%</span>
        <div className="flex-1 h-1.5 rounded-full bg-default-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-default-400 shrink-0 font-mono tabular-nums whitespace-nowrap">
          {usedTokens.toLocaleString()} / {totalTokens.toLocaleString()}
        </span>
      </div>
      {pct >= 90 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-danger-200 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/30 text-danger-800 dark:text-danger-200 text-xs">
          <span>🔴</span>
          <span className="flex-1">
            Context window critical ({pct}%) — use <code className="font-mono">/compact</code> to compress history
          </span>
          {onCompact && (
            <button
              type="button"
              onClick={onCompact}
              className="underline hover:no-underline text-danger-700 dark:text-danger-300 shrink-0"
            >
              Compact now
            </button>
          )}
        </div>
      )}
      {pct >= 75 && pct < 90 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-warning-200 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30 text-warning-800 dark:text-warning-200 text-xs">
          <span>⚠️</span>
          <span>Context window almost full ({pct}%)</span>
        </div>
      )}
    </>
  )
}
