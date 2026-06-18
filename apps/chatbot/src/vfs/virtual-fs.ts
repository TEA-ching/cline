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
  content: string
  mimeType: string
  size: number
}

export interface SearchMatch {
  path: string
  lineNumber: number
  line: string
  context: string[]
}

export class VirtualFS {
  private files = new Map<string, VFSEntry>()

  write(path: string, content: string, mimeType = 'text/plain'): void {
    this.files.set(path, { content, mimeType, size: content.length })
  }

  read(path: string): string | null {
    return this.files.get(path)?.content ?? null
  }

  entry(path: string): VFSEntry | null {
    return this.files.get(path) ?? null
  }

  delete(path: string): boolean {
    return this.files.delete(path)
  }

  list(prefix?: string): string[] {
    const keys = [...this.files.keys()]
    if (prefix === undefined) {
      return keys
    }
    return keys.filter((k) => k.startsWith(prefix))
  }

  search(pattern: RegExp, paths?: string[]): SearchMatch[] {
    const targets = paths ?? [...this.files.keys()]
    const matches: SearchMatch[] = []

    for (const path of targets) {
      const entry = this.files.get(path)
      if (!entry) continue

      const lines = entry.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // Reset lastIndex before each test for global/sticky regexes
        if (pattern.global || pattern.sticky) pattern.lastIndex = 0

        const line = lines[i]
        if (pattern.test(line)) {
          if (pattern.global || pattern.sticky) pattern.lastIndex = 0

          const contextStart = Math.max(0, i - 2)
          const contextEnd = Math.min(lines.length - 1, i + 2)
          const context: string[] = []
          for (let j = contextStart; j <= contextEnd; j++) {
            if (j !== i) {
              context.push(lines[j])
            }
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

  toSnapshot(): Record<string, { content: string; mimeType: string }> {
    const snap: Record<string, { content: string; mimeType: string }> = {}
    for (const [path, entry] of this.files) {
      snap[path] = { content: entry.content, mimeType: entry.mimeType }
    }
    return snap
  }

  static fromSnapshot(
    snap: Record<string, { content: string; mimeType: string }>,
  ): VirtualFS {
    const vfs = new VirtualFS()
    for (const [path, { content, mimeType }] of Object.entries(snap)) {
      vfs.write(path, content, mimeType)
    }
    return vfs
  }
}
