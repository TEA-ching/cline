// KeypoolLive — handler: keypoolCheckUpdate
// © 2026 Ronan LE MEILLAT — MIT License

import { EmptyRequest } from "@shared/proto/cline/common"
import { KeypoolCheckUpdateResponse } from "@shared/proto/cline/models"
import { ExtensionRegistryInfo } from "@/registry"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { buildDate } from "@/utils/build-date"
import type { Controller } from ".."

const GITHUB_OWNER = "TEA-ching"
const GITHUB_REPO = "cline"

interface GitHubAsset {
	name: string
	browser_download_url: string
}

interface GitHubRelease {
	tag_name: string
	published_at: string
	prerelease: boolean
	assets: GitHubAsset[]
}

function platformAssetPattern(): { platform: string; arch: string } {
	const platform = process.platform // darwin, win32, linux
	const arch = process.arch // arm64, x64, ia32

	// Normalize arch to match asset naming convention
	const normalizedArch = arch === "ia32" ? "x86" : arch

	return { platform, arch: normalizedArch }
}

function findBestVsixAsset(assets: GitHubAsset[]): GitHubAsset | undefined {
	const { platform, arch } = platformAssetPattern()
	const vsixAssets = assets.filter((a) => a.name.endsWith(".vsix"))

	// Try exact platform + arch match first
	const exact = vsixAssets.find((a) => a.name.includes(platform) && a.name.includes(arch))
	if (exact) return exact

	// Try platform-only match
	const platformOnly = vsixAssets.find((a) => a.name.includes(platform))
	if (platformOnly) return platformOnly

	// Fallback: first available VSIX (universal build)
	return vsixAssets[0]
}

function extractVersion(tagName: string): string {
	// Tags are like "preview/1.2.3" — strip the prefix
	return tagName.replace(/^preview\//, "")
}

/**
 * Extracts the build date from a GitHub release tag name to an ISO date string.
 * Tags are expected to be in the format "preview/YYYY-MM-DDTHH-MM-SSZ".
 * @param tagName 
 * @returns ISO date string or null if the tag format is invalid
 */
function extractBuildDate(tagName: string): string | null {
	// Tags are like "preview/2026-06-17T11-23-05Z" — extract the date part and convert to ISO format
	// We capture the date and time parts separately to avoid offset calculation issues
	const match = tagName.match(/^preview\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}Z)$/)
	if (match) {
		// Reconstruct with colons: "2026-06-17T11:23:05Z"
		return `${match[1]}T${match[2]}:${match[3]}:${match[4]}`
	}
	return null
}

export async function keypoolCheckUpdate(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<KeypoolCheckUpdateResponse> {
	try {
		const currentVersion = ExtensionRegistryInfo.version

		const response = await fetch(
			`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`,
			{ headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } },
		)

		if (!response.ok) {
			return KeypoolCheckUpdateResponse.create({
				currentVersion,
				error: `GitHub API error: ${response.status} ${response.statusText}`,
			})
		}

		const releases = (await response.json()) as GitHubRelease[]

		const previewReleases = releases
			.filter((r) => r.prerelease && r.tag_name.startsWith("preview/"))
			.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())

		if (previewReleases.length === 0) {
			return KeypoolCheckUpdateResponse.create({
				currentVersion,
				latestVersion: currentVersion,
				updateAvailable: false,
			})
		}

		const latest = previewReleases[0]
		const latestVersion = extractVersion(latest.tag_name)
		const vsixAsset = findBestVsixAsset(latest.assets)

		if (!vsixAsset) {
			return KeypoolCheckUpdateResponse.create({
				currentVersion,
				latestVersion,
				updateAvailable: false,
				tagName: latest.tag_name,
				publishedAt: latest.published_at,
				error: "No VSIX asset found for this platform in the latest release",
			})
		}

		// BuildDate-based version detection
		let updateAvailable = false

		// First check if versions are different
		if (latestVersion !== currentVersion) {
			Logger.info(`[keypoolCheckUpdate] Update available: current: ${currentVersion}, latest: ${latestVersion}`)
			updateAvailable = true
		}

		const tagBuildDate = extractBuildDate(latest.tag_name)
		Logger.info(`[keypoolCheckUpdate] Current build date: ${buildDate.toISOString()}, Latest release build date (extracted tag): ${tagBuildDate}`)

		const tagBuildDateObj = tagBuildDate ? new Date(tagBuildDate) : null
		Logger.info(`[keypoolCheckUpdate] Parsed latest release build date: ${tagBuildDateObj?.toISOString()}`)

		// If current build is the same or newer than the release, no update needed
		// Only compare if we successfully parsed the tag build date
		if (tagBuildDateObj && buildDate >= tagBuildDateObj) {
			Logger.info(`[keypoolCheckUpdate] Current build date (${buildDate.toISOString()}) is the same or newer than the latest release build date (${tagBuildDateObj?.toISOString()}). Full tag: ${latest.tag_name}. No update needed.`)
			updateAvailable = false
		}

		Logger.info(`[keypoolCheckUpdate] Current version: ${currentVersion}, Latest version: ${latestVersion}, Update available: ${updateAvailable}, Build date: ${buildDate}, Full tag: ${latest.tag_name}, Published  build date: ${tagBuildDateObj?.toISOString()}, VSIX asset: ${vsixAsset.name}`)
		return KeypoolCheckUpdateResponse.create({
			currentVersion,
			latestVersion,
			updateAvailable,
			downloadUrl: vsixAsset.browser_download_url,
			assetName: vsixAsset.name,
			tagName: latest.tag_name,
			publishedAt: latest.published_at,
		})
	} catch (err) {
		Logger.error("[keypoolCheckUpdate] Failed to check for updates:", err)
		return KeypoolCheckUpdateResponse.create({
			currentVersion: ExtensionRegistryInfo.version,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}
