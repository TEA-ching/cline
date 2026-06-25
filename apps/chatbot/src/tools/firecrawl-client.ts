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
const MARKDOWN_TRUNCATE_LIMIT = 50_000
const MAX_RETRIES = 3
const CREDIT_CACHE_DURATION_MS = 300_000 // 5 minutes

// Estimated credit costs per operation (used for optimistic decrement)
const CREDIT_COST_SCRAPE = 1
const CREDIT_COST_SEARCH_PER_RESULT = 1

// Module-level set of keys that have hit permanent auth errors (401/403)
// or exhausted all retries on 429. Persists across calls within the same
// worker lifetime. Reset by creating a new worker.
const failedFirecrawlKeys = new Set<string>()

// Set of keys that have run out of credits (402 errors)
const outOfCreditsKeys = new Set<string>()

// Cache for credit usage information to avoid frequent API calls
const creditUsageCache = new Map<string, {
  remainingCredits: number
  lastChecked: number
  expiresAt: number
}>()

// In-flight credit fetch promises — deduplicates concurrent fetches for the same key
const pendingCreditFetches = new Map<string, Promise<FirecrawlCreditUsage>>()

export function markFirecrawlKeyFailed(key: string): void {
  failedFirecrawlKeys.add(key)
}

export function markFirecrawlKeyOutOfCredits(key: string): void {
  outOfCreditsKeys.add(key)
  // Remove from cache so it won't be selected again
  creditUsageCache.delete(key)
}

/**
 * Returns a snapshot of the credit map for monitoring/debugging.
 * Keys mapped to their cached remaining credits (or null if uncached/out-of-credits).
 */
export function getFirecrawlCreditMap(keys: string[]): Record<string, number | null> {
  const map: Record<string, number | null> = {}
  for (const key of keys) {
    if (outOfCreditsKeys.has(key) || failedFirecrawlKeys.has(key)) {
      map[key] = null
    } else {
      const cached = creditUsageCache.get(key)
      map[key] = cached ? cached.remainingCredits : null
    }
  }
  return map
}

class FirecrawlOutOfCreditsError extends Error {
  constructor(message: string, public readonly remainingCredits: number = 0) {
    super(message)
    this.name = 'FirecrawlOutOfCreditsError'
  }
}

interface FirecrawlCreditUsage {
  remainingCredits: number
  planCredits: number
  billingPeriodStart?: string
  billingPeriodEnd?: string
}

function isCreditCacheValid(key: string): boolean {
  const cached = creditUsageCache.get(key)
  if (!cached) return false
  return Date.now() < cached.expiresAt
}

function updateCreditCache(key: string, usage: FirecrawlCreditUsage): void {
  creditUsageCache.set(key, {
    remainingCredits: usage.remainingCredits,
    lastChecked: Date.now(),
    expiresAt: Date.now() + CREDIT_CACHE_DURATION_MS,
  })
}

/**
 * Optimistically deducts `cost` credits from the cache entry for `key`.
 * Prevents over-dispatching to a key before the 5-minute cache refreshes.
 */
function deductCreditsOptimistically(key: string, cost: number): void {
  const cached = creditUsageCache.get(key)
  if (!cached) return
  const updated = Math.max(0, cached.remainingCredits - cost)
  creditUsageCache.set(key, { ...cached, remainingCredits: updated })
  if (updated === 0) {
    markFirecrawlKeyOutOfCredits(key)
  }
}

async function getFirecrawlCreditUsage(config: FirecrawlConfig): Promise<FirecrawlCreditUsage> {
  // Deduplicate concurrent fetches for the same key
  const existing = pendingCreditFetches.get(config.apiKey)
  if (existing) return existing

  const fetchPromise = (async (): Promise<FirecrawlCreditUsage> => {
    try {
      const response = await fetch(`${config.endpoint}/team/credit-usage`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
      })

      if (!response.ok) {
        if (response.status === 404) {
          // Endpoint not available, treat key as having unlimited credits
          return { remainingCredits: Number.MAX_SAFE_INTEGER, planCredits: Number.MAX_SAFE_INTEGER }
        }
        throw new Error(`Failed to fetch credit usage: ${response.status} ${response.statusText}`)
      }

      const data = await response.json() as {
        success: boolean
        data?: {
          remainingCredits: number
          planCredits: number
          billingPeriodStart?: string
          billingPeriodEnd?: string
        }
        error?: string
      }

      if (!data.success || !data.data) {
        throw new Error(data.error || 'Invalid credit usage response')
      }

      return {
        remainingCredits: data.data.remainingCredits,
        planCredits: data.data.planCredits,
        billingPeriodStart: data.data.billingPeriodStart,
        billingPeriodEnd: data.data.billingPeriodEnd,
      }
    } catch (error) {
      console.warn('Failed to fetch credit usage, using cached values if available:', error)
      const cached = creditUsageCache.get(config.apiKey)
      if (cached) {
        return { remainingCredits: cached.remainingCredits, planCredits: Number.MAX_SAFE_INTEGER }
      }
      return { remainingCredits: Number.MAX_SAFE_INTEGER, planCredits: Number.MAX_SAFE_INTEGER }
    } finally {
      pendingCreditFetches.delete(config.apiKey)
    }
  })()

  pendingCreditFetches.set(config.apiKey, fetchPromise)
  return fetchPromise
}

async function checkCreditsBeforeCall(config: FirecrawlConfig): Promise<void> {
  if (outOfCreditsKeys.has(config.apiKey)) {
    throw new FirecrawlOutOfCreditsError(
      `Firecrawl API key ${config.apiKey.substring(0, 8)}... has no credits remaining`,
      0,
    )
  }

  if (isCreditCacheValid(config.apiKey)) {
    const cached = creditUsageCache.get(config.apiKey)
    if (cached && cached.remainingCredits <= 0) {
      markFirecrawlKeyOutOfCredits(config.apiKey)
      throw new FirecrawlOutOfCreditsError(
        `Firecrawl API key ${config.apiKey.substring(0, 8)}... has no credits remaining`,
        cached.remainingCredits,
      )
    }
    return
  }

  const usage = await getFirecrawlCreditUsage(config)
  updateCreditCache(config.apiKey, usage)

  if (usage.remainingCredits <= 0) {
    markFirecrawlKeyOutOfCredits(config.apiKey)
    throw new FirecrawlOutOfCreditsError(
      `Firecrawl API key ${config.apiKey.substring(0, 8)}... has no credits remaining (${usage.remainingCredits})`,
      usage.remainingCredits,
    )
  }
}

/**
 * Selects the optimal key from `keys` — the eligible key with the most remaining credits.
 * Fetches credit data in parallel for stale keys; deduplicates in-flight fetches.
 */
async function getOptimalKeyWithCredits(keys: string[], endpoint: string): Promise<string> {
  const eligibleKeys = keys.filter(k => !failedFirecrawlKeys.has(k) && !outOfCreditsKeys.has(k))
  if (eligibleKeys.length === 0) {
    throw new FirecrawlOutOfCreditsError('All Firecrawl API keys have failed or have no credits remaining', 0)
  }

  const staleKeys = eligibleKeys.filter(k => !isCreditCacheValid(k))

  // Refresh stale entries in parallel (deduplication handled inside getFirecrawlCreditUsage)
  if (staleKeys.length > 0) {
    await Promise.all(
      staleKeys.map(async key => {
        try {
          const usage = await getFirecrawlCreditUsage({ endpoint, apiKey: key })
          updateCreditCache(key, usage)
        } catch (error) {
          console.warn(`Failed to fetch credit usage for key ${key.substring(0, 8)}...:`, error)
        }
      }),
    )
  }

  // Rank eligible keys by remaining credits (highest first)
  const ranked = eligibleKeys
    .map(key => {
      const cached = creditUsageCache.get(key)
      return { key, remainingCredits: cached?.remainingCredits ?? 0 }
    })
    .filter(item => {
      if (item.remainingCredits <= 0) {
        markFirecrawlKeyOutOfCredits(item.key)
        return false
      }
      return true
    })
    .sort((a, b) => b.remainingCredits - a.remainingCredits)

  if (ranked.length === 0) {
    throw new FirecrawlOutOfCreditsError('All Firecrawl API keys have no credits remaining', 0)
  }

  return ranked[0].key
}

/**
 * Resolves the best key to use, then checks its credits.
 * Returns the resolved key string.
 */
async function resolveKey(config: FirecrawlConfig, keys?: string[]): Promise<string> {
  if (!keys || keys.length === 0) {
    await checkCreditsBeforeCall(config)
    return config.apiKey
  }

  if (keys.length === 1) {
    const singleConfig = { ...config, apiKey: keys[0] }
    await checkCreditsBeforeCall(singleConfig)
    return keys[0]
  }

  return getOptimalKeyWithCredits(keys, config.endpoint)
}

export interface FirecrawlConfig {
  endpoint: string
  apiKey: string
  timeoutMs?: number
}

export interface FirecrawlScrapeResult {
  url: string
  title?: string
  markdown?: string
  links?: string[]
  truncated?: boolean
  originalLength?: number
}

export interface FirecrawlSearchResult {
  title: string
  url: string
  description?: string
  markdown?: string
  truncated?: boolean
  originalLength?: number
}

interface TruncateResult {
  text: string | undefined
  truncated: boolean
  originalLength: number
}

function truncateMarkdown(md: string | undefined): TruncateResult {
  if (md === undefined) return { text: undefined, truncated: false, originalLength: 0 }
  const originalLength = md.length
  const truncated = originalLength > MARKDOWN_TRUNCATE_LIMIT
  return {
    text: truncated ? md.slice(0, MARKDOWN_TRUNCATE_LIMIT) : md,
    truncated,
    originalLength,
  }
}

/**
 * Retry fetch with exponential backoff.
 * Retries on: network errors, 429, 5xx.
 * Does NOT retry on: 400, 401, 402, 403, 404 (permanent failures).
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timeoutId)

      // Permanent failures — do not retry
      if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 402 ||
        response.status === 403 ||
        response.status === 404
      ) {
        return response
      }

      // Transient failure — retry with backoff (408 = server-side timeout, worth retrying)
      if (response.status === 408 || response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt < retries - 1) {
          const retryAfterHeader = response.headers.get('Retry-After')
          const waitMs = retryAfterHeader
            ? Math.ceil(parseFloat(retryAfterHeader)) * 1000
            : 1000 * 2 ** attempt
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
          continue
        }
        return response
      }

      return response
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < retries - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
  }

  throw lastError ?? new Error('All retries failed')
}

export async function scrapeWithFirecrawl(
  url: string,
  config: FirecrawlConfig,
  keys?: string[],
): Promise<FirecrawlScrapeResult> {
  const timeoutMs = config.timeoutMs ?? 60_000
  const activeKey = await resolveKey(config, keys)

  const response = await fetchWithRetry(
    `${config.endpoint}/scrape`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify({
        url,
        formats: [{ type: 'markdown' }],
        onlyMainContent: true,
        // scrapeOptions.timeout tells the server how long to scrape; cap at API max 300s
        timeout: Math.min(Math.max(timeoutMs - 5_000, 10_000), 300_000),
      }),
    },
    timeoutMs,
  )

  if (response.status === 401 || response.status === 403) {
    markFirecrawlKeyFailed(activeKey)
    throw new Error(`Firecrawl scrape auth failed: ${response.status} ${response.statusText}`)
  }

  if (response.status === 402) {
    markFirecrawlKeyOutOfCredits(activeKey)
    throw new FirecrawlOutOfCreditsError(
      `Firecrawl scrape failed: no credits remaining (402 ${response.statusText})`,
      0,
    )
  }

  if (!response.ok) {
    throw new Error(`Firecrawl scrape failed: ${response.status} ${response.statusText}`)
  }

  // Optimistically deduct cost so the key isn't over-dispatched before the cache refreshes
  deductCreditsOptimistically(activeKey, CREDIT_COST_SCRAPE)

  const data = (await response.json()) as {
    data?: {
      url?: string
      metadata?: { title?: string; sourceURL?: string }
      markdown?: string
      links?: string[]
    }
  }

  const result = data.data ?? {}
  const { text: markdown, truncated, originalLength } = truncateMarkdown(result.markdown)
  return {
    url: result.metadata?.sourceURL ?? result.url ?? url,
    title: result.metadata?.title,
    markdown,
    links: result.links,
    truncated,
    originalLength: truncated ? originalLength : undefined,
  }
}

export async function searchWithFirecrawl(
  query: string,
  config: FirecrawlConfig,
  opts?: {
    includeDomains?: string[]
    excludeDomains?: string[]
    limit?: number
    keys?: string[]
    /** Pass null to skip markdown scraping (faster, cheaper — use when you only need URLs/titles) */
    scrapeOptions?: { formats: Array<{ type: string }>; onlyMainContent?: boolean } | null
  },
): Promise<FirecrawlSearchResult[]> {
  const timeoutMs = config.timeoutMs ?? 120_000
  const limit = opts?.limit ?? 5
  const activeKey = await resolveKey(config, opts?.keys)

  // Server-side timeout: slightly less than client-side so the server can return a clean error
  // before the AbortController fires. Capped at the API maximum of 300s.
  const serverTimeoutMs = Math.min(Math.max(timeoutMs - 5_000, 10_000), 300_000)

  const scrapeOptions =
    opts?.scrapeOptions !== undefined
      ? opts.scrapeOptions
      : { formats: [{ type: 'markdown' }], onlyMainContent: true }

  const body: Record<string, unknown> = {
    query,
    limit,
    timeout: serverTimeoutMs,
  }
  if (scrapeOptions) body.scrapeOptions = scrapeOptions
  if (opts?.includeDomains) body.includeDomains = opts.includeDomains
  if (opts?.excludeDomains) body.excludeDomains = opts.excludeDomains

  const response = await fetchWithRetry(
    `${config.endpoint}/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  )

  if (response.status === 401 || response.status === 403) {
    markFirecrawlKeyFailed(activeKey)
    throw new Error(`Firecrawl search auth failed: ${response.status} ${response.statusText}`)
  }

  if (response.status === 402) {
    markFirecrawlKeyOutOfCredits(activeKey)
    throw new FirecrawlOutOfCreditsError(
      `Firecrawl search failed: no credits remaining (402 ${response.statusText})`,
      0,
    )
  }

  if (!response.ok) {
    throw new Error(`Firecrawl search failed: ${response.status} ${response.statusText}`)
  }

  // Optimistically deduct cost so the key isn't over-dispatched before the cache refreshes
  deductCreditsOptimistically(activeKey, CREDIT_COST_SEARCH_PER_RESULT * limit)

  const data = (await response.json()) as {
    data?: {
      web?: Array<{
        title?: string
        url?: string
        description?: string
        markdown?: string
      }>
    }
  }

  return (data.data?.web ?? []).map((item) => {
    const { text: markdown, truncated, originalLength } = truncateMarkdown(item.markdown)
    return {
      title: item.title ?? '',
      url: item.url ?? '',
      description: item.description,
      markdown,
      truncated,
      originalLength: truncated ? originalLength : undefined,
    }
  })
}

/**
 * Credit-aware key selector — picks the eligible key with the most cached credits.
 * Falls back to round-robin over all non-failed keys when no credit data is available.
 */
export function pickFirecrawlKey(keys: string[], callCount: number): string {
  if (keys.length === 0) throw new Error('No Firecrawl API keys configured')

  const eligible = keys.filter(k => !failedFirecrawlKeys.has(k) && !outOfCreditsKeys.has(k))
  const pool = eligible.length > 0 ? eligible : keys

  // If we have credit data for any key in the pool, prefer the richest one
  const withCredits = pool
    .map(k => ({ key: k, credits: creditUsageCache.get(k)?.remainingCredits ?? -1 }))
    .filter(item => item.credits > 0)
    .sort((a, b) => b.credits - a.credits)

  if (withCredits.length > 0) return withCredits[0].key

  // No credit data yet — round-robin
  return pool[callCount % pool.length]
}
