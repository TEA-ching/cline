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

export interface Chunk {
  /** Unique identifier: `<path>:<index>` */
  id: string
  path: string
  text: string
  /** 1-indexed start line in the original document */
  startLine: number
  /** 1-indexed end line in the original document */
  endLine: number
}

export interface ChunkOptions {
  /** Target max tokens per chunk (estimated at ~4 chars/token). Default 400. */
  maxTokens?: number
  /** Overlap in tokens to repeat from the end of the previous chunk. Default 40. */
  overlap?: number
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Return lines from the end of `lines` summing to ~`targetTokens` tokens. */
function tailLines(lines: string[], targetTokens: number): string[] {
  let total = 0
  const result: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    total += estimateTokens(lines[i]) + 1
    result.unshift(lines[i])
    if (total >= targetTokens) break
  }
  return result
}

/**
 * Split `text` into overlapping chunks, respecting Markdown section boundaries.
 *
 * Strategy:
 * 1. Accumulate lines; flush when we hit a header *and* the accumulated text
 *    already contains content, or when we exceed `maxTokens`.
 * 2. After each flush, prepend the last ~`overlap` tokens of the previous
 *    chunk to the next one so queries that straddle a boundary still match.
 */
export function chunkText(text: string, path: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? 400
  const overlap = opts.overlap ?? 40

  if (!text.trim()) return []

  const lines = text.split('\n')
  const chunks: Chunk[] = []
  let chunkIdx = 0

  // Current accumulator
  let accLines: string[] = []
  let accStart = 0 // 0-indexed line where accLines[0] sits

  function emit(upToLine: number): void {
    const t = accLines.join('\n').trim()
    if (!t) return
    chunks.push({
      id: `${path}:${chunkIdx++}`,
      path,
      text: t,
      startLine: accStart + 1,
      endLine: upToLine + 1,
    })
  }

  function flushAndOverlap(endLine: number, nextLineIdx: number): void {
    emit(endLine)
    const overlap_lines = tailLines(accLines, overlap)
    accLines = [...overlap_lines]
    // accStart should reflect where the overlap lines originated
    // Use nextLineIdx as the new start (overlap is logically before it)
    accStart = nextLineIdx - overlap_lines.length
    if (accStart < 0) accStart = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isHeader = /^#{1,6}\s/.test(line)

    // At a markdown header: flush current accumulator (if non-empty), then start fresh
    if (isHeader && accLines.length > 0) {
      flushAndOverlap(i - 1, i)
    }

    accLines.push(line)

    // Force-flush when we exceed maxTokens (mid-section split)
    if (estimateTokens(accLines.join('\n')) >= maxTokens) {
      // If this is the only line (extremely long line), emit it as-is
      if (accLines.length === 1) {
        emit(i)
        accLines = []
        accStart = i + 1
      } else {
        // Remove the last line we just pushed, flush what we had, then restart
        const last = accLines.pop()!
        flushAndOverlap(i - 1, i)
        accLines.push(last)
      }
    }
  }

  // Flush remainder
  if (accLines.length > 0) {
    emit(lines.length - 1)
  }

  return chunks
}
