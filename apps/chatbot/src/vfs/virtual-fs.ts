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

export interface VFSEntry {
  content: string | Uint8Array
  binary: boolean
  mimeType: string
  /** Real size in bytes: byteLength for Uint8Array, decoded count for data: URLs,
   *  UTF-8 byte count for plain strings. */
  size: number
}

export interface SearchMatch {
  path: string
  lineNumber: number
  line: string
  context: string[]
}

/** Snapshot entry — binary content is base64-encoded; `binary: true` flags it. */
export interface VFSSnapshotEntry {
  content: string
  mimeType: string
  binary?: boolean
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeSize(content: string | Uint8Array): number {
  if (content instanceof Uint8Array) return content.byteLength
  // base64 data URL: compute decoded size without fully decoding
  if (content.startsWith('data:')) {
    const commaIdx = content.indexOf(',')
    if (commaIdx >= 0) {
      const b64 = content.slice(commaIdx + 1)
      const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
      return Math.floor(b64.length * 3 / 4) - pad
    }
  }
  return new TextEncoder().encode(content).length
}

function uint8ToDataUrl(data: Uint8Array, mimeType: string): string {
  let binary = ''
  for (let i = 0; i < data.byteLength; i++) {
    binary += String.fromCharCode(data[i])
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

function uint8ToBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.byteLength; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary)
}

// ---------------------------------------------------------------------------

export class VirtualFS {
  private files = new Map<string, VFSEntry>()

  /** Write a file. Content may be a plain string (text) or Uint8Array (binary). */
  write(path: string, content: string | Uint8Array, mimeType = 'text/plain'): void {
    const binary = content instanceof Uint8Array
    this.files.set(path, { content, binary, mimeType, size: computeSize(content) })
  }

  /**
   * Read file content as a string.
   * Binary (Uint8Array) entries are returned as a `data:<mime>;base64,...` URL
   * so that existing consumers (LLM image inputs, file viewer) continue to work.
   */
  read(path: string): string | null {
    const entry = this.files.get(path)
    if (!entry) return null
    if (entry.binary && entry.content instanceof Uint8Array) {
      return uint8ToDataUrl(entry.content, entry.mimeType)
    }
    return entry.content as string
  }

  /** Read file content as raw bytes.  String entries are UTF-8 encoded. */
  readBinary(path: string): Uint8Array | null {
    const entry = this.files.get(path)
    if (!entry) return null
    if (entry.content instanceof Uint8Array) return entry.content
    return new TextEncoder().encode(entry.content as string)
  }

  entry(path: string): VFSEntry | null {
    return this.files.get(path) ?? null
  }

  delete(path: string): boolean {
    return this.files.delete(path)
  }

  list(prefix?: string): string[] {
    const keys = [...this.files.keys()]
    if (prefix === undefined) return keys
    return keys.filter(k => k.startsWith(prefix))
  }

  search(pattern: RegExp, paths?: string[]): SearchMatch[] {
    const targets = paths ?? [...this.files.keys()]
    const matches: SearchMatch[] = []

    for (const path of targets) {
      const entry = this.files.get(path)
      // Binary files cannot be searched with a string regex
      if (!entry || entry.binary) continue

      const lines = (entry.content as string).split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (pattern.global || pattern.sticky) pattern.lastIndex = 0
        const line = lines[i]
        if (pattern.test(line)) {
          if (pattern.global || pattern.sticky) pattern.lastIndex = 0
          const contextStart = Math.max(0, i - 2)
          const contextEnd = Math.min(lines.length - 1, i + 2)
          const context: string[] = []
          for (let j = contextStart; j <= contextEnd; j++) {
            if (j !== i) context.push(lines[j])
          }
          matches.push({ path, lineNumber: i + 1, line, context })
        }
      }
    }

    return matches
  }

  size(): number {
    return this.files.size
  }

  clear(): void {
    this.files.clear()
  }

  /** Serialise to a JSON-safe snapshot.  Binary entries are base64-encoded. */
  toSnapshot(): Record<string, VFSSnapshotEntry> {
    const snap: Record<string, VFSSnapshotEntry> = {}
    for (const [path, entry] of this.files) {
      if (entry.binary && entry.content instanceof Uint8Array) {
        snap[path] = { content: uint8ToBase64(entry.content), mimeType: entry.mimeType, binary: true }
      } else {
        snap[path] = { content: entry.content as string, mimeType: entry.mimeType }
      }
    }
    return snap
  }

  static fromSnapshot(snap: Record<string, VFSSnapshotEntry>): VirtualFS {
    const vfs = new VirtualFS()
    for (const [path, { content, mimeType, binary }] of Object.entries(snap)) {
      if (binary) {
        const bytes = Uint8Array.from(atob(content), c => c.charCodeAt(0))
        vfs.write(path, bytes, mimeType)
      } else {
        vfs.write(path, content, mimeType)
      }
    }
    return vfs
  }
}
