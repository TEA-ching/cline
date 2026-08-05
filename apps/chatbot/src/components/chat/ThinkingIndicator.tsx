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
import React, { useEffect, useState } from 'react'

interface Props {
  startedAt: number | null
  streamedTokens: number
}

export const ThinkingIndicator: React.FC<Props> = ({ startedAt, streamedTokens }) => {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) { setElapsed(0); return }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    )
    return () => clearInterval(id)
  }, [startedAt])

  if (!startedAt) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-default-400">
      <span className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="inline-block w-1.5 h-1.5 rounded-full bg-default-300 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span className="font-mono tabular-nums">
        {streamedTokens > 0
          ? `${streamedTokens} tokens · ${elapsed}s`
          : `Waiting… ${elapsed}s`}
      </span>
    </div>
  )
}
