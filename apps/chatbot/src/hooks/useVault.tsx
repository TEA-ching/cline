// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { AiConfig } from '@/types/ai-config'
import { VaultApi } from '@/lib/vault-api'
import { getFirecrawlKeys } from '@/lib/model-utils'

type VaultMode = 'vault' | 'byok'

interface VaultContextType {
  config: AiConfig | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
  mode: VaultMode
  firecrawlKeys: string[]
  login: (token: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
  switchToBYOK: (localConfig: AiConfig) => void
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AiConfig | null>(() => {
    // Check if BYOK config exists in localStorage
    const stored = localStorage.getItem('byok_config')
    return stored ? JSON.parse(stored) : null
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    // Check if BYOK config exists or vault token exists
    const byokConfig = localStorage.getItem('byok_config')
    const vaultToken = VaultApi.getToken()
    return !!byokConfig || !!vaultToken
  })
  const [mode, setMode] = useState<VaultMode>(() => {
    // Determine initial mode based on localStorage, with fallback to last_used_mode
    const byokConfig = localStorage.getItem('byok_config')
    const lastUsedMode = localStorage.getItem('last_used_mode') as VaultMode | null
    if (byokConfig) return 'byok'
    if (lastUsedMode) return lastUsedMode
    return 'vault'
  })

  const refresh = useCallback(async () => {
    if (mode === 'byok') return // No need to refresh for BYOK mode

    setLoading(true)
    setError(null)
    try {
      const data = await VaultApi.fetchConfig()
      setConfig(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      if (msg.includes('401') || msg.includes('authorized')) {
        setIsAuthenticated(false)
      }
    } finally {
      setLoading(false)
    }
  }, [mode])

  const login = async (token: string) => {
    VaultApi.setToken(token)
    setIsAuthenticated(true)
    setMode('vault')
    localStorage.setItem('last_used_mode', 'vault')
    await refresh()
  }

  const logout = () => {
    VaultApi.clearToken()
    setIsAuthenticated(false)
    setError(null)
    setMode('vault')
    localStorage.setItem('last_used_mode', 'vault')
    // Preserve BYOK config on logout - only clear vault token
    // localStorage.removeItem('byok_config') - REMOVED
  }

  const switchToBYOK = (localConfig: AiConfig) => {
    localStorage.setItem('byok_config', JSON.stringify(localConfig))
    setConfig(localConfig)
    setMode('byok')
    localStorage.setItem('last_used_mode', 'byok')
    setIsAuthenticated(true)
    setError(null)
  }

  useEffect(() => {
    if (isAuthenticated && mode === 'vault') refresh()
  }, [isAuthenticated, mode, refresh])

  const firecrawlKeys = config ? getFirecrawlKeys(config) : []

  return (
    <VaultContext.Provider value={{ config, loading, error, isAuthenticated, mode, firecrawlKeys, login, logout, refresh, switchToBYOK }}>
      {children}
    </VaultContext.Provider>
  )
}

export function useVault(): VaultContextType {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used within VaultProvider')
  return ctx
}
