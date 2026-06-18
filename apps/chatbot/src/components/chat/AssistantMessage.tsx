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
        // Simple inline formatting: **bold**, `code`
        const html = part
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
