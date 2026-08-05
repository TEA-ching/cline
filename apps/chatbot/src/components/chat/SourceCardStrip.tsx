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
import type { Source } from './SourcesPanel'

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

interface Props {
  sources: Source[]
}

export const SourceCardStrip: React.FC<Props> = ({ sources }) => {
  if (sources.length === 0) return null

  return (
    <div className="mt-3 -mx-1">
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
        {sources.slice(0, 12).map(src => {
          const domain = src.domain || safeHostname(src.url)
          const favicon = src.favicon || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '')
          return (
            <a
              key={src.id}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              title={src.title}
              className="shrink-0 w-28 rounded-lg border border-default-200 bg-default-50 hover:bg-default-100 hover:border-primary-300 transition-colors p-2 text-left no-underline"
            >
              <div className="flex items-center gap-1 mb-1">
                {favicon ? (
                  <img
                    src={favicon}
                    alt=""
                    width={12}
                    height={12}
                    className="h-3 w-3 shrink-0 rounded-sm"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div className="h-3 w-3 shrink-0 rounded-sm bg-default-200" />
                )}
                <span className="text-[10px] text-default-400 truncate leading-none">{domain}</span>
              </div>
              <p className="text-[11px] text-default-700 font-medium leading-tight line-clamp-2 m-0">
                {src.title}
              </p>
            </a>
          )
        })}
      </div>
    </div>
  )
}
