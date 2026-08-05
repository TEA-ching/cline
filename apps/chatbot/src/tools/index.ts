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
import { createTool } from '@sctg/cline-agents'
import { z } from 'zod'
import type { AgentTool } from '@sctg/cline-agents'
import type { VirtualFS } from '@/vfs/virtual-fs'
import {
  scrapeWithFirecrawl,
  searchWithFirecrawl,
} from './firecrawl-client'
import { emulateShellCommands } from './shell-emulator'
import { createResearchPlanTool, createCompleteResearchStepTool } from './research-tool'
import { createDeepResearchTool } from './deep-research-tool'
import type { FocusMode } from './focus-modes'
import { getFocusDomains } from './focus-modes'

export interface BrowserToolContext {
  vfs: VirtualFS
  firecrawlKeys: string[]
  firecrawlEndpoint: string
  onFileCreated: (path: string, content: string) => void
  onAskQuestion: (question: string, options: string[]) => Promise<string>
  enabledTools?: string[]
  focusMode?: FocusMode
}

// ---------------------------------------------------------------------------
// GNU diff engine — LCS-based with option support
// ---------------------------------------------------------------------------
type DiffOp = { op: 'eq'; line: string } | { op: 'del'; line: string } | { op: 'ins'; line: string }

function naiveComputeDiff(aLines: string[], bLines: string[]): DiffOp[] {
  const ops: DiffOp[] = []
  const max = Math.max(aLines.length, bLines.length)
  for (let i = 0; i < max; i++) {
    if (i >= aLines.length) ops.push({ op: 'ins', line: bLines[i] })
    else if (i >= bLines.length) ops.push({ op: 'del', line: aLines[i] })
    else if (aLines[i] === bLines[i]) ops.push({ op: 'eq', line: aLines[i] })
    else { ops.push({ op: 'del', line: aLines[i] }); ops.push({ op: 'ins', line: bLines[i] }) }
  }
  return ops
}

function lcsComputeDiff(aKeys: string[], bKeys: string[], aLines: string[], bLines: string[]): DiffOp[] {
  const m = aKeys.length
  const n = bKeys.length
  if (m * n > 4_000_000) return naiveComputeDiff(aLines, bLines)
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aKeys[i - 1] === bKeys[j - 1]
        ? dp[i - 1][j - 1] + 1
        : dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1]
    }
  }
  const ops: DiffOp[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aKeys[i - 1] === bKeys[j - 1]) {
      ops.push({ op: 'eq', line: aLines[i - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ op: 'ins', line: bLines[j - 1] }); j--
    } else {
      ops.push({ op: 'del', line: aLines[i - 1] }); i--
    }
  }
  ops.reverse()
  return ops
}

interface GnuDiffOptions {
  format: 'normal' | 'unified' | 'context' | 'side-by-side' | 'brief'
  contextLines: number
  ignoreCase: boolean
  ignoreSpaceChange: boolean
  ignoreAllSpace: boolean
  ignoreBlankLines: boolean
  width: number
  reportIdentical: boolean
}

function parseGnuDiffFlags(flags: string): GnuDiffOptions {
  const opts: GnuDiffOptions = {
    format: 'unified', contextLines: 3,
    ignoreCase: false, ignoreSpaceChange: false, ignoreAllSpace: false,
    ignoreBlankLines: false, width: 130, reportIdentical: false,
  }
  const tokens = flags.trim().split(/\s+/).filter(Boolean)
  let ti = 0
  while (ti < tokens.length) {
    const tok = tokens[ti]
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=')
      const name = eq >= 0 ? tok.slice(2, eq) : tok.slice(2)
      const val = eq >= 0 ? tok.slice(eq + 1) : undefined
      if (name === 'unified') { opts.format = 'unified'; if (val) opts.contextLines = +val }
      else if (name === 'context') { opts.format = 'context'; if (val) opts.contextLines = +val }
      else if (name === 'side-by-side') opts.format = 'side-by-side'
      else if (name === 'brief') opts.format = 'brief'
      else if (name === 'normal') opts.format = 'normal'
      else if (name === 'ignore-case') opts.ignoreCase = true
      else if (name === 'ignore-space-change') opts.ignoreSpaceChange = true
      else if (name === 'ignore-all-space') opts.ignoreAllSpace = true
      else if (name === 'ignore-blank-lines') opts.ignoreBlankLines = true
      else if (name === 'report-identical-files') opts.reportIdentical = true
      else if (name === 'width' && val) opts.width = +val
    } else if (tok.startsWith('-') && tok.length > 1) {
      const chars = tok.slice(1)
      for (let ci = 0; ci < chars.length; ci++) {
        const c = chars[ci]
        const rest = chars.slice(ci + 1)
        const nextIsNum = /^\d+$/.test(tokens[ti + 1] ?? '')
        if (c === 'u' || c === 'c') {
          opts.format = c === 'u' ? 'unified' : 'context'
          const m = rest.match(/^(\d+)/)
          if (m) { opts.contextLines = +m[1]; ci += m[1].length }
          else if (!rest.length && nextIsNum) opts.contextLines = +tokens[++ti]
        } else if (c === 'U' || c === 'C') {
          opts.format = c === 'U' ? 'unified' : 'context'
          if (rest.length) { opts.contextLines = +rest; ci = chars.length }
          else if (nextIsNum) opts.contextLines = +tokens[++ti]
        } else if (c === 'W') {
          if (rest.length) { opts.width = +rest; ci = chars.length }
          else if (nextIsNum) opts.width = +tokens[++ti]
        } else if (c === 'y') opts.format = 'side-by-side'
        else if (c === 'q') opts.format = 'brief'
        else if (c === 'i') opts.ignoreCase = true
        else if (c === 'b') opts.ignoreSpaceChange = true
        else if (c === 'w') opts.ignoreAllSpace = true
        else if (c === 'B') opts.ignoreBlankLines = true
        else if (c === 's') opts.reportIdentical = true
      }
    }
    ti++
  }
  return opts
}

function lineKey(line: string, opts: GnuDiffOptions): string {
  let k = line
  if (opts.ignoreCase) k = k.toLowerCase()
  if (opts.ignoreAllSpace) return k.replace(/\s/g, '')
  if (opts.ignoreSpaceChange) return k.replace(/\s+/g, ' ').trim()
  return k
}

function suppressBlankOnlyHunks(ops: DiffOp[]): DiffOp[] {
  const result: DiffOp[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].op === 'eq') { result.push(ops[i++]); continue }
    const start = i
    while (i < ops.length && ops[i].op !== 'eq') i++
    const hunk = ops.slice(start, i)
    if (hunk.every(o => o.line.trim() === '')) {
      for (const o of hunk) result.push({ op: 'eq', line: o.line })
    } else {
      result.push(...hunk)
    }
  }
  return result
}

function buildLineMaps(ops: DiffOp[]): { aAt: number[]; bAt: number[] } {
  const aAt: number[] = []
  const bAt: number[] = []
  let a = 1, b = 1
  for (const op of ops) {
    aAt.push(a); bAt.push(b)
    if (op.op === 'eq') { a++; b++ } else if (op.op === 'del') { a++ } else { b++ }
  }
  return { aAt, bAt }
}

function buildHunks(ops: DiffOp[], contextLines: number): Array<{ start: number; end: number }> {
  const hunks: Array<{ start: number; end: number }> = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].op === 'eq') continue
    const s = Math.max(0, i - contextLines)
    const e = Math.min(ops.length - 1, i + contextLines)
    if (hunks.length > 0 && s <= hunks[hunks.length - 1].end + 1) {
      hunks[hunks.length - 1].end = Math.max(hunks[hunks.length - 1].end, e)
    } else {
      hunks.push({ start: s, end: e })
    }
  }
  return hunks
}

function formatUnifiedDiff(ops: DiffOp[], aLabel: string, bLabel: string, contextLines: number): string {
  if (!ops.some(o => o.op !== 'eq')) return ''
  const { aAt, bAt } = buildLineMaps(ops)
  const lines = [`--- ${aLabel}`, `+++ ${bLabel}`]
  for (const { start, end } of buildHunks(ops, contextLines)) {
    const slice = ops.slice(start, end + 1)
    const aCount = slice.filter(o => o.op !== 'ins').length
    const bCount = slice.filter(o => o.op !== 'del').length
    lines.push(`@@ -${aAt[start]},${aCount} +${bAt[start]},${bCount} @@`)
    for (const op of slice) lines.push(`${op.op === 'del' ? '-' : op.op === 'ins' ? '+' : ' '}${op.line}`)
  }
  return lines.join('\n')
}

function formatContextDiff(ops: DiffOp[], aLabel: string, bLabel: string, contextLines: number): string {
  if (!ops.some(o => o.op !== 'eq')) return ''
  const { aAt, bAt } = buildLineMaps(ops)
  const lines = [`*** ${aLabel}`, `--- ${bLabel}`]
  for (const { start, end } of buildHunks(ops, contextLines)) {
    const slice = ops.slice(start, end + 1)
    const aCount = slice.filter(o => o.op !== 'ins').length
    const bCount = slice.filter(o => o.op !== 'del').length
    lines.push('***************')
    lines.push(`*** ${aAt[start]},${aAt[start] + aCount - 1} ****`)
    for (const op of slice) if (op.op !== 'ins') lines.push(`${op.op === 'del' ? '- ' : '  '}${op.line}`)
    lines.push(`--- ${bAt[start]},${bAt[start] + bCount - 1} ----`)
    for (const op of slice) if (op.op !== 'del') lines.push(`${op.op === 'ins' ? '+ ' : '  '}${op.line}`)
  }
  return lines.join('\n')
}

function formatNormalDiff(ops: DiffOp[]): string {
  if (!ops.some(o => o.op !== 'eq')) return ''
  const { aAt, bAt } = buildLineMaps(ops)
  const rng = (f: number, l: number) => f === l ? `${f}` : `${f},${l}`
  const lines: string[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].op === 'eq') { i++; continue }
    const hs = i
    while (i < ops.length && ops[i].op !== 'eq') i++
    let dFirst = -1, dLast = -1, iFirst = -1, iLast = -1
    for (let k = hs; k < i; k++) {
      if (ops[k].op === 'del') { if (dFirst < 0) dFirst = k; dLast = k }
      else if (ops[k].op === 'ins') { if (iFirst < 0) iFirst = k; iLast = k }
    }
    if (dFirst >= 0 && iFirst >= 0) {
      lines.push(`${rng(aAt[dFirst], aAt[dLast])}c${rng(bAt[iFirst], bAt[iLast])}`)
      for (let k = hs; k < i; k++) if (ops[k].op === 'del') lines.push(`< ${ops[k].line}`)
      lines.push('---')
      for (let k = hs; k < i; k++) if (ops[k].op === 'ins') lines.push(`> ${ops[k].line}`)
    } else if (dFirst >= 0) {
      lines.push(`${rng(aAt[dFirst], aAt[dLast])}d${bAt[hs] - 1}`)
      for (let k = hs; k < i; k++) if (ops[k].op === 'del') lines.push(`< ${ops[k].line}`)
    } else {
      lines.push(`${aAt[hs] - 1}a${rng(bAt[iFirst], bAt[iLast])}`)
      for (let k = hs; k < i; k++) if (ops[k].op === 'ins') lines.push(`> ${ops[k].line}`)
    }
  }
  return lines.join('\n')
}

function formatSideBySideDiff(ops: DiffOp[], width: number): string {
  const colW = Math.max(10, Math.floor((width - 3) / 2))
  const pad = (s: string) => s.length >= colW ? s.slice(0, colW) : s + ' '.repeat(colW - s.length)
  const lines: string[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].op === 'eq') { lines.push(`${pad(ops[i].line)}  ${ops[i].line}`); i++; continue }
    const hs = i
    while (i < ops.length && ops[i].op !== 'eq') i++
    const hunk = ops.slice(hs, i)
    const dels = hunk.filter(o => o.op === 'del').map(o => o.line)
    const ins = hunk.filter(o => o.op === 'ins').map(o => o.line)
    for (let k = 0; k < Math.max(dels.length, ins.length); k++) {
      if (k < dels.length && k < ins.length) lines.push(`${pad(dels[k])} | ${ins[k]}`)
      else if (k < dels.length) lines.push(`${pad(dels[k])} <`)
      else lines.push(`${' '.repeat(colW)} > ${ins[k]}`)
    }
  }
  return lines.join('\n')
}

function runGnuDiff(contentA: string, contentB: string, aLabel: string, bLabel: string, flagsStr: string): string {
  const opts = parseGnuDiffFlags(flagsStr)
  const aLines = contentA.split('\n')
  const bLines = contentB.split('\n')
  if (opts.format === 'brief') {
    if (contentA === contentB) return opts.reportIdentical ? `Files ${aLabel} and ${bLabel} are identical` : ''
    return `Files ${aLabel} and ${bLabel} differ`
  }
  const aKeys = aLines.map(l => lineKey(l, opts))
  const bKeys = bLines.map(l => lineKey(l, opts))
  let ops = lcsComputeDiff(aKeys, bKeys, aLines, bLines)
  if (opts.ignoreBlankLines) ops = suppressBlankOnlyHunks(ops)
  if (!ops.some(o => o.op !== 'eq'))
    return opts.reportIdentical ? `Files ${aLabel} and ${bLabel} are identical` : ''
  switch (opts.format) {
    case 'unified':      return formatUnifiedDiff(ops, aLabel, bLabel, opts.contextLines)
    case 'context':      return formatContextDiff(ops, aLabel, bLabel, opts.contextLines)
    case 'normal':       return formatNormalDiff(ops)
    case 'side-by-side': return formatSideBySideDiff(ops, opts.width)
    default:             return formatUnifiedDiff(ops, aLabel, bLabel, opts.contextLines)
  }
}

// ---------------------------------------------------------------------------
// Unified patch parser and applier
// ---------------------------------------------------------------------------
interface PatchHunkLine { type: ' ' | '+' | '-'; content: string }
interface PatchHunk { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: PatchHunkLine[] }
interface FilePatch { oldPath: string; newPath: string; hunks: PatchHunk[] }

function parseUnifiedPatch(patch: string): FilePatch[] {
  const files: FilePatch[] = []
  const raw = patch.split('\n')
  let i = 0
  while (i < raw.length) {
    if (!raw[i].startsWith('--- ')) { i++; continue }
    const oldPath = raw[i].slice(4).split('\t')[0].replace(/^[ab]\//, '').trim()
    i++
    if (i >= raw.length || !raw[i].startsWith('+++ ')) continue
    const newPath = raw[i].slice(4).split('\t')[0].replace(/^[ab]\//, '').trim()
    i++
    const hunks: PatchHunk[] = []
    while (i < raw.length && !raw[i].startsWith('--- ')) {
      if (!raw[i].startsWith('@@ ')) { i++; continue }
      const m = raw[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (!m) { i++; continue }
      const oldStart = +m[1], oldCount = m[2] !== undefined ? +m[2] : 1
      const newStart = +m[3], newCount = m[4] !== undefined ? +m[4] : 1
      i++
      const lines: PatchHunkLine[] = []
      while (i < raw.length && !raw[i].startsWith('@@ ') && !raw[i].startsWith('--- ')) {
        const l = raw[i]
        if (l.startsWith('-')) lines.push({ type: '-', content: l.slice(1) })
        else if (l.startsWith('+')) lines.push({ type: '+', content: l.slice(1) })
        else if (l.startsWith(' ')) lines.push({ type: ' ', content: l.slice(1) })
        i++
      }
      hunks.push({ oldStart, oldCount, newStart, newCount, lines })
    }
    if (hunks.length > 0) files.push({ oldPath, newPath, hunks })
  }
  return files
}

function applyFilePatch(
  content: string,
  hunks: PatchHunk[],
  reverse: boolean,
): { success: boolean; content: string; errors: string[] } {
  let lines = content.split('\n')
  const errors: string[] = []
  // Apply hunks last-to-first so earlier line numbers stay valid
  const sorted = [...hunks].sort((a, b) =>
    reverse ? b.newStart - a.newStart : b.oldStart - a.oldStart,
  )
  for (const hunk of sorted) {
    const start = (reverse ? hunk.newStart : hunk.oldStart) - 1
    const removeCount = reverse ? hunk.newCount : hunk.oldCount
    const expected: string[] = []
    const replacement: string[] = []
    for (const l of hunk.lines) {
      const t = reverse ? (l.type === '+' ? '-' : l.type === '-' ? '+' : ' ') : l.type
      if (t === ' ' || t === '-') expected.push(l.content)
      if (t === ' ' || t === '+') replacement.push(l.content)
    }
    let ok = true
    for (let k = 0; k < expected.length; k++) {
      if (lines[start + k] !== expected[k]) {
        errors.push(`Hunk @${start + 1}: expected "${expected[k]}", found "${lines[start + k] ?? '(end of file)'}"`)
        ok = false
        break
      }
    }
    if (!ok) continue
    lines = [...lines.slice(0, start), ...replacement, ...lines.slice(start + removeCount)]
  }
  return { success: errors.length === 0, content: lines.join('\n'), errors }
}

// ---------------------------------------------------------------------------
// Glob to regex helper
// ---------------------------------------------------------------------------
export function globToRegex(glob: string): RegExp {
  // Handle recursive **/ pattern
  if (glob.includes('**/')) {
    // Split the pattern at **/
    const parts = glob.split('**/')
    // The part after **/ should match any path ending with this pattern
    const suffix = parts[1].replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
    return new RegExp(suffix + '$')
  }

  // Handle regular glob patterns with path separators
  if (glob.includes('/')) {
    // For patterns with slashes, we want exact path matching
    // Convert to regex that matches the exact path structure
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
    return new RegExp('^' + escaped + '$')
  }

  // Handle simple filename patterns - match filename anywhere in path
  // For patterns like *.ts, we want to match the filename pattern anywhere
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(escaped + '$')
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------
export function createBrowserTools(
  ctx: BrowserToolContext,
// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
): AgentTool<any, any>[] {
  const vfsRead = createTool({
    name: 'vfs_read',
    description: 'Read one or more files from the virtual file system.',
    inputSchema: z.object({
      paths: z.array(z.string()).min(1).describe('File paths to read'),
    }),
    execute: async ({ paths }) => {
      const results: Record<string, string | null> = {}
      for (const path of paths) {
        const raw = ctx.vfs.read(path)
        if (raw !== null && raw.startsWith('data:') && raw.includes(';base64,')) {
          // Binary file — return metadata only to avoid flooding the context window.
          const mimeEnd = raw.indexOf(';base64,')
          const mime = raw.slice(5, mimeEnd)
          const base64 = raw.slice(mimeEnd + 8)
          const byteSize = Math.floor(base64.length * 0.75)
          results[path] = `[binary:${mime} size=${byteSize}B — file available for download in the VFS panel; use execute_python_code to process it]`
        } else {
          results[path] = raw
        }
      }
      return results
    },
  })

  const vfsEditor = createTool({
    name: 'vfs_editor',
    description:
      'Edit files in the virtual file system. Supports create, replace, insert, and delete operations.',
    inputSchema: z.object({
      operations: z
        .array(
          z.discriminatedUnion('op', [
            z.object({
              op: z.literal('create'),
              path: z.string(),
              content: z.string(),
            }),
            z.object({
              op: z.literal('replace'),
              path: z.string(),
              content: z.string(),
            }),
            z.object({
              op: z.literal('insert'),
              path: z.string(),
              line: z.number().int().min(1).describe('1-based line number to insert before'),
              content: z.string(),
            }),
            z.object({
              op: z.literal('delete'),
              path: z.string(),
              line: z.number().int().min(1).describe('1-based line number to delete'),
            }),
          ]),
        )
        .min(1),
    }),
    execute: async ({ operations }) => {
      const results: string[] = []
      for (const op of operations) {
        if (op.op === 'create' || op.op === 'replace') {
          ctx.vfs.write(op.path, op.content)
          ctx.onFileCreated(op.path, op.content)
          results.push(`${op.op}: ${op.path}`)
        } else if (op.op === 'insert') {
          const existing = ctx.vfs.read(op.path) ?? ''
          const lines = existing.split('\n')
          const insertAt = Math.min(op.line - 1, lines.length)
          lines.splice(insertAt, 0, op.content)
          const newContent = lines.join('\n')
          ctx.vfs.write(op.path, newContent)
          ctx.onFileCreated(op.path, newContent)
          results.push(`insert at line ${op.line}: ${op.path}`)
        } else if (op.op === 'delete') {
          const existing = ctx.vfs.read(op.path)
          if (existing === null) {
            results.push(`error: ${op.path} not found`)
            continue
          }
          const lines = existing.split('\n')
          if (op.line < 1 || op.line > lines.length) {
            results.push(`error: line ${op.line} out of range in ${op.path}`)
            continue
          }
          lines.splice(op.line - 1, 1)
          const newContent = lines.join('\n')
          ctx.vfs.write(op.path, newContent)
          ctx.onFileCreated(op.path, newContent)
          results.push(`delete line ${op.line}: ${op.path}`)
        }
      }
      return results.join('\n')
    },
  })

  const vfsFind = createTool({
    name: 'vfs_find',
    description:
      'Find files in the virtual file system matching a glob-like name pattern.',
    inputSchema: z.object({
      name: z.string().describe('Glob-like pattern (supports * and ?)'),
      prefix: z.string().optional().describe('Optional path prefix to search under'),
    }),
    execute: async ({ name, prefix }) => {
      const all = ctx.vfs.list(prefix)
      const regex = globToRegex(name)
      const matched = all.filter((p) => {
        const basename = p.split('/').pop() ?? p
        return regex.test(basename) || regex.test(p)
      })
      return matched
    },
  })

  const vfsGrep = createTool({
    name: 'vfs_grep',
    description: 'Search file contents in the virtual file system using a regex pattern.',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      flags: z.string().optional().default('').describe('Regex flags (e.g. "i" for case-insensitive)'),
      paths: z.array(z.string()).optional().describe('Limit search to these paths'),
    }),
    execute: async ({ pattern, flags, paths }) => {
      const regex = new RegExp(pattern, flags ?? '')
      const matches = ctx.vfs.search(regex, paths)
      if (matches.length === 0) return 'No matches found.'
      return matches
        .map(
          (m) =>
            `${m.path}:${m.lineNumber}: ${m.line}`,
        )
        .join('\n')
    },
  })

  const vfsSed = createTool({
    name: 'vfs_sed',
    description:
      'Apply a sed-like s/pattern/replacement/flags substitution to a file in the virtual file system.',
    inputSchema: z.object({
      path: z.string(),
      expression: z
        .string()
        .describe('Substitution expression in the form s/pattern/replacement/flags'),
    }),
    execute: async ({ path, expression }) => {
      const content = ctx.vfs.read(path)
      if (content === null) return `Error: file not found: ${path}`

      // Parse s/pattern/replacement/flags — use the first char after 's' as delimiter
      const match = expression.match(/^s(.)(.+?)\1(.*?)\1([gimsuy]*)$/)
      if (!match) {
        return `Error: invalid sed expression: ${expression}`
      }
      const [, , pattern, replacement, flags] = match
      const regex = new RegExp(pattern, flags)
      const newContent = content.replace(regex, replacement)
      ctx.vfs.write(path, newContent)
      ctx.onFileCreated(path, newContent)
      return `Applied substitution to ${path}`
    },
  })

  const vfsHeadTail = createTool({
    name: 'vfs_head_tail',
    description: 'Read the first or last N lines of a file in the virtual file system.',
    inputSchema: z.object({
      path: z.string(),
      mode: z.enum(['head', 'tail']),
      lines: z.number().int().min(1).default(10),
    }),
    execute: async ({ path, mode, lines }) => {
      const content = ctx.vfs.read(path)
      if (content === null) return `Error: file not found: ${path}`
      const all = content.split('\n')
      const sliced =
        mode === 'head' ? all.slice(0, lines) : all.slice(-lines)
      return sliced.join('\n')
    },
  })

  const vfsWc = createTool({
    name: 'vfs_wc',
    description: 'Count lines, words, and bytes of a file in the virtual file system.',
    inputSchema: z.object({
      path: z.string(),
    }),
    execute: async ({ path }) => {
      const content = ctx.vfs.read(path)
      if (content === null) return `Error: file not found: ${path}`
      const lineCount = content.split('\n').length
      const wordCount = content.trim().split(/\s+/).filter(Boolean).length
      const byteCount = new TextEncoder().encode(content).length
      return { lines: lineCount, words: wordCount, bytes: byteCount }
    },
  })

  const vfsDiff = createTool({
    name: 'vfs_diff',
    description: 'Show a diff between two files in the virtual file system. Supports GNU diff options.',
    inputSchema: z.object({
      pathA: z.string(),
      pathB: z.string(),
      flags: z.string().optional().default('-u').describe(
        'GNU diff flags: "-u" unified (default), "-u 5" 5 context lines, "-c" context format, "-y" side-by-side, "-q" brief, "--normal" traditional format. Ignore options: "-i" case, "-b" space change, "-w" all space, "-B" blank lines. "-s" report identical. Combine: "-u -i -B".',
      ),
    }),
    execute: async ({ pathA, pathB, flags }) => {
      const contentA = ctx.vfs.read(pathA)
      const contentB = ctx.vfs.read(pathB)
      if (contentA === null) return `Error: file not found: ${pathA}`
      if (contentB === null) return `Error: file not found: ${pathB}`
      return runGnuDiff(contentA, contentB, pathA, pathB, flags ?? '-u')
    },
  })

  const vfsPatch = createTool({
    name: 'vfs_patch',
    description:
      'Apply a unified diff patch to files in the virtual file system. The patch is typically the output of vfs_diff. Supports file creation (old path /dev/null), reverse application, and dry-run mode.',
    inputSchema: z.object({
      patch: z.string().describe('Unified diff patch text (--- / +++ / @@ format)'),
      path: z.string().optional().describe('Override target file path (uses the path from the patch header if omitted)'),
      reverse: z.boolean().optional().default(false).describe('Apply patch in reverse to undo it'),
      dryRun: z.boolean().optional().default(false).describe('Check if patch applies cleanly without modifying files'),
    }),
    execute: async ({ patch, path: overridePath, reverse, dryRun }) => {
      const filePatch = parseUnifiedPatch(patch)
      if (filePatch.length === 0) return 'Error: no valid unified diff found in patch'
      const results: string[] = []
      for (const fp of filePatch) {
        const targetPath = overridePath ?? (reverse ? fp.oldPath : fp.newPath)
        // File deletion: new path is /dev/null
        if (fp.newPath === '/dev/null' && !reverse) {
          if (!dryRun) ctx.vfs.delete(targetPath)
          results.push(`${dryRun ? '[dry-run] would delete' : 'Deleted'}: ${targetPath}`)
          continue
        }
        const content = ctx.vfs.read(targetPath)
        // File creation: old path is /dev/null or file doesn't exist with oldCount=0
        if (content === null) {
          const isCreation = fp.oldPath === '/dev/null' || fp.hunks.every(h => h.oldCount === 0)
          if (!isCreation) { results.push(`Error: file not found: ${targetPath}`); continue }
          const newLines: string[] = []
          for (const hunk of fp.hunks)
            for (const l of hunk.lines) if (l.type === '+') newLines.push(l.content)
          const newContent = newLines.join('\n')
          if (!dryRun) { ctx.vfs.write(targetPath, newContent); ctx.onFileCreated(targetPath, newContent) }
          results.push(`${dryRun ? '[dry-run] would create' : 'Created'}: ${targetPath}`)
          continue
        }
        const { success, content: newContent, errors } = applyFilePatch(content, fp.hunks, reverse ?? false)
        if (errors.length > 0)
          results.push(`Patch errors for ${targetPath}:\n${errors.map(e => `  ${e}`).join('\n')}`)
        if (!success) continue
        if (!dryRun) { ctx.vfs.write(targetPath, newContent); ctx.onFileCreated(targetPath, newContent) }
        results.push(`${dryRun ? '[dry-run] would patch' : 'Patched'}: ${targetPath}`)
      }
      return results.join('\n')
    },
  })

  const vfsSortUniq = createTool({
    name: 'vfs_sort_uniq',
    description: 'Sort lines of a file, optionally deduplicating them.',
    inputSchema: z.object({
      path: z.string(),
      unique: z.boolean().optional().default(false),
      reverse: z.boolean().optional().default(false),
    }),
    execute: async ({ path, unique, reverse }) => {
      const content = ctx.vfs.read(path)
      if (content === null) return `Error: file not found: ${path}`
      let lines = content.split('\n')
      lines.sort()
      if (unique) lines = [...new Set(lines)]
      if (reverse) lines.reverse()
      return lines.join('\n')
    },
  })

  const vfsCat = createTool({
    name: 'vfs_cat',
    description: 'Concatenate multiple files from the virtual file system.',
    inputSchema: z.object({
      paths: z.array(z.string()).min(1),
    }),
    execute: async ({ paths }) => {
      const parts: string[] = []
      for (const path of paths) {
        const content = ctx.vfs.read(path)
        if (content === null) {
          parts.push(`[Error: ${path} not found]`)
        } else {
          parts.push(content)
        }
      }
      return parts.join('\n')
    },
  })

  const vfsLs = createTool({
    name: 'vfs_ls',
    description: 'List files in the virtual file system with their sizes and MIME types.',
    inputSchema: z.object({
      prefix: z.string().optional().describe('Optional path prefix to filter by'),
    }),
    execute: async ({ prefix }) => {
      const paths = ctx.vfs.list(prefix)
      if (paths.length === 0) return 'No files found.'
      return paths
        .map((p) => {
          const entry = ctx.vfs.entry(p)
          return entry
            ? `${p}  ${entry.size}B  ${entry.mimeType}`
            : `${p}  (unknown)`
        })
        .join('\n')
    },
  })

  const vfsMvCp = createTool({
    name: 'vfs_mv_cp',
    description: 'Copy or move (rename) a file in the virtual file system.',
    inputSchema: z.object({
      op: z.enum(['copy', 'move']),
      src: z.string(),
      dest: z.string(),
    }),
    execute: async ({ op, src, dest }) => {
      const entry = ctx.vfs.entry(src)
      if (entry === null) return `Error: source file not found: ${src}`
      ctx.vfs.write(dest, entry.content, entry.mimeType)
      // read() always returns a string (data URL for binary entries)
      ctx.onFileCreated(dest, ctx.vfs.read(dest) ?? '')
      if (op === 'move') {
        ctx.vfs.delete(src)
      }
      return `${op}: ${src} -> ${dest}`
    },
  })

  const fetchWebContent = createTool({
    name: 'fetch_web_content',
    description: 'Fetch and extract the main content of a web page as markdown. When citing this content, use [citation:N] format where N is the source number. The citation system will automatically create clickable links to the sources panel.',
    inputSchema: z.object({
      url: z.string().url(),
    }),
    execute: async ({ url }) => {
      return await scrapeWithFirecrawl(
        url,
        { endpoint: ctx.firecrawlEndpoint, apiKey: ctx.firecrawlKeys[0] ?? '', timeoutMs: 35_000 },
        ctx.firecrawlKeys,
      )
    },
  })

  /**
   * Sample test prompts for the tools:
   * `recherche sur le web une liste de sites météo français`
   */
  const searchWeb = createTool({
    name: 'search_web',
    description: 'Search the web and return results with titles, URLs, and markdown content. When citing search results in your response, use [citation:N] format where N is the source number (1, 2, 3, etc.). The citation system will automatically create clickable links to the sources panel. For example: "According to recent studies [citation:1], the technology has improved significantly. More details can be found on the official website [citation:2]."',
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(20).optional().default(5),
      includeDomains: z.array(z.string()).optional(),
      excludeDomains: z.array(z.string()).optional(),
    }),
    execute: async ({ query, limit, includeDomains, excludeDomains }) => {
      const focusDomains = getFocusDomains(ctx.focusMode)
      const effectiveAllowed = focusDomains.includeDomains ?? includeDomains
      const effectiveBlocked = focusDomains.excludeDomains ?? excludeDomains
      return await searchWithFirecrawl(
        query,
        { endpoint: ctx.firecrawlEndpoint, apiKey: ctx.firecrawlKeys[0] ?? '', timeoutMs: 90_000 },
        { keys: ctx.firecrawlKeys, limit, includeDomains: effectiveAllowed, excludeDomains: effectiveBlocked },
      )
    },
  })

  const askQuestion = createTool({
    name: 'ask_question',
    description:
      'Ask the user a question with a set of predefined options and wait for their response.',
    inputSchema: z.object({
      question: z.string(),
      options: z.array(z.string()).min(1),
    }),
    execute: async ({ question, options }) => {
      const answer = await ctx.onAskQuestion(question, options)
      return { answer }
    },
  })

  const runCommands = createTool({
    name: 'run_commands',
    description:
      'Emulate a safe subset of common shell commands in the browser using the virtual file system. Supports command separators ; and &&, multiline commands with trailing backslash, and selected commands such as date, time, uname, find, grep, cat, ls, wc, head, tail, sort, uniq.',
    inputSchema: z.object({
      commands: z.array(z.string()).min(1),
    }),
    execute: async ({ commands }) => {
      const isPythonEnabled = (ctx.enabledTools ?? []).includes('execute_python_code')
      return emulateShellCommands(commands, {
        vfs: ctx.vfs,
        onFileCreated: ctx.onFileCreated,
        isPythonEnabled,
        onAskQuestion: ctx.onAskQuestion,
        runPython: async (code: string) => {
          const { runPython: _runPython } = await import('./python-sandbox')
          const result = await _runPython(code, [], false, ctx.vfs, ctx.onAskQuestion)
          for (const path of result.filesWritten) {
            const content = ctx.vfs.read(path)
            if (content !== null) ctx.onFileCreated(path, content)
          }
          return result
        },
      })
    },
  })

  const deepResearch = createDeepResearchTool({
    firecrawlKeys: ctx.firecrawlKeys,
    firecrawlEndpoint: ctx.firecrawlEndpoint,
    focusMode: ctx.focusMode,
  })

  const suggestFollowups = createTool({
    name: 'suggest_followups',
    description: 'After completing a research response, suggest 2-4 relevant follow-up questions that would help the user explore the topic further. Call this ONCE at the end of each substantive research answer.',
    inputSchema: z.object({
      questions: z
        .array(z.string())
        .min(2)
        .max(4)
        .describe('2-4 follow-up questions relevant to the current answer'),
    }),
    execute: async ({ questions }) => ({ questions }),
  })

  return [
    vfsRead,
    vfsEditor,
    vfsFind,
    vfsGrep,
    vfsSed,
    vfsHeadTail,
    vfsWc,
    vfsDiff,
    vfsPatch,
    vfsSortUniq,
    vfsCat,
    vfsLs,
    vfsMvCp,
    fetchWebContent,
    searchWeb,
    deepResearch,
    suggestFollowups,
    askQuestion,
    runCommands,
    createResearchPlanTool(),
    createCompleteResearchStepTool(),
  ]
}
