// KeypoolLive — SessionKeyManager: per-session sticky key assignment + rotation
// © 2026 Ronan LE MEILLAT — MIT License

/**
 * SessionKeyManager.ts provides the core key management functionality for Cline's KeypoolLive system.
 * It implements per-session sticky key assignment and rotation, ensuring that AI API keys remain
 * consistent throughout a task session while providing mechanisms for key rotation and cleanup.
 *
 * The module maintains two primary data structures:
 * - sessionKeyMap: Maps unique session-provider-model combinations to ResolvedApiConfig objects,
 *   ensuring "stickiness" where the same key is reused for a given session unless explicitly rotated.
 * - sessionKeyCache: A simplified cache mapping session+provider to raw API key strings for quick lookups.
 *
 * Key Features:
 *   - Sticky Key Assignment: Once a key is assigned to a session, it persists for that session's
 *     lifetime, avoiding unnecessary key changes during ongoing interactions.
 *   - Key Rotation: Provides controlled rotation mechanisms that can mark failed keys as unhealthy
 *     in the global KeyPool, preventing immediate reuse across sessions.
 *   - Session Lifecycle Management: Offers cleanup functions to remove all session-specific data,
 *     preventing memory leaks during long-running workflows.
 *   - Metadata Retrieval: Exposes functions to query current key assignments and metadata for UI
 *     components, enabling real-time display of active API configurations.
 *   - Configuration Management: Requires explicit initialization with a vault URL before use,
 *     ensuring proper setup before key operations.
 *
 * The manager integrates with other KeypoolLive components:
 *   - AiVault: Loads encrypted key vault data containing available API keys and configurations.
 *   - KeyPool: Accesses persistent state for round-robin key selection and failure tracking.
 *   - Logger: Provides error logging and monitoring for vault loading failures.
 *
 * Usage Pattern:
 *   1. Configure the manager with vault URL at extension startup.
 *   2. Request API config via getSessionApiConfig(sessionId, providerName, modelId).
 *   3. The system returns either existing sticky config or assigns new key from vault.
 *   4. Rotate keys using rotateSessionKey() when needed (user request or failure).
 *   5. Clean up session data when tasks complete using cleanupSession().
 */

import { Logger } from "@/shared/services/Logger";
import { loadAiVault } from "./AiVault";
import { resolveNextApiConfig } from "./KeyPool";
import type { AiVaultConfig, ResolvedApiConfig } from "./types";

/**
 * Maps a unique session-provider-model combination to its assigned API configuration.
 * This ensures "stickiness" within a session: once a key is picked for a task,
 * it stays the same unless rotated.
 */
const sessionKeyMap = new Map<string, ResolvedApiConfig>();

/**
 * A simpler cache mapping session+provider to the raw API key string.
 * Used for quick lookups when only the key is needed.
 */
const sessionKeyCache = new Map<string, string>();

/** The URL of the remote AI vault. Must be configured before use. */
let vaultUrl: string | null = null;

/**
 * Configures the manager with the vault URL.
 * This must be called at extension startup.
 *
 * @param url - Remote URL for the encrypted vault.
 */
export function configureSessionKeyManager(url: string): void {
	vaultUrl = url;
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
	// First, check if we've already assigned a key to this specific session/provider/model combo.
	const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;
	const existing = sessionKeyMap.get(sessionKey);
	if (existing) return existing;

	if (!vaultUrl) {
		throw new Error(
			"[KeypoolLive] SessionKeyManager not configured: call configureSessionKeyManager(url) first",
		);
	}

	// Load persistent state for round-robin indexes and key statuses
	const { loadPersistentStateOnce } = await import("./KeyPool");
	await loadPersistentStateOnce();

	// Load the vault (this uses internal caching to avoid redundant network hits).
	let vault: AiVaultConfig;
	try {
		vault = await loadAiVault(vaultUrl);
	} catch (e) {
		Logger.error("[KeypoolLive] Failed to load vault:", e);
		return null;
	}

	// Resolve the next available key from the pool.
	const resolved = await resolveNextApiConfig(vault, providerName, modelId);
	if (!resolved) return null;

	// Store the resolved config in both our detailed map and our simplified key cache.
	sessionKeyMap.set(sessionKey, resolved);
	sessionKeyCache.set(`${sessionId}:${providerName}`, resolved.apiKey);
	return resolved;
}

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
	const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;
	const current = sessionKeyMap.get(sessionKey);

	// If a key failed, we notify the global KeyPool so it can mark it as unhealthy
	// and put it on cooldown for all sessions.
	if (reason === "key_failure" && current) {
		const { markKeyAsFailed } = await import("./KeyPool");
		await markKeyAsFailed(providerName, current.apiKey);
	}

	// By deleting the current assignment, the next call to getSessionApiConfig
	// will be forced to pick a new (and hopefully healthy) key from the vault.
	sessionKeyMap.delete(sessionKey);
	sessionKeyCache.delete(`${sessionId}:${providerName}`);

	// Load persistent state for round-robin indexes and key statuses
	const { loadPersistentStateOnce } = await import("./KeyPool");
	await loadPersistentStateOnce();

	return getSessionApiConfig(sessionId, providerName, modelId);
}

/**
 * Removes all assigned keys and cached info associated with a session.
 * Should be called when a task is completed or deleted to free memory.
 *
 * @param sessionId - The session to clean up.
 */
export function cleanupSession(sessionId: string): void {
	// We iterate over the keys of our maps and delete anything belonging to the target sessionId.
	// This prevents memory leaks as users start and finish many tasks.
	for (const key of [...sessionKeyMap.keys()]) {
		if (key.startsWith(`${sessionId}:`)) {
			sessionKeyMap.delete(key);
		}
	}
	for (const key of [...sessionKeyCache.keys()]) {
		if (key.startsWith(`${sessionId}:`)) {
			sessionKeyCache.delete(key);
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
export function getSessionKeyInfo(sessionId: string): {
	providerName: string;
	keyOwner: string;
	keyHint: string;
	modelId: string;
} | null {
	for (const [compoundKey, config] of sessionKeyMap.entries()) {
		if (compoundKey.startsWith(`${sessionId}:`)) {
			return {
				providerName: config.providerName,
				keyOwner: config.keyOwner,
				keyHint: `***${config.apiKey.slice(-8)}`,
				modelId: config.model.id,
			};
		}
	}
	return null;
}

/**
 * Quickly retrieves the active API key string for a session without triggering
 * any resolution logic or vault loads.
 *
 * @param sessionId - The session identifier.
 * @param providerName - The AI provider.
 * @returns The API key string if cached, or null.
 */
export function getCachedSessionKey(
	sessionId: string,
	providerName: string,
): string | null {
	return sessionKeyCache.get(`${sessionId}:${providerName}`) ?? null;
}
