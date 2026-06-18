// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { AiConfig } from '@/types/ai-config'
import { VaultApi } from '@/lib/vault-api'
import { getFirecrawlKeys } from '@/lib/model-utils'

interface VaultContextType {
  config: AiConfig | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
  firecrawlKeys: string[]
  login: (token: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(!!VaultApi.getToken())

  const refresh = useCallback(async () => {
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
  }, [])

  const login = async (token: string) => {
    VaultApi.setToken(token)
    setIsAuthenticated(true)
    await refresh()
  }

  const logout = () => {
    VaultApi.clearToken()
    setIsAuthenticated(false)
    setConfig(null)
    setError(null)
  }

  useEffect(() => {
    if (isAuthenticated) refresh()
  }, [isAuthenticated, refresh])

  const firecrawlKeys = config ? getFirecrawlKeys(config) : []

  return (
    <VaultContext.Provider value={{ config, loading, error, isAuthenticated, firecrawlKeys, login, logout, refresh }}>
      {children}
    </VaultContext.Provider>
  )
}

export function useVault(): VaultContextType {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used within VaultProvider')
  return ctx
}
