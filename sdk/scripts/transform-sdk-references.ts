/**
 * Copyright (c) 2026 Ronan LE MEILLAT - SCTG Development
 * License: AGPL-3.0-or-later
 *
 * transform-sdk-references.ts — Pure text transformation for SDK package references
 *
 * This module provides a pure function that transforms @cline/ package references
 * to @sctg/ format without any file system side effects. It's designed for use
 * in export scripts that need to generate content with transformed references
 * without modifying local files.
 */

/**
 * Transforms @cline/ package references to @sctg/ format in text content.
 * This is a pure function with no side effects - it only transforms the input string.
 *
 * @param content - The text content to transform
 * @returns Transformed content with package references updated
 */
export function transformSdkReferences(content: string): string {
	// Get repository information for setting package repository URLs
	const githubRepository = process.env.GITHUB_REPOSITORY || "TEA-ching/cline";
	const githubServerUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
	const repositoryUrl = githubRepository
		? `${githubServerUrl}/${githubRepository}`
		: "https://github.com/TEA-ching/cline";

	return content
		.replace(/@cline\/([a-zA-Z][a-zA-Z0-9-]*)/g, (_, packageName: string) => {
			if (packageName.startsWith("cline-")) {
				return `@sctg/${packageName}`;
			}
			return `@sctg/cline-${packageName}`;
		})
		.replace(/docs\.cline\.bot/g, "docs.ai-ml.pp.ua")
		.replace(
			/https:\/\/github\.com\/cline\/cline\.git/g,
			`${repositoryUrl}.git`,
		)
		.replace(/https:\/\/github\.com\/cline\/cline/g, `${repositoryUrl}`)
		.replace(
			/https:\/\/marketplace\.visualstudio\.com\/items\?itemName=saoudrizwan\.claude-dev/g,
			`${repositoryUrl}/releases`,
		)
		.replace(
			/https:\/\/github\.com\/TEA-ching\/cline\/releases/g,
			"https://github.com/TEA-ching/cline/releases",
		)
		.replace(
			/npx skills add cline\/sdk-skill/g,
			"npx skills add https://github.com/TEA-ching/cline/tree/keypool-docs-deploy/.agents/skills/cline-sdk",
		);
}
