// KeypoolLive — SessionKeyManager: per-session sticky key assignment + rotation
// © 2026 Ronan LE MEILLAT — MIT License

import { Logger } from "@/shared/services/Logger"
import { loadAiVault } from "./AiVault"
import { markKeyAsFailed, resolveNextApiConfig } from "./KeyPool"
import type { AiVaultConfig, ResolvedApiConfig } from "./types"

/**
 * Maps a unique session-provider-model combination to its assigned API configuration.
 * This ensures "stickiness" within a session: once a key is picked for a task,
 * it stays the same unless rotated.
 */
const sessionKeyMap = new Map<string, ResolvedApiConfig>()

/**
 * A simpler cache mapping session+provider to the raw API key string.
 * Used for quick lookups when only the key is needed.
 */
const sessionKeyCache = new Map<string, string>()

/** The URL of the remote AI vault. Must be configured before use. */
let vaultUrl: string | null = null

/**
 * Configures the manager with the vault URL.
 * This must be called at extension startup.
 *
 * @param url - Remote URL for the encrypted vault.
 */
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
/**
 * Forces a change of the API key for a given session.
 *
 * If the reason is "key_failure", the currently assigned key is marked as unhealthy
 * in the global KeyPool to prevent it from being picked again immediately.
 *
 * @param sessionId - Unique identifier for the current task/session.
 * @param providerName - The AI provider.
 * @param modelId - Optional model identifier.
 * @param reason - Why rotation is requested.
 * @returns The new resolved API configuration.
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

/**
 * Removes all assigned keys and cached info associated with a session.
 * Should be called when a task is completed or deleted to free memory.
 *
 * @param sessionId - The session to clean up.
 */
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

/**
 * Retrieves metadata about the key currently assigned to a session.
 * Useful for UI components that want to show which key is active (e.g., in the dashboard).
 *
 * @param sessionId - The session identifier.
 * @returns Metadata object including provider, owner, and a hint of the key.
 */
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

/**
 * Quickly retrieves the active API key string for a session without triggering
 * any resolution logic or vault loads.
 *
 * @param sessionId - The session identifier.
 * @param providerName - The AI provider.
 * @returns The API key string if cached, or null.
 */
export function getCachedSessionKey(sessionId: string, providerName: string): string | null {
	return sessionKeyCache.get(`${sessionId}:${providerName}`) ?? null
}
