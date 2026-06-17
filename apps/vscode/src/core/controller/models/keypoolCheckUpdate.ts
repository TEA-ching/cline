// KeypoolLive — handler: keypoolCheckUpdate
// © 2026 Ronan LE MEILLAT — MIT License

import { EmptyRequest } from "@shared/proto/cline/common"
import { KeypoolCheckUpdateResponse } from "@shared/proto/cline/models"
import { ExtensionRegistryInfo } from "@/registry"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
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

export async function keypoolCheckUpdate(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<KeypoolCheckUpdateResponse> {
	try {
		const buildDate: string = "dirty" ;// Injected at build time
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
		updateAvailable = true
	}

	// If buildDate is not "dirty", compare with release published date
	if (buildDate !== "dirty") {
		const buildDateObj = new Date(buildDate)
		const publishedAtObj = new Date(latest.published_at)

		// If current build is the same or newer than the release, no update needed
		if (buildDateObj >= publishedAtObj) {
			updateAvailable = false
		}
	}

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
