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
}

type CommandSeparator = 'always' | 'onSuccess'

interface ParsedCommandSegment {
  command: string
  separatorBefore: CommandSeparator
}

interface EmulatedCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

function normalizeShellInput(input: string): string {
  // Remove trailing backslash-newline sequences
  return input.replace(/\\\r?\n/g, ' ')
}

function splitShellCommands(input: string): ParsedCommandSegment[] {
  const segments: ParsedCommandSegment[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (escapeNext) {
      current += char
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === ';') {
        if (current.trim()) {
          segments.push({ command: current.trim(), separatorBefore: 'always' })
        }
        current = ''
        continue
      }

      if (char === '&' && i + 1 < input.length && input[i + 1] === '&') {
        if (current.trim()) {
          segments.push({ command: current.trim(), separatorBefore: 'onSuccess' })
        }
        current = ''
        i++ // Skip the second &
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    segments.push({ command: current.trim(), separatorBefore: 'always' })
  }

  return segments
}

function parseShellArgs(command: string): string[] {
  const args: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escapeNext) {
      current += char
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    args.push(current)
  }

  return args
}

async function executeEmulatedCommand(
  argv: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (argv.length === 0) {
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  const command = argv[0]
  const args = argv.slice(1)

  switch (command) {
    case 'date':
      return handleDateCommand(args)
    case 'time':
      return handleTimeCommand(args)
    case 'uname':
      return handleUnameCommand(args)
    case 'find':
      return handleFindCommand(args, ctx)
    case 'grep':
      return handleGrepCommand(args, ctx)
    case 'cat':
      return handleCatCommand(args, ctx)
    case 'ls':
      return handleLsCommand(args, ctx)
    case 'pwd':
      return handlePwdCommand(args)
    case 'echo':
      return handleEchoCommand(args)
    case 'wc':
      return handleWcCommand(args, ctx)
    case 'head':
      return handleHeadCommand(args, ctx)
    case 'tail':
      return handleTailCommand(args, ctx)
    case 'sort':
      return handleSortCommand(args, ctx)
    case 'uniq':
      return handleUniqCommand(args, ctx)
    default:
      return {
        stdout: '',
        stderr: `Command "${command}" is not available in the browser shell emulator. Use VFS tools for file operations.`,
        exitCode: 127,
      }
  }
}

function handleDateCommand(args: string[]): EmulatedCommandResult {
  const now = new Date()
  let dateString = now.toISOString()

  // Handle common date arguments
  if (args.includes('-u') || args.includes('--utc')) {
    // UTC is already the default for toISOString, but we can make it explicit
    dateString = now.toISOString()
  } else if (args.includes('--iso-8601=seconds')) {
    dateString = now.toISOString()
  } else if (args.includes('--rfc-3339=seconds')) {
    dateString = now.toISOString()
  } else if (args.includes('+%s')) {
    // Unix timestamp in seconds
    dateString = Math.floor(now.getTime() / 1000).toString()
  } else if (args.includes('+%H:%M:%S')) {
    // Time format HH:MM:SS
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    dateString = `${hours}:${minutes}:${seconds}`
  } else if (args.includes('+%Z')) {
    // Timezone name (e.g., UTC, CEST, etc.)
    // Using Intl.DateTimeFormat to get the timezone name
    const tzName = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
    })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value
    dateString = tzName || 'UTC'
  } else if (args.length > 0) {
    // For other unknown arguments, return a simple format
    dateString = now.toString()
  }

  return { stdout: dateString, stderr: '', exitCode: 0 }
}

function handleTimeCommand(args: string[]): EmulatedCommandResult {
  return {
    stdout: 'real 0m0.001s\nuser 0m0.000s\nsys  0m0.000s',
    stderr: '',
    exitCode: 0,
  }
}

function handleUnameCommand(args: string[]): EmulatedCommandResult {
  if (args.length === 0 || args.includes('-a') || args.includes('-s')) {
    return {
      stdout: 'SCTG chat bot - fake environment',
      stderr: '',
      exitCode: 0,
    }
  }

  return {
    stdout: '',
    stderr: `uname: unknown option -- ${args[0]}`,
    exitCode: 1,
  }
}

async function handleFindCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'find: missing path', exitCode: 1 }
  }

  const prefix = args[0]
  let namePattern: string | undefined
  let typeF = false

  // Simple argument parsing for -name and -type
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-name' && i + 1 < args.length) {
      namePattern = args[i + 1]
      i++
    } else if (args[i] === '-type' && i + 1 < args.length) {
      typeF = args[i + 1] === 'f'
      i++
    }
  }

  const allFiles = ctx.vfs.list(prefix)
  const results: string[] = []

  for (const path of allFiles) {
    if (namePattern) {
      const regex = globToRegex(namePattern)
      const basename = path.split('/').pop() || path
      if (regex.test(basename) || regex.test(path)) {
        results.push(path)
      }
    } else {
      results.push(path)
    }
  }

  return { stdout: results.join('\n'), stderr: '', exitCode: 0 }
}

async function handleGrepCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length < 2) {
    return { stdout: '', stderr: 'grep: missing pattern and file', exitCode: 1 }
  }

  let pattern = args[0]
  let paths: string[] = []
  let caseInsensitive = false
  let showLineNumbers = false
  let recursive = false

  // Simple argument parsing
  let i = 0
  while (i < args.length) {
    if (args[i] === '-i') {
      caseInsensitive = true
      i++
    } else if (args[i] === '-n') {
      showLineNumbers = true
      i++
    } else if (args[i] === '-R' || args[i] === '-r') {
      recursive = true
      i++
    } else if (args[i].startsWith('-')) {
      return { stdout: '', stderr: `grep: unknown option -- ${args[i].substring(1)}`, exitCode: 1 }
    } else {
      break
    }
  }

  pattern = args[i++]
  paths = args.slice(i)

  if (paths.length === 0) {
    return { stdout: '', stderr: 'grep: missing file operand', exitCode: 1 }
  }

  const flags = caseInsensitive ? 'i' : ''
  const regex = new RegExp(pattern, flags)
  const results: string[] = []

  for (const path of paths) {
    const content = ctx.vfs.read(path)
    if (content === null) {
      results.push(`grep: ${path}: No such file or directory`)
      continue
    }

    const lines = content.split('\n')
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      if (regex.test(lines[lineNum])) {
        if (showLineNumbers) {
          results.push(`${path}:${lineNum + 1}: ${lines[lineNum]}`)
        } else {
          results.push(`${path}:${lines[lineNum]}`)
        }
      }
    }
  }

  if (results.length === 0) {
    return { stdout: 'No matches found.', stderr: '', exitCode: 1 }
  }

  return { stdout: results.join('\n'), stderr: '', exitCode: 0 }
}

async function handleCatCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'cat: missing file operand', exitCode: 1 }
  }

  const results: string[] = []
  for (const path of args) {
    const content = ctx.vfs.read(path)
    if (content === null) {
      results.push(`cat: ${path}: No such file or directory`)
    } else {
      results.push(content)
    }
  }

  return { stdout: results.join('\n'), stderr: '', exitCode: 0 }
}

async function handleLsCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  const prefix = args.length > 0 && !args[0].startsWith('-') ? args[0] : '.'
  const paths = ctx.vfs.list(prefix)

  if (paths.length === 0) {
    return { stdout: 'No files found.', stderr: '', exitCode: 0 }
  }

  const results: string[] = []
  for (const path of paths) {
    const entry = ctx.vfs.entry(path)
    if (entry) {
      results.push(`${path}  ${entry.size}B  ${entry.mimeType}`)
    } else {
      results.push(`${path}  (unknown)`)
    }
  }

  return { stdout: results.join('\n'), stderr: '', exitCode: 0 }
}

function handlePwdCommand(args: string[]): EmulatedCommandResult {
  return { stdout: '/', stderr: '', exitCode: 0 }
}

function handleEchoCommand(args: string[]): EmulatedCommandResult {
  return { stdout: args.join(' '), stderr: '', exitCode: 0 }
}

async function handleWcCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'wc: missing file operand', exitCode: 1 }
  }

  const path = args[0]
  const content = ctx.vfs.read(path)
  if (content === null) {
    return { stdout: '', stderr: `wc: ${path}: No such file or directory`, exitCode: 1 }
  }

  const lineCount = content.split('\n').length
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  const byteCount = new TextEncoder().encode(content).length

  return { stdout: `${lineCount} ${wordCount} ${byteCount}`, stderr: '', exitCode: 0 }
}

async function handleHeadCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'head: missing file operand', exitCode: 1 }
  }

  let lines = 10
  let path = args[0]

  // Simple argument parsing for -n
  if (args[0] === '-n' && args.length > 1) {
    lines = parseInt(args[1]) || 10
    path = args[2] || ''
  }

  if (!path) {
    return { stdout: '', stderr: 'head: missing file operand', exitCode: 1 }
  }

  const content = ctx.vfs.read(path)
  if (content === null) {
    return { stdout: '', stderr: `head: ${path}: No such file or directory`, exitCode: 1 }
  }

  const allLines = content.split('\n')
  const resultLines = allLines.slice(0, lines)

  return { stdout: resultLines.join('\n'), stderr: '', exitCode: 0 }
}

async function handleTailCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'tail: missing file operand', exitCode: 1 }
  }

  let lines = 10
  let path = args[0]

  // Simple argument parsing for -n
  if (args[0] === '-n' && args.length > 1) {
    lines = parseInt(args[1]) || 10
    path = args[2] || ''
  }

  if (!path) {
    return { stdout: '', stderr: 'tail: missing file operand', exitCode: 1 }
  }

  const content = ctx.vfs.read(path)
  if (content === null) {
    return { stdout: '', stderr: `tail: ${path}: No such file or directory`, exitCode: 1 }
  }

  const allLines = content.split('\n')
  const resultLines = allLines.slice(-lines)

  return { stdout: resultLines.join('\n'), stderr: '', exitCode: 0 }
}

async function handleSortCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'sort: missing file operand', exitCode: 1 }
  }

  const path = args[0]
  const content = ctx.vfs.read(path)
  if (content === null) {
    return { stdout: '', stderr: `sort: ${path}: No such file or directory`, exitCode: 1 }
  }

  const lines = content.split('\n')
  lines.sort()

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 }
}

async function handleUniqCommand(
  args: string[],
  ctx: ShellEmulatorContext,
): Promise<EmulatedCommandResult> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'uniq: missing file operand', exitCode: 1 }
  }

  const path = args[0]
  const content = ctx.vfs.read(path)
  if (content === null) {
    return { stdout: '', stderr: `uniq: ${path}: No such file or directory`, exitCode: 1 }
  }

  const lines = content.split('\n')
  const uniqueLines = [...new Set(lines)]

  return { stdout: uniqueLines.join('\n'), stderr: '', exitCode: 0 }
}

export async function emulateShellCommands(
  commands: string[],
  ctx: ShellEmulatorContext,
): Promise<string> {
  const normalized = normalizeShellInput(commands.join('\n'))
  const segments = splitShellCommands(normalized)
  const results: string[] = []

  for (const segment of segments) {
    const argv = parseShellArgs(segment.command)
    if (argv.length === 0) continue

    const result = await executeEmulatedCommand(argv, ctx)
    results.push(`$ ${segment.command}`)
    results.push(result.stdout)
    if (result.stderr) {
      results.push(result.stderr)
    }

    // Handle command chaining with && and ;
    if (segment.separatorBefore === 'onSuccess' && result.exitCode !== 0) {
      break
    }
  }

  return results.join('\n')
}
