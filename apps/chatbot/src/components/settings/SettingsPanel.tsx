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
import React, { useState, useEffect } from 'react'
import { Button } from '@heroui/react'
import { LogOut, RefreshCw, RotateCcw } from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { useVault } from '@/hooks/useVault'
import { getUsageStats, type UsagePeriod } from '@/lib/keypool-usage'
import type { AiConfig } from '@/types/ai-config'

interface Props {
  config: AiConfig
  selectedProviderId: string
  selectedModelId: string
  onModelChange: (providerId: string, modelId: string) => void
  onClose?: () => void
  /** Display hint for the currently active API key (e.g. "***abc12345"). */
  currentKeyHint?: string
  /** Whether key rotation is possible (pool has > 1 non-expired key). */
  canRotate?: boolean
  /** Called when the user manually triggers a key rotation. */
  onRotateKey?: () => void
  /** Current authentication mode */
  mode: 'vault' | 'byok'
}

export const SettingsPanel: React.FC<Props> = ({
  config, selectedProviderId, selectedModelId, onModelChange,
  currentKeyHint, canRotate, onRotateKey, mode,
}) => {
  const { logout, refresh, loading } = useVault()
  const [statsPeriod, setStatsPeriod] = useState<UsagePeriod>('day')
  const [stats, setStats] = useState<any[]>([])

  // Load stats automatically for BYOK mode
  useEffect(() => {
    if (mode === 'byok') {
      getUsageStats(statsPeriod, mode)
        .then(setStats)
        .catch(() => setStats([]))
    }
  }, [statsPeriod, mode])

  return (
    <div className="flex flex-col h-full p-3 space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-default-400">Model</p>
        <ModelSelector
          config={config}
          selectedProviderId={selectedProviderId}
          selectedModelId={selectedModelId}
          onChange={onModelChange}
        />
      </div>

      {mode === 'byok' ? (
        <>
          <div className="text-xs text-default-400 space-y-1">
            <p className="font-semibold uppercase tracking-wide">BYOK Management</p>
            <p>Bring Your Own Key mode active</p>
          </div>

          <div className="text-xs text-default-400 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold uppercase tracking-wide">Usage Statistics</p>
e              <select
                value={statsPeriod}
                onChange={(e) => setStatsPeriod(e.target.value as UsagePeriod)}
                className="text-xs p-1 border rounded"
              >
                <option value="hour">Last hour</option>
                <option value="day">Last 24h</option>
                <option value="week">Last 7 days</option>
                <option value="month">Last 30 days</option>
              </select>
            </div>

            {stats.length > 0 ? (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-default-200">
                      <th className="text-left py-1">Provider</th>
                      <th className="text-left py-1">Key</th>
                      <th className="text-right py-1">Requests</th>
                      <th className="text-right py-1">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((stat, idx) => (
                      <tr key={idx} className="border-b border-default-100">
                        <td className="py-1">{stat.provider}</td>
                        <td className="py-1 font-mono">{stat.keyHint}</td>
                        <td className="py-1 text-right">{stat.requestCount}</td>
                        <td className="py-1 text-right">
                          {Math.round((stat.promptTokens + stat.completionTokens) / 1000)}K
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-default-500">No usage data available for this period.</p>
            )}
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

      <div className="mt-auto pt-3 border-t border-default-200 flex gap-2">
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
