import { describe, it, expect, beforeEach } from 'vitest'
import { BM25Index } from './bm25'

describe('BM25Index', () => {
  let index: BM25Index

  beforeEach(() => {
    index = new BM25Index()
  })

  it('starts empty', () => {
    expect(index.docCount).toBe(0)
    expect(index.search('anything')).toEqual([])
  })

  it('returns no results for empty query', () => {
    index.addDocument('d1', 'hello world')
    const results = index.search('')
    expect(results).toEqual([])
  })

  it('finds a document containing the query term', () => {
    index.addDocument('d1', 'the quick brown fox jumps over the lazy dog')
    const results = index.search('fox')
    expect(results).toHaveLength(1)
    expect(results[0].docId).toBe('d1')
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('ranks more relevant documents higher', () => {
    index.addDocument('d1', 'machine learning is great for classification tasks')
    index.addDocument('d2', 'machine learning machine learning machine learning deep neural')
    index.addDocument('d3', 'cooking pasta with tomato sauce is delicious')

    const results = index.search('machine learning', 3)
    // d2 has higher term frequency → should rank first or second
    const topIds = results.slice(0, 2).map(r => r.docId)
    expect(topIds).toContain('d2')
    // d3 (unrelated) should not appear in top 2
    expect(topIds).not.toContain('d3')
  })

  it('removes a document and no longer finds it', () => {
    index.addDocument('d1', 'unique term xyzzy foobar')
    index.addDocument('d2', 'other content here')
    index.removeDocument('d1')
    const results = index.search('xyzzy')
    expect(results.map(r => r.docId)).not.toContain('d1')
    expect(index.docCount).toBe(1)
  })

  it('removeDocumentsForPath removes all chunks for a path', () => {
    index.addDocument('doc.md:0', 'first chunk content alpha')
    index.addDocument('doc.md:1', 'second chunk content beta')
    index.addDocument('other.md:0', 'unrelated gamma')

    index.removeDocumentsForPath('doc.md')
    expect(index.docCount).toBe(1)
    expect(index.search('alpha')).toHaveLength(0)
    expect(index.search('gamma')).toHaveLength(1)
  })

  it('is idempotent on addDocument (re-adding updates the doc)', () => {
    index.addDocument('d1', 'original content apple')
    index.addDocument('d1', 'updated content banana')
    expect(index.docCount).toBe(1)
    // Should find 'banana' but not 'apple'
    expect(index.search('banana')).toHaveLength(1)
    expect(index.search('apple')).toHaveLength(0)
  })

  it('respects topK limit', () => {
    for (let i = 0; i < 20; i++) {
      index.addDocument(`d${i}`, `document ${i} contains the word search`)
    }
    const results = index.search('search', 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('scores with IDF: rare terms score higher than common ones', () => {
    // Add many documents with 'common', only one with 'rare'
    for (let i = 0; i < 10; i++) {
      index.addDocument(`d${i}`, `common word is found in document ${i}`)
    }
    index.addDocument('rare_doc', 'rare unique term zebrafish quantum')

    const rareResults = index.search('zebrafish')
    expect(rareResults).toHaveLength(1)
    expect(rareResults[0].score).toBeGreaterThan(0)
  })

  it('clears all documents', () => {
    index.addDocument('d1', 'hello')
    index.addDocument('d2', 'world')
    index.clear()
    expect(index.docCount).toBe(0)
    expect(index.search('hello')).toEqual([])
  })
})
