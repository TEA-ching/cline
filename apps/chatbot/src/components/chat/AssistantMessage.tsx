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
  content: string
  isStreaming?: boolean
}

// Simple markdown renderer — renders code blocks and basic formatting without external deps.
// Replaced with a richer renderer once shiki is wired in.
export const AssistantMessage: React.FC<Props> = ({ content, isStreaming }) => {
  const parts = content.split(/(```[\s\S]*?```)/g)

  return (
    <div className="prose prose-sm max-w-none text-default-800 dark:prose-invert">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/)
          const code = match ? match[2] : part.slice(3, -3)
          return (
            <pre key={i} className="overflow-auto rounded-md bg-default-100 p-3 text-xs font-mono">
              <code>{code}</code>
            </pre>
          )
        }
        // Simple inline formatting: **bold**, `code`, ![alt](url)
        const html = part
          .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '<img src="$2" alt="$1" class="rounded-lg max-h-64 max-w-full object-contain border border-default-200 my-1" />')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/`([^`]+)`/g, '<code class="bg-default-100 rounded px-1 py-0.5 text-xs font-mono">$1</code>')
          .replace(/\n/g, '<br/>')
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
      })}
      {isStreaming && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary-500" />
      )}
    </div>
  )
}
