// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import type { AiConfig } from '@/types/ai-config'
import { decryptAiConfig } from './crypto'
import { parseAiConfig } from './ai-config-schema'

// Defaults to the standalone app's build-time env var; overridden at runtime via
// setVaultBaseUrl() so the <Chatbot> component can be configured by prop instead
// (a downstream consumer's bundler won't have KEYPOOL_VAULT_URL defined).
let VAULT_URL = (import.meta.env.KEYPOOL_VAULT_URL as string | undefined) ?? ''
const SESSION_KEY = 'ai_vault_token'

/** Sets the vault base URL at runtime — called by VaultProvider from its `vaultUrl` prop. */
export function setVaultBaseUrl(url: string): void {
  VAULT_URL = url
}

/**
 * GET vault URL from environment variable KEYPOOL_VAULT_URL
 * - legacy usage define import.meta.env.KEYPOOL_VAULT_URL = 'https://vault.exemple.com/path/ai.json.enc'
 * - new usage define import.meta.env.KEYPOOL_VAULT_URL = 'https://vault.exemple.com/path'
 * @returns vault URL for encrypted config
 */
export function getVaultUrl(): string {
  // Extract the base URL from the environment variable
  const vaultUrl = VAULT_URL.replace(/\/ai\.json(\.enc)?$/, '')
  return `${vaultUrl}/ai.json.enc`
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

    // Use the encrypted endpoint to save CPU on the Cloudflare Worker
    const res = await fetch(`${getVaultUrl()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
      throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
    }

    const encryptedConfig = await res.text()
    const decryptedConfig = await decryptAiConfig(encryptedConfig, token)
    return parseAiConfig(JSON.parse(decryptedConfig))
  },
}

/**
 * Fetch the public models list for BYOK mode
 * Returns an AiConfig structure with empty keys arrays
 */
export async function fetchPublicModels(): Promise<AiConfig> {
  const baseUrl = new URL(VAULT_URL).origin
  const res = await fetch(`${baseUrl}/v1/keypool/byok/models`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
  }

  const data = await res.json()
  return parseAiConfig(data)
}
