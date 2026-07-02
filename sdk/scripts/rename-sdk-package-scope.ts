#!/usr/bin/env node
/**
 * This script renames all @cline/ package references to @sctg/cline-*
 * for publishing to the SCTG npm registry.
 * This ensures proper scoping and namespace isolation for the preview release.
 */

import fs from 'node:fs';
import path from 'node:path';

interface PackageJson {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  repository?: string | { type: string; url: string }
  [key: string]: unknown
}

interface FileEntry {
  isDirectory(): boolean
  isFile(): boolean
  name: string
}

const root: string = process.cwd()
const sdkDir: string = path.join(root, 'sdk')
const docsDir: string = path.join(root, 'docs')
const agentsDir: string = path.join(root, '.agents')
const chatbotDir: string = path.join(root, 'apps', 'chatbot')
const ignoredDirs: Set<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  '.next',
])

/**
 * Maps @cline/ package names to @sctg/ format
 * @param name - The original package name
 * @returns The mapped package name with SCTG scope
 */
function mapClineName(name: unknown): string {
  if (typeof name !== 'string') return String(name)
  if (!name.startsWith('@cline/')) return name

  // Extract the package name after @cline/
  const packageName = name.slice('@cline/'.length)

  // Avoid double "cline" in the name (e.g., @cline/cline-hub-webview -> @sctg/cline-hub-webview)
  if (packageName.startsWith('cline-')) {
    return `@sctg/${packageName}`
  } else {
    return `@sctg/cline-${packageName}`
  }
}

/**
 * Recursively finds all files with a specific extension in a directory
 * @param dir - The directory to search
 * @param extension - The file extension to find
 * @param acc - Accumulator for found files
 * @returns Array of file paths matching the extension
 */
function findFilesByExtension(dir: string, extension: string, acc: string[] = []): string[] {
  let entries: FileEntry[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    console.warn(`Could not read directory ${dir}:`, (err as Error).message)
    return acc
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        findFilesByExtension(path.join(dir, entry.name), extension, acc)
      }
      continue
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      acc.push(path.join(dir, entry.name))
    }
  }
  return acc
}

/**
 * Recursively finds all files in a directory (excluding ignored directories)
 * @param dir - The directory to search
 * @param acc - Accumulator for found files
 * @returns Array of all file paths found
 */
function findAllFiles(dir: string, acc: string[] = []): string[] {
  let entries: FileEntry[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    console.warn(`Could not read directory ${dir}:`, (err as Error).message)
    return acc
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        findAllFiles(path.join(dir, entry.name), acc)
      }
      continue
    }
    if (entry.isFile()) {
      acc.push(path.join(dir, entry.name))
    }
  }
  return acc
}

/**
 * Replaces all @cline/ package references with @sctg/cline-* equivalents
 * - also updates any docs.ai-ml.pp.ua references to docs.ai-ml.pp.ua
 * - also updates any https://github.com/TEA-ching/cline.git to the repository URL for trusted publishing provenance
 * @param content - The file content to process
 * @returns Content with package references updated
 */
export function replaceClineReferences(content: string): string {
  // Get repository information for setting package repository URLs
  const githubRepository = process.env.GITHUB_REPOSITORY || 'TEA-ching/cline'
  const githubServerUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
  const repositoryUrl = githubRepository
    ? `${githubServerUrl}/${githubRepository}`
    : 'https://github.com/TEA-ching/cline'

  return content
    .replace(/@cline\/([a-zA-Z][a-zA-Z0-9-]*)/g, (_, packageName: string) => {
      if (packageName.startsWith('cline-')) {
        return `@sctg/${packageName}`
      }
      return `@sctg/cline-${packageName}`
    })
    .replace(/docs\.cline\.bot/g, 'docs.ai-ml.pp.ua')
    .replace(/https:\/\/github\.com\/cline\/cline\.git/g, `${repositoryUrl}.git`)
    .replace(/https:\/\/github\.com\/cline\/cline/g, `${repositoryUrl}`)
    .replace(/https:\/\/marketplace\.visualstudio\.com\/items\?itemName=saoudrizwan\.claude-dev/g, `${repositoryUrl}/releases`)
    .replace(/https:\/\/github\.com\/TEA-ching\/cline\/releases/g, 'https://github.com/TEA-ching/cline/releases')
    .replace(/npx skills add cline\/sdk-skill/g, 'npx skills add https://github.com/TEA-ching/cline/tree/keypool-docs-deploy/.agents/skills/cline-sdk')
}

// List of package.json dependency fields to process
const keysToRewrite: string[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

// Main execution
void (async (): Promise<void> => {
  try {
    // Update package.json files - this is the primary transformation
    const packageJsonFiles = findFilesByExtension(root, 'package.json')
    let touched = 0

    for (const pkgPath of packageJsonFiles) {
      try {
        const fileContent = fs.readFileSync(pkgPath, 'utf8')
        const pkg: PackageJson = JSON.parse(fileContent)

        // Update package name if it's a @cline/ package
        const oldName = pkg.name
        const mappedName = mapClineName(oldName)
        if (mappedName !== oldName && typeof oldName === 'string') {
          pkg.name = mappedName
        }

        // Update all dependency fields
        for (const key of keysToRewrite) {
          if (!pkg[key] || typeof pkg[key] !== 'object' || Array.isArray(pkg[key])) {
            continue
          }
          const rewritten: Record<string, string> = {}
          for (const [depName, depVersion] of Object.entries(pkg[key] as Record<string, string>)) {
            rewritten[mapClineName(depName)] = depVersion as string
          }
          pkg[key] = rewritten
        }

        // Set repository URL for trusted publishing provenance
        const githubRepository = process.env.GITHUB_REPOSITORY
        const githubServerUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
        const repositoryUrl = githubRepository
          ? `${githubServerUrl}/${githubRepository}`
          : 'https://github.com/TEA-ching/cline'

        if (repositoryUrl) {
          if (typeof pkg.repository === 'string') {
            pkg.repository = repositoryUrl
          } else if (pkg.repository && typeof pkg.repository === 'object') {
            pkg.repository.url = repositoryUrl
          } else {
            pkg.repository = {
              type: 'git',
              url: repositoryUrl,
            }
          }
        }

        // Write updated package.json with consistent formatting
        const serialized = replaceClineReferences(JSON.stringify(pkg, null, '\t'))
        fs.writeFileSync(pkgPath, `${serialized}\n`)
        touched++
      } catch (err) {
        console.error(`Error processing ${pkgPath}:`, (err as Error).message)
      }
    }

    // apps/{cli,cline-hub,examples} were moved from sdk/apps/ to apps/ at root.
    // They must be scanned for @cline/ refs just like sdk/ was before.
    // apps/vscode/ is intentionally excluded: the extension source keeps @cline/* as-is.
    // apps/chatbot is included: it's published as @sctg/cline-chatbot and its source
    // imports @cline/agents|llms|shared, which must become @sctg/cline-* at publish time.
    const appsCliDir = path.join(root, 'apps/cli')
    const appsClineHubDir = path.join(root, 'apps/cline-hub')
    const appsExamplesDir = path.join(root, 'apps/examples')

    // Update README.md files to ensure documentation references correct package names
    const readmeFiles: string[] = [
      ...findFilesByExtension(sdkDir, 'README.md'),
      ...(fs.existsSync(appsCliDir) ? findFilesByExtension(appsCliDir, 'README.md') : []),
      ...(fs.existsSync(appsClineHubDir) ? findFilesByExtension(appsClineHubDir, 'README.md') : []),
      ...(fs.existsSync(appsExamplesDir) ? findFilesByExtension(appsExamplesDir, 'README.md') : []),
      ...(fs.existsSync(chatbotDir) ? findFilesByExtension(chatbotDir, 'README.md') : [])
    ]

    for (const readmePath of readmeFiles) {
      try {
        let content = fs.readFileSync(readmePath, 'utf8')
        const originalContent = content
        content = replaceClineReferences(content)

        if (content !== originalContent) {
          fs.writeFileSync(readmePath, content)
          console.log(`Updated package references in ${readmePath}`)
        }
      } catch (err) {
        console.error(`Error processing ${readmePath}:`, (err as Error).message)
      }
    }

    // Update all other files (source code, config files, etc.) to ensure consistency
    const allFiles: string[] = [
      ...findAllFiles(sdkDir),
      ...findAllFiles(docsDir),
      ...findAllFiles(agentsDir),
      ...(fs.existsSync(appsCliDir) ? findAllFiles(appsCliDir) : []),
      ...(fs.existsSync(appsClineHubDir) ? findAllFiles(appsClineHubDir) : []),
      ...(fs.existsSync(appsExamplesDir) ? findAllFiles(appsExamplesDir) : []),
      ...(fs.existsSync(chatbotDir) ? findAllFiles(chatbotDir) : [])
    ]

    for (const filePath of allFiles) {
      // Skip package.json and README.md files as they were already processed
      if (filePath.endsWith('package.json') || filePath.endsWith('README.md')) {
        continue
      }

      try {
        let content = fs.readFileSync(filePath, 'utf8')
        const originalContent = content
        content = replaceClineReferences(content)

        if (content !== originalContent) {
          fs.writeFileSync(filePath, content)
          console.log(`Updated package references in ${filePath}`)
        }
      } catch (err) {
        console.error(`Error processing ${filePath}:`, (err as Error).message)
      }
    }

    // Log summary of changes made
    console.log(`Rewrote ${touched} file(s): @cline/* -> @sctg/cline-*`)
    const githubRepository = process.env.GITHUB_REPOSITORY
    const githubServerUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
    const repositoryUrl = githubRepository
      ? `${githubServerUrl}/${githubRepository}`
      : 'https://github.com/TEA-ching/cline'

    if (repositoryUrl) {
      console.log(`Set repository.url to ${repositoryUrl} for trusted publishing provenance`)
    }
    console.log('Updated @cline/ package references in all repository files')

  } catch (err) {
    console.error('Fatal error in script execution:', (err as Error).message)
    process.exit(1)
  }
})()
