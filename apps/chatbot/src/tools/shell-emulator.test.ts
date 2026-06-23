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

import { describe, it, expect, vi } from 'vitest'
import { emulateShellCommands } from './shell-emulator'
import { VirtualFS } from '@/vfs/virtual-fs'
import type { VFSEntry, SearchMatch } from '@/vfs/virtual-fs'

// Mock VirtualFS implementation for testing
class MockVirtualFS extends VirtualFS {
  constructor(initialFiles: Record<string, string> = {}) {
    super()
    for (const [path, content] of Object.entries(initialFiles)) {
      this.write(path, content, 'text/plain')
    }
  }
}

describe('emulateShellCommands', () => {
  it('should handle uname command', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['uname'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ uname')
    expect(result).toContain('SCTG chat bot - fake environment')
  })

  it('should handle date command', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['date'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ date')
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  })

  it('should handle date with -u argument', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['date -u'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ date -u')
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  })

  it('should handle date with --utc argument', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['date --utc'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ date --utc')
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  })

  it('should handle date with --iso-8601=seconds argument', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['date --iso-8601=seconds'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ date --iso-8601=seconds')
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  })

  it('should handle date with unknown argument', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['date +%Y-%m-%d'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ date +%Y-%m-%d')
    // For unknown arguments, should return a simple date string
    expect(result).toMatch(/\w+ \w+ \d{1,2} \d{4} \d{2}:\d{2}:\d{2} GMT/)
  })

  it('should handle date +%s (Unix timestamp)', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['date +%s'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ date +%s')
    // Should return a Unix timestamp (seconds since 1970-01-01)
    expect(result).toMatch(/\d{10}/)
    const timestamp = parseInt(result.match(/\d{10}/)?.[0] || '')
    expect(timestamp).toBeGreaterThan(1000000000) // Reasonable timestamp
    expect(timestamp).toBeLessThan(3000000000) // Reasonable timestamp
  })

   it('should handle date +%H:%M:%S (time format)', async () => {
     const vfs = new MockVirtualFS()
     const result = await emulateShellCommands(['date +%H:%M:%S'], {
       vfs,
       onFileCreated: vi.fn(),
     })

     expect(result).toContain('$ date +%H:%M:%S')
     // Should return time in HH:MM:SS format
     expect(result).toMatch(/\d{2}:\d{2}:\d{2}/)
   })

   it('should handle date +%Z (timezone name)', async () => {
     const vfs = new MockVirtualFS()
     const result = await emulateShellCommands(['date +%Z'], {
       vfs,
       onFileCreated: vi.fn(),
     })

     expect(result).toContain('$ date +%Z')
     // Should return a timezone name (e.g., UTC, CEST, GMT+2, etc.)
     // The format can vary: UTC, GMT+2, GMT-5, CEST, etc.
     expect(result).toMatch(/UTC|GMT[+-]?\d*|CEST|CST|EST|PST|[A-Z]{3,5}/)
   })

   it('should handle echo command', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['echo "hello world"'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ echo "hello world"')
    expect(result).toContain('hello world')
  })

  it('should handle find command', async () => {
    const vfs = new MockVirtualFS({
      'src/index.ts': 'const x = 1',
      'src/utils.ts': 'export function foo() {}',
      'README.md': '# Project',
    })

    const result = await emulateShellCommands(['find src -name "*.ts"'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ find src -name "*.ts"')
    expect(result).toContain('src/index.ts')
    expect(result).toContain('src/utils.ts')
    expect(result).not.toContain('README.md')
  })

  it('should handle grep command', async () => {
    const vfs = new MockVirtualFS({
      'src/index.ts': 'const x = 1\nconst y = 2',
      'src/utils.ts': 'export function foo() { return "bar"; }',
    })

    const result = await emulateShellCommands(['grep "const" src/index.ts'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ grep "const" src/index.ts')
    expect(result).toContain('src/index.ts:const x = 1')
    expect(result).toContain('src/index.ts:const y = 2')
  })

  it('should handle cat command', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'line1\nline2\nline3',
    })

    const result = await emulateShellCommands(['cat test.txt'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ cat test.txt')
    expect(result).toContain('line1')
    expect(result).toContain('line2')
    expect(result).toContain('line3')
  })

  it('should handle ls command', async () => {
    const vfs = new MockVirtualFS({
      'src/index.ts': 'const x = 1',
      'README.md': '# Project',
    })

    const result = await emulateShellCommands(['ls src'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ ls src')
    expect(result).toContain('src/index.ts')
  })

  it('should handle pwd command', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['pwd'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ pwd')
    expect(result).toContain('/')
  })

  it('should handle command chaining with &&', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'hello world',
    })

    const result = await emulateShellCommands(['echo "start" && cat test.txt'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ echo "start"')
    expect(result).toContain('start')
    expect(result).toContain('$ cat test.txt')
    expect(result).toContain('hello world')
  })

  it('should handle command chaining with ;', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'hello world',
    })

    const result = await emulateShellCommands(['echo "first"; echo "second"'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ echo "first"')
    expect(result).toContain('first')
    expect(result).toContain('$ echo "second"')
    expect(result).toContain('second')
  })

  it('should handle multiline commands with backslash', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'hello world',
    })

    const result = await emulateShellCommands(['echo "line1" \\\n&& echo "line2"'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ echo "line1"')
    expect(result).toContain('line1')
    expect(result).toContain('$ echo "line2"')
    expect(result).toContain('line2')
  })

  it('should return error for unknown command', async () => {
    const vfs = new MockVirtualFS()
    const result = await emulateShellCommands(['unknowncmd'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ unknowncmd')
    expect(result).toContain('Command "unknowncmd" is not available in the browser shell emulator')
  })

  it('should handle wc command', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'hello world this is a test',
    })

    const result = await emulateShellCommands(['wc test.txt'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ wc test.txt')
    expect(result).toMatch(/\d+ \d+ \d+/)
  })

  it('should handle head command', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'line1\nline2\nline3\nline4\nline5',
    })

    const result = await emulateShellCommands(['head -n 2 test.txt'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ head -n 2 test.txt')
    expect(result).toContain('line1')
    expect(result).toContain('line2')
    expect(result).not.toContain('line3')
  })

  it('should handle tail command', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'line1\nline2\nline3\nline4\nline5',
    })

    const result = await emulateShellCommands(['tail -n 2 test.txt'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ tail -n 2 test.txt')
    expect(result).toContain('line4')
    expect(result).toContain('line5')
    expect(result).not.toContain('line3')
  })

  it('should handle sort command', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'banana\napple\ncherry',
    })

    const result = await emulateShellCommands(['sort test.txt'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ sort test.txt')
    expect(result).toContain('apple')
    expect(result).toContain('banana')
    expect(result).toContain('cherry')
  })

  it('should handle uniq command', async () => {
    const vfs = new MockVirtualFS({
      'test.txt': 'apple\nbanana\napple\ncherry\nbanana',
    })

    const result = await emulateShellCommands(['uniq test.txt'], {
      vfs,
      onFileCreated: vi.fn(),
    })

    expect(result).toContain('$ uniq test.txt')
    expect(result).toContain('apple')
    expect(result).toContain('banana')
    expect(result).toContain('cherry')
  })
})
