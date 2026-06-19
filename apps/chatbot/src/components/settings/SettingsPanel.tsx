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
import { Button } from '@heroui/react'
import { X, LogOut, RefreshCw, RotateCcw } from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { useVault } from '@/hooks/useVault'
import type { AiConfig } from '@/types/ai-config'

interface Props {
  config: AiConfig
  selectedProviderId: string
  selectedModelId: string
  onModelChange: (providerId: string, modelId: string) => void
  onClose: () => void
  /** Display hint for the currently active API key (e.g. "***abc12345"). */
  currentKeyHint?: string
  /** Whether key rotation is possible (pool has > 1 non-expired key). */
  canRotate?: boolean
  /** Called when the user manually triggers a key rotation. */
  onRotateKey?: () => void
}

export const SettingsPanel: React.FC<Props> = ({
  config, selectedProviderId, selectedModelId, onModelChange, onClose,
  currentKeyHint, canRotate, onRotateKey,
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

        {currentKeyHint && (
          <div className="text-xs text-default-400 space-y-2">
            <p className="font-semibold uppercase tracking-wide">API Key</p>
            <p className="font-mono text-default-500 break-all">{currentKeyHint}</p>
            {canRotate && onRotateKey && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onPress={onRotateKey}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Rotate Key
              </Button>
            )}
          </div>
        )}
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
