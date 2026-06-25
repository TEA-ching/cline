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
import { createTool } from '@cline/agents'
import { z } from 'zod'
import type { AgentTool } from '@cline/agents'
import { scrapeWithFirecrawl, searchWithFirecrawl } from './firecrawl-client'
import { expandQuery } from './query-utils'
import type { FocusMode } from './focus-modes'
import { getFocusDomains } from './focus-modes'

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    return `${host}${u.pathname}`.replace(/\/+$/, '').toLowerCase()
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'with',
  'be', 'are', 'was', 'were', 'will', 'can', 'do', 'does', 'did', 'have', 'has', 'had',
  'que', 'les', 'des', 'une', 'est', 'par', 'sur', 'dans', 'avec', 'pour', 'pas', 'mais',
  'this', 'that', 'from', 'by', 'not', 'what', 'when', 'where', 'how', 'why', 'which',
])

// ── A4: Domain reliability scoring ──────────────────────────────────────────

const RELIABILITY_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\.edu$/, score: 4 },
  { pattern: /\.gov$/, score: 4 },
  { pattern: /arxiv\.org$/, score: 4 },
  { pattern: /pubmed\.ncbi\.nlm\.nih\.gov$/, score: 4 },
  { pattern: /nature\.com$/, score: 4 },
  { pattern: /science\.org$/, score: 4 },
  { pattern: /ieee\.org$/, score: 3 },
  { pattern: /acm\.org$/, score: 3 },
  { pattern: /springer\.com$/, score: 3 },
  { pattern: /wiley\.com$/, score: 3 },
  { pattern: /sciencedirect\.com$/, score: 3 },
  { pattern: /reuters\.com$/, score: 3 },
  { pattern: /bbc\.com$|bbc\.co\.uk$/, score: 3 },
  { pattern: /wikipedia\.org$/, score: 2 },
  { pattern: /github\.com$/, score: 2 },
  { pattern: /stackoverflow\.com$/, score: 2 },
  { pattern: /medium\.com$/, score: 1 },
]

function computeReliability(domain: string): number {
  for (const { pattern, score } of RELIABILITY_PATTERNS) {
    if (pattern.test(domain)) return score
  }
  return 1
}

// ── A4: Fact markers (numbers + key entities) for agreement scoring ──────────

function extractFactMarkers(text: string): Set<string> {
  const numbers = text.match(/\b\d+(?:[.,]\d+)?(?:\s*%|px|km|kg|MB|GB|TB|ms)?\b/g) ?? []
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 5 && !STOPWORDS.has(w))
  return new Set([...numbers.slice(0, 10), ...words.slice(0, 20)])
}

function computeAgreement(
  markers: Set<string>,
  sourceId: number,
  allPassages: Array<{ markers: Set<string>; sourceId: number }>,
): number {
  if (markers.size === 0) return 0
  const confirmingSources = new Set<number>()
  for (const other of allPassages) {
    if (other.sourceId === sourceId) continue
    let overlap = 0
    for (const m of markers) {
      if (other.markers.has(m)) overlap++
    }
    if (overlap / markers.size >= 0.2) {
      confirmingSources.add(other.sourceId)
    }
  }
  return confirmingSources.size
}

// ── Query relevance scoring ───────────────────────────────────────────────────

function questionKeywords(question: string): Set<string> {
  return new Set(
    question.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOPWORDS.has(w)),
  )
}

function scorePassage(text: string, qWords: Set<string>): number {
  if (!text.trim() || text.length < 50) return 0
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2)
  if (words.length === 0) return 0
  const matches = words.filter(w => qWords.has(w)).length
  return matches / words.length
}

// ── Tool factory ──────────────────────────────────────────────────────────────

/**
 * Creates the deep_research tool.
 * @param ctx - Firecrawl configuration + optional focus mode for domain filtering
 * @param nextKey - Returns the next Firecrawl API key (handles round-robin externally)
 */
export function createDeepResearchTool(
  ctx: { firecrawlKeys: string[]; firecrawlEndpoint: string; focusMode?: FocusMode },
  nextKey: () => string,
): AgentTool<any, any> {
  return createTool({
    name: 'deep_research',
    description: `Perform comprehensive web research on a topic. Fires multiple search queries in parallel, deduplicates results by URL, scrapes the most relevant pages, scores passages by keyword relevance, and returns structured results with citable sources.

Each passage is tagged with [Source N, agree=M] where M is the number of independent sources corroborating the same facts. Use agree=0 passages with caution and mark them ⚠️ single source.

Use this for complex research questions requiring multiple sources (comparisons, best practices, market overviews). For simple lookups, prefer search_web.

Cite sources with [citation:1], [citation:2], etc.`,
    inputSchema: z.object({
      question: z.string().describe('The research question or topic to investigate'),
      breadth: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .default(3)
        .describe('Number of pages to scrape deeply (default: 3, max: 8)'),
    }),
    execute: async ({ question, breadth }) => {
      const year = new Date().getFullYear()
      const queries = expandQuery(question, { year }).slice(0, 3)
      const focusDomains = getFocusDomains(ctx.focusMode)

      // Parallel search across all query variants
      const searchResults = await Promise.allSettled(
        queries.map(q =>
          searchWithFirecrawl(
            q,
            // No markdown scraping here — we only need URLs/titles/descriptions.
            // Full content is fetched in the scrapeWithFirecrawl pass below.
            { endpoint: ctx.firecrawlEndpoint, apiKey: nextKey(), timeoutMs: 30_000 },
            { limit: 5, ...focusDomains, scrapeOptions: null },
          ),
        ),
      )

      // Collect unique URLs, preserving first-seen title/description
      const seen = new Map<string, { url: string; title: string; description: string }>()
      for (const result of searchResults) {
        if (result.status !== 'fulfilled') continue
        for (const item of result.value) {
          if (!item.url) continue
          const key = normalizeUrl(item.url)
          if (!seen.has(key)) {
            seen.set(key, {
              url: item.url,
              title: item.title || '',
              description: item.description || item.markdown?.slice(0, 300) || '',
            })
          }
        }
      }

      const urlsToScrape = [...seen.values()].slice(0, breadth ?? 3)

      // Scrape pages in parallel
      const scrapeResults = await Promise.allSettled(
        urlsToScrape.map(item =>
          scrapeWithFirecrawl(item.url, {
            endpoint: ctx.firecrawlEndpoint,
            apiKey: nextKey(),
            timeoutMs: 35_000,
          }),
        ),
      )

      // Build sources array (with A4 reliability)
      const qWords = questionKeywords(question)
      const sources: Array<{
        id: number
        title: string
        url: string
        snippet: string
        domain: string
        favicon: string
        reliability: number
      }> = []

      // First pass: collect raw passages with fact markers
      const rawPassages: Array<{
        text: string
        score: number
        sourceId: number
        markers: Set<string>
      }> = []

      for (let idx = 0; idx < urlsToScrape.length; idx++) {
        const meta = urlsToScrape[idx]
        const scrapeResult = scrapeResults[idx]
        const scrape = scrapeResult.status === 'fulfilled' ? scrapeResult.value : null
        const domain = safeHostname(meta.url)
        const sourceId = idx + 1
        const reliability = computeReliability(domain)

        sources.push({
          id: sourceId,
          title: scrape?.title || meta.title || meta.url,
          url: meta.url,
          snippet: meta.description.slice(0, 300),
          domain,
          favicon: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '',
          reliability,
        })

        if (scrape?.markdown) {
          const paragraphs = scrape.markdown.split(/\n{2,}/).filter(p => p.trim().length >= 50)
          for (const p of paragraphs.slice(0, 40)) {
            rawPassages.push({
              text: p.trim(),
              score: scorePassage(p, qWords),
              sourceId,
              markers: extractFactMarkers(p),
            })
          }
        }
      }

      // Second pass: compute agreement across sources (A4)
      const passagesWithAgreement = rawPassages.map(p => ({
        ...p,
        agreement: computeAgreement(p.markers, p.sourceId, rawPassages),
      }))

      // Sort sources by reliability descending (A4)
      const sortedSources = [...sources].sort((a, b) => b.reliability - a.reliability)

      const topPassages = passagesWithAgreement
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map(p => `[Source ${p.sourceId}, agree=${p.agreement}] ${p.text}`)

      return {
        question,
        sources: sortedSources,
        passages: topPassages,
        totalSourcesFound: seen.size,
        sourcesScraped: scrapeResults.filter(r => r.status === 'fulfilled').length,
      }
    },
  })
}
