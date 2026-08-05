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

  // ─── Pipe infrastructure ───────────────────────────────────────────────────

  describe('pipe |', () => {
    it('pipes stdout of echo into cat (stdin passthrough)', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo hello | cat'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('echo hello | cat')
      expect(result).toContain('hello')
    })

    it('pipes echo into grep — matching line is printed', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo -e "foo\\nbar\\nbaz" | grep bar'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('bar')
      expect(result).not.toMatch(/\bfoo\b/)
    })

    it('pipes cat into sort', async () => {
      const vfs = new MockVirtualFS({ 'data.txt': 'cherry\napple\nbanana' })
      const result = await emulateShellCommands(['cat data.txt | sort'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      const lines = result.split('\n').filter(l => /^[a-z]/.test(l))
      expect(lines).toEqual(['apple', 'banana', 'cherry'])
    })

    it('three-stage pipeline: cat | sort | uniq', async () => {
      const vfs = new MockVirtualFS({ 'f.txt': 'b\na\nb\na\nc' })
      const result = await emulateShellCommands(['cat f.txt | sort | uniq'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      const lines = result.split('\n').filter(l => /^[a-c]$/.test(l))
      expect(lines).toEqual(['a', 'b', 'c'])
    })

    it('pipe prompt shows full pipeline as single $ line', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo hi | cat'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/\$ echo hi \| cat/)
      // Should not have separate prompt lines for each segment
      const promptLines = result.split('\n').filter(l => l.startsWith('$'))
      expect(promptLines).toHaveLength(1)
    })

    it('pipe into wc counts words from stdin', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo "one two three" | wc'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/1\s+3\s+\d+/)
    })

    it('pipe into head limits lines from stdin', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(
        ['printf "a\\nb\\nc\\nd\\ne" | head -n 2'],
        { vfs, onFileCreated: vi.fn() },
      )
      expect(result).toContain('a')
      expect(result).toContain('b')
      expect(result).not.toMatch(/\bc\b/)
    })

    it('pipe into tail limits lines from stdin', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(
        ['printf "a\\nb\\nc\\nd" | tail -n 2'],
        { vfs, onFileCreated: vi.fn() },
      )
      expect(result).toContain('c')
      expect(result).toContain('d')
      expect(result).not.toMatch(/\ba\b/)
    })
  })

  // ─── Redirect > and >> ────────────────────────────────────────────────────

  describe('redirect > and >>', () => {
    it('> creates a new file in VFS', async () => {
      const vfs = new MockVirtualFS()
      const onFileCreated = vi.fn()
      await emulateShellCommands(['echo hello > out.txt'], { vfs, onFileCreated })
      expect(vfs.read('out.txt')).toBe('hello')
      expect(onFileCreated).toHaveBeenCalledWith('out.txt', 'hello')
    })

    it('> overwrites an existing file', async () => {
      const vfs = new MockVirtualFS({ 'out.txt': 'old content' })
      await emulateShellCommands(['echo new > out.txt'], { vfs, onFileCreated: vi.fn() })
      expect(vfs.read('out.txt')).toBe('new')
    })

    it('>> appends to an existing file', async () => {
      const vfs = new MockVirtualFS({ 'log.txt': 'line1' })
      await emulateShellCommands(['echo line2 >> log.txt'], { vfs, onFileCreated: vi.fn() })
      expect(vfs.read('log.txt')).toContain('line1')
      expect(vfs.read('log.txt')).toContain('line2')
    })

    it('>> creates file if it does not exist', async () => {
      const vfs = new MockVirtualFS()
      await emulateShellCommands(['echo hello >> new.txt'], { vfs, onFileCreated: vi.fn() })
      expect(vfs.read('new.txt')).toBe('hello')
    })

    it('redirect output is not printed to terminal', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo UNIQUEVALUE > hidden.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      // Only the prompt line should appear; actual output goes to file
      const outputLines = result.split('\n').filter(l => !l.startsWith('$') && l.trim())
      expect(outputLines).toHaveLength(0)
      expect(vfs.read('hidden.txt')).toBe('UNIQUEVALUE')
    })

    it('pipe then redirect: cat | sort > sorted.txt', async () => {
      const vfs = new MockVirtualFS({ 'data.txt': 'b\na\nc' })
      await emulateShellCommands(['cat data.txt | sort > sorted.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(vfs.read('sorted.txt')).toBe('a\nb\nc')
    })
  })

  // ─── File management ──────────────────────────────────────────────────────

  describe('rm', () => {
    it('removes a file', async () => {
      const vfs = new MockVirtualFS({ 'del.txt': 'bye' })
      await emulateShellCommands(['rm del.txt'], { vfs, onFileCreated: vi.fn() })
      expect(vfs.read('del.txt')).toBeNull()
    })

    it('errors on missing file without -f', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['rm ghost.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/No such file/)
    })

    it('-f suppresses error for missing file', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['rm -f ghost.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).not.toMatch(/No such file/)
    })

    it('-r removes all files matching prefix', async () => {
      const vfs = new MockVirtualFS({ 'dir/a.txt': 'a', 'dir/b.txt': 'b', 'other.txt': 'x' })
      await emulateShellCommands(['rm -r dir'], { vfs, onFileCreated: vi.fn() })
      expect(vfs.read('dir/a.txt')).toBeNull()
      expect(vfs.read('dir/b.txt')).toBeNull()
      expect(vfs.read('other.txt')).toBe('x')
    })
  })

  describe('cp', () => {
    it('copies a file', async () => {
      const vfs = new MockVirtualFS({ 'src.txt': 'content' })
      const onFileCreated = vi.fn()
      await emulateShellCommands(['cp src.txt dst.txt'], { vfs, onFileCreated })
      expect(vfs.read('dst.txt')).toBe('content')
      expect(vfs.read('src.txt')).toBe('content')
      expect(onFileCreated).toHaveBeenCalledWith('dst.txt', 'content')
    })

    it('errors if source is missing', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['cp missing.txt dst.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/No such file/)
    })
  })

  describe('mv', () => {
    it('moves a file (source deleted)', async () => {
      const vfs = new MockVirtualFS({ 'old.txt': 'data' })
      await emulateShellCommands(['mv old.txt new.txt'], { vfs, onFileCreated: vi.fn() })
      expect(vfs.read('new.txt')).toBe('data')
      expect(vfs.read('old.txt')).toBeNull()
    })
  })

  describe('touch', () => {
    it('creates an empty file', async () => {
      const vfs = new MockVirtualFS()
      const onFileCreated = vi.fn()
      await emulateShellCommands(['touch empty.txt'], { vfs, onFileCreated })
      expect(vfs.read('empty.txt')).toBe('')
      expect(onFileCreated).toHaveBeenCalledWith('empty.txt', '')
    })

    it('does not overwrite an existing file', async () => {
      const vfs = new MockVirtualFS({ 'existing.txt': 'keep me' })
      await emulateShellCommands(['touch existing.txt'], { vfs, onFileCreated: vi.fn() })
      expect(vfs.read('existing.txt')).toBe('keep me')
    })
  })

  describe('mkdir', () => {
    it('returns exit 0 silently (flat VFS)', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['mkdir mydir'], { vfs, onFileCreated: vi.fn() })
      expect(result).not.toMatch(/error/i)
    })
  })

  describe('tee', () => {
    it('writes stdin to file and passes through stdout', async () => {
      const vfs = new MockVirtualFS()
      const onFileCreated = vi.fn()
      const result = await emulateShellCommands(['echo hello | tee log.txt'], {
        vfs,
        onFileCreated,
      })
      expect(vfs.read('log.txt')).toBe('hello')
      expect(result).toContain('hello')
      expect(onFileCreated).toHaveBeenCalledWith('log.txt', 'hello')
    })

    it('-a appends instead of overwriting', async () => {
      const vfs = new MockVirtualFS({ 'log.txt': 'first' })
      await emulateShellCommands(['echo second | tee -a log.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      const content = vfs.read('log.txt') ?? ''
      expect(content).toContain('first')
      expect(content).toContain('second')
    })
  })

  // ─── Text processing ──────────────────────────────────────────────────────

  describe('tr', () => {
    it('translates characters', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo hello | tr a-z A-Z'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('HELLO')
    })

    it('replaces newlines', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['printf "a\\nb\\nc" | tr \\\\n ,'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('a,b,c')
    })

    it('errors when fewer than two sets', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo x | tr a'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/missing operand/)
    })
  })

  describe('cut', () => {
    it('extracts a field with default tab delimiter', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['printf "a\\tb\\tc" | cut -f 2'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('b')
    })

    it('extracts a field with custom delimiter', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo "one:two:three" | cut -d: -f 1'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('one')
    })

    it('extracts range of fields', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo "a:b:c:d" | cut -d: -f 2-3'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('b')
      expect(result).toContain('c')
    })
  })

  describe('sed', () => {
    it('performs inline substitution on stdin', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo hello | sed s/hello/world/'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('world')
    })

    it('global flag replaces all occurrences', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo "aaa" | sed s/a/b/g'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('bbb')
    })

    it('operates on a VFS file', async () => {
      const vfs = new MockVirtualFS({ 'f.txt': 'foo bar foo' })
      const result = await emulateShellCommands(['sed s/foo/baz/g f.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('baz bar baz')
    })

    it('errors on invalid script', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo x | sed not_a_script'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/invalid script/)
    })
  })

  describe('printf', () => {
    it('formats string', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['printf "Hello %s" World'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('Hello World')
    })

    it('formats integer', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['printf "%d items" 42'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('42 items')
    })

    it('handles \\n escape in format', async () => {
      const vfs = new MockVirtualFS()
      // Single-quoted format string preserves the literal \n for printf to expand
      const result = await emulateShellCommands(["printf 'a\\nb'"], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('a\nb')
    })
  })

  describe('diff', () => {
    it('outputs nothing for identical files', async () => {
      const vfs = new MockVirtualFS({ 'a.txt': 'same', 'b.txt': 'same' })
      const result = await emulateShellCommands(['diff a.txt b.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      // Only the prompt line; no diff output
      const lines = result.split('\n').filter(l => l.trim())
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^\$/)
    })

    it('shows unified diff for different files', async () => {
      const vfs = new MockVirtualFS({ 'a.txt': 'alpha\nbeta', 'b.txt': 'alpha\ngamma' })
      const result = await emulateShellCommands(['diff a.txt b.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('--- a.txt')
      expect(result).toContain('+++ b.txt')
      expect(result).toContain('+gamma')
    })

    it('errors if a file is missing', async () => {
      const vfs = new MockVirtualFS({ 'a.txt': 'x' })
      const result = await emulateShellCommands(['diff a.txt missing.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/No such file/)
    })
  })

  // ─── Scripting utilities ──────────────────────────────────────────────────

  describe('true / false', () => {
    it('true exits 0 and does not break && chain', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['true && echo ok'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('ok')
    })

    it('false exits 1 and short-circuits && chain', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['false && echo skipped'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).not.toContain('skipped')
    })
  })

  describe('test / [', () => {
    it('-f returns 0 for existing file', async () => {
      const vfs = new MockVirtualFS({ 'real.txt': 'x' })
      const result = await emulateShellCommands(['test -f real.txt && echo yes'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('yes')
    })

    it('-f returns 1 for missing file', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['test -f ghost.txt && echo yes'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).not.toContain('yes')
    })

    it('-z is true for empty string', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['test -z "" && echo empty'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('empty')
    })

    it('-n is true for non-empty string', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['test -n hello && echo nonempty'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('nonempty')
    })

    it('string equality = works', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['test hello = hello && echo equal'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('equal')
    })

    it('numeric comparison -eq works', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['test 2 -eq 2 && echo two'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('two')
    })

    it('numeric comparison -lt works', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['test 1 -lt 3 && echo yes'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('yes')
    })

    it('[ ] bracket syntax works', async () => {
      const vfs = new MockVirtualFS({ 'a.txt': 'x' })
      const result = await emulateShellCommands(['[ -f a.txt ] && echo bracket'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('bracket')
    })
  })

  describe('which', () => {
    it('returns path for known command', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['which echo'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('/usr/bin/echo')
    })

    it('errors for unknown command', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['which foobar'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/no foobar/)
    })

    it('python3 is a known command', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['which python3'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('/usr/bin/python3')
    })
  })

  describe('env / printenv', () => {
    it('prints simulated environment variables', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['env'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('HOME=/')
      expect(result).toContain('SHELL=/bin/sh')
    })

    it('printenv outputs same as env', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['printenv'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('HOME=/')
    })
  })

  describe('sleep', () => {
    it('returns immediately without error', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['sleep 5'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).not.toMatch(/error/i)
    })
  })

  // ─── Encoding / checksum ──────────────────────────────────────────────────

  describe('base64', () => {
    it('encodes stdin', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo hello | base64'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      // "hello" base64 = aGVsbG8=
      expect(result).toContain('aGVsbG8=')
    })

    it('decodes with -d flag', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo aGVsbG8= | base64 -d'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain('hello')
    })

    it('encodes a VFS file', async () => {
      const vfs = new MockVirtualFS({ 'msg.txt': 'hi' })
      const result = await emulateShellCommands(['base64 msg.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toContain(btoa('hi'))
    })

    it('errors on missing file', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['base64 nope.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/No such file/)
    })
  })

  describe('sha256sum', () => {
    it('returns a 64-char hex hash for a VFS file', async () => {
      const vfs = new MockVirtualFS({ 'data.txt': 'hello' })
      const result = await emulateShellCommands(['sha256sum data.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/[0-9a-f]{64}\s+data\.txt/)
    })

    it('returns hash for stdin via pipe', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['echo hello | sha256sum'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/[0-9a-f]{64}\s+-/)
    })

    it('errors on missing file', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['sha256sum missing.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/No such file/)
    })
  })

  describe('md5sum', () => {
    it('returns a helpful error message', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(['md5sum file.txt'], {
        vfs,
        onFileCreated: vi.fn(),
      })
      expect(result).toMatch(/sha256sum/)
    })
  })

  // ─── Heredoc ──────────────────────────────────────────────────────────────

  describe('heredoc cat <<', () => {
    it('cat << EOF > file writes to VFS', async () => {
      const vfs = new MockVirtualFS()
      const onFileCreated = vi.fn()
      await emulateShellCommands(
        ['cat << EOF > hello.txt\ngreeting\nEOF'],
        { vfs, onFileCreated },
      )
      expect(vfs.read('hello.txt')).toBe('greeting')
      expect(onFileCreated).toHaveBeenCalledWith('hello.txt', 'greeting')
    })

    it('cat << EOF >> file appends to VFS', async () => {
      const vfs = new MockVirtualFS({ 'log.txt': 'first' })
      await emulateShellCommands(
        ['cat << EOF >> log.txt\nsecond\nEOF'],
        { vfs, onFileCreated: vi.fn() },
      )
      expect(vfs.read('log.txt')).toContain('first')
      expect(vfs.read('log.txt')).toContain('second')
    })

    it('cat << EOF prints to stdout', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(
        ['cat << EOF\nhello from heredoc\nEOF'],
        { vfs, onFileCreated: vi.fn() },
      )
      expect(result).toContain('hello from heredoc')
    })

    it('cat << EOF | python3 asks for authorization when Python disabled', async () => {
      const vfs = new MockVirtualFS()
      const onAskQuestion = vi.fn().mockResolvedValue('No, deny')
      const result = await emulateShellCommands(
        ['cat << PYTH | python3\nprint("hi")\nPYTH'],
        {
          vfs,
          onFileCreated: vi.fn(),
          isPythonEnabled: false,
          onAskQuestion,
          runPython: vi.fn().mockResolvedValue({ output: 'hi', filesWritten: [] }),
        },
      )
      expect(onAskQuestion).toHaveBeenCalled()
      expect(result).toContain('denied')
    })
  })

  // ─── Stdin-aware existing commands ───────────────────────────────────────

  describe('stdin-aware commands', () => {
    it('grep filters stdin when no file arg', async () => {
      const vfs = new MockVirtualFS({ 'input.txt': 'keep\nignore\nkeep' })
      const result = await emulateShellCommands(
        ['cat input.txt | grep keep'],
        { vfs, onFileCreated: vi.fn() },
      )
      const lines = result.split('\n').filter(l => /^(keep|ignore)/.test(l))
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.every(l => l === 'keep')).toBe(true)
    })

    it('sort sorts stdin', async () => {
      const vfs = new MockVirtualFS({ 'input.txt': 'z\na\nm' })
      const result = await emulateShellCommands(
        ['cat input.txt | sort'],
        { vfs, onFileCreated: vi.fn() },
      )
      const lines = result.split('\n').filter(l => /^[a-z]$/.test(l))
      expect(lines).toEqual(['a', 'm', 'z'])
    })

    it('uniq deduplicates adjacent lines from stdin', async () => {
      const vfs = new MockVirtualFS({ 'input.txt': 'a\na\nb' })
      const result = await emulateShellCommands(
        ['cat input.txt | uniq'],
        { vfs, onFileCreated: vi.fn() },
      )
      const lines = result.split('\n').filter(l => /^[ab]$/.test(l))
      expect(lines).toEqual(['a', 'b'])
    })
  })

  // ─── && short-circuit ─────────────────────────────────────────────────────

  describe('&& short-circuit', () => {
    it('second command does not run if first fails', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(
        ['cat nonexistent.txt && echo reached'],
        { vfs, onFileCreated: vi.fn() },
      )
      expect(result).not.toContain('reached')
    })

    it('three commands: middle failure stops the chain', async () => {
      const vfs = new MockVirtualFS()
      const result = await emulateShellCommands(
        ['echo first && cat nosuchfile.txt && echo third'],
        { vfs, onFileCreated: vi.fn() },
      )
      expect(result).toContain('first')
      expect(result).not.toContain('third')
    })
  })
})
