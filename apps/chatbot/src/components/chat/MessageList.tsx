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
import React, { useEffect, useRef } from 'react'
import { MessageItem } from './MessageItem'
import type { ChatMessage } from '@/hooks/useAgent'
import type { Source } from './SourcesPanel'

interface Props {
  messages: ChatMessage[]
  onImageCaptured?: (path: string, dataUrl: string) => void
  onFork?: (messageId: string) => void
  showReasoning?: boolean
  getReasoningSteps?: () => string[]
  sources?: Source[]
}

export const MessageList: React.FC<Props> = ({ messages, onImageCaptured, onFork, showReasoning, getReasoningSteps, sources }) => {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-default-400">
        <div className="text-center">
          <p className="text-4xl mb-3">🤖</p>
          <p className="text-sm">Start a conversation</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map(msg => (
        <MessageItem
          key={msg.id}
          message={msg}
          onImageCaptured={onImageCaptured}
          onFork={onFork}
          showReasoning={showReasoning}
          getReasoningSteps={getReasoningSteps}
          sources={sources}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
