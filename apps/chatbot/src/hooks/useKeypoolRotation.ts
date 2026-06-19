// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
//
// Key rotation state hook — mirrors KeyPool.ts (apps/vscode) and
// keypoollive-browser.ts (sdk/packages/llms) for the browser chatbot.
//
// Persists the per-provider key index in localStorage so rotation survives
// page refreshes. Filters out expired keys before rotation.

import { useCallback, useMemo } from 'react'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import type { AiProvider, AiKey } from '@/types/ai-config'
import { maskKey } from '@/lib/keypool-usage'

export interface KeypoolRotationState {
  /** The currently selected key object, or null if the provider has no keys. */
  currentKey: AiKey | null
  /** Display-safe key hint: "***xxxxxxxx". */
  currentKeyHint: string
  /** Owner label from the key metadata (defaults to "unknown"). */
  currentKeyOwner: string
  /** Number of non-expired keys available for this provider. */
  poolSize: number
  /** Rotate to the next key in round-robin order. */
  rotateKey: () => void
  /** Mark the current key as failed and immediately rotate to the next one. */
  markKeyFailedAndRotate: () => void
}

/**
 * Manages key rotation for a single vault provider.
 *
 * @param providerKey - Vault provider name (e.g. "openai"), used as localStorage key prefix.
 * @param provider    - The AiProvider object from the decrypted vault, or null if not loaded.
 */
export function useKeypoolRotation(
  providerKey: string,
  provider: AiProvider | null,
): KeypoolRotationState {
  // Persist rotation index across page refreshes
  const [rawIndex, setRawIndex] = useLocalStorageState<number>(
    `kpl_idx_${providerKey}`,
    0,
  )

  // Only rotate among non-expired keys; fall back to all keys if all are expired
  const pool: AiKey[] = useMemo(() => {
    const keys = provider?.keys ?? []
    const usable = keys.filter(k => k.type !== 'expired')
    return usable.length > 0 ? usable : keys
  }, [provider])

  const effectiveIndex = pool.length > 0 ? rawIndex % pool.length : 0
  const currentKey = pool[effectiveIndex] ?? null

  const rotateKey = useCallback(() => {
    if (pool.length <= 1) return
    setRawIndex(prev => {
      const next = (prev + 1) % pool.length
      return next
    })
  }, [pool.length, setRawIndex])

  const markKeyFailedAndRotate = useCallback(() => {
    rotateKey()
  }, [rotateKey])

  const currentKeyHint = currentKey ? maskKey(currentKey.key) : '—'
  const currentKeyOwner = currentKey?.owner ?? 'unknown'

  return {
    currentKey,
    currentKeyHint,
    currentKeyOwner,
    poolSize: pool.length,
    rotateKey,
    markKeyFailedAndRotate,
  }
}
