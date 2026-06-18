import React from 'react'
import { Button } from '@heroui/react'
import { X, LogOut, RefreshCw } from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { useVault } from '@/hooks/useVault'
import type { AiConfig } from '@/types/ai-config'

interface Props {
  config: AiConfig
  selectedProviderId: string
  selectedModelId: string
  onModelChange: (providerId: string, modelId: string) => void
  onClose: () => void
}

export const SettingsPanel: React.FC<Props> = ({
  config, selectedProviderId, selectedModelId, onModelChange, onClose,
}) => {
  const { logout, refresh, loading } = useVault()

  return (
    <div className="flex h-full w-72 flex-col border-l border-default-200 bg-background">
      <div className="flex items-center justify-between border-b border-default-200 px-4 py-3">
        <h2 className="text-sm font-semibold">Settings</h2>
        <Button isIconOnly variant="ghost" size="sm" onPress={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-default-400">Model</p>
          <ModelSelector
            config={config}
            selectedProviderId={selectedProviderId}
            selectedModelId={selectedModelId}
            onChange={onModelChange}
          />
        </div>

        <div className="text-xs text-default-400 space-y-1">
          <p className="font-semibold uppercase tracking-wide">Vault</p>
          <p>{Object.keys(config.providers).length} providers · {Object.keys(config.crawlers).length} crawlers</p>
        </div>
      </div>

      <div className="border-t border-default-200 p-3 flex gap-2">
        <Button variant="ghost" size="sm" onPress={() => void refresh()} isPending={loading} className="flex-1">
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button variant="ghost" size="sm" className="flex-1 text-danger-500" onPress={logout}>
          <LogOut className="mr-1 h-3.5 w-3.5" />
          Logout
        </Button>
      </div>
    </div>
  )
}
