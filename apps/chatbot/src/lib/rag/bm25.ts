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

/** BM25 Okapi — k1 = 1.5, b = 0.75. */

const K1 = 1.5
const B = 0.75

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
}

export class BM25Index {
  /** docId → { term → count } */
  private termFreqs = new Map<string, Map<string, number>>()
  /** docId → token count (document length) */
  private docLengths = new Map<string, number>()
  /** term → set of docIds that contain it */
  private invertedIndex = new Map<string, Set<string>>()

  get docCount(): number {
    return this.termFreqs.size
  }

  private get avgDocLength(): number {
    if (this.termFreqs.size === 0) return 0
    let total = 0
    for (const len of this.docLengths.values()) total += len
    return total / this.termFreqs.size
  }

  addDocument(docId: string, text: string): void {
    // Idempotent: remove previous version first
    this.removeDocument(docId)

    const tokens = tokenize(text)
    const tf = new Map<string, number>()
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1)
    }

    this.termFreqs.set(docId, tf)
    this.docLengths.set(docId, tokens.length)

    for (const tok of tf.keys()) {
      let docs = this.invertedIndex.get(tok)
      if (!docs) {
        docs = new Set()
        this.invertedIndex.set(tok, docs)
      }
      docs.add(docId)
    }
  }

  removeDocument(docId: string): void {
    const tf = this.termFreqs.get(docId)
    if (!tf) return

    for (const tok of tf.keys()) {
      const docs = this.invertedIndex.get(tok)
      if (docs) {
        docs.delete(docId)
        if (docs.size === 0) this.invertedIndex.delete(tok)
      }
    }
    this.termFreqs.delete(docId)
    this.docLengths.delete(docId)
  }

  /** Remove all documents whose id starts with `<path>:`. */
  removeDocumentsForPath(path: string): void {
    const prefix = `${path}:`
    const toRemove = [...this.termFreqs.keys()].filter(id => id.startsWith(prefix))
    for (const id of toRemove) this.removeDocument(id)
  }

  /**
   * Score all documents against `query` and return the top `topK` by BM25 score.
   * Documents with score 0 are excluded.
   */
  search(query: string, topK = 5): Array<{ docId: string; score: number }> {
    const queryTerms = tokenize(query)
    const scores = new Map<string, number>()
    const N = this.docCount
    const avgDL = this.avgDocLength

    for (const term of queryTerms) {
      const docs = this.invertedIndex.get(term)
      if (!docs) continue

      const df = docs.size
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)

      for (const docId of docs) {
        const tf = this.termFreqs.get(docId)?.get(term) ?? 0
        const dl = this.docLengths.get(docId) ?? 0
        const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / (avgDL || 1))))
        scores.set(docId, (scores.get(docId) ?? 0) + idf * tfNorm)
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([docId, score]) => ({ docId, score }))
  }

  clear(): void {
    this.termFreqs.clear()
    this.docLengths.clear()
    this.invertedIndex.clear()
  }
}
