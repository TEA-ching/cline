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
import { createTool } from '@cline/agents'
import { z } from 'zod'
import type { AgentTool } from '@cline/agents'
import type { VirtualFS } from '@/vfs/virtual-fs'
import {
  scrapeWithFirecrawl,
  searchWithFirecrawl,
  pickFirecrawlKey,
} from './firecrawl-client'
import { emulateShellCommands } from './shell-emulator'

export interface BrowserToolContext {
  vfs: VirtualFS
  firecrawlKeys: string[]
  firecrawlEndpoint: string
  onFileCreated: (path: string, content: string) => void
  onAskQuestion: (question: string, options: string[]) => Promise<string>
}

// ---------------------------------------------------------------------------
// Simple unified diff helper (line-by-line, no external library)
// ---------------------------------------------------------------------------
function simpleUnifiedDiff(
  aLines: string[],
  bLines: string[],
  aLabel: string,
  bLabel: string,
): string {
  const output: string[] = [`--- ${aLabel}`, `+++ ${bLabel}`]
  const maxLen = Math.max(aLines.length, bLines.length)
  let i = 0
  let j = 0
  while (i < maxLen || j < maxLen) {
    const aLine = i < aLines.length ? aLines[i] : undefined
    const bLine = j < bLines.length ? bLines[j] : undefined
    if (aLine === bLine) {
      output.push(` ${aLine ?? ''}`)
      i++
      j++
    } else if (aLine !== undefined && bLine !== undefined) {
      output.push(`-${aLine}`)
      output.push(`+${bLine}`)
      i++
      j++
    } else if (aLine !== undefined) {
      output.push(`-${aLine}`)
      i++
    } else if (bLine !== undefined) {
      output.push(`+${bLine ?? ''}`)
      j++
    } else {
      break
    }
  }
  return output.join('\n')
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
  let firecrawlCallCount = 0

  const vfsRead = createTool({
    name: 'vfs_read',
    description: 'Read one or more files from the virtual file system.',
    inputSchema: z.object({
      paths: z.array(z.string()).min(1).describe('File paths to read'),
    }),
    execute: async ({ paths }) => {
      const results: Record<string, string | null> = {}
      for (const path of paths) {
        results[path] = ctx.vfs.read(path)
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
    description: 'Show a simple unified diff between two files in the virtual file system.',
    inputSchema: z.object({
      pathA: z.string(),
      pathB: z.string(),
    }),
    execute: async ({ pathA, pathB }) => {
      const contentA = ctx.vfs.read(pathA)
      const contentB = ctx.vfs.read(pathB)
      if (contentA === null) return `Error: file not found: ${pathA}`
      if (contentB === null) return `Error: file not found: ${pathB}`
      const aLines = contentA.split('\n')
      const bLines = contentB.split('\n')
      return simpleUnifiedDiff(aLines, bLines, pathA, pathB)
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
      ctx.onFileCreated(dest, entry.content)
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
      const key = pickFirecrawlKey(ctx.firecrawlKeys, firecrawlCallCount++)
      const result = await scrapeWithFirecrawl(url, {
        endpoint: ctx.firecrawlEndpoint,
        apiKey: key,
      })
      return result
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
      allowedDomains: z.array(z.string()).optional(),
      blockedDomains: z.array(z.string()).optional(),
    }),
    execute: async ({ query, limit, allowedDomains, blockedDomains }) => {
      const key = pickFirecrawlKey(ctx.firecrawlKeys, firecrawlCallCount++)
      const results = await searchWithFirecrawl(
        query,
        { endpoint: ctx.firecrawlEndpoint, apiKey: key },
        { limit, allowedDomains, blockedDomains },
      )
      return results
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
      return emulateShellCommands(commands, {
        vfs: ctx.vfs,
        onFileCreated: ctx.onFileCreated,
      })
    },
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
    vfsSortUniq,
    vfsCat,
    vfsLs,
    vfsMvCp,
    fetchWebContent,
    searchWeb,
    askQuestion,
    runCommands,
  ]
}
