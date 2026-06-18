import React from 'react'
import { ImagePlus, Wrench, Brain } from 'lucide-react'
import { listChatModels, modelSupportsImages } from '@/lib/model-utils'
import type { AiConfig } from '@/types/ai-config'

interface Props {
  config: AiConfig
  selectedProviderId: string
  selectedModelId: string
  onChange: (providerId: string, modelId: string) => void
}

export const ModelSelector: React.FC<Props> = ({ config, selectedProviderId, selectedModelId, onChange }) => {
  const models = listChatModels(config)

  return (
    <div className="space-y-1">
      {models.map(({ providerId, model }) => {
        const active = providerId === selectedProviderId && model.id === selectedModelId
        return (
          <button
            key={`${providerId}/${model.id}`}
            onClick={() => onChange(providerId, model.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              active
                ? 'bg-primary-100 text-primary-700 font-medium'
                : 'text-default-600 hover:bg-default-100'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="flex-1 truncate font-mono text-xs">{model.id}</span>
              <span className="text-[10px] text-default-400">{providerId}</span>
              {modelSupportsImages(model) && <ImagePlus className="h-3 w-3 text-primary-400"  />}
              {model.supportsTools && <Wrench className="h-3 w-3 text-default-400"  />}
              {model.supportsReasoning && <Brain className="h-3 w-3 text-warning-400"  />}
            </div>
            <p className="text-[10px] text-default-400">
              {model.contextWindow.toLocaleString()} ctx · {(model.maxOutputTokens ?? 0).toLocaleString()} out
            </p>
          </button>
        )
      })}
      {models.length === 0 && (
        <p className="text-xs text-default-400 italic px-2">No chat models in vault</p>
      )}
    </div>
  )
}
