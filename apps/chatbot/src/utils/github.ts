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

/**
 * GitHub URL utilities for parsing and fetching content from GitHub repositories.
 * This module provides functions to detect GitHub URLs, parse them into API endpoints,
 * and fetch file/directory contents using the GitHub API.
 */



/**
 * GitHub URL information interface
 */
export interface GitHubUrlInfo {
  /** Type of GitHub URL: 'blob' (file), 'tree' (directory), 'repo' (repository root), or 'unknown' */
  type: 'blob' | 'tree' | 'repo' | 'unknown'
  /** GitHub API URL for fetching content */
  apiUrl: string
  /** Repository owner */
  owner?: string
  /** Repository name */
  repo?: string
  /** File path within repository */
  path?: string
  /** Branch name */
  branch?: string
}

/**
 * Checks if a URL is a GitHub URL
 *
 * @param url - The URL to check
 * @returns true if the URL is from github.com, false otherwise
 *
 * @example
 * ```typescript
 * isGitHubUrl('https://github.com/owner/repo') // true
 * isGitHubUrl('https://example.com/file.txt') // false
 * ```
 */
export function isGitHubUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname === 'github.com'
  } catch {
    return false
  }
}

/**
 * Parses a GitHub URL and returns information about the resource type and API endpoint
 *
 * @param url - GitHub URL to parse
 * @returns GitHubUrlInfo object containing type and API URL information
 *
 * @example
 * ```typescript
 * // File URL
 * parseGitHubUrl('https://github.com/owner/repo/blob/main/src/file.ts')
 * // Returns: { type: 'blob', apiUrl: 'https://api.github.com/repos/owner/repo/contents/src/file.ts?ref=main', ... }
 *
 * // Directory URL
 * parseGitHubUrl('https://github.com/owner/repo/tree/main/src')
 * // Returns: { type: 'tree', apiUrl: 'https://api.github.com/repos/owner/repo/contents/src?ref=main', ... }
 *
 * // Repository root URL
 * parseGitHubUrl('https://github.com/owner/repo')
 * // Returns: { type: 'repo', apiUrl: 'https://api.github.com/repos/owner/repo/contents', ... }
 * ```
 */
export function parseGitHubUrl(url: string): GitHubUrlInfo {
  try {
    const urlObj = new URL(url)
    const pathParts = urlObj.pathname.split('/').filter(p => p)

    if (pathParts.length < 2) {
      return { type: 'unknown', apiUrl: url }
    }

    const [owner, repo, type, branch, ...rest] = pathParts
    const path = rest.join('/')

    // Handle repository root URL
    if (pathParts.length === 2) {
      return {
        type: 'repo',
        apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents`,
        owner,
        repo,
        path: ''
      }
    }

    // Handle tree (directory) URLs
    if (type === 'tree') {
      return {
        type: 'tree',
        apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        owner,
        repo,
        path,
        branch
      }
    }

    // Handle blob (file) URLs
    if (type === 'blob') {
      return {
        type: 'blob',
        apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        owner,
        repo,
        path,
        branch
      }
    }

    return { type: 'unknown', apiUrl: url }
  } catch {
    return { type: 'unknown', apiUrl: url }
  }
}

/**
 * GitHub API file item interface
 */
export interface GitHubFileItem {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url?: string
  url?: string
}

/**
 * Fetches a single file content from GitHub API
 *
 * @param apiUrl - GitHub API URL for the file
 * @param filename - Name to use for the downloaded file
 * @returns Promise resolving to a File object containing the file content
 * @throws Error if the fetch fails or response is not OK
 *
 * @example
 * ```typescript
 * const file = await fetchGitHubFile(
 *   'https://api.github.com/repos/owner/repo/contents/file.ts?ref=main',
 *   'file.ts'
 * )
 * // file is a File object with the content
 * ```
 */
export async function fetchGitHubFile(apiUrl: string, filename: string): Promise<File> {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3.raw'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub file: ${response.status} ${response.statusText}`)
    }

    const content = await response.text()
    return new File([content], filename, { type: 'text/plain' })
  } catch (error) {
    console.error('Error fetching GitHub file:', error)
    throw error
  }
}

/**
 * Fetches all files from a GitHub directory using the GitHub API
 *
 * @param apiUrl - GitHub API URL for the directory
 * @returns Promise resolving to an array of File objects
 * @throws Error if the fetch fails or response is not OK
 *
 * @example
 * ```typescript
 * const files = await fetchGitHubDirectory(
 *   'https://api.github.com/repos/owner/repo/contents/src?ref=main'
 * )
 * // files is an array of File objects for each file in the directory
 * ```
 */
export async function fetchGitHubDirectory(apiUrl: string): Promise<File[]> {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub directory: ${response.status} ${response.statusText}`)
    }

    const items: GitHubFileItem[] = await response.json()
    const files: File[] = []

    for (const item of items) {
      if (item.type === 'file') {
        const fileUrl = item.download_url || item.url
        if (!fileUrl) {
          console.warn(`Skipping file ${item.name} - no download URL available`)
          continue
        }

        const fileResponse = await fetch(fileUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3.raw'
          }
        })

        if (fileResponse.ok) {
          const content = await fileResponse.text()
          const file = new File([content], item.name, { type: 'text/plain' })
          files.push(file)
        }
      }
    }

    return files
  } catch (error) {
    console.error('Error fetching GitHub directory:', error)
    throw error
  }
}
