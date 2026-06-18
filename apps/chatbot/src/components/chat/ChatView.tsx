import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@heroui/react'
import { Settings, PanelLeftOpen, PanelLeftClose } from 'lucide-react'

import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { ToolApprovalDialog } from '@/components/approval/ToolApprovalDialog'
import { AskQuestionDialog } from '@/components/approval/AskQuestionDialog'
import { FileManager } from '@/components/files/FileManager'
import { DropZone } from '@/components/files/DropZone'
import { SettingsPanel } from '@/components/settings/SettingsPanel'

import { useAgent } from '@/hooks/useAgent'
import { useVirtualFS } from '@/hooks/useVirtualFS'
import { useVault } from '@/hooks/useVault'
import { listChatModels, modelSupportsImages } from '@/lib/model-utils'
import { SessionStore } from '@/session/session-store'
import type { AiConfig } from '@/types/ai-config'


const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to a virtual file system and web tools.
Use the vfs_* tools to read and write files. Use fetch_web_content and search_web to browse the internet.
When asked to create files, use vfs_editor and they will be available for download.`

interface Props { vaultConfig: AiConfig }

export const ChatView: React.FC<Props> = ({ vaultConfig }) => {
  const { firecrawlKeys } = useVault()

  // Pick first available chat model as default
  const models = listChatModels(vaultConfig)
  const [selectedProviderId, setSelectedProviderId] = useState(models[0]?.providerId ?? '')
  const [selectedModelId, setSelectedModelId] = useState(models[0]?.model.id ?? '')
  const [showSettings, setShowSettings] = useState(false)
  const [showFiles, setShowFiles] = useState(true)
  const [sessionId] = useState(() => `sess_${Date.now()}`)

  const selectedModel = models.find(
    m => m.providerId === selectedProviderId && m.model.id === selectedModelId
  )?.model

  const selectedProvider = vaultConfig.providers[selectedProviderId] ?? null

  // Use the real API key and endpoint from the decrypted vault config.
  // provider.endpoint is the direct provider API URL; provider.keys[0].key is the real API key.
  const agentConfig = selectedProviderId && selectedModelId && selectedProvider && selectedProvider.keys.length > 0
    ? {
        providerId: selectedProviderId,
        modelId: selectedModelId,
        apiKey: selectedProvider.keys[0].key,
        baseUrl: selectedProvider.endpoint,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        firecrawlKeys,
        firecrawlEndpoint: 'https://api.firecrawl.dev',
      }
    : null

  const {
    messages, isRunning, generatedFiles,
    pendingApproval, pendingQuestion,
    sendMessage, abort, syncVfsFile, removeVfsFile,
  } = useAgent(agentConfig)

  const vfs = useVirtualFS(syncVfsFile)

  // Auto-save session on message change
  useEffect(() => {
    if (messages.length === 0) return
    const title = messages[0]?.content.slice(0, 60) ?? 'Session'
    void SessionStore.save({
      id: sessionId,
      title,
      messages,
      providerId: selectedProviderId,
      modelId: selectedModelId,
      createdAt: messages[0]?.timestamp ?? Date.now(),
      updatedAt: Date.now(),
    })
  }, [messages, sessionId, selectedProviderId, selectedModelId])

  console.log('[ChatView] render — messages:', messages.length, messages.map(m => ({ role: m.role, len: m.content.length, streaming: m.isStreaming })))

  const handleModelChange = useCallback((pid: string, mid: string) => {
    setSelectedProviderId(pid)
    setSelectedModelId(mid)
  }, [])

  return (
    <DropZone onDrop={vfs.uploadFiles}>
      <div className="flex h-screen overflow-hidden bg-background">

        {/* File sidebar */}
        {showFiles && (
          <div className="w-56 flex-shrink-0 border-r border-default-200 overflow-hidden">
            <FileManager
              files={vfs.files}
              generatedFiles={generatedFiles}
              onRemove={path => { vfs.removeFile(path); removeVfsFile(path) }}
            />
          </div>
        )}

        {/* Main chat area */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Header bar */}
          <div className="flex items-center gap-2 border-b border-default-200 px-3 py-2 flex-shrink-0">
            <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowFiles(v => !v)}>
              {showFiles ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </Button>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-default-500 truncate font-mono">
                {selectedModelId || 'No model selected'}
              </p>
            </div>
            <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowSettings(v => !v)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <MessageList messages={messages} />
          </div>

          {/* Input */}
          <InputBar
            onSend={sendMessage}
            onAbort={abort}
            isRunning={isRunning}
            supportsImages={!!selectedModel && modelSupportsImages(selectedModel)}
            onUploadFiles={vfs.uploadFiles}
          />
        </div>

        {/* Settings panel */}
        {showSettings && (
          <SettingsPanel
            config={vaultConfig}
            selectedProviderId={selectedProviderId}
            selectedModelId={selectedModelId}
            onModelChange={handleModelChange}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* Approval dialog */}
        {pendingApproval && (
          <ToolApprovalDialog
            toolName={pendingApproval.toolName}
            input={pendingApproval.input}
            onApprove={() => pendingApproval.resolve(true)}
            onDeny={() => pendingApproval.resolve(false)}
          />
        )}

        {/* Ask question dialog */}
        {pendingQuestion && (
          <AskQuestionDialog
            question={pendingQuestion.question}
            options={pendingQuestion.options}
            onAnswer={pendingQuestion.resolve}
          />
        )}
      </div>
    </DropZone>
  )
}
