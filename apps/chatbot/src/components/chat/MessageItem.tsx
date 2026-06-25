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
import { Bot, User, Terminal, Copy, Check, Download, GitBranch } from 'lucide-react'
import { AssistantMessage } from './AssistantMessage'
import { ToolCallCard } from './ToolCallCard'
import type { ChatMessage } from '@/hooks/useAgent'
import type { Source } from './SourcesPanel'

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
      className={`self-start mt-1 shrink-0 rounded opacity-20 group-hover:opacity-100 transition-opacity ${
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

interface Props {
  message: ChatMessage
  onImageCaptured?: (path: string, dataUrl: string) => void
  onFork?: (messageId: string) => void
  showReasoning?: boolean
  getReasoningSteps?: () => string[]
  sources?: Source[]
  isLast?: boolean
}

export const MessageItem: React.FC<Props> = ({ message, onImageCaptured, onFork, showReasoning, getReasoningSteps, sources, isLast }) => {
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
          ? <><div className="flex items-center gap-2"><CopyButton text={message.content}/><User className="h-4 w-4 text-primary-600" /></div></>
          : <Bot className="h-4 w-4 text-default-600" />}
      </div>

      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
        isUser ? 'bg-primary-500 text-gray-300' : 'bg-default-50 border border-default-200'
      }`}>
        {/* Image thumbnails for user messages */}
        {isUser && message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.images.map((src, i) => (
              <img key={i} src={src} alt="" className="h-20 w-20 rounded object-cover border border-white/20" />
            ))}
          </div>
        )}

        {isUser
          ? <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          : <AssistantMessage content={message.content} isStreaming={message.isStreaming} reasoning={getReasoningSteps?.()} showReasoning={showReasoning} sources={sources} isLast={isLast} />
        }

        {/* Generated images for assistant messages */}
        {!isUser && message.images && message.images.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${message.content ? 'mt-2' : ''}`}>
            {message.images.map((src, i) => (
              <div key={i} className="relative group inline-block">
                <img
                  src={src}
                  alt="Generated image"
                  className="rounded-lg max-h-64 max-w-full object-contain border border-default-200"
                  onLoad={(e) => {
                    if (!onImageCaptured) return
                    // data: URLs are already binary — VFS entry was written by the tool. Skip canvas re-capture.
                    if (src.startsWith('data:')) return
                    const img = e.currentTarget
                    try {
                      const canvas = document.createElement('canvas')
                      canvas.width = img.naturalWidth
                      canvas.height = img.naturalHeight
                      const ctx2d = canvas.getContext('2d')
                      if (!ctx2d) return
                      ctx2d.drawImage(img, 0, 0)
                      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
                      const path = `generated_images/img_${message.id}_${i}.jpg`
                      onImageCaptured(path, dataUrl)
                    } catch {
                      // Canvas tainted — cross-origin image without CORS headers; image still displays
                    }
                  }}
                />
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Open / download image"
                  onClick={e => e.stopPropagation()}
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <CopyButton text={message.content} light={isUser} />
        {onFork && !message.isStreaming && (
          <button
            onClick={() => onFork(message.id)}
            title="Forker la conversation ici"
            className={`self-start shrink-0 rounded opacity-20 group-hover:opacity-100 transition-opacity ${
              isUser
                ? 'text-white/60 hover:text-white/90 hover:bg-white/10'
                : 'text-default-400 hover:text-default-600 hover:bg-default-100'
            }`}
          >
            <GitBranch className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
