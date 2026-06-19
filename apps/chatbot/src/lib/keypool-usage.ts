// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
//
// Remote KeypoolLive usage recording for the browser chatbot.
// Uses import.meta.env.KEYPOOL_USAGE_DB (base URL of the Cloudflare Worker)
// to POST usage and error records, matching the NDJSON format of KeypoolUsageDb.
// If KEYPOOL_USAGE_DB starts with http:// or https://, remote mode is used.
// Otherwise (or if unset), recording is a no-op (no local FS in browser).

const KEYPOOL_DB_RAW = (import.meta.env.KEYPOOL_USAGE_DB as string | undefined) ?? ''

const SESSION_KEY = 'ai_vault_token'

/**
 * Strip any /v1/keypool/... suffix from the env var to get the worker base URL.
 * Accepts both:
 *   https://proxy.example.com                (base URL)
 *   https://proxy.example.com/v1/keypool/... (full path — strip suffix)
 */
function getWorkerBaseUrl(): string | null {
  const url = KEYPOOL_DB_RAW.trim()
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null
  return url.replace(/\/v1\/keypool\/?.*$/, '')
}

function getAuthHeader(): string | null {
  try {
    const token = sessionStorage.getItem(SESSION_KEY)
    return token ? `Bearer ${token}` : null
  } catch {
    return null
  }
}

async function remotePost(path: string, body: object): Promise<void> {
  const base = getWorkerBaseUrl()
  if (!base) return
  const auth = getAuthHeader()
  if (!auth) return
  try {
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
    })
  } catch {
    // fire-and-forget — usage recording is non-critical
  }
}

// ─── Public types ──────────────────────────────────────────────────────────────

export interface KeyUsageEntry {
  provider: string
  modelId: string
  keyOwner: string
  /** Last 8 chars of the key, prefixed with "***". */
  keyHint: string
  promptTokens: number
  completionTokens: number
}

export interface KeyErrorEntry {
  provider: string
  modelId: string
  keyOwner: string
  keyHint: string
  /** HTTP status code if available, null otherwise. */
  errorCode: number | null
}

export interface UsageStat {
  period: string
  provider: string
  modelId: string
  keyOwner: string
  keyHint: string
  promptTokens: number
  completionTokens: number
  requestCount: number
}

export type UsagePeriod = 'hour' | 'day' | 'week' | 'month'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Records a successful API-key usage event on the remote worker.
 * Fire-and-forget — never throws.
 */
export function recordKeyUsage(entry: KeyUsageEntry): void {
  void remotePost('/v1/keypool/usage', entry)
}

/**
 * Records a failed API-key request on the remote worker.
 * Fire-and-forget — never throws.
 */
export function recordKeyError(entry: KeyErrorEntry): void {
  void remotePost('/v1/keypool/error', entry)
}

/**
 * Fetches usage statistics from the remote worker.
 * Returns an empty array if remote mode is not configured or the call fails.
 */
export async function getUsageStats(period: UsagePeriod = 'day'): Promise<UsageStat[]> {
  const base = getWorkerBaseUrl()
  if (!base) return []
  const auth = getAuthHeader()
  if (!auth) return []
  try {
    const res = await fetch(`${base}/v1/keypool/stats?period=${period}`, {
      headers: { Authorization: auth },
    })
    if (!res.ok) return []
    const data = await res.json() as { data?: UsageStat[] }
    return data.data ?? []
  } catch {
    return []
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns "***" + last 8 chars of a key, safe for logs and UI. */
export function maskKey(key: string): string {
  if (key.length <= 8) return key
  return `***${key.slice(-8)}`
}

/**
 * Returns true if the error message suggests an auth or rate-limit issue
 * that warrants key rotation.
 */
export function isKeyRelatedError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase()
  return (
    /\b401\b/.test(msg) ||
    /\b403\b/.test(msg) ||
    /\b429\b/.test(msg) ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('quota') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('too many requests') ||
    msg.includes('throttle') ||
    msg.includes('resource exhausted') ||
    msg.includes('insufficient_quota')
  )
}

/**
 * Extracts an HTTP status code from an error message string.
 * Returns null if none is found.
 */
export function extractErrorCode(errorMessage: string): number | null {
  const m = errorMessage.match(/\b(4\d{2}|5\d{2})\b/)
  return m ? Number(m[1]) : null
}
