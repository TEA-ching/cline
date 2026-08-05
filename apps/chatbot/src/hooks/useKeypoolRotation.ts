// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
//
// Key rotation state hook — mirrors KeyPool.ts (apps/vscode) and
// keypoollive.ts (sdk/packages/llms) for the browser chatbot.
//
// Selection strategy (same as VSCode and SDK):
//   1. Fetch 24h usage stats from the remote worker on mount.
//   2. Sort eligible (non-expired, non-failed) keys by:
//        min completion tokens → min prompt tokens → min request count
//   3. Expose the cheapest key as currentKey.
//   4. markKeyFailedAndRotate() blacklists the current key for this session
//      and re-derives the next best key automatically.
//   5. rotateKey() advances the selection index within the sorted pool
//      (useful for manual round-robin when the caller wants a different key).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiProvider, AiKey } from '@/types/ai-config'
import { getUsageStats, maskKey } from '@/lib/keypool-usage'
import type { UsageStat } from '@/lib/keypool-usage'
import { toast } from "@heroui/react"

export interface KeypoolRotationState {
  /** The currently selected key object, or null if the provider has no keys. */
  currentKey: AiKey | null
  /** Display-safe key hint: "***xxxxxxxx". */
  currentKeyHint: string
  /** Owner label from the key metadata (defaults to "unknown"). */
  currentKeyOwner: string
  /** Number of non-expired keys available for this provider. */
  poolSize: number
  /** Advance the selection to the next key in the sorted pool. */
  rotateKey: () => void
  /** Mark the current key as failed and move to the next available key. */
  markKeyFailedAndRotate: () => void
}

/**
 * Manages key selection for a single vault provider.
 *
 * Keys are sorted by 24-hour usage statistics fetched from the remote worker
 * so that the key with the lowest token consumption is preferred, matching
 * the strategy used in apps/vscode KeyPool.ts and sdk keypoollive.ts.
 * Falls back to original vault order when no stats are available.
 *
 * @param providerKey - Vault provider name (e.g. "openai"), used to filter stats.
 * @param provider    - The AiProvider object from the decrypted vault, or null if not loaded.
 */
export function useKeypoolRotation(
  providerKey: string,
  provider: AiProvider | null,
): KeypoolRotationState {
  // 24h usage stats fetched once per mount / provider change
  const [stats, setStats] = useState<UsageStat[]>([])

  // Keys that failed in this session — blacklisted until page reload
  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set())

  // Manual rotation offset within the sorted pool
  const [rotationOffset, setRotationOffset] = useState(0)

  // Fetch stats whenever the provider changes
  const fetchedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (fetchedForRef.current === providerKey) return
    fetchedForRef.current = providerKey
    setRotationOffset(0)
    setFailedKeys(new Set())
    getUsageStats('day')
      .then(setStats)
      .catch(() => setStats([]))
  }, [providerKey])

  // Build the eligible key pool (non-expired, not blacklisted this session)
  const pool: AiKey[] = useMemo(() => {
    const keys = provider?.keys ?? []
    const nonExpired = keys.filter(k => k.type !== 'expired')
    const withoutFailed = nonExpired.filter(k => !failedKeys.has(k.key))
    // Progressive fallback so there is always at least one key to try
    if (withoutFailed.length > 0) return withoutFailed
    if (nonExpired.length > 0) return nonExpired
    return keys
  }, [provider, failedKeys])

  // Build a per-key-hint usage map (normalize by stripping leading "***")
  const statsMap = useMemo(() => {
    const m = new Map<string, { out: number; inp: number; req: number }>()
    for (const s of stats) {
      if (s.provider !== providerKey) continue
      // Normalize: "***abc12345" → "abc12345"
      const hint = s.keyHint.replace(/^\*+/, '')
      const ex = m.get(hint)
      if (ex) {
        ex.out += s.completionTokens
        ex.inp += s.promptTokens
        ex.req += s.requestCount
      } else {
        m.set(hint, { out: s.completionTokens, inp: s.promptTokens, req: s.requestCount })
      }
    }
    return m
  }, [stats, providerKey])

  // Sort pool by min completion tokens → min prompt tokens → min requests
  const sortedPool: AiKey[] = useMemo(() => {
    if (pool.length <= 1) return pool
    const hasAnyStats = pool.some(k => statsMap.has(k.key.slice(-8)))
    if (!hasAnyStats) return pool   // no stats yet → keep vault order
    return [...pool].sort((a, b) => {
      const sa = statsMap.get(a.key.slice(-8)) ?? { out: 0, inp: 0, req: 0 }
      const sb = statsMap.get(b.key.slice(-8)) ?? { out: 0, inp: 0, req: 0 }
      if (sa.out !== sb.out) return sa.out - sb.out
      if (sa.inp !== sb.inp) return sa.inp - sb.inp
      return sa.req - sb.req
    })
  }, [pool, statsMap])

  const effectiveIndex = sortedPool.length > 0 ? rotationOffset % sortedPool.length : 0
  const currentKey = sortedPool[effectiveIndex] ?? null

  const rotateKey = useCallback(() => {
    if (sortedPool.length <= 1) return
    const nextOffset = (rotationOffset + 1) % sortedPool.length
    setRotationOffset(nextOffset)
    const nextKey = sortedPool[nextOffset] ?? null
    const hint = nextKey ? maskKey(nextKey.key) : '—'
    const owner = nextKey?.owner ?? 'unknown'
    toast(`Key rotated : ${owner} …${hint.slice(-8)}`, { timeout: 2000 })
    console.log(`Key rotated to ${owner} …${hint.slice(-8)}`)
    // Refresh stats so the sort order reflects latest usage after rotation.
    // This also serves as a connectivity check for the remote worker.
    getUsageStats('day').then((stats) => {
      setStats(stats)
    }).catch(() => { })
  }, [sortedPool, rotationOffset])

  const markKeyFailedAndRotate = useCallback(() => {
    if (!currentKey) return
    const failingKey = currentKey.key
    // Find where the failing key sits in the current sorted pool
    const currentIdx = sortedPool.findIndex(k => k.key === failingKey)
    // Compute the new pool deterministically (matches the upcoming re-render)
    const newPool = sortedPool.filter(k => k.key !== failingKey)
    // Key that was "next" in the current sorted order (wrapping)
    const nextInCurrentPool = sortedPool[(currentIdx + 1) % sortedPool.length]
    // Set the offset so rotation resumes from the next eligible key, not index 0
    const newOffset =
      newPool.length > 0 && nextInCurrentPool
        ? Math.max(0, newPool.findIndex(k => k.key === nextInCurrentPool.key))
        : 0

    setFailedKeys(prev => new Set([...prev, failingKey]))
    setRotationOffset(newOffset)
    const hint = maskKey(failingKey)
    const owner = currentKey?.owner ?? 'unknown'
    toast(`Key failed & rotated : ${owner} …${hint.slice(-8)}`, { timeout: 2000 })
  }, [currentKey, sortedPool])

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
