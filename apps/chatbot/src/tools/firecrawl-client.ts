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
}

export interface FirecrawlSearchResult {
  title: string
  url: string
  description?: string
  markdown?: string
}

function truncateMarkdown(md: string | undefined): string | undefined {
  if (md === undefined) return undefined
  return md.length > MARKDOWN_TRUNCATE_LIMIT
    ? md.slice(0, MARKDOWN_TRUNCATE_LIMIT)
    : md
}

export async function scrapeWithFirecrawl(
  url: string,
  config: FirecrawlConfig,
): Promise<FirecrawlScrapeResult> {
  const controller = config.timeoutMs
    ? new AbortController()
    : undefined
  const timeoutId = controller && config.timeoutMs
    ? setTimeout(() => controller.abort(), config.timeoutMs)
    : undefined

  try {
    const response = await fetch(`${config.endpoint}/v1/scrape`, {
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
      signal: controller?.signal,
    })

    if (!response.ok) {
      throw new Error(
        `Firecrawl scrape failed: ${response.status} ${response.statusText}`,
      )
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
    return {
      url: result.metadata?.sourceURL ?? result.url ?? url,
      title: result.metadata?.title,
      markdown: truncateMarkdown(result.markdown),
      links: result.links,
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
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
  const controller = config.timeoutMs ? new AbortController() : undefined
  const timeoutId = controller && config.timeoutMs
    ? setTimeout(() => controller.abort(), config.timeoutMs)
    : undefined

  try {
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

    const response = await fetch(`${config.endpoint}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    })

    if (!response.ok) {
      throw new Error(
        `Firecrawl search failed: ${response.status} ${response.statusText}`,
      )
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

    return (data.data?.web ?? []).map((item) => ({
      title: item.title ?? '',
      url: item.url ?? '',
      description: item.description,
      markdown: truncateMarkdown(item.markdown),
    }))
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/**
 * Round-robin key selector — picks the next key from the pool based on callCount.
 */
export function pickFirecrawlKey(keys: string[], callCount: number): string {
  if (keys.length === 0) throw new Error('No Firecrawl API keys configured')
  return keys[callCount % keys.length]
}
