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

import type { VirtualFS } from '@/vfs/virtual-fs'
import { globToRegex } from './index'

export interface ShellEmulatorContext {
  vfs: VirtualFS
  onFileCreated: (path: string, content: string) => void
  isPythonEnabled?: boolean
  onAskQuestion?: (question: string, options: string[]) => Promise<string>
  runPython?: (code: string) => Promise<{ output: string; error?: string; filesWritten: string[] }>
}

// 'pipe': stdout of this segment feeds the next segment's stdin
type CommandSeparator = 'always' | 'onSuccess' | 'pipe'

interface ParsedCommandSegment {
  command: string
  separatorBefore: CommandSeparator
}

interface EmulatedCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface RedirectInfo {
  command: string
  redirect?: { mode: 'write' | 'append'; file: string }
}

const KNOWN_COMMANDS = new Set([
  'date', 'time', 'uname', 'find', 'grep', 'cat', 'ls', 'pwd', 'echo',
  'wc', 'head', 'tail', 'sort', 'uniq', 'python', 'python3',
  'rm', 'cp', 'mv', 'touch', 'mkdir', 'tee', 'tr', 'cut', 'sed', 'printf', 'diff',
  'true', 'false', 'test', '[', 'which', 'env', 'printenv', 'sleep',
  'base64', 'sha256sum', 'md5sum',
])

const SIMULATED_ENV: Record<string, string> = {
  HOME: '/',
  SHELL: '/bin/sh',
  TERM: 'xterm',
  LANG: 'en_US.UTF-8',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  USER: 'user',
  LOGNAME: 'user',
  PWD: '/',
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

function normalizeShellInput(input: string): string {
  return input.replace(/\\\r?\n/g, ' ')
}

type HeredocAction =
  | { type: 'python' }
  | { type: 'write'; file: string }
  | { type: 'append'; file: string }
  | { type: 'cat' }

interface HeredocBlock {
  content: string
  action: HeredocAction
}

interface HeredocExtractResult {
  processed: string
  blocks: Map<string, HeredocBlock>
}

function extractHeredocBlocks(input: string): HeredocExtractResult {
  const lines = input.split('\n')
  const blocks = new Map<string, HeredocBlock>()
  let blockIdx = 0
  const outputLines: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // Match heredoc patterns (optional - strips leading tabs from body):
    //   cat << MARKER | python[3]   →  run via Python
    //   cat << MARKER > file        →  write file
    //   cat << MARKER >> file       →  append to file
    //   cat << MARKER               →  print to stdout
    const heredocMatch = line.match(
      /^cat\s+<<[-]?\s*(\w+)\s*(?:\|\s*(python3?)|(>>?)\s*(.+?))?\s*$/
    )
    if (heredocMatch) {
      const marker = heredocMatch[1]
      const bodyLines: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== marker) {
        bodyLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip closing marker

      const content = bodyLines.join('\n')
      const blockKey = `__HEREDOC_${blockIdx++}__`

      let action: HeredocAction
      if (heredocMatch[2]) {
        action = { type: 'python' }
      } else if (heredocMatch[3] === '>>') {
        action = { type: 'append', file: heredocMatch[4].trim() }
      } else if (heredocMatch[3] === '>') {
        action = { type: 'write', file: heredocMatch[4].trim() }
      } else {
        action = { type: 'cat' }
      }

      blocks.set(blockKey, { content, action })
      outputLines.push(`__heredoc__ ${blockKey}`)
    } else {
      outputLines.push(line)
      i++
    }
  }

  return { processed: outputLines.join('\n'), blocks }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function splitShellCommands(input: string): ParsedCommandSegment[] {
  const segments: ParsedCommandSegment[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (escapeNext) { current += char; escapeNext = false; continue }
    if (char === '\\' && !inSingleQuote) { escapeNext = true; continue }
    if (char === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; current += char; continue }
    if (char === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; current += char; continue }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === ';') {
        if (current.trim()) segments.push({ command: current.trim(), separatorBefore: 'always' })
        current = ''
        continue
      }
      if (char === '&' && i + 1 < input.length && input[i + 1] === '&') {
        if (current.trim()) segments.push({ command: current.trim(), separatorBefore: 'onSuccess' })
        current = ''
        i++
        continue
      }
      // Single pipe (not ||)
      if (char === '|') {
        if (i + 1 < input.length && input[i + 1] === '|') {
          current += char // pass || through unsplit
          continue
        }
        if (current.trim()) segments.push({ command: current.trim(), separatorBefore: 'pipe' })
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) segments.push({ command: current.trim(), separatorBefore: 'always' })
  return segments
}

// Detect the last unquoted > or >> in a command and return the redirect target.
function extractRedirect(command: string): RedirectInfo {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false
  let lastRedirectPos = -1
  let lastRedirectLen = 1

  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (escapeNext) { escapeNext = false; continue }
    if (char === '\\') { escapeNext = true; continue }
    if (char === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; continue }
    if (char === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; continue }

    if (!inSingleQuote && !inDoubleQuote && char === '>') {
      if (command[i + 1] === '>') {
        lastRedirectPos = i; lastRedirectLen = 2; i++
      } else {
        lastRedirectPos = i; lastRedirectLen = 1
      }
    }
  }

  if (lastRedirectPos === -1) return { command }
  const file = command.slice(lastRedirectPos + lastRedirectLen).trim()
  const cmdPart = command.slice(0, lastRedirectPos).trim()
  if (!file) return { command }
  return { command: cmdPart, redirect: { mode: lastRedirectLen === 2 ? 'append' : 'write', file } }
}

function parseShellArgs(command: string): string[] {
  const args: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escapeNext) { current += char; escapeNext = false; continue }
    if (char === '\\' && !inSingleQuote) { escapeNext = true; continue }
    if (char === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; continue }
    if (char === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; continue }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) { args.push(current); current = '' }
      continue
    }

    current += char
  }

  if (current) args.push(current)
  return args
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function executeEmulatedCommand(
  argv: string[],
  ctx: ShellEmulatorContext,
  stdin = '',
): Promise<EmulatedCommandResult> {
  if (argv.length === 0) return { stdout: '', stderr: '', exitCode: 0 }

  const command = argv[0]
  const args = argv.slice(1)

  switch (command) {
    case 'date':     return handleDateCommand(args)
    case 'time':     return handleTimeCommand()
    case 'uname':    return handleUnameCommand(args)
    case 'find':     return handleFindCommand(args, ctx)
    case 'grep':     return handleGrepCommand(args, ctx, stdin)
    case 'cat':      return handleCatCommand(args, ctx, stdin)
    case 'ls':       return handleLsCommand(args, ctx)
    case 'pwd':      return handlePwdCommand()
    case 'echo':     return handleEchoCommand(args)
    case 'printf':   return handlePrintfCommand(args)
    case 'wc':       return handleWcCommand(args, ctx, stdin)
    case 'head':     return handleHeadCommand(args, ctx, stdin)
    case 'tail':     return handleTailCommand(args, ctx, stdin)
    case 'sort':     return handleSortCommand(args, ctx, stdin)
    case 'uniq':     return handleUniqCommand(args, ctx, stdin)
    case 'tr':       return handleTrCommand(args, stdin)
    case 'cut':      return handleCutCommand(args, stdin)
    case 'sed':      return handleSedCommand(args, ctx, stdin)
    case 'diff':     return handleDiffCommand(args, ctx)
    case 'rm':       return handleRmCommand(args, ctx)
    case 'cp':       return handleCpCommand(args, ctx)
    case 'mv':       return handleMvCommand(args, ctx)
    case 'touch':    return handleTouchCommand(args, ctx)
    case 'mkdir':    return handleMkdirCommand(args)
    case 'tee':      return handleTeeCommand(args, ctx, stdin)
    case 'base64':   return handleBase64Command(args, ctx, stdin)
    case 'sha256sum': return handleSha256sumCommand(args, ctx, stdin)
    case 'md5sum':   return { stdout: '', stderr: 'md5sum: not available in browser — use sha256sum instead', exitCode: 1 }
    case 'true':     return { stdout: '', stderr: '', exitCode: 0 }
    case 'false':    return { stdout: '', stderr: '', exitCode: 1 }
    case 'test':
    case '[':        return handleTestCommand(args, ctx)
    case 'which':    return handleWhichCommand(args)
    case 'env':
    case 'printenv': return handleEnvCommand()
    case 'sleep':    return handleSleepCommand(args)
    case 'python':
    case 'python3':  return handlePythonCommand(args, ctx)
    default:
      return {
        stdout: '',
        stderr: `Command "${command}" is not available in the browser shell emulator. Use VFS tools for file operations.`,
        exitCode: 127,
      }
  }
}

// ---------------------------------------------------------------------------
// Handlers — existing commands (updated for stdin support)
// ---------------------------------------------------------------------------

function handleDateCommand(args: string[]): EmulatedCommandResult {
  const now = new Date()
  let dateString = now.toISOString()

  if (args.includes('-u') || args.includes('--utc') ||
      args.includes('--iso-8601=seconds') || args.includes('--rfc-3339=seconds')) {
    dateString = now.toISOString()
  } else if (args.includes('+%s')) {
    dateString = Math.floor(now.getTime() / 1000).toString()
  } else if (args.includes('+%H:%M:%S')) {
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    dateString = `${hh}:${mm}:${ss}`
  } else if (args.includes('+%Z')) {
    const tzName = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(now)
      .find(p => p.type === 'timeZoneName')?.value
    dateString = tzName || 'UTC'
  } else if (args.some(a => a.startsWith('+'))) {
    dateString = now.toString()
  }

  return { stdout: dateString, stderr: '', exitCode: 0 }
}

function handleTimeCommand(): EmulatedCommandResult {
  return { stdout: 'real 0m0.001s\nuser 0m0.000s\nsys  0m0.000s', stderr: '', exitCode: 0 }
}

function handleUnameCommand(args: string[]): EmulatedCommandResult {
  if (args.length === 0 || args.includes('-a') || args.includes('-s')) {
    return { stdout: 'SCTG chat bot - fake environment', stderr: '', exitCode: 0 }
  }
  return { stdout: '', stderr: `uname: unknown option -- ${args[0]}`, exitCode: 1 }
}

async function handleFindCommand(args: string[], ctx: ShellEmulatorContext): Promise<EmulatedCommandResult> {
  if (args.length === 0) return { stdout: '', stderr: 'find: missing path', exitCode: 1 }

  const prefix = args[0]
  let namePattern: string | undefined

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-name' && i + 1 < args.length) { namePattern = args[i + 1]; i++ }
    // -type f is silently accepted (VFS only has files)
  }

  const allFiles = ctx.vfs.list(prefix)
  const results = namePattern
    ? allFiles.filter(p => {
        const regex = globToRegex(namePattern!)
        return regex.test(p.split('/').pop() || p) || regex.test(p)
      })
    : allFiles

  return { stdout: results.join('\n'), stderr: '', exitCode: 0 }
}

async function handleGrepCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  let caseInsensitive = false
  let showLineNumbers = false
  let i = 0

  while (i < args.length) {
    if (args[i] === '-i') { caseInsensitive = true; i++ }
    else if (args[i] === '-n') { showLineNumbers = true; i++ }
    else if (args[i] === '-R' || args[i] === '-r') { i++ } // accepted, no-op (no real dirs)
    else if (args[i].startsWith('-')) {
      return { stdout: '', stderr: `grep: unknown option -- ${args[i].substring(1)}`, exitCode: 1 }
    } else break
  }

  if (i >= args.length) return { stdout: '', stderr: 'grep: missing pattern', exitCode: 1 }
  const pattern = args[i++]
  const paths = args.slice(i)

  const flags = caseInsensitive ? 'i' : ''
  let regex: RegExp
  try { regex = new RegExp(pattern, flags) }
  catch { return { stdout: '', stderr: `grep: invalid regex: ${pattern}`, exitCode: 1 } }

  const matchLines = (content: string, prefix: string): string[] => {
    const lines = content.split('\n')
    const out: string[] = []
    for (let ln = 0; ln < lines.length; ln++) {
      if (regex.test(lines[ln])) {
        const lineTag = showLineNumbers ? `${ln + 1}:` : ''
        out.push(prefix ? `${prefix}:${lineTag}${lines[ln]}` : `${lineTag}${lines[ln]}`)
      }
    }
    return out
  }

  const results: string[] = []

  if (paths.length === 0) {
    if (!stdin) return { stdout: '', stderr: 'grep: missing file operand', exitCode: 1 }
    results.push(...matchLines(stdin, ''))
  } else {
    for (const path of paths) {
      const content = ctx.vfs.read(path)
      if (content === null) { results.push(`grep: ${path}: No such file or directory`); continue }
      results.push(...matchLines(content, path))
    }
  }

  if (results.length === 0) return { stdout: '', stderr: '', exitCode: 1 }
  return { stdout: results.join('\n'), stderr: '', exitCode: 0 }
}

async function handleCatCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) return { stdout: stdin, stderr: '', exitCode: 0 }

  const outputs: string[] = []
  const errors: string[] = []
  for (const path of args) {
    const content = ctx.vfs.read(path)
    if (content === null) errors.push(`cat: ${path}: No such file or directory`)
    else outputs.push(content)
  }
  return { stdout: outputs.join('\n'), stderr: errors.join('\n'), exitCode: errors.length > 0 ? 1 : 0 }
}

async function handleLsCommand(args: string[], ctx: ShellEmulatorContext): Promise<EmulatedCommandResult> {
  const prefix = args.find(a => !a.startsWith('-')) ?? '.'
  const paths = ctx.vfs.list(prefix)

  if (paths.length === 0) return { stdout: 'No files found.', stderr: '', exitCode: 0 }

  const results = paths.map(p => {
    const entry = ctx.vfs.entry(p)
    return entry ? `${p}  ${entry.size}B  ${entry.mimeType}` : `${p}  (unknown)`
  })
  return { stdout: results.join('\n'), stderr: '', exitCode: 0 }
}

function handlePwdCommand(): EmulatedCommandResult {
  return { stdout: '/', stderr: '', exitCode: 0 }
}

function handleEchoCommand(args: string[]): EmulatedCommandResult {
  // -n suppresses trailing newline (no-op here since we don't add one)
  const noNewline = args[0] === '-n'
  const text = noNewline ? args.slice(1).join(' ') : args.join(' ')
  return { stdout: text, stderr: '', exitCode: 0 }
}

function handlePrintfCommand(args: string[]): EmulatedCommandResult {
  if (args.length === 0) return { stdout: '', stderr: 'printf: missing format string', exitCode: 1 }

  const fmt = args[0]
  const rest = args.slice(1)
  let argIdx = 0

  const result = fmt
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\')
    .replace(/%([sdifxXobu%])/g, (_, spec: string) => {
      if (spec === '%') return '%'
      const val = rest[argIdx++] ?? ''
      switch (spec) {
        case 's': return String(val)
        case 'd': case 'i': return String(Math.trunc(Number(val)) || 0)
        case 'f': return String(Number(val) || 0)
        case 'x': return (Math.trunc(Number(val)) || 0).toString(16)
        case 'X': return (Math.trunc(Number(val)) || 0).toString(16).toUpperCase()
        case 'o': return (Math.trunc(Number(val)) || 0).toString(8)
        case 'b': return (Math.trunc(Number(val)) || 0).toString(2)
        case 'u': return String(Math.abs(Math.trunc(Number(val))) || 0)
        default: return val
      }
    })

  return { stdout: result, stderr: '', exitCode: 0 }
}

async function handleWcCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  const filePaths = args.filter(a => !a.startsWith('-'))
  let content: string
  let label = ''

  if (filePaths.length > 0) {
    const c = ctx.vfs.read(filePaths[0])
    if (c === null) return { stdout: '', stderr: `wc: ${filePaths[0]}: No such file or directory`, exitCode: 1 }
    content = c; label = filePaths[0]
  } else if (stdin) {
    content = stdin
  } else {
    return { stdout: '', stderr: 'wc: missing file operand', exitCode: 1 }
  }

  const lineCount = content.split('\n').length
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  const byteCount = new TextEncoder().encode(content).length
  return { stdout: `${lineCount} ${wordCount} ${byteCount}${label ? ` ${label}` : ''}`, stderr: '', exitCode: 0 }
}

async function handleHeadCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  let lines = 10
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-n' && i + 1 < args.length) { lines = parseInt(args[i + 1]) || 10; i += 2 }
    else if (/^-\d+$/.test(args[i])) { lines = parseInt(args[i].slice(1)) || 10; i++ }
    else i++
  }
  const path = args[i]

  let content: string
  if (path) {
    const c = ctx.vfs.read(path)
    if (c === null) return { stdout: '', stderr: `head: ${path}: No such file or directory`, exitCode: 1 }
    content = c
  } else if (stdin) {
    content = stdin
  } else {
    return { stdout: '', stderr: 'head: missing file operand', exitCode: 1 }
  }

  return { stdout: content.split('\n').slice(0, lines).join('\n'), stderr: '', exitCode: 0 }
}

async function handleTailCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  let lines = 10
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-n' && i + 1 < args.length) { lines = parseInt(args[i + 1]) || 10; i += 2 }
    else if (/^-\d+$/.test(args[i])) { lines = parseInt(args[i].slice(1)) || 10; i++ }
    else i++
  }
  const path = args[i]

  let content: string
  if (path) {
    const c = ctx.vfs.read(path)
    if (c === null) return { stdout: '', stderr: `tail: ${path}: No such file or directory`, exitCode: 1 }
    content = c
  } else if (stdin) {
    content = stdin
  } else {
    return { stdout: '', stderr: 'tail: missing file operand', exitCode: 1 }
  }

  return { stdout: content.split('\n').slice(-lines).join('\n'), stderr: '', exitCode: 0 }
}

async function handleSortCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  const reverse = args.includes('-r')
  const numeric = args.includes('-n')
  const filePaths = args.filter(a => !a.startsWith('-'))

  let content: string
  if (filePaths.length > 0) {
    const c = ctx.vfs.read(filePaths[0])
    if (c === null) return { stdout: '', stderr: `sort: ${filePaths[0]}: No such file or directory`, exitCode: 1 }
    content = c
  } else if (stdin) {
    content = stdin
  } else {
    return { stdout: '', stderr: 'sort: missing file operand', exitCode: 1 }
  }

  const sorted = content.split('\n')
  if (numeric) sorted.sort((a, b) => Number(a) - Number(b))
  else sorted.sort()
  if (reverse) sorted.reverse()

  return { stdout: sorted.join('\n'), stderr: '', exitCode: 0 }
}

async function handleUniqCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  const filePaths = args.filter(a => !a.startsWith('-'))

  let content: string
  if (filePaths.length > 0) {
    const c = ctx.vfs.read(filePaths[0])
    if (c === null) return { stdout: '', stderr: `uniq: ${filePaths[0]}: No such file or directory`, exitCode: 1 }
    content = c
  } else if (stdin) {
    content = stdin
  } else {
    return { stdout: '', stderr: 'uniq: missing file operand', exitCode: 1 }
  }

  const lines = content.split('\n')
  const uniqLines = lines.filter((l, idx) => idx === 0 || l !== lines[idx - 1])
  return { stdout: uniqLines.join('\n'), stderr: '', exitCode: 0 }
}

// ---------------------------------------------------------------------------
// Handlers — new text-processing commands
// ---------------------------------------------------------------------------

function handleTrCommand(args: string[], stdin: string): EmulatedCommandResult {
  if (args.length < 2) return { stdout: '', stderr: 'tr: missing operand', exitCode: 1 }

  const expandSet = (s: string): string =>
    s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\')
     .replace(/(.)-(.)/g, (_, a: string, b: string) => {
       const start = a.charCodeAt(0), end = b.charCodeAt(0)
       if (start > end) return ''
       let r = ''
       for (let c = start; c <= end; c++) r += String.fromCharCode(c)
       return r
     })

  const set1 = expandSet(args[0])
  const set2 = expandSet(args[1])
  const lastTo = set2[set2.length - 1] ?? ''

  let output = stdin
  for (let i = 0; i < set1.length; i++) {
    const from = set1[i]
    const to = i < set2.length ? set2[i] : lastTo
    output = output.split(from).join(to)
  }
  return { stdout: output, stderr: '', exitCode: 0 }
}

function handleCutCommand(args: string[], stdin: string): EmulatedCommandResult {
  let delimiter = '\t'
  let fields: number[] = []
  let i = 0

  const parseFields = (f: string): number[] =>
    f.split(',').flatMap(part => {
      if (part.includes('-')) {
        const [s, e] = part.split('-').map(Number)
        return Array.from({ length: e - s + 1 }, (_, k) => s + k)
      }
      return [Number(part)]
    })

  while (i < args.length) {
    if (args[i] === '-d' && i + 1 < args.length) { delimiter = args[i + 1]; i += 2 }
    else if (args[i].startsWith('-d') && args[i].length > 2) { delimiter = args[i].slice(2); i++ }
    else if (args[i] === '-f' && i + 1 < args.length) { fields = parseFields(args[i + 1]); i += 2 }
    else if (args[i].startsWith('-f') && args[i].length > 2) { fields = parseFields(args[i].slice(2)); i++ }
    else i++
  }

  if (fields.length === 0) return { stdout: '', stderr: 'cut: you must specify a list of fields with -f', exitCode: 1 }

  const result = stdin.split('\n').map(line => {
    const parts = line.split(delimiter)
    return fields.map(f => parts[f - 1] ?? '').join(delimiter)
  }).join('\n')

  return { stdout: result, stderr: '', exitCode: 0 }
}

async function handleSedCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  let script = ''
  const filePaths: string[] = []
  let i = 0

  while (i < args.length) {
    if (args[i] === '-e' && i + 1 < args.length) { script = args[i + 1]; i += 2 }
    else if (args[i].startsWith('-')) i++
    else if (!script) { script = args[i]; i++ }
    else { filePaths.push(args[i]); i++ }
  }

  if (!script) return { stdout: '', stderr: 'sed: no script command', exitCode: 1 }

  // Parse: s<delim><pattern><delim><replacement><delim><flags>
  const m = script.match(/^s(.)(.+?)\1(.*?)\1([gimsuy]*)$/)
  if (!m) return { stdout: '', stderr: `sed: invalid script: ${script}`, exitCode: 1 }

  let regex: RegExp
  try { regex = new RegExp(m[2], m[4] || 'g') }
  catch (e) { return { stdout: '', stderr: `sed: invalid regex: ${e instanceof Error ? e.message : e}`, exitCode: 1 } }

  const sources: string[] = filePaths.length > 0
    ? filePaths.map(p => ctx.vfs.read(p) ?? `sed: ${p}: No such file or directory`)
    : [stdin]

  return { stdout: sources.map(s => s.replace(regex, m[3])).join('\n'), stderr: '', exitCode: 0 }
}

function simpleUnifiedDiff(aLines: string[], bLines: string[], aLabel: string, bLabel: string): string {
  const out = [`--- ${aLabel}`, `+++ ${bLabel}`]
  const max = Math.max(aLines.length, bLines.length)
  let i = 0, j = 0
  while (i < max || j < max) {
    const a = i < aLines.length ? aLines[i] : undefined
    const b = j < bLines.length ? bLines[j] : undefined
    if (a === b) { out.push(` ${a ?? ''}`); i++; j++ }
    else if (a !== undefined && b !== undefined) { out.push(`-${a}`); out.push(`+${b}`); i++; j++ }
    else if (a !== undefined) { out.push(`-${a}`); i++ }
    else { out.push(`+${b ?? ''}`); j++ }
  }
  return out.join('\n')
}

async function handleDiffCommand(args: string[], ctx: ShellEmulatorContext): Promise<EmulatedCommandResult> {
  const filePaths = args.filter(a => !a.startsWith('-'))
  if (filePaths.length < 2) return { stdout: '', stderr: 'diff: missing operand', exitCode: 1 }

  const [fileA, fileB] = filePaths
  const contentA = ctx.vfs.read(fileA)
  const contentB = ctx.vfs.read(fileB)
  if (contentA === null) return { stdout: '', stderr: `diff: ${fileA}: No such file or directory`, exitCode: 2 }
  if (contentB === null) return { stdout: '', stderr: `diff: ${fileB}: No such file or directory`, exitCode: 2 }

  if (contentA === contentB) return { stdout: '', stderr: '', exitCode: 0 }
  return { stdout: simpleUnifiedDiff(contentA.split('\n'), contentB.split('\n'), fileA, fileB), stderr: '', exitCode: 1 }
}

// ---------------------------------------------------------------------------
// Handlers — file management
// ---------------------------------------------------------------------------

function handleRmCommand(args: string[], ctx: ShellEmulatorContext): EmulatedCommandResult {
  if (args.length === 0) return { stdout: '', stderr: 'rm: missing operand', exitCode: 1 }

  let recursive = false
  let force = false
  const paths: string[] = []

  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (arg.includes('r') || arg.includes('R')) recursive = true
      if (arg.includes('f')) force = true
    } else {
      paths.push(arg)
    }
  }

  const errors: string[] = []
  for (const path of paths) {
    if (recursive) {
      const files = ctx.vfs.list(path)
      for (const f of files) ctx.vfs.delete(f)
      ctx.vfs.delete(path)
    } else {
      if (!ctx.vfs.delete(path) && !force) {
        errors.push(`rm: cannot remove '${path}': No such file or directory`)
      }
    }
  }

  return { stdout: '', stderr: errors.join('\n'), exitCode: errors.length > 0 ? 1 : 0 }
}

function handleCpCommand(args: string[], ctx: ShellEmulatorContext): EmulatedCommandResult {
  const filePaths = args.filter(a => !a.startsWith('-'))
  if (filePaths.length < 2) return { stdout: '', stderr: 'cp: missing destination file operand', exitCode: 1 }

  const [src, dst] = filePaths
  const content = ctx.vfs.read(src)
  if (content === null) return { stdout: '', stderr: `cp: '${src}': No such file or directory`, exitCode: 1 }
  const entry = ctx.vfs.entry(src)
  ctx.vfs.write(dst, content, entry?.mimeType ?? 'text/plain')
  ctx.onFileCreated(dst, content)
  return { stdout: '', stderr: '', exitCode: 0 }
}

function handleMvCommand(args: string[], ctx: ShellEmulatorContext): EmulatedCommandResult {
  const filePaths = args.filter(a => !a.startsWith('-'))
  if (filePaths.length < 2) return { stdout: '', stderr: 'mv: missing destination file operand', exitCode: 1 }

  const [src, dst] = filePaths
  const content = ctx.vfs.read(src)
  if (content === null) return { stdout: '', stderr: `mv: '${src}': No such file or directory`, exitCode: 1 }
  const entry = ctx.vfs.entry(src)
  ctx.vfs.write(dst, content, entry?.mimeType ?? 'text/plain')
  ctx.onFileCreated(dst, content)
  ctx.vfs.delete(src)
  return { stdout: '', stderr: '', exitCode: 0 }
}

function handleTouchCommand(args: string[], ctx: ShellEmulatorContext): EmulatedCommandResult {
  if (args.length === 0) return { stdout: '', stderr: 'touch: missing file operand', exitCode: 1 }
  for (const path of args.filter(a => !a.startsWith('-'))) {
    if (ctx.vfs.read(path) === null) {
      ctx.vfs.write(path, '')
      ctx.onFileCreated(path, '')
    }
  }
  return { stdout: '', stderr: '', exitCode: 0 }
}

function handleMkdirCommand(args: string[]): EmulatedCommandResult {
  if (args.filter(a => !a.startsWith('-')).length === 0) {
    return { stdout: '', stderr: 'mkdir: missing operand', exitCode: 1 }
  }
  // VFS is flat — directories are implicit path prefixes; just succeed silently
  return { stdout: '', stderr: '', exitCode: 0 }
}

function handleTeeCommand(args: string[], ctx: ShellEmulatorContext, stdin: string): EmulatedCommandResult {
  const append = args.includes('-a')
  const paths = args.filter(a => !a.startsWith('-'))

  for (const path of paths) {
    if (append) {
      const existing = ctx.vfs.read(path) ?? ''
      const sep = existing && !existing.endsWith('\n') ? '\n' : ''
      const newContent = existing + sep + stdin
      ctx.vfs.write(path, newContent)
      ctx.onFileCreated(path, newContent)
    } else {
      ctx.vfs.write(path, stdin)
      ctx.onFileCreated(path, stdin)
    }
  }
  return { stdout: stdin, stderr: '', exitCode: 0 }
}

// ---------------------------------------------------------------------------
// Handlers — encoding / checksum
// ---------------------------------------------------------------------------

function handleBase64Command(args: string[], ctx: ShellEmulatorContext, stdin: string): EmulatedCommandResult {
  const decode = args.includes('-d') || args.includes('--decode')
  const filePaths = args.filter(a => !a.startsWith('-'))

  let input: string
  if (filePaths.length > 0) {
    const content = ctx.vfs.read(filePaths[0])
    if (content === null) return { stdout: '', stderr: `base64: ${filePaths[0]}: No such file or directory`, exitCode: 1 }
    input = content
  } else {
    input = stdin
  }

  try {
    if (decode) return { stdout: atob(input.replace(/\s/g, '')), stderr: '', exitCode: 0 }
    return { stdout: btoa(input), stderr: '', exitCode: 0 }
  } catch (e) {
    return { stdout: '', stderr: `base64: invalid input: ${e instanceof Error ? e.message : e}`, exitCode: 1 }
  }
}

async function handleSha256sumCommand(
  args: string[],
  ctx: ShellEmulatorContext,
  stdin: string,
): Promise<EmulatedCommandResult> {
  const filePaths = args.filter(a => !a.startsWith('-'))
  let input: string
  let label = '-'

  if (filePaths.length > 0) {
    const content = ctx.vfs.read(filePaths[0])
    if (content === null) return { stdout: '', stderr: `sha256sum: ${filePaths[0]}: No such file or directory`, exitCode: 1 }
    input = content; label = filePaths[0]
  } else {
    input = stdin
  }

  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  return { stdout: `${hex}  ${label}`, stderr: '', exitCode: 0 }
}

// ---------------------------------------------------------------------------
// Handlers — scripting utilities
// ---------------------------------------------------------------------------

function handleTestCommand(args: string[], ctx: ShellEmulatorContext): EmulatedCommandResult {
  const a = args.filter(x => x !== ']')
  if (a.length === 0) return { stdout: '', stderr: '', exitCode: 1 }

  let result = false
  if (a.length === 1) {
    result = a[0].length > 0
  } else if (a[0] === '!') {
    const inner = handleTestCommand(a.slice(1), ctx)
    return { stdout: '', stderr: '', exitCode: inner.exitCode === 0 ? 1 : 0 }
  } else if (a[0] === '-f' || a[0] === '-e') {
    result = ctx.vfs.read(a[1] ?? '') !== null
  } else if (a[0] === '-d') {
    // VFS is flat — treat as false (no real directories)
    result = false
  } else if (a[0] === '-z') {
    result = (a[1] ?? '').length === 0
  } else if (a[0] === '-n') {
    result = (a[1] ?? '').length > 0
  } else if (a.length >= 3) {
    const [left, op, right] = a
    switch (op) {
      case '=': case '==': result = left === right; break
      case '!=': result = left !== right; break
      case '-eq': result = Number(left) === Number(right); break
      case '-ne': result = Number(left) !== Number(right); break
      case '-lt': result = Number(left) < Number(right); break
      case '-le': result = Number(left) <= Number(right); break
      case '-gt': result = Number(left) > Number(right); break
      case '-ge': result = Number(left) >= Number(right); break
    }
  }

  return { stdout: '', stderr: '', exitCode: result ? 0 : 1 }
}

function handleWhichCommand(args: string[]): EmulatedCommandResult {
  if (args.length === 0) return { stdout: '', stderr: 'which: missing argument', exitCode: 1 }
  const found: string[] = []
  const missing: string[] = []
  for (const cmd of args) {
    if (KNOWN_COMMANDS.has(cmd)) found.push(`/usr/bin/${cmd}`)
    else missing.push(cmd)
  }
  return {
    stdout: found.join('\n'),
    stderr: missing.map(c => `which: no ${c} in (/usr/local/bin:/usr/bin:/bin)`).join('\n'),
    exitCode: missing.length > 0 ? 1 : 0,
  }
}

function handleEnvCommand(): EmulatedCommandResult {
  return {
    stdout: Object.entries(SIMULATED_ENV).map(([k, v]) => `${k}=${v}`).join('\n'),
    stderr: '',
    exitCode: 0,
  }
}

function handleSleepCommand(args: string[]): EmulatedCommandResult {
  if (args.length === 0) {
    return { stdout: '', stderr: 'sleep: missing operand', exitCode: 1 }
  }

  let totalMilliseconds = 0
  const MAX_SLEEP_MS = 2 * 60 * 1000 // 2 minutes in milliseconds

  for (const arg of args) {
    // Parse time value with optional suffix
    // Format: NUMBER[SUFFIX] where SUFFIX can be s, m, h, or d
    const match = arg.match(/^(\d+(?:\.\d+)?)([smhd])?$/)
    if (!match) {
      return { stdout: '', stderr: `sleep: invalid time interval '${arg}'`, exitCode: 1 }
    }

    const value = parseFloat(match[1])
    const suffix = match[2] || 's' // default to seconds

    let milliseconds = 0
    switch (suffix) {
      case 's': // seconds
        milliseconds = value * 1000
        break
      case 'm': // minutes
        milliseconds = value * 60 * 1000
        break
      case 'h': // hours
        milliseconds = value * 60 * 60 * 1000
        break
      case 'd': // days
        milliseconds = value * 24 * 60 * 60 * 1000
        break
      default:
        // This shouldn't happen due to the regex, but just in case
        return { stdout: '', stderr: `sleep: invalid suffix '${suffix}'`, exitCode: 1 }
    }

    totalMilliseconds += milliseconds
  }

  // Silently limit to 2 minutes maximum
  totalMilliseconds = Math.min(totalMilliseconds, MAX_SLEEP_MS)

  // Convert to integer milliseconds
  const sleepTime = Math.floor(totalMilliseconds)

  // Use a promise to sleep without blocking
  // Note: In a real shell emulator, this would need to be handled differently
  // since we can't actually block the event loop. For the emulator, we'll
  // simulate the delay but return immediately to avoid blocking.
  if (sleepTime > 0) {
    // In a real implementation, we would await a sleep here
    // For the emulator, we'll just acknowledge the sleep would have occurred
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  return { stdout: '', stderr: '', exitCode: 0 }
}

// ---------------------------------------------------------------------------
// Handlers — Python
// ---------------------------------------------------------------------------

async function handlePythonExecution(
  code: string,
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (!ctx.runPython) {
    return {
      stdout: '',
      stderr: 'Python execution is not available. Enable the "execute_python_code" tool in the chatbot settings.',
      exitCode: 127,
    }
  }

  if (!ctx.isPythonEnabled) {
    if (!ctx.onAskQuestion) {
      return { stdout: '', stderr: 'Python execution requires the execute_python_code tool to be enabled.', exitCode: 127 }
    }
    const answer = await ctx.onAskQuestion(
      'A shell command is attempting to execute Python code via Pyodide. The execute_python_code tool is not currently enabled. Authorize this one-time execution?',
      ['Yes, run via Pyodide', 'No, deny'],
    )
    if (!answer.startsWith('Yes')) return { stdout: '', stderr: 'Python execution denied by user.', exitCode: 1 }
  }

  const result = await ctx.runPython(code)
  return { stdout: result.output, stderr: result.error ?? '', exitCode: result.error ? 1 : 0 }
}

async function handlePythonCommand(args: string[], ctx: ShellEmulatorContext): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'Python interactive mode is not supported in the shell emulator. Use the execute_python_code tool directly.',
      exitCode: 1,
    }
  }

  let code: string
  if (args[0] === '-c') {
    if (args.length < 2) return { stdout: '', stderr: 'python: -c requires an argument', exitCode: 1 }
    code = args.slice(1).join(' ')
  } else {
    const content = ctx.vfs.read(args[0])
    if (content === null) {
      return { stdout: '', stderr: `python: can't open file '${args[0]}': No such file or directory`, exitCode: 2 }
    }
    code = content
  }
  return handlePythonExecution(code, ctx)
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function emulateShellCommands(
  commands: string[],
  ctx: ShellEmulatorContext,
): Promise<string> {
  const normalized = normalizeShellInput(commands.join('\n'))
  const { processed, blocks } = extractHeredocBlocks(normalized)
  const segments = splitShellCommands(processed)
  const results: string[] = []

  // pendingPipeStdin: stdout accumulated from pipe-chained commands
  let pendingPipeStdin: string | null = null
  // pipeChainCommands: command strings in the current pipe chain (for display)
  let pipeChainCommands: string[] = []

  for (let si = 0; si < segments.length; si++) {
    const segment = segments[si]
    const isNewChain = pendingPipeStdin === null
    const stdin = pendingPipeStdin ?? ''
    if (isNewChain) pipeChainCommands = []
    pendingPipeStdin = null

    // ── Heredoc blocks ──────────────────────────────────────────────────────
    const heredocMatch = segment.command.match(/^__heredoc__\s+(__HEREDOC_\d+__)$/)
    if (heredocMatch) {
      const block = blocks.get(heredocMatch[1])
      if (block !== undefined) {
        let result: EmulatedCommandResult
        let displayLabel: string

        switch (block.action.type) {
          case 'python': {
            result = await handlePythonExecution(block.content, ctx)
            displayLabel = 'cat << heredoc | python3'
            break
          }
          case 'write': {
            ctx.vfs.write(block.action.file, block.content)
            ctx.onFileCreated(block.action.file, block.content)
            result = { stdout: '', stderr: '', exitCode: 0 }
            displayLabel = `cat << heredoc > ${block.action.file}`
            break
          }
          case 'append': {
            const existing = ctx.vfs.read(block.action.file) ?? ''
            const sep = existing && !existing.endsWith('\n') ? '\n' : ''
            const newContent = existing + sep + block.content
            ctx.vfs.write(block.action.file, newContent)
            ctx.onFileCreated(block.action.file, newContent)
            result = { stdout: '', stderr: '', exitCode: 0 }
            displayLabel = `cat << heredoc >> ${block.action.file}`
            break
          }
          default: {
            result = { stdout: block.content, stderr: '', exitCode: 0 }
            displayLabel = 'cat << heredoc'
          }
        }

        pipeChainCommands.push(displayLabel)

        if (segment.separatorBefore === 'pipe') {
          pendingPipeStdin = result.stdout
          if (result.stderr) results.push(result.stderr)
        } else {
          results.push(`$ ${pipeChainCommands.join(' | ')}`)
          results.push(result.stdout)
          if (result.stderr) results.push(result.stderr)
        }
        if (segment.separatorBefore === 'onSuccess' && result.exitCode !== 0) break
        continue
      }
    }

    // ── Regular command ─────────────────────────────────────────────────────
    const { command: cmdWithoutRedirect, redirect } = extractRedirect(segment.command)
    const argv = parseShellArgs(cmdWithoutRedirect)
    if (argv.length === 0) continue

    const result = await executeEmulatedCommand(argv, ctx, stdin)

    pipeChainCommands.push(segment.command)

    if (segment.separatorBefore === 'pipe') {
      // Intermediate pipe: stdout feeds next command; show stderr only
      if (redirect) {
        writeToVfs(ctx, redirect, result.stdout)
        pendingPipeStdin = ''
      } else {
        pendingPipeStdin = result.stdout
      }
      if (result.stderr) results.push(result.stderr)
    } else {
      // End of chain (or standalone command)
      const displayCmd = pipeChainCommands.join(' | ')
      results.push(`$ ${displayCmd}`)

      if (redirect) {
        writeToVfs(ctx, redirect, result.stdout)
      } else {
        results.push(result.stdout)
      }
      if (result.stderr) results.push(result.stderr)
    }

    if (segment.separatorBefore === 'onSuccess' && result.exitCode !== 0) break
  }

  return results.join('\n')
}

function writeToVfs(
  ctx: ShellEmulatorContext,
  redirect: { mode: 'write' | 'append'; file: string },
  content: string,
): void {
  if (redirect.mode === 'write') {
    ctx.vfs.write(redirect.file, content)
    ctx.onFileCreated(redirect.file, content)
  } else {
    const existing = ctx.vfs.read(redirect.file) ?? ''
    const sep = existing && !existing.endsWith('\n') ? '\n' : ''
    const newContent = existing + sep + content
    ctx.vfs.write(redirect.file, newContent)
    ctx.onFileCreated(redirect.file, newContent)
  }
}
