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

// Module-level set of keys that have hit permanent auth errors (401/403)
// or exhausted all retries on 429. Persists across calls within the same
// worker lifetime. Reset by creating a new worker.
const failedFirecrawlKeys = new Set<string>()

export function markFirecrawlKeyFailed(key: string): void {
  failedFirecrawlKeys.add(key)
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
 * Does NOT retry on: 400, 401, 403, 404 (permanent failures).
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

      // Permanent auth failure — do not retry
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 400) {
        return response
      }

      // Transient failure — retry with backoff
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
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
): Promise<FirecrawlScrapeResult> {
  const timeoutMs = config.timeoutMs ?? 12_000

  const response = await fetchWithRetry(
    `${config.endpoint}/scrape`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: [{ type: 'markdown' }],
        onlyMainContent: true,
      }),
    },
    timeoutMs,
  )

  if (response.status === 401 || response.status === 403) {
    markFirecrawlKeyFailed(config.apiKey)
    throw new Error(`Firecrawl scrape auth failed: ${response.status} ${response.statusText}`)
  }

  if (!response.ok) {
    throw new Error(`Firecrawl scrape failed: ${response.status} ${response.statusText}`)
  }

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
    allowedDomains?: string[]
    blockedDomains?: string[]
    limit?: number
  },
): Promise<FirecrawlSearchResult[]> {
  const timeoutMs = config.timeoutMs ?? 25_000

  const body: Record<string, unknown> = {
    query,
    limit: opts?.limit ?? 5,
    scrapeOptions: {
      formats: [{ type: 'markdown' }],
      onlyMainContent: true,
    },
  }
  if (opts?.allowedDomains) body.allowedDomains = opts.allowedDomains
  if (opts?.blockedDomains) body.blockedDomains = opts.blockedDomains

  const response = await fetchWithRetry(
    `${config.endpoint}/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  )

  if (response.status === 401 || response.status === 403) {
    markFirecrawlKeyFailed(config.apiKey)
    throw new Error(`Firecrawl search auth failed: ${response.status} ${response.statusText}`)
  }

  if (!response.ok) {
    throw new Error(`Firecrawl search failed: ${response.status} ${response.statusText}`)
  }

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
 * Round-robin key selector — picks the next eligible (non-failed) key.
 * Falls back to the full pool if all keys have failed.
 */
export function pickFirecrawlKey(keys: string[], callCount: number): string {
  if (keys.length === 0) throw new Error('No Firecrawl API keys configured')
  const eligible = keys.filter((k) => !failedFirecrawlKeys.has(k))
  const pool = eligible.length > 0 ? eligible : keys
  return pool[callCount % pool.length]
}
