// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import type { AiConfig } from '@/types/ai-config'

const VAULT_URL = import.meta.env.KEYPOOL_VAULT_URL as string
const SESSION_KEY = 'ai_vault_token'

/**
 * GET vault URL from environment variable KEYPOOL_VAULT_URL
 * - legacy usage define import.meta.env.KEYPOOL_VAULT_URL = 'https://vault.exemple.com/path/ai.json.enc'
 * - new usage define import.meta.env.KEYPOOL_VAULT_URL = 'https://vault.exemple.com/path'
 * @returns vault URL
 */
export function getVaultUrl(): string {
  // Extract the base URL from the environment variable
  const vaultUrl = VAULT_URL.replace(/\/ai\.json\.enc$/, '')
  return `${vaultUrl}/ai.json`  
}


export const VaultApi = {
  getToken(): string | null {
    return sessionStorage.getItem(SESSION_KEY)
  },

  setToken(token: string): void {
    sessionStorage.setItem(SESSION_KEY, token)
  },

  clearToken(): void {
    sessionStorage.removeItem(SESSION_KEY)
  },

  async fetchConfig(): Promise<AiConfig> {
    const token = this.getToken()
    if (!token) throw new Error('No authorization token')

    const res = await fetch(`${getVaultUrl()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
      throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
    }

    return res.json() as Promise<AiConfig>
  },
}
