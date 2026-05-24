// KeypoolLive — SessionKeyManager: per-session sticky key assignment + rotation
// © 2026 Ronan LE MEILLAT — MIT License

import { Logger } from "@/shared/services/Logger"
import { loadAiVault } from "./AiVault"
import { markKeyAsFailed, resolveNextApiConfig } from "./KeyPool"
import type { AiVaultConfig, ResolvedApiConfig } from "./types"

const sessionKeyMap = new Map<string, ResolvedApiConfig>()
const sessionKeyCache = new Map<string, string>()

let vaultUrl: string | null = null

export function configureSessionKeyManager(url: string): void {
	vaultUrl = url
}

/**
 * Returns the sticky API config for session+provider+model.
 * Assigns a new key if none is assigned yet.
 */
export async function getSessionApiConfig(
	sessionId: string,
	providerName: string,
	modelId?: string,
): Promise<ResolvedApiConfig | null> {
	const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`
	const existing = sessionKeyMap.get(sessionKey)
	if (existing) return existing

	if (!vaultUrl) {
		throw new Error("[KeypoolLive] SessionKeyManager not configured: call configureSessionKeyManager(url) first")
	}

	let vault: AiVaultConfig
	try {
		vault = await loadAiVault(vaultUrl)
	} catch (e) {
		Logger.error("[KeypoolLive] Failed to load vault:", e)
		return null
	}

	const resolved = resolveNextApiConfig(vault, providerName, modelId)
	if (!resolved) return null

	sessionKeyMap.set(sessionKey, resolved)
	sessionKeyCache.set(`${sessionId}:${providerName}`, resolved.apiKey)
	return resolved
}

/**
 * Forces rotation: if reason is "key_failure", marks current key as unhealthy.
 */
export async function rotateSessionKey(
	sessionId: string,
	providerName: string,
	modelId?: string,
	reason: "user_request" | "key_failure" = "user_request",
): Promise<ResolvedApiConfig | null> {
	const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`
	const current = sessionKeyMap.get(sessionKey)

	if (reason === "key_failure" && current) {
		markKeyAsFailed(providerName, current.apiKey)
	}

	// Remove the current session key to force re-resolution
	sessionKeyMap.delete(sessionKey)
	sessionKeyCache.delete(`${sessionId}:${providerName}`)

	return getSessionApiConfig(sessionId, providerName, modelId)
}

export function cleanupSession(sessionId: string): void {
	for (const key of [...sessionKeyMap.keys()]) {
		if (key.startsWith(`${sessionId}:`)) {
			sessionKeyMap.delete(key)
		}
	}
	for (const key of [...sessionKeyCache.keys()]) {
		if (key.startsWith(`${sessionId}:`)) {
			sessionKeyCache.delete(key)
		}
	}
}

export function getSessionKeyInfo(
	sessionId: string,
): { providerName: string; keyOwner: string; keyHint: string; modelId: string } | null {
	for (const [compoundKey, config] of sessionKeyMap.entries()) {
		if (compoundKey.startsWith(`${sessionId}:`)) {
			return {
				providerName: config.providerName,
				keyOwner: config.keyOwner,
				keyHint: `...${config.apiKey.slice(-8)}`,
				modelId: config.model.id,
			}
		}
	}
	return null
}

export function getCachedSessionKey(sessionId: string, providerName: string): string | null {
	return sessionKeyCache.get(`${sessionId}:${providerName}`) ?? null
}
