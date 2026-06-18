import React from 'react'
import { Bot, User } from 'lucide-react'
import { AssistantMessage } from './AssistantMessage'
import { ToolCallCard } from './ToolCallCard'
import type { ChatMessage } from '@/hooks/useAgent'

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

  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 rounded-full p-1.5 ${isUser ? 'bg-primary-100' : 'bg-default-100'}`}>
        {isUser
          ? <User className="h-4 w-4 text-primary-600" />
          : <Bot className="h-4 w-4 text-default-600" />}
      </div>

      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
        isUser ? 'bg-primary-500 text-white' : 'bg-default-50 border border-default-200'
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
    </div>
  )
}
