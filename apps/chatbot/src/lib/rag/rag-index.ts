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
import { BM25Index } from './bm25'
import { chunkText } from './chunk'
import { getBatchEmbeddings, cosineSimilarity } from './embeddings'
import type { Chunk, ChunkOptions } from './chunk'
import type { EmbeddingConfig } from './embeddings'

export type { EmbeddingConfig }

export interface SearchResult {
  path: string
  chunkId: string
  text: string
  startLine: number
  endLine: number
  score: number
}

export class RagIndex {
  private bm25 = new BM25Index()
  /** chunkId → Chunk */
  private chunks = new Map<string, Chunk>()
  /** chunkId → embedding vector (populated only when embeddingConfig is set) */
  private embeddings = new Map<string, number[]>()
  private embeddingConfig?: EmbeddingConfig

  constructor(embeddingConfig?: EmbeddingConfig) {
    this.embeddingConfig = embeddingConfig
  }

  /**
   * Chunk `text` and add all chunks to the BM25 index.
   * If an embedding config is set, request vectors asynchronously and store them
   * for semantic search. Failures are silently ignored (falls back to BM25).
   */
  async indexDocument(path: string, text: string, opts?: ChunkOptions): Promise<void> {
    // Remove any existing chunks for this path first
    this.removeDocument(path)

    const newChunks = chunkText(text, path, opts)
    for (const chunk of newChunks) {
      this.chunks.set(chunk.id, chunk)
      this.bm25.addDocument(chunk.id, chunk.text)
    }

    if (this.embeddingConfig && newChunks.length > 0) {
      try {
        const texts = newChunks.map(c => c.text)
        const vectors = await getBatchEmbeddings(texts, this.embeddingConfig)
        for (let i = 0; i < newChunks.length; i++) {
          if (vectors[i]) this.embeddings.set(newChunks[i].id, vectors[i])
        }
      } catch {
        // Embedding unavailable — BM25 is still usable
      }
    }
  }

  removeDocument(path: string): void {
    for (const [id, chunk] of this.chunks) {
      if (chunk.path === path) {
        this.chunks.delete(id)
        this.embeddings.delete(id)
      }
    }
    this.bm25.removeDocumentsForPath(path)
  }

  /**
   * Synchronous BM25 search. Always available regardless of embedding config.
   */
  search(query: string, topK = 5): SearchResult[] {
    return this._bm25Search(query, topK)
  }

  /**
   * Semantic search when embeddings are available, with BM25 fallback.
   * The embedding query requires an async API call.
   */
  async searchAsync(query: string, topK = 5): Promise<SearchResult[]> {
    if (this.embeddingConfig && this.embeddings.size > 0) {
      try {
        const [queryVec] = await getBatchEmbeddings([query], this.embeddingConfig)
        if (queryVec) return this._semanticSearch(queryVec, topK)
      } catch {
        // Fall through to BM25
      }
    }
    return this._bm25Search(query, topK)
  }

  private _bm25Search(query: string, topK: number): SearchResult[] {
    return this.bm25
      .search(query, topK)
      .map(m => {
        const chunk = this.chunks.get(m.docId)
        if (!chunk) return null
        return {
          path: chunk.path,
          chunkId: m.docId,
          text: chunk.text,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: m.score,
        }
      })
      .filter((r): r is SearchResult => r !== null)
  }

  private _semanticSearch(queryVector: number[], topK: number): SearchResult[] {
    const scored: Array<{ chunkId: string; score: number }> = []
    for (const [chunkId, vec] of this.embeddings) {
      scored.push({ chunkId, score: cosineSimilarity(queryVector, vec) })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored
      .slice(0, topK)
      .map(m => {
        const chunk = this.chunks.get(m.chunkId)
        if (!chunk) return null
        return {
          path: chunk.path,
          chunkId: m.chunkId,
          text: chunk.text,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: m.score,
        }
      })
      .filter((r): r is SearchResult => r !== null)
  }

  get documentCount(): number {
    const paths = new Set<string>()
    for (const chunk of this.chunks.values()) paths.add(chunk.path)
    return paths.size
  }

  get chunkCount(): number {
    return this.chunks.size
  }

  hasEmbeddings(): boolean {
    return this.embeddings.size > 0
  }

  setEmbeddingConfig(config: EmbeddingConfig | undefined): void {
    this.embeddingConfig = config
  }

  clear(): void {
    this.bm25.clear()
    this.chunks.clear()
    this.embeddings.clear()
  }
}
