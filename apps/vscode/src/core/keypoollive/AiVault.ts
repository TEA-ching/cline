/**
 * KeypoolLive — AiVault: fetch + AES-256-CBC decrypt vault; 5-min cache
 * © 2026 Ronan LE MEILLAT — MIT License
 *
 * AiVault provides a caching layer for AI configuration data retrieved from KeypoolLive.
 * It fetches encrypted vault data from a remote URL, decrypts it using AES-256-CBC with
 * PBKDF2 key derivation (OpenSSL compatible format), transforms the raw configuration
 * into an extension-friendly structure, and maintains a 5-minute in-memory cache to
 * avoid repeated network calls and expensive cryptographic operations.
 *
 * Key features:
 *   - In-memory cache with 5-minute TTL to minimize redundant fetches
 *   - AES-256-CBC decryption compatible with OpenSSL's `enc` command
 *   - PBKDF2-SHA256 key derivation with 100,000 iterations for security
 *   - Transformation of raw vault JSON into typed provider/model structures
 *   - Synchronous model lookup for UI components before task execution
 *   - Cache invalidation method to force fresh data retrieval
 *   - Error handling for network failures, invalid formats, and missing secrets
 */

import { fetch } from "@/shared/net";
import type { AiConfig, AiVaultConfig, VaultCrawler } from "./types";

/**
 * In-memory cache structure for the AI Vault configuration.
 * Stores the parsed configuration and the timestamp of when it was fetched.
 * This helps avoid redundant network requests and expensive decryption operations.
 */
interface VaultCache {
	/** The transformed vault configuration available for use by the extension. */
	config: AiVaultConfig;
	/** Timestamp (ms) when the vault was last successfully fetched and decrypted. */
	fetchedAt: number;
}

/**
 * Cache expiration time (Time To Live). Defaults to 5 minutes.
 * Prevents frequent network requests by reusing the decrypted vault.
 * After this period, the next request will trigger a fresh fetch and decryption.
 */
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Global singleton instance of the vault cache.
 * Shared across all parts of the extension that require vault information.
 */
let vaultCache: VaultCache | null = null;

/**
 * Decrypts a vault file encrypted with OpenSSL AES-256-CBC.
 * Compatible with the following OpenSSL command:
 *   openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt -in ai.json -out ai.json.enc -pass pass:"SECRET"
 *
 * OpenSSL format details:
 * - The base64-encoded ciphertext starts with "Salted__" magic bytes (8 bytes).
 * - Followed by 8 bytes of salt.
 * - Remaining bytes are the actual ciphertext.
 * - Key (32 bytes) and IV (16 bytes) are derived via PBKDF2-SHA256 with 100,000 iterations.
 *
 * @param base64Ciphertext - The base64 encoded string from the encrypted vault file.
 * @param password - The decryption password (usually from KEYPOOL_LIVE_SECRET).
 * @returns The parsed AiConfig object.
 * @throws {Error} If the vault format is invalid or decryption fails.
 */
export async function decryptAiConfig(
	base64Ciphertext: string,
	password: string,
): Promise<AiConfig> {
	// Convert base64 string back to raw bytes
	const raw = Uint8Array.from(atob(base64Ciphertext.trim()), (c) =>
		c.charCodeAt(0),
	);

	// Verify "Salted__" magic header (bytes 0-7)
	const magic = String.fromCharCode(...raw.slice(0, 8));
	if (magic !== "Salted__") {
		throw new Error("Invalid vault format: missing 'Salted__' magic header");
	}

	// Extract salt (8 bytes) and ciphertext (the rest)
	const salt = raw.slice(8, 16);
	const ciphertext = raw.slice(16);

	// Derive 32-byte key + 16-byte IV using PBKDF2-SHA256
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const derived = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt,
			iterations: 100000,
		},
		keyMaterial,
		(32 + 16) * 8, // 48 bytes = 32 key + 16 IV
	);

	const keyBytes = new Uint8Array(derived, 0, 32);
	const iv = new Uint8Array(derived, 32, 16);

	// Decrypt using AES-CBC (Cipher Block Chaining) mode.
	// This corresponds to the OpenSSL -aes-256-cbc flag.
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "AES-CBC" },
		false,
		["decrypt"],
	);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-CBC", iv },
		cryptoKey,
		ciphertext,
	);

	// Convert the raw decrypted buffer to a string and parse it as JSON.
	// The resulting object is typed as AiConfig, which reflects the raw vault structure.
	return JSON.parse(new TextDecoder().decode(plaintext)) as AiConfig;
}

/**
 * Fetches the encrypted vault content from a remote URL.
 *
 * @param url - The URL of the encrypted vault file.
 * @returns The raw ciphertext as a string.
 */
async function fetchEncryptedVault(url: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) {
		throw new Error(
			`Failed to fetch vault from ${url}: HTTP ${response.status}`,
		);
	}
	return response.text();
}

/**
 * Transforms the raw AiConfig into the extension-friendly AiVaultConfig.
 * The raw AiConfig (mirrored from the JSON vault) might have optional fields
 * or structures that aren't convenient for direct use. This function maps
 * and cleans up the data, providing defaults where necessary (e.g., key owner).
 *
 * @param aiConfig - Raw configuration from the decrypted vault.
 * @returns Transformed configuration.
 */
function transformAiConfigToVaultConfig(aiConfig: AiConfig): AiVaultConfig {
	const vaultConfig: AiVaultConfig = {
		version: aiConfig.version,
		providers: {},
	};
	for (const [providerName, provider] of Object.entries(aiConfig.providers)) {
		vaultConfig.providers[providerName] = {
			protocol: provider.protocol,
			endpoint: provider.endpoint,
			keys: provider.keys.map((k) => ({
				key: k.key,
				owner: k.owner ?? "unknown",
				type: k.type ?? "paid",
			})),
			models: provider.models.map((m) => ({
				id: m.id,
				name: m.name,
				contextWindow: m.contextWindow,
				maxOutputTokens: m.maxOutputTokens,
				usage: m.usage,
				supportsImages: m.supportsImages,
				supportsPromptCache: m.supportsPromptCache,
				inputPrice: m.inputPrice,
				outputPrice: m.outputPrice,
				defaultDimensions: m.defaultDimensions,
			})),
		};
	}
	if (aiConfig.crawlers) {
		const crawlers: Record<string, VaultCrawler> = {};
		for (const [name, crawler] of Object.entries(aiConfig.crawlers)) {
			crawlers[name] = {
				protocol: crawler.protocol,
				endpoint: crawler.endpoint,
				keys: crawler.keys.map((k) => ({
					key: k.key,
					owner: k.owner,
					type: k.type,
				})),
			};
		}
		vaultConfig.crawlers = crawlers;
	}

	return vaultConfig;
}

/**
 * Loads the AI Vault: fetches, decrypts, transforms, and caches the result.
 * Implements a 5-minute cache to avoid repeated network and crypto overhead.
 *
 * @param vaultUrl - URL where the vault is hosted.
 * @returns The active vault configuration.
 * @throws {Error} If the KEYPOOL_LIVE_SECRET is missing or vault processing fails.
 */
export async function loadAiVault(vaultUrl: string): Promise<AiVaultConfig> {
	// Step 1: Check if we have a valid, non-expired configuration in the in-memory cache.
	if (vaultCache && Date.now() - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
		return vaultCache.config;
	}

	// Step 2: Retrieve the decryption secret from environment variables.
	// This secret is used to derive the AES key and IV.
	const secret = process.env.KEYPOOL_LIVE_SECRET;
	if (!secret) {
		throw new Error("KEYPOOL_LIVE_SECRET environment variable is not set");
	}

	// Step 3: Fetch the encrypted vault from the remote server.
	const base64Ciphertext = await fetchEncryptedVault(vaultUrl);

	// Step 4: Decrypt the vault using AES-256-CBC.
	const aiConfig = await decryptAiConfig(base64Ciphertext, secret);

	// Step 5: Transform the raw JSON structure into the internal format used by the extension.
	const config = transformAiConfigToVaultConfig(aiConfig);

	// Step 6: Store the result in the cache and update the timestamp.
	vaultCache = { config, fetchedAt: Date.now() };
	return config;
}

/**
 * Clears the in-memory vault cache, forcing the next loadAiVault() call to refetch.
 */
export function clearVaultCache(): void {
	vaultCache = null;
}

/**
 * Synchronously looks up a model from the in-memory vault cache.
 * Returns null if the cache is empty or the model isn't found.
 *
 * This is primarily used by the UI to show correct context-window and
 * capabilities information before any task starts.
 *
 * @param providerName - The provider name (e.g., 'anthropic').
 * @param modelId - The model identifier.
 * @returns The found model or null.
 */
export function getCachedVaultModel(
	providerName: string,
	modelId: string,
): import("./types").VaultModel | null {
	if (!vaultCache) return null;
	const provider = vaultCache.config.providers[providerName];
	if (!provider) return null;
	const chatModels = provider.models.filter(
		(m) => !m.usage || m.usage === "chat",
	);
	return (
		(modelId ? chatModels.find((m) => m.id === modelId) : chatModels[0]) ?? null
	);
}
