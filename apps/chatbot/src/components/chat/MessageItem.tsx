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
import React, { useState } from 'react'
import { Bot, User, Terminal, Copy, Check } from 'lucide-react'
import { AssistantMessage } from './AssistantMessage'
import { ToolCallCard } from './ToolCallCard'
import type { ChatMessage } from '@/hooks/useAgent'

const CopyButton: React.FC<{ text: string; light?: boolean }> = ({ text, light }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      onClick={handleCopy}
      title="Copier"
      className={`self-start mt-2 shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity ${
        light
          ? 'text-white/60 hover:text-white/90 hover:bg-white/10'
          : 'text-default-400 hover:text-default-600 hover:bg-default-100'
      }`}
    >
      {copied
        ? <Check className="h-3 w-3" />
        : <Copy className="h-3 w-3" />}
    </button>
  )
}

interface Props { message: ChatMessage }

export const MessageItem: React.FC<Props> = ({ message }) => {
  if (message.role === 'tool') {
    return (
      <ToolCallCard
        toolName={message.toolName ?? 'tool'}
        input={message.toolInput}
        result={message.toolResult}
        isRunning={message.isStreaming}
      />
    )
  }

  // System messages (command output, /help, etc.)
  if (message.role === 'system') {
    return (
      <div className="flex gap-3 group items-start">
        <div className="shrink-0 rounded-full p-1.5 bg-default-100">
          <Terminal className="h-4 w-4 text-default-500" />
        </div>
        <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-default-100 border border-default-200">
          <pre className="text-xs text-default-600 font-mono whitespace-pre-wrap">{message.content}</pre>
        </div>
        <CopyButton text={message.content} />
      </div>
    )
  }

  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 group items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`shrink-0 rounded-full p-1.5 ${isUser ? 'bg-primary-100' : 'bg-default-100'}`}>
        {isUser
          ? <User className="h-4 w-4 text-primary-600" />
          : <Bot className="h-4 w-4 text-default-600" />}
      </div>

      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
        isUser ? 'bg-primary-500 text-gray-300' : 'bg-default-50 border border-default-200'
      }`}>
        {/* Image thumbnails for user messages */}
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.images.map((src, i) => (
              <img key={i} src={src} alt="" className="h-20 w-20 rounded object-cover border border-white/20" />
            ))}
          </div>
        )}

        {isUser
          ? <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          : <AssistantMessage content={message.content} isStreaming={message.isStreaming} />
        }
      </div>

      <CopyButton text={message.content} light={isUser} />
    </div>
  )
}
