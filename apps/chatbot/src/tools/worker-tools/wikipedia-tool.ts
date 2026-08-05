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
import { createTool } from '@sctg/cline-agents'
import { z } from 'zod'
import type { AgentTool } from '@sctg/cline-agents'

export function createWikipediaTool(): AgentTool<any, any> {
  return createTool({
    name: 'search_wikipedia',
    description:
      'Search and extract articles from Wikipedia in various languages. ' +
      'Search for articles by title or keywords across different Wikipedia editions (fr, en, de, it, es, etc.). ' +
      'Retrieve article summaries, full content, or specific sections. ' +
      'Example: search for "Eiffel Tower" in English Wikipedia or "Tour Eiffel" in French Wikipedia.',
    inputSchema: z.object({
      query: z.string().describe('Search query or article title'),
      language: z.string().default('en').describe(
        'Wikipedia language edition (fr, en, de, it, es, etc.). Default: "en"'
      ),
      search_type: z.enum(['search', 'summary', 'content', 'sections']).default('summary').describe(
        'Type of search: search (find matching articles), summary (get article summary), ' +
        'content (get full article content), sections (get article sections)'
      ),
      limit: z.number().int().min(1).max(10).optional().default(3).describe(
        'Maximum number of results to return (for search type)'
      ),
    }),
    execute: async ({ query, language, search_type, limit }) => {
      try {
        // Wikipedia API base URL
        const baseUrl = `https://${language}.wikipedia.org/w/api.php`

        // Build API parameters based on search type
        const params = new URLSearchParams({
          action: search_type === 'search' ? 'query' : 'query',
          format: 'json',
          origin: '*',
        })

        if (search_type === 'search') {
          // Search for articles matching the query
          params.append('list', 'search')
          params.append('srsearch', query)
          params.append('srlimit', String(limit))
          params.append('srprop', 'size|wordcount|timestamp')

          const response = await fetch(`${baseUrl}?${params.toString()}`)
          const data = await response.json()

          if (data.query?.search) {
            return {
              success: true,
              results: data.query.search.map((item: any) => ({
                title: item.title,
                snippet: item.snippet,
                wordcount: item.wordcount,
                timestamp: item.timestamp,
                size: item.size,
                url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(item.title)}`
              }))
            }
          } else {
            return { success: false, error: 'No results found' }
          }
        }
        else if (search_type === 'summary') {
          // Get article summary (extracts)
          params.append('prop', 'extracts|info')
          params.append('titles', query)
          params.append('exintro', 'true')
          params.append('explaintext', 'true')
          params.append('inprop', 'url')

          const response = await fetch(`${baseUrl}?${params.toString()}`)
          const data = await response.json()

          const pages = data.query?.pages
          if (pages) {
            const pageId = Object.keys(pages)[0]
            const page = pages[pageId]

            if (page.missing) {
              return { success: false, error: 'Article not found' }
            }

            return {
              success: true,
              title: page.title,
              extract: page.extract,
              fullurl: page.fullurl,
              canonicalurl: page.canonicalurl,
              pageid: page.pageid
            }
          } else {
            return { success: false, error: 'Article not found' }
          }
        }
        else if (search_type === 'content') {
          // Get full article content
          params.append('prop', 'revisions')
          params.append('titles', query)
          params.append('rvprop', 'content')
          params.append('rvslots', 'main')

          const response = await fetch(`${baseUrl}?${params.toString()}`)
          const data = await response.json()

          const pages = data.query?.pages
          if (pages) {
            const pageId = Object.keys(pages)[0]
            const page = pages[pageId]

            if (page.missing) {
              return { success: false, error: 'Article not found' }
            }

            return {
              success: true,
              title: page.title,
              content: page.revisions?.[0]?.slots?.main?.content || '',
              pageid: page.pageid
            }
          } else {
            return { success: false, error: 'Article not found' }
          }
        }
        else if (search_type === 'sections') {
          // Get article sections
          params.append('prop', 'sections')
          params.append('titles', query)

          const response = await fetch(`${baseUrl}?${params.toString()}`)
          const data = await response.json()

          const pages = data.query?.pages
          if (pages) {
            const pageId = Object.keys(pages)[0]
            const page = pages[pageId]

            if (page.missing) {
              return { success: false, error: 'Article not found' }
            }

            return {
              success: true,
              title: page.title,
              sections: page.sections?.map((section: any) => ({
                toclevel: section.toclevel,
                level: section.level,
                line: section.line,
                number: section.number,
                index: section.index,
                fromtitle: section.fromtitle,
                byteoffset: section.byteoffset,
                anchor: section.anchor
              })) || [],
              pageid: page.pageid
            }
          } else {
            return { success: false, error: 'Article not found' }
          }
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch Wikipedia data'
        }
      }
    },
  })
}
