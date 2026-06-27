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

const GH_API = 'https://api.github.com'
// Truncate file content at 50 KB — large files are rarely useful in full
const MAX_FILE_BYTES = 50_000

interface GitHubToolContext {
  githubToken?: string
}

function makeHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

async function ghFetch(url: string, token?: string): Promise<Response> {
  const res = await fetch(url, { headers: makeHeaders(token) })
  if (res.status === 403) {
    const remaining = res.headers.get('X-RateLimit-Remaining')
    if (remaining === '0') {
      const reset = res.headers.get('X-RateLimit-Reset')
      const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown'
      throw Object.assign(
        new Error(`GitHub rate limit exceeded. Resets at ${resetAt}. Connect your GitHub account to increase the limit to 5000 req/h.`),
        { rateLimited: true },
      )
    }
    const body = await res.text()
    throw new Error(`GitHub 403: ${body}`)
  }
  if (res.status === 404) throw new Error(`GitHub 404: resource not found at ${url}`)
  if (res.status === 422) {
    const body = await res.text()
    throw new Error(`GitHub 422 Unprocessable: ${body}`)
  }
  if (!res.ok) throw new Error(`GitHub API error ${res.status} ${res.statusText} for ${url}`)
  return res
}

/** Decode a base64 string (as returned by GitHub Contents API) to UTF-8 text. */
function decodeBase64Content(encoded: string): string {
  // GitHub pads with \n every 60 chars
  const raw = atob(encoded.replace(/\n/g, ''))
  // Convert latin1 bytes to UTF-8
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// biome-ignore lint/suspicious/noExplicitAny: GitHub API shapes are complex
type GHItem = Record<string, any>

export function createGitHubTool(ctx?: GitHubToolContext): AgentTool<any, any> {
  const token = ctx?.githubToken

  return createTool({
    name: 'github',
    description:
      'Explore GitHub repositories without cloning. Supports reading files, listing directories, ' +
      'getting the full file tree, searching code, viewing commits, issues, and pull requests. ' +
      'Works with public repos unauthenticated (60 req/h); add a GitHub token for 5000 req/h. ' +
      'Typical workflow: repo_info → full_tree → read_file for files of interest.',
    // Flat schema avoids oneOf branches with identical enum fields (e.g. `state`
    // in list_issues and list_prs), which the Anthropic API rejects with
    // "enum items must be unique" when it flattens oneOf for validation.
    inputSchema: z.object({
      action: z.enum([
        'repo_info', 'list_dir', 'read_file', 'full_tree',
        'search_code', 'list_commits', 'list_issues', 'list_prs', 'get_pr_diff',
      ]).describe(
        'repo_info: basic metadata. list_dir: directory listing. read_file: file contents. ' +
        'full_tree: full recursive file tree. search_code: code search. ' +
        'list_commits: commit history. list_issues: issues. list_prs: pull requests. ' +
        'get_pr_diff: PR unified diff.',
      ),
      owner: z.string().optional().describe('Repository owner (user or org)'),
      repo: z.string().optional().describe('Repository name'),
      path: z.string().optional().describe('File or directory path (empty = root for list_dir)'),
      ref: z.string().optional().describe('Branch, tag, or commit SHA (defaults to repo default branch)'),
      start_line: z.number().int().min(1).optional().describe('First line to return (1-based, read_file only)'),
      end_line: z.number().int().min(1).optional().describe('Last line to return inclusive (read_file only)'),
      max_entries: z.number().int().min(10).max(2000).optional().default(500)
        .describe('Max tree entries to return, default 500 (full_tree only)'),
      filter_ext: z.array(z.string()).optional()
        .describe('Only include files with these extensions, e.g. [".ts", ".tsx"] (full_tree only)'),
      query: z.string().optional().describe('Code search query, e.g. "useState" (search_code only)'),
      language: z.string().optional().describe('Filter by language, e.g. "typescript" (search_code only)'),
      state: z.enum(['open', 'closed', 'all']).optional().default('open')
        .describe('Issue/PR state filter (list_issues, list_prs)'),
      labels: z.string().optional().describe('Comma-separated label names to filter issues by (list_issues only)'),
      per_page: z.number().int().min(1).max(30).optional().default(10)
        .describe('Results per page (search_code, list_commits, list_issues, list_prs)'),
      pull_number: z.number().int().min(1).optional().describe('Pull request number (get_pr_diff only)'),
    }),
    timeoutMs: 20_000,
    // biome-ignore lint/suspicious/noExplicitAny: flat input schema, action dispatch handles field presence
    execute: async (input: any) => {
      try {
        switch (input.action) {
          // ── repo_info ─────────────────────────────────────────────────────
          case 'repo_info': {
            const res = await ghFetch(`${GH_API}/repos/${input.owner}/${input.repo}`, token)
            const d: GHItem = await res.json()
            return {
              full_name: d.full_name,
              description: d.description,
              default_branch: d.default_branch,
              language: d.language,
              topics: d.topics,
              stars: d.stargazers_count,
              forks: d.forks_count,
              open_issues: d.open_issues_count,
              license: d.license?.spdx_id ?? null,
              size_kb: d.size,
              homepage: d.homepage ?? null,
              created_at: d.created_at,
              updated_at: d.updated_at,
              pushed_at: d.pushed_at,
              visibility: d.visibility,
              archived: d.archived,
              fork: d.fork,
              parent: d.parent ? `${d.parent.full_name} (${d.parent.default_branch})` : null,
            }
          }

          // ── list_dir ──────────────────────────────────────────────────────
          case 'list_dir': {
            const ref = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : ''
            const path = input.path ? `/${input.path}` : ''
            const res = await ghFetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/contents${path}${ref}`,
              token,
            )
            const items: GHItem[] = await res.json()
            if (!Array.isArray(items)) {
              // It's a file, not a directory
              return { error: `"${input.path}" is a file, not a directory. Use action "read_file".` }
            }
            return items.map(item => ({
              name: item.name,
              path: item.path,
              type: item.type, // 'file' | 'dir' | 'symlink'
              size: item.type === 'file' ? item.size : undefined,
            }))
          }

          // ── read_file ─────────────────────────────────────────────────────
          case 'read_file': {
            const ref = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : ''
            const res = await ghFetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/contents/${input.path}${ref}`,
              token,
            )
            const data: GHItem = await res.json()

            if (Array.isArray(data)) {
              return { error: `"${input.path}" is a directory. Use action "list_dir".` }
            }

            if (data.type === 'symlink') {
              return { symlink_target: data.target, message: 'This path is a symlink.' }
            }

            if (data.size > 1_000_000) {
              // Files >1 MB: GitHub omits the content field; use download_url
              if (!data.download_url) {
                return { error: `File is too large (${data.size} bytes) and has no download URL.` }
              }
              const raw = await fetch(data.download_url)
              const text = await raw.text()
              const truncated = text.length > MAX_FILE_BYTES
              const slice = truncated ? text.slice(0, MAX_FILE_BYTES) : text
              const lines = slice.split('\n')
              const out = applyLineRange(lines, input.start_line, input.end_line)
              return {
                path: data.path,
                size: data.size,
                sha: data.sha,
                truncated,
                content: out.content,
                total_lines: out.totalLines,
                returned_lines: `${out.from}–${out.to}`,
              }
            }

            if (!data.content) {
              return { error: 'No content returned by GitHub API.' }
            }

            const decoded = decodeBase64Content(data.content as string)
            const truncated = decoded.length > MAX_FILE_BYTES
            const slice = truncated ? decoded.slice(0, MAX_FILE_BYTES) : decoded
            const lines = slice.split('\n')
            const out = applyLineRange(lines, input.start_line, input.end_line)
            return {
              path: data.path,
              size: data.size,
              sha: data.sha,
              encoding: 'utf-8',
              truncated: truncated || out.sliced,
              content: out.content,
              total_lines: out.totalLines,
              returned_lines: `${out.from}–${out.to}`,
            }
          }

          // ── full_tree ─────────────────────────────────────────────────────
          case 'full_tree': {
            // First resolve the SHA for the ref
            let treeSha: string
            const infoRes = await ghFetch(`${GH_API}/repos/${input.owner}/${input.repo}`, token)
            const repoInfo: GHItem = await infoRes.json()
            const branch = input.ref ?? repoInfo.default_branch

            const branchRes = await ghFetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/branches/${encodeURIComponent(branch)}`,
              token,
            )
            const branchData: GHItem = await branchRes.json()
            treeSha = branchData.commit.commit.tree.sha

            const treeRes = await ghFetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/git/trees/${treeSha}?recursive=1`,
              token,
            )
            const treeData: GHItem = await treeRes.json()
            const allEntries: GHItem[] = treeData.tree ?? []

            // Filter and truncate
            const filtered = (input.filter_ext && input.filter_ext.length > 0)
              ? allEntries.filter(e => {
                  if (e.type === 'tree') return false // directories not needed when filtering
                  const ext = '.' + (e.path as string).split('.').pop()
                  return (input.filter_ext as string[]).includes(ext)
                })
              : allEntries

            const maxEntries = input.max_entries ?? 500
            const truncated = filtered.length > maxEntries
            const shown = filtered.slice(0, maxEntries)

            return {
              ref: branch,
              tree_sha: treeSha,
              total_entries: filtered.length,
              truncated,
              entries: shown.map(e => ({
                path: e.path,
                type: e.type, // 'blob' | 'tree'
                size: e.type === 'blob' ? e.size : undefined,
              })),
              note: truncated
                ? `Tree truncated to first ${maxEntries}/${filtered.length} entries. Use filter_ext to narrow scope.`
                : undefined,
            }
          }

          // ── search_code ───────────────────────────────────────────────────
          case 'search_code': {
            if (!input.query) return { error: 'query is required for search_code' }
            let q = `${encodeURIComponent(input.query)}+repo:${input.owner}/${input.repo}`
            if (input.language) q += `+language:${encodeURIComponent(input.language)}`
            const perPage = input.per_page ?? 10
            const res = await ghFetch(
              `${GH_API}/search/code?q=${q}&per_page=${perPage}`,
              token,
            )
            const data: GHItem = await res.json()
            return {
              total_count: data.total_count,
              results: (data.items as GHItem[]).map(item => ({
                path: item.path,
                name: item.name,
                url: item.html_url,
                // text_matches are only present when Accept includes text-match, skip for now
              })),
            }
          }

          // ── list_commits ──────────────────────────────────────────────────
          case 'list_commits': {
            const params = new URLSearchParams()
            if (input.ref) params.set('sha', input.ref)
            if (input.path) params.set('path', input.path)
            params.set('per_page', String(input.per_page ?? 10))
            const res = await ghFetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/commits?${params}`,
              token,
            )
            const commits: GHItem[] = await res.json()
            return commits.map(c => ({
              sha: (c.sha as string).slice(0, 8),
              message: (c.commit.message as string).split('\n')[0], // subject line only
              author: c.commit.author.name,
              date: c.commit.author.date,
              url: c.html_url,
            }))
          }

          // ── list_issues ───────────────────────────────────────────────────
          case 'list_issues': {
            const params = new URLSearchParams({
              state: input.state ?? 'open',
              per_page: String(input.per_page ?? 10),
            })
            if (input.labels) params.set('labels', input.labels)
            const res = await ghFetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/issues?${params}`,
              token,
            )
            const issues: GHItem[] = await res.json()
            // GitHub issues endpoint returns both issues and PRs; filter out PRs
            return issues
              .filter(i => !i.pull_request)
              .map(i => ({
                number: i.number,
                title: i.title,
                state: i.state,
                labels: (i.labels as GHItem[]).map(l => l.name),
                author: i.user.login,
                created_at: i.created_at,
                updated_at: i.updated_at,
                comments: i.comments,
                url: i.html_url,
                body_preview: i.body ? (i.body as string).slice(0, 300) : null,
              }))
          }

          // ── list_prs ──────────────────────────────────────────────────────
          case 'list_prs': {
            const params = new URLSearchParams({
              state: input.state ?? 'open',
              per_page: String(input.per_page ?? 10),
            })
            const res = await ghFetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/pulls?${params}`,
              token,
            )
            const prs: GHItem[] = await res.json()
            return prs.map(pr => ({
              number: pr.number,
              title: pr.title,
              state: pr.state,
              draft: pr.draft,
              author: pr.user.login,
              base: pr.base.ref,
              head: pr.head.ref,
              created_at: pr.created_at,
              updated_at: pr.updated_at,
              comments: pr.comments,
              additions: pr.additions,
              deletions: pr.deletions,
              changed_files: pr.changed_files,
              url: pr.html_url,
              body_preview: pr.body ? (pr.body as string).slice(0, 300) : null,
            }))
          }

          // ── get_pr_diff ───────────────────────────────────────────────────
          case 'get_pr_diff': {
            const res = await fetch(
              `${GH_API}/repos/${input.owner}/${input.repo}/pulls/${input.pull_number}`,
              {
                headers: {
                  ...makeHeaders(token),
                  Accept: 'application/vnd.github.v3.diff',
                } as HeadersInit,
              },
            )
            if (!res.ok) throw new Error(`GitHub ${res.status} fetching PR diff`)
            const diff = await res.text()
            const truncated = diff.length > MAX_FILE_BYTES
            return {
              pull_number: input.pull_number,
              truncated,
              diff: truncated ? diff.slice(0, MAX_FILE_BYTES) + '\n[... diff truncated ...]' : diff,
            }
          }

          default:
            return { error: 'Unknown action' }
        }
      } catch (err) {
        if (err instanceof Error && (err as Error & { rateLimited?: boolean }).rateLimited) {
          return { error: err.message, rateLimited: true }
        }
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

// ── Line-range helper ──────────────────────────────────────────────────────────

interface LineRangeResult {
  content: string
  totalLines: number
  from: number
  to: number
  sliced: boolean
}

function applyLineRange(
  lines: string[],
  startLine?: number,
  endLine?: number,
): LineRangeResult {
  const total = lines.length
  const from = startLine ?? 1
  const to = endLine ?? total
  if (from === 1 && to === total) {
    return { content: lines.join('\n'), totalLines: total, from, to, sliced: false }
  }
  const sliced = lines.slice(from - 1, to)
  return {
    content: sliced.join('\n'),
    totalLines: total,
    from,
    to: Math.min(to, total),
    sliced: true,
  }
}
