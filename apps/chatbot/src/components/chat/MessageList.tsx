import React, { useEffect, useRef } from 'react'
import { MessageItem } from './MessageItem'
import type { ChatMessage } from '@/hooks/useAgent'

interface Props { messages: ChatMessage[] }

export const MessageList: React.FC<Props> = ({ messages }) => {
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
        <MessageItem key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
