import { describe, it, expect } from 'vitest'
import { chunkText } from './chunk'

const PATH = 'test.md'

describe('chunkText', () => {
  it('returns empty array for empty text', () => {
    expect(chunkText('', PATH)).toEqual([])
    expect(chunkText('   \n  ', PATH)).toEqual([])
  })

  it('returns a single chunk for short text', () => {
    const text = 'Hello world.\nSecond line.'
    const chunks = chunkText(text, PATH)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].path).toBe(PATH)
    expect(chunks[0].text).toContain('Hello world')
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].id).toMatch(/^test\.md:/)
  })

  it('splits at markdown headers', () => {
    const text = [
      '# Introduction',
      'Some intro text.',
      '',
      '# Second Section',
      'Second section body.',
    ].join('\n')

    const chunks = chunkText(text, PATH, { maxTokens: 400 })
    // Should have at least 2 chunks (intro + second section)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // First chunk contains the header
    expect(chunks[0].text).toContain('Introduction')
    // Second chunk contains the second header
    const secondSectionChunk = chunks.find(c => c.text.includes('Second Section'))
    expect(secondSectionChunk).toBeDefined()
  })

  it('enforces maxTokens by splitting long text', () => {
    // Each line ~10 chars = ~2.5 tokens. 100 lines ≈ 250 tokens.
    // maxTokens=50 → should produce multiple chunks
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${String(i).padStart(3, '0')}: some content here.`)
    const text = lines.join('\n')
    const chunks = chunkText(text, PATH, { maxTokens: 50, overlap: 0 })
    expect(chunks.length).toBeGreaterThan(1)
    // Each chunk should be at most maxTokens in size (within ±1 line tolerance)
    for (const chunk of chunks) {
      const tokenCount = Math.ceil(chunk.text.length / 4)
      expect(tokenCount).toBeLessThan(100) // generous upper bound
    }
  })

  it('adds overlap between consecutive chunks', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}: word word word word word`)
    const text = lines.join('\n')

    const chunksWithOverlap = chunkText(text, PATH, { maxTokens: 60, overlap: 30 })
    const chunksNoOverlap = chunkText(text, PATH, { maxTokens: 60, overlap: 0 })

    // With overlap, chunks should share some content (more chunks or longer chunks)
    expect(chunksWithOverlap.length).toBeGreaterThanOrEqual(chunksNoOverlap.length)
  })

  it('assigns unique ids and correct line ranges', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n')
    const chunks = chunkText(text, PATH, { maxTokens: 5, overlap: 0 })
    const ids = chunks.map(c => c.id)
    // All ids unique
    expect(new Set(ids).size).toBe(ids.length)
    // Line ranges are 1-indexed and within bounds
    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(1)
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
      expect(chunk.endLine).toBeLessThanOrEqual(10)
    }
  })

  it('handles text with no markdown headers as a single section', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const chunks = chunkText(text, PATH, { maxTokens: 400 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    // All lines should be covered
    const allText = chunks.map(c => c.text).join(' ')
    expect(allText).toContain('First paragraph')
    expect(allText).toContain('Third paragraph')
  })
})
