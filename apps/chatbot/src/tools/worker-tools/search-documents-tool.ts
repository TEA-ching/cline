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
import type { RagIndex } from '@/lib/rag/rag-index'

export interface SearchDocumentsContext {
  ragIndex?: RagIndex
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSearchDocumentsTool(ctx: SearchDocumentsContext): AgentTool<any, any> {
  return createTool({
    name: 'search_documents',
    description:
      'Search through uploaded documents for relevant passages. ' +
      'Uses semantic search when an embedding model is configured, otherwise falls back to lexical BM25 scoring. ' +
      'Returns the most relevant text passages with their source file and line range.',
    inputSchema: z.object({
      query: z.string().describe('The search query to find relevant passages'),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('Number of passages to return (default 5, max 20)'),
    }),
    execute: async ({ query, top_k }) => {
      const ragIndex = ctx.ragIndex

      if (!ragIndex || ragIndex.chunkCount === 0) {
        return {
          results: [],
          message: 'No documents are currently indexed. Upload text files first.',
        }
      }

      const topK = top_k ?? 5
      const results = await ragIndex.searchAsync(query, topK)

      if (results.length === 0) {
        return {
          results: [],
          message: `No relevant passages found for: "${query}".`,
          documentsIndexed: ragIndex.documentCount,
          chunksIndexed: ragIndex.chunkCount,
        }
      }

      return {
        results: results.map(r => ({
          path: r.path,
          lineRange: `${r.startLine}-${r.endLine}`,
          score: Math.round(r.score * 1000) / 1000,
          text: r.text,
        })),
        searchMode: ragIndex.hasEmbeddings() ? 'semantic' : 'lexical',
        documentsIndexed: ragIndex.documentCount,
        chunksIndexed: ragIndex.chunkCount,
      }
    },
  })
}
