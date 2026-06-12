/**
 * KeypoolLive provider — automatic key rotation from an AES-256-CBC encrypted vault.
 *
 * This provider enables automatic API key rotation for AI services by loading keys from
 * an encrypted vault. It supports multiple AI protocols (OpenAI, Anthropic, Gemini) and
 * implements intelligent key management with failure tracking and round-robin rotation.
 *
 * Usage:
 *   providerId: "keypoollive"
 *   modelId:    "mistral/devstral-latest"   (format: "<vaultProviderName>/<modelId>")
 *   apiKey:     "auto"                       (load from KEYPOOL_VAULT_URL + KEYPOOL_LIVE_SECRET)
 *              or a literal key string       (use directly without vault)
 *
 * Environment variables (when apiKey === "auto"):
 *   KEYPOOL_VAULT_URL      — URL or file:// path to the encrypted vault
 *   KEYPOOL_LIVE_SECRET    — decryption password
 *
 * © 2026 Ronan LE MEILLAT — MIT License
 */

import type {
	AgentModelEvent,
	GatewayProvider,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import type { CrawlerKeyResolver, ResolvedCrawlerConfig } from "@cline/shared";

// ─── Vault types ─────────────────────────────────────────────────────────────
/**
 * Type definitions for the AI vault configuration system.
 * These types define the structure of the encrypted vault and its components.
 */

/**
 * Supported AI protocols that the vault can handle
 */
type AiProtocol = "openai" | "anthropic" | "gemini" | "mistral" | "cohere";

/**
 * Supported crawler protocols that the vault can handle
 */
type CrawlerProtocol = "firecrawl" | "exa" | "scrapegraphai";

/**
 * Represents a crawler API key in the vault
 */
interface CrawlerKey {
	key: string;
	owner?: string;
	type?: AiKeyTier;
}

/**
 * Represents a crawler service configuration in the vault
 */
interface VaultCrawler {
	protocol: CrawlerProtocol;
	endpoint: string;
	keys: CrawlerKey[];
}

/**
 * Key tier classification for prioritization and usage tracking
 */
type AiKeyTier = "expired" | "free" | "paid" | "premium" | "unlimited";

/**
 * Represents an API key stored in the vault with metadata
 */
interface VaultKey {
	key: string;
	owner: string;
	type: AiKeyTier;
}

/**
 * Represents an AI model configuration in the vault
 */
interface VaultModel {
	id: string;
	name?: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	usage?: "chat" | "embedding";
	supportsImages?: boolean;
	supportsPromptCache?: boolean;
	inputPrice?: number;
	outputPrice?: number;
}

/**
 * Represents an AI service provider configuration in the vault
 */
interface VaultProvider {
	protocol: AiProtocol;
	endpoint?: string;
	userAgent?: string;
	keys: VaultKey[];
	models: VaultModel[];
}

/**
 * Top-level vault configuration containing all providers
 */
interface AiVaultConfig {
	version: number;
	providers: Record<string, VaultProvider>;
	crawlers?: Record<string, VaultCrawler>;
}

// Internal raw format from the JSON file
/**
 * Raw key data as stored in the encrypted JSON file (before transformation)
 */
interface RawAiKey {
	key: string;
	owner?: string;
	type?: AiKeyTier;
}

/**
 * Raw model data as stored in the encrypted JSON file
 */
interface RawAiModel {
	id: string;
	name?: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	usage?: "chat" | "embedding";
	supportsImages?: boolean;
	supportsPromptCache?: boolean;
	inputPrice?: number;
	outputPrice?: number;
}

/**
 * Raw provider data as stored in the encrypted JSON file
 */
interface RawAiProvider {
	protocol: AiProtocol;
	endpoint?: string;
	userAgent?: string;
	keys: RawAiKey[];
	models: RawAiModel[];
}

/**
 * Raw vault configuration as stored in the encrypted JSON file
 */
interface RawAiConfig {
	version: number;
	providers: Record<string, RawAiProvider>;
	crawlers?: Record<
		string,
		{
			protocol: CrawlerProtocol;
			endpoint: string;
			keys: Array<{
				key: string;
				owner?: string;
				type?: AiKeyTier;
			}>;
		}
	>;
}

// ─── AiVault (decryption + caching) ──────────────────────────────────────────
/**
 * Vault decryption and caching system.
 * Handles loading, decrypting, and caching the AI vault configuration.
 */

/**
 * Cache structure for vault configurations to avoid repeated decryption
 */
interface VaultCache {
	config: AiVaultConfig;
	fetchedAt: number;
}

/**
 * Cache TTL (Time To Live) in milliseconds
 */
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Current vault cache instance
 */
let vaultCache: VaultCache | null = null;

/**
 * Decrypts the AI vault configuration using AES-256-CBC encryption.
 *
 * @param base64Ciphertext - Base64 encoded encrypted vault content
 * @param password - Decryption password from KEYPOOL_LIVE_SECRET
 * @returns Decrypted raw vault configuration
 * @throws Error if vault format is invalid or decryption fails
 */
async function decryptAiConfig(
	base64Ciphertext: string,
	password: string,
): Promise<RawAiConfig> {
	// Convert base64 to Uint8Array
	const raw = Uint8Array.from(atob(base64Ciphertext.trim()), (c) =>
		c.charCodeAt(0),
	);

	// Validate vault format by checking for OpenSSL "Salted__" magic header
	const magic = String.fromCharCode(...raw.slice(0, 8));
	if (magic !== "Salted__") {
		throw new Error("Invalid vault format: missing 'Salted__' magic header");
	}

	// Extract salt and ciphertext from the raw data
	const salt = raw.slice(8, 16);
	const ciphertext = raw.slice(16);

	// Derive encryption key using PBKDF2 with SHA-256
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const derived = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
		keyMaterial,
		(32 + 16) * 8, // 32 bytes for key + 16 bytes for IV
	);

	// Extract key and initialization vector
	const keyBytes = new Uint8Array(derived, 0, 32);
	const iv = new Uint8Array(derived, 32, 16);

	// Import key and decrypt the ciphertext
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

	// Parse and return the decrypted JSON configuration
	return JSON.parse(new TextDecoder().decode(plaintext)) as RawAiConfig;
}

/**
 * Transforms raw vault configuration to the internal AiVaultConfig format.
 * Applies default values for optional fields.
 *
 * @param raw - Raw configuration from the decrypted vault
 * @returns Transformed vault configuration with defaults applied
 */
function transformRawConfig(raw: RawAiConfig): AiVaultConfig {
	const vault: AiVaultConfig = {
		version: raw.version,
		providers: {},
	};

	// Transform providers
	for (const [name, p] of Object.entries(raw.providers)) {
		vault.providers[name] = {
			protocol: p.protocol,
			endpoint: p.endpoint,
			userAgent: p.userAgent,
			keys: p.keys.map((k) => ({
				key: k.key,
				owner: k.owner ?? "unknown",
				type: k.type ?? "paid",
			})),
			models: p.models.map((m) => ({ ...m })),
		};
	}

	// Transform crawlers if present in the raw config
	if ("crawlers" in raw) {
		const rawCrawlers = raw as RawAiConfig & { crawlers?: Record<string, any> };
		if (rawCrawlers.crawlers) {
			vault.crawlers = {};
			for (const [name, c] of Object.entries(rawCrawlers.crawlers)) {
				vault.crawlers[name] = {
					protocol: c.protocol,
					endpoint: c.endpoint,
					keys: c.keys.map((k: any) => ({
						key: k.key,
						owner: k.owner,
						type: k.type,
					})),
				};
			}
		}
	}

	return vault;
}

/**
 * Fetches vault content from a URL or local file.
 *
 * @param url - URL or file:// path to the vault
 * @returns Vault content as string
 * @throws Error if fetch fails or response is not OK
 */
async function fetchVaultText(url: string): Promise<string> {
	// Support file:// for local development
	if (url.startsWith("file://")) {
		const fs = await import("node:fs/promises");
		return fs.readFile(new URL(url), "utf8");
	}
	const res = await globalThis.fetch(url, {
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch vault from ${url}: HTTP ${res.status}`);
	}
	return res.text();
}

/**
 * Loads and decrypts the AI vault configuration.
 * Implements caching to avoid repeated decryption operations.
 *
 * @param vaultUrl - URL or file path to the encrypted vault
 * @returns Decrypted and transformed vault configuration
 * @throws Error if environment variables are missing or decryption fails
 */
async function loadAiVault(vaultUrl: string): Promise<AiVaultConfig> {
	// Return cached config if still valid
	if (vaultCache && Date.now() - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
		return vaultCache.config;
	}

	// Validate required environment variable
	const secret = process.env.KEYPOOL_LIVE_SECRET;
	if (!secret) {
		throw new Error("KEYPOOL_LIVE_SECRET environment variable is not set");
	}

	// Fetch, decrypt, and transform the vault
	const ciphertext = await fetchVaultText(vaultUrl);
	const raw = await decryptAiConfig(ciphertext, secret);
	const config = transformRawConfig(raw);

	// Update cache and return
	vaultCache = { config, fetchedAt: Date.now() };
	return config;
}

/**
 * Clears the vault cache, forcing the next load to fetch and decrypt fresh data.
 */
function clearVaultCache(): void {
	vaultCache = null;
}

// ─── KeyPool (round-robin + health tracking) ─────────────────────────────────
/**
 * Key rotation and health tracking system.
 * Implements round-robin key selection with failure tracking and cooldown periods.
 */

// ---- Crawler-specific state tracking ----

/**
 * Tracks the current round-robin index for each crawler
 */
const crawlerRoundRobinIndexes = new Map<string, number>();

/**
 * Tracks health status for each crawler key
 */
const crawlerKeyStatuses = new Map<string, KeyStatus>();

/**
 * Generates a unique identifier for a crawler key
 */
function getCrawlerKeyId(crawlerName: string, keyValue: string): string {
	return `${crawlerName}:${keyValue.slice(-8)}`;
}

/**
 * Checks if a crawler key is currently usable
 */
function isCrawlerKeyUsable(crawlerName: string, keyValue: string): boolean {
	const status = crawlerKeyStatuses.get(getCrawlerKeyId(crawlerName, keyValue));
	if (!status) return true;

	if (status.failureCount >= MAX_FAILURE_COUNT) {
		if (
			status.cooledDownAt &&
			Date.now() - status.cooledDownAt >= KEY_COOLDOWN_MS
		) {
			crawlerKeyStatuses.delete(getCrawlerKeyId(crawlerName, keyValue));
			persistStateSoon();
			return true;
		}
		return false;
	}
	return true;
}

/**
 * Marks a crawler key as failed
 */
export function markCrawlerKeyAsFailed(
	crawlerName: string,
	keyValue: string,
): void {
	const id = getCrawlerKeyId(crawlerName, keyValue);
	const existing = crawlerKeyStatuses.get(id);
	const failureCount = (existing?.failureCount ?? 0) + 1;

	crawlerKeyStatuses.set(id, {
		key: keyValue,
		failureCount,
		cooledDownAt:
			failureCount >= MAX_FAILURE_COUNT ? Date.now() : existing?.cooledDownAt,
	});
	persistStateSoon();
}

/**
 * Selects the next crawler key to use
 */
function selectNextCrawlerKey(
	crawlerName: string,
	keys: CrawlerKey[],
): CrawlerKey | null {
	const eligible = keys.filter((k) => k.type !== "expired");
	if (!eligible.length) return null;

	const usable = eligible.filter((k) => isCrawlerKeyUsable(crawlerName, k.key));
	const pool = usable.length ? usable : eligible;

	const idx = (crawlerRoundRobinIndexes.get(crawlerName) ?? 0) % pool.length;
	crawlerRoundRobinIndexes.set(crawlerName, (idx + 1) % pool.length);
	return pool[idx];
}

// ---- Implémentation de CrawlerKeyResolver ----

/**
 * KeypoolCrawlerResolver - implements CrawlerKeyResolver for KeypoolLive
 */
export class KeypoolCrawlerResolver implements CrawlerKeyResolver {
	constructor(private readonly vaultUrl: string) {}

	async resolve(): Promise<ResolvedCrawlerConfig | null> {
		const vault = await loadAiVault(this.vaultUrl);

		// Access crawlers in the vault
		const crawlers = vault.crawlers;
		if (!crawlers) return null;

		const entries = Object.entries(crawlers);
		if (!entries.length) return null;

		// Find the first crawler with a usable key
		for (const [crawlerName, crawler] of entries) {
			const key = selectNextCrawlerKey(crawlerName, crawler.keys);
			if (!key) continue;

			return {
				crawlerName,
				protocol: crawler.protocol,
				endpoint: crawler.endpoint,
				apiKey: key.key,
				keyOwner: key.owner,
			};
		}

		return null;
	}
}

/**
 * Creates a CrawlerKeyResolver based on the KeypoolLive vault
 */
export function createKeypoolCrawlerResolver(
	vaultUrl: string,
): CrawlerKeyResolver {
	return new KeypoolCrawlerResolver(vaultUrl);
}

/**
 * Tracks the health and usage status of individual API keys
 */
interface KeyStatus {
	key: string;
	cooledDownAt?: number; // Timestamp when key entered cooldown
	failureCount: number; // Number of consecutive failures
}

interface PersistedKeyStatus {
	providerName: string;
	keySuffix: string;
	cooledDownAt?: number;
	failureCount: number;
}

interface PersistedRoundRobinState {
	version: 1;
	roundRobinIndexes: Record<string, number>;
	keyStatuses: PersistedKeyStatus[];
}

/**
 * Cooldown period for failed keys (15 minutes)
 */
const KEY_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Maximum allowed failures before a key enters cooldown
 */
const MAX_FAILURE_COUNT = 3;

/**
 * Tracks the current round-robin index for each provider
 */
const roundRobinIndexes = new Map<string, number>();

/**
 * Tracks health status for each key
 */
const keyStatuses = new Map<string, KeyStatus>();

let persistentStateLoaded = false;
let persistentStateWriteChain: Promise<void> = Promise.resolve();

const KEYPOOL_STATE_FILE_ENV = "KEYPOOL_STATE_FILE";
const DEFAULT_KEYPOOL_STATE_FILE = "keypoollive-state.json";

/**
 * Generates a unique identifier for a key within a provider
 *
 * @param providerName - Name of the vault provider
 * @param keyValue - API key string
 * @returns Unique identifier combining provider name and key suffix
 */
function keyStatusId(providerName: string, keyValue: string): string {
	return `${providerName}:${keyValue.slice(-8)}`;
}

function keySuffix(keyValue: string): string {
	return keyValue.length <= 8 ? keyValue : keyValue.slice(-8);
}

function keyMask(keyValue: string): string {
	const suffix = keySuffix(keyValue);
	return `***${suffix}`;
}

function keyStatusIdFromSuffix(providerName: string, suffix: string): string {
	return `${providerName}:${suffix}`;
}

async function getPersistentStatePath(): Promise<string> {
	if (process.env[KEYPOOL_STATE_FILE_ENV]) {
		return process.env[KEYPOOL_STATE_FILE_ENV] as string;
	}

	// Default to ~/.cline/data/keypoolliveState.json if not specified
	const os = await import("node:os");
	const path = await import("node:path");
	const homeDir = os.homedir();
	return path.join(homeDir, ".cline", "data", DEFAULT_KEYPOOL_STATE_FILE);
}

async function loadPersistentStateOnce(): Promise<void> {
	if (persistentStateLoaded) {
		return;
	}
	persistentStateLoaded = true;

	try {
		const statePath = await getPersistentStatePath();
		const fs = await import("node:fs/promises");
		const path = await import("node:path");

		// Create the directory if it doesn't exist
		await fs.mkdir(path.dirname(statePath), { recursive: true });

		// Create an empty state file if it doesn't exist
		try {
			await fs.access(statePath);
		} catch {
			// File doesn't exist, create an empty one
			await fs.writeFile(
				statePath,
				JSON.stringify(
					{
						version: 1,
						roundRobinIndexes: {},
						keyStatuses: [],
					},
					null,
					2,
				),
			);
		}

		// Load existing state if available
		try {
			const raw = await fs.readFile(statePath, "utf8");
			const parsed = JSON.parse(raw) as PersistedRoundRobinState;

			if (parsed.version !== 1) {
				return;
			}

			for (const [providerName, index] of Object.entries(
				parsed.roundRobinIndexes ?? {},
			)) {
				if (Number.isInteger(index) && index >= 0) {
					roundRobinIndexes.set(providerName, index);
				}
			}

			for (const status of parsed.keyStatuses ?? []) {
				if (
					typeof status.providerName !== "string" ||
					typeof status.keySuffix !== "string" ||
					typeof status.failureCount !== "number"
				) {
					continue;
				}
				keyStatuses.set(
					keyStatusIdFromSuffix(status.providerName, status.keySuffix),
					{
						key: status.keySuffix,
						failureCount: Math.max(0, Math.trunc(status.failureCount)),
						cooledDownAt:
							typeof status.cooledDownAt === "number"
								? status.cooledDownAt
								: undefined,
					},
				);
			}
		} catch {
			// Ignore: state file is optional and recreated on next write.
		}
	} catch {
		// Ignore: state file is optional and recreated on next write.
	}
}

function persistStateSoon(): void {
	persistentStateWriteChain = persistentStateWriteChain
		.then(async () => {
			const statePath = await getPersistentStatePath();
			const fs = await import("node:fs/promises");
			const path = await import("node:path");

			await fs.mkdir(path.dirname(statePath), { recursive: true });

			const persisted: PersistedRoundRobinState = {
				version: 1,
				roundRobinIndexes: Object.fromEntries(roundRobinIndexes.entries()),
				keyStatuses: Array.from(keyStatuses.entries()).map(([id, status]) => {
					const sep = id.indexOf(":");
					return {
						providerName: sep >= 0 ? id.slice(0, sep) : "unknown",
						keySuffix: sep >= 0 ? id.slice(sep + 1) : keySuffix(status.key),
						cooledDownAt: status.cooledDownAt,
						failureCount: status.failureCount,
					};
				}),
			};

			const tmpPath = `${statePath}.tmp`;
			await fs.writeFile(tmpPath, `${JSON.stringify(persisted)}\n`, "utf8");
			await fs.rename(tmpPath, statePath);
		})
		.catch(() => {
			// Ignore write failures: in-memory rotation still works.
		});
}

/**
 * Checks if a key is currently usable (not in cooldown and below failure threshold)
 *
 * @param providerName - Name of the vault provider
 * @param keyValue - API key string to check
 * @returns true if key is usable, false if in cooldown or has too many failures
 */
function isKeyUsable(providerName: string, keyValue: string): boolean {
	const status = keyStatuses.get(keyStatusId(providerName, keyValue));
	if (!status) return true; // No status record means key is usable

	// Check if key has exceeded failure threshold but cooldown has expired
	if (status.failureCount >= MAX_FAILURE_COUNT) {
		if (
			status.cooledDownAt &&
			Date.now() - status.cooledDownAt >= KEY_COOLDOWN_MS
		) {
			// Cooldown expired, remove status and allow key to be used again
			keyStatuses.delete(keyStatusId(providerName, keyValue));
			persistStateSoon();
			return true;
		}
		return false; // Still in cooldown
	}
	return true; // Below failure threshold
}

function markKeyAsHealthy(providerName: string, keyValue: string): void {
	const id = keyStatusId(providerName, keyValue);
	if (keyStatuses.has(id)) {
		keyStatuses.delete(id);
		persistStateSoon();
	}
}

/**
 * Marks a key as failed and updates its failure count
 *
 * @param providerName - Name of the vault provider
 * @param keyValue - API key string that failed
 */
function markKeyAsFailed(providerName: string, keyValue: string): void {
	const id = keyStatusId(providerName, keyValue);
	const existing = keyStatuses.get(id);
	const failureCount = (existing?.failureCount ?? 0) + 1;

	keyStatuses.set(id, {
		key: keyValue,
		failureCount,
		cooledDownAt:
			failureCount >= MAX_FAILURE_COUNT ? Date.now() : existing?.cooledDownAt,
	});
	persistStateSoon();
}

/**
 * Selects the next key to use using round-robin algorithm with health filtering
 *
 * @param providerName - Name of the vault provider
 * @param keys - Array of available keys from the vault
 * @returns Next usable key, or null if no keys are available
 */
function selectNextKey(
	providerName: string,
	keys: VaultKey[],
): VaultKey | null {
	// Filter out expired keys
	const eligible = keys.filter((k) => k.type !== "expired");
	if (eligible.length === 0) return null;

	// Filter out keys that are not currently usable (in cooldown or failed)
	const usable = eligible.filter((k) => isKeyUsable(providerName, k.key));

	// If no usable keys, fall back to round-robin selection from eligible keys
	// This allows keys to be tried even if they have some failures
	if (usable.length === 0) {
		const idx = (roundRobinIndexes.get(providerName) ?? 0) % eligible.length;
		roundRobinIndexes.set(providerName, (idx + 1) % eligible.length);
		persistStateSoon();
		return eligible[idx];
	}

	// Select next key using round-robin from usable keys
	const idx = (roundRobinIndexes.get(providerName) ?? 0) % usable.length;
	roundRobinIndexes.set(providerName, (idx + 1) % usable.length);
	persistStateSoon();
	return usable[idx];
}

/**
 * Resolved API configuration containing all necessary information to create a provider
 */
interface ResolvedApiConfig {
	providerName: string;
	protocol: AiProtocol;
	endpoint?: string;
	userAgent?: string;
	apiKey: string;
	keyOwner?: string;
	model: VaultModel;
}

/**
 * Resolves the next API configuration to use for a given provider and model
 *
 * @param vault - Loaded vault configuration
 * @param providerName - Name of the vault provider
 * @param modelId - Optional specific model ID, uses first chat model if not provided
 * @returns Resolved API configuration, or null if no suitable configuration found
 */
function resolveNextApiConfig(
	vault: AiVaultConfig,
	providerName: string,
	modelId?: string,
): ResolvedApiConfig | null {
	// Get provider from vault
	const provider = vault.providers[providerName];
	if (!provider) return null;

	// Filter to chat models (or models without specific usage)
	const chatModels = provider.models.filter(
		(m) => !m.usage || m.usage === "chat",
	);

	// Find the requested model or use the first available chat model
	const model = modelId
		? (chatModels.find((m) => m.id === modelId) ?? chatModels[0])
		: chatModels[0];
	if (!model) return null;

	// Select the next key to use
	const key = selectNextKey(providerName, provider.keys);
	if (!key) return null;

	// Return complete resolved configuration
	return {
		providerName,
		protocol: provider.protocol,
		endpoint: provider.endpoint,
		userAgent: provider.userAgent,
		apiKey: key.key,
		keyOwner: key.owner,
		model,
	};
}

// ─── Error detection ──────────────────────────────────────────────────────────

/**
 * Extracts an HTTP status code from an error object, returning null if not found.
 */
function extractHttpStatus(error: unknown): number | null {
	if (!error || typeof error !== "object") return null;
	const e = error as Record<string, unknown>;
	const nested =
		e.error && typeof e.error === "object"
			? (e.error as Record<string, unknown>)
			: undefined;
	const response =
		e.response && typeof e.response === "object"
			? (e.response as Record<string, unknown>)
			: undefined;
	const candidates = [
		e.status,
		e.statusCode,
		nested?.status,
		nested?.statusCode,
		response?.status,
		response?.statusCode,
	];
	const found = candidates.find((v): v is number => typeof v === "number");
	return found ?? null;
}
/**
 * Error detection utilities for identifying key-related failures
 */

/**
 * Determines if an error is likely related to API key issues (authentication, rate limits, etc.)
 *
 * @param error - Error object to analyze
 * @returns true if error appears to be key-related, false otherwise
 */
function isKeyError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const e = error as Record<string, unknown>;
	const nested =
		e.error && typeof e.error === "object"
			? (e.error as Record<string, unknown>)
			: undefined;
	const response =
		e.response && typeof e.response === "object"
			? (e.response as Record<string, unknown>)
			: undefined;

	// Check for specific HTTP status codes that indicate key issues.
	const statusCandidates = [
		e.status,
		e.statusCode,
		nested?.status,
		nested?.statusCode,
		response?.status,
		response?.statusCode,
	];
	const status = statusCandidates.find(
		(value): value is number => typeof value === "number",
	);
	if (status === 401 || status === 403 || status === 429) return true;

	const codeCandidates = [e.code, nested?.code, response?.code];
	for (const code of codeCandidates) {
		if (typeof code === "number" && code === 429) {
			return true;
		}
		if (typeof code === "string") {
			const normalized = code.toLowerCase();
			if (
				normalized === "429" ||
				normalized.includes("rate_limit") ||
				normalized.includes("quota") ||
				normalized.includes("exhaust")
			) {
				return true;
			}
		}
	}

	// Check error message for keywords that indicate key issues
	const messageCandidates = [e.message, nested?.message, response?.message];
	const msg = messageCandidates
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();
	return (
		msg.includes("unauthorized") ||
		msg.includes("forbidden") ||
		msg.includes("resource has been exhausted") ||
		msg.includes("resource exhausted") ||
		msg.includes("insufficient_quota") ||
		msg.includes("too many requests") ||
		msg.includes("throttle") ||
		msg.includes("rate limit") ||
		msg.includes("quota")
	);
}

// ─── Provider factory ─────────────────────────────────────────────────────────
/**
 * Provider factory functions for creating protocol-specific providers
 */

/**
 * Creates a protocol-specific provider instance based on the resolved configuration
 *
 * @param resolved - Resolved API configuration with protocol, endpoint, and key
 * @param parentConfig - Parent configuration to inherit settings from
 * @returns GatewayProvider instance for the specified protocol
 */
async function createSubProvider(
	resolved: ResolvedApiConfig,
	parentConfig: GatewayResolvedProviderConfig,
): Promise<GatewayProvider> {
	// Create configuration for the sub-provider with resolved API key and endpoint
	const subConfig: GatewayResolvedProviderConfig = {
		...parentConfig,
		apiKey: resolved.apiKey,
		baseUrl: resolved.endpoint,
	};

	// Select the appropriate provider factory based on protocol
	let factory: GatewayProviderFactory;
	switch (resolved.protocol) {
		case "anthropic": {
			const { createAnthropicProvider } = await import("../ai-sdk");
			factory = createAnthropicProvider;
			break;
		}
		case "gemini": {
			const { createGoogleProvider } = await import("../ai-sdk");
			factory = createGoogleProvider;
			break;
		}
		case "cohere": {
			const { createCohereProvider } = await import("../ai-sdk");
			factory = createCohereProvider;
			break;
		}
		case "mistral": {
			const { createMistralProvider } = await import("../ai-sdk");
			factory = createMistralProvider;
			break;
		}
		default: {
			// "openai" or any openai-compatible
			const { createOpenAICompatibleProvider } = await import("../ai-sdk");
			factory = createOpenAICompatibleProvider;
			break;
		}
	}

	// Create and return the protocol-specific provider instance
	return factory(subConfig);
}

/**
 * Parse a keypoollive modelId of the form "providerName/modelId".
 * Returns `{ providerName, modelId }` or throws if the format is invalid.
 *
 * @param compositeModelId - Model ID in format "providerName/modelId"
 * @returns Object containing parsed providerName and modelId
 * @throws Error if format is invalid
 */
function parseModelId(compositeModelId: string): {
	providerName: string;
	modelId: string;
} {
	const slashIndex = compositeModelId.indexOf("/");
	if (slashIndex <= 0) {
		throw new Error(
			`[keypoollive] modelId must be in format "providerName/modelId", got: "${compositeModelId}"`,
		);
	}
	return {
		providerName: compositeModelId.slice(0, slashIndex),
		modelId: compositeModelId.slice(slashIndex + 1),
	};
}

// ─── NDJSON usage recording ───────────────────────────────────────────────────
// Compatible with apps/vscode/src/core/keypoollive/KeypoolUsageDb.ts record format.
// Directory: KEYPOOL_USAGE_DB_DIR env var, or ~/.cline/data/keypoollive/

const KEYPOOL_USAGE_DB_DIR_ENV = "KEYPOOL_USAGE_DB_DIR";

interface NdjsonUsageEntry {
	ts: number;
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	promptTokens: number;
	completionTokens: number;
}

interface NdjsonErrorEntry {
	ts: number;
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	errorCode: number | null;
}

async function getUsageDbDir(): Promise<string> {
	if (process.env[KEYPOOL_USAGE_DB_DIR_ENV]) {
		return process.env[KEYPOOL_USAGE_DB_DIR_ENV] as string;
	}
	const os = await import("node:os");
	const path = await import("node:path");
	return path.join(os.homedir(), ".cline", "data", "keypoollive");
}

async function recordKeypoolUsageToNdjson(
	entry: Omit<NdjsonUsageEntry, "ts">,
): Promise<void> {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const dbDir = await getUsageDbDir();
	await fs.mkdir(dbDir, { recursive: true });
	const line =
		JSON.stringify({ ts: Date.now(), ...entry } satisfies NdjsonUsageEntry) +
		"\n";
	await fs.appendFile(path.join(dbDir, "usage.ndjson"), line, "utf8");
}

async function recordKeypoolErrorToNdjson(
	entry: Omit<NdjsonErrorEntry, "ts">,
): Promise<void> {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const dbDir = await getUsageDbDir();
	await fs.mkdir(dbDir, { recursive: true });
	const line =
		JSON.stringify({ ts: Date.now(), ...entry } satisfies NdjsonErrorEntry) +
		"\n";
	await fs.appendFile(path.join(dbDir, "errors.ndjson"), line, "utf8");
}

// ─── Key state query ──────────────────────────────────────────────────────────

/** Snapshot of a tracked key's health state. */
export interface KeypoolKeyState {
	providerName: string;
	keyHint: string;
	failureCount: number;
	inCooldown: boolean;
	cooledDownAt?: number;
	/** Milliseconds remaining in cooldown, only set when inCooldown is true. */
	cooldownRemainingMs?: number;
}

/**
 * Returns the in-memory health state for all tracked keypoollive keys.
 * Call after loadPersistentStateOnce() has run (i.e. after the first stream).
 *
 * @param providerName - If provided, only return keys for this vault provider.
 */
export function getKeypoolKeyStates(providerName?: string): KeypoolKeyState[] {
	return Array.from(keyStatuses.entries())
		.filter(([id]) => !providerName || id.startsWith(`${providerName}:`))
		.map(([id, status]) => {
			const sep = id.indexOf(":");
			const pName = sep >= 0 ? id.slice(0, sep) : id;
			const kHint = sep >= 0 ? id.slice(sep + 1) : "";
			const now = Date.now();
			const inCooldown =
				status.failureCount >= MAX_FAILURE_COUNT &&
				!!status.cooledDownAt &&
				now - status.cooledDownAt < KEY_COOLDOWN_MS;
			return {
				providerName: pName,
				keyHint: kHint,
				failureCount: status.failureCount,
				inCooldown,
				cooledDownAt: status.cooledDownAt,
				cooldownRemainingMs:
					inCooldown && status.cooledDownAt
						? KEY_COOLDOWN_MS - (now - status.cooledDownAt)
						: undefined,
			};
		});
}

// ─── Manual key rotation ──────────────────────────────────────────────────────

/**
 * Manually force rotation of a key.
 *
 * Call this when you detect an error outside of the normal stream flow (e.g. in
 * a pre-flight health check or after an error caught at a higher level).
 *
 * @param providerName - The vault provider name (e.g. "mistral").
 * @param apiKey       - The API key string to mark as failed.
 * @param invalidateCache - If true (default), also clears the vault cache so the
 *                          next request re-fetches the vault. Set to false if you
 *                          only want to mark the key without forcing a vault reload.
 */
export function rotateKeypoolliveKey(
	providerName: string,
	apiKey: string,
	invalidateCache = true,
): void {
	markKeyAsFailed(providerName, apiKey);
	if (invalidateCache) {
		clearVaultCache();
	}
}

// ─── Provider factory ─────────────────────────────────────────────────────────
/**
 * Main KeypoolLive provider factory.
 * This is the entry point that creates the GatewayProvider instance with automatic key rotation.
 */

/**
 * Creates a KeypoolLive provider that implements automatic key rotation.
 *
 * The provider supports two modes:
 * 1. Auto mode: Loads keys from encrypted vault (apiKey = "auto")
 * 2. Explicit mode: Uses a single provided API key (apiKey = literal key string)
 *
 * @param config - Gateway provider configuration
 * @returns GatewayProvider instance with stream method
 */
export const createKeypoolliveProvider: GatewayProviderFactory = (config) => ({
	/**
	 * Main stream method that handles API requests with automatic key rotation.
	 *
	 * @param request - Gateway stream request containing modelId and other parameters
	 * @param context - Gateway provider context with model and configuration
	 * @returns Async iterable of AgentModelEvent results
	 */
	async *stream(
		request: GatewayStreamRequest,
		context: GatewayProviderContext,
	): AsyncIterable<AgentModelEvent> {
		await loadPersistentStateOnce();

		// Parse the composite modelId to extract provider name and actual model ID
		const { providerName, modelId } = parseModelId(request.modelId);

		// Determine if we're in auto mode (vault-based) or explicit key mode
		const apiKeyValue = config.apiKey?.trim();
		const isAuto = !apiKeyValue || apiKeyValue === "auto";

		// Validate vault URL if in auto mode
		let vaultUrl: string | undefined;
		if (isAuto) {
			vaultUrl = process.env.KEYPOOL_VAULT_URL;
			if (!vaultUrl) {
				throw new Error(
					"[keypoollive] KEYPOOL_VAULT_URL environment variable is not set (required when apiKey is 'auto')",
				);
			}
		}

		const getRequiredVaultUrl = () => {
			if (!vaultUrl) {
				throw new Error(
					"[keypoollive] KEYPOOL_VAULT_URL environment variable is not set (required when apiKey is 'auto')",
				);
			}
			return vaultUrl;
		};

		// Maximum number of key rotation attempts before giving up
		const MAX_KEY_ATTEMPTS = 5;
		let lastError: unknown;

		// Key rotation loop - try different keys until success or max attempts reached
		for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
			let resolvedApiKey: string;
			let resolvedEndpoint: string | undefined;
			let resolvedProtocol: AiProtocol = "openai";
			let resolvedVaultModel: VaultModel | undefined;
			let resolvedKeyOwner: string | undefined;
			let resolvedUserAgent: string | undefined;
			let selectedByRoundRobin = false;

			// Handle explicit key mode (no rotation)
			if (!isAuto) {
				if (!apiKeyValue) {
					throw new Error(
						"[keypoollive] apiKey is required when not using auto mode",
					);
				}
				resolvedApiKey = apiKeyValue;
				resolvedEndpoint = config.baseUrl;
				resolvedProtocol = "openai";
			} else {
				// Auto mode: load vault and resolve next API configuration
				const vault = await loadAiVault(getRequiredVaultUrl());
				const resolved = resolveNextApiConfig(vault, providerName, modelId);
				if (!resolved) {
					throw new Error(
						`[keypoollive] No usable key found for provider "${providerName}" model "${modelId}"`,
					);
				}
				resolvedApiKey = resolved.apiKey;
				resolvedEndpoint = resolved.endpoint;
				resolvedProtocol = resolved.protocol;
				resolvedVaultModel = resolved.model;
				resolvedKeyOwner = resolved.keyOwner;
				resolvedUserAgent = resolved.userAgent;
				selectedByRoundRobin = true;
			}

			const maskedKey = keyMask(resolvedApiKey);
			if (attempt === 0) {
				context.logger?.log("KeypoolLive active key", {
					providerId: "keypoollive",
					severity: "info",
					providerName,
					modelId,
					key: maskedKey,
					roundRobin: selectedByRoundRobin,
				});
				context.keypoolEventHandler?.({
					type: "key-selected",
					providerName,
					modelId,
					keyHint: maskedKey,
					keyOwner: resolvedKeyOwner,
					roundRobin: selectedByRoundRobin,
				});
			}

			// Create sub-request with the actual (un-prefixed) model ID
			const subRequest: GatewayStreamRequest = {
				...request,
				modelId,
			};

			// Create sub-context with resolved API key, endpoint and vault model metadata
			const subContext: GatewayProviderContext = {
				...context,
				model: {
					...context.model,
					id: modelId,
					contextWindow:
						resolvedVaultModel?.contextWindow ?? context.model.contextWindow,
					maxOutputTokens:
						resolvedVaultModel?.maxOutputTokens ??
						context.model.maxOutputTokens,
				},
				config: {
					...context.config,
					apiKey: resolvedApiKey,
					baseUrl: resolvedEndpoint,
					...(resolvedUserAgent
						? {
								headers: {
									...(context.config.headers ?? {}),
									"User-Agent": resolvedUserAgent,
								},
							}
						: {}),
				},
			};

			// Create sub-configuration for the protocol-specific provider
			const subConfig: GatewayResolvedProviderConfig = {
				...config,
				apiKey: resolvedApiKey,
				baseUrl: resolvedEndpoint,
				...(resolvedUserAgent
					? {
							headers: {
								...(config.headers ?? {}),
								"User-Agent": resolvedUserAgent,
							},
						}
					: {}),
			};

			try {
				// Create resolved configuration for sub-provider creation (with full vault model info)
				const resolved: ResolvedApiConfig = {
					providerName,
					protocol: resolvedProtocol,
					endpoint: resolvedEndpoint,
					userAgent: resolvedUserAgent,
					apiKey: resolvedApiKey,
					keyOwner: resolvedKeyOwner,
					model: resolvedVaultModel ?? { id: modelId },
				};

				// Create protocol-specific provider and stream the request
				const subProvider = await createSubProvider(resolved, subConfig);
				const streamResult = subProvider.stream(subRequest, subContext);
				const iterable =
					streamResult instanceof Promise ? await streamResult : streamResult;

				// Iterate the sub-provider stream, accumulating token usage along the way
				let inputTokens = 0;
				let outputTokens = 0;
				let cacheReadTokens = 0;
				let cacheWriteTokens = 0;
				for await (const event of iterable) {
					yield event;
					if (event.type === "usage") {
						inputTokens += event.usage.inputTokens ?? 0;
						outputTokens += event.usage.outputTokens ?? 0;
						cacheReadTokens += event.usage.cacheReadTokens ?? 0;
						cacheWriteTokens += event.usage.cacheWriteTokens ?? 0;
					}
				}

				markKeyAsHealthy(providerName, resolvedApiKey);
				context.logger?.log("KeypoolLive request succeeded", {
					providerId: "keypoollive",
					severity: "info",
					providerName,
					modelId,
					key: maskedKey,
					attempt,
				});

				// Notify caller of key health recovery and usage
				context.keypoolEventHandler?.({
					type: "key-recovered",
					providerName,
					modelId,
					keyHint: maskedKey,
					keyOwner: resolvedKeyOwner,
				});
				if (inputTokens > 0 || outputTokens > 0) {
					context.keypoolEventHandler?.({
						type: "usage-recorded",
						providerName,
						modelId,
						keyHint: maskedKey,
						keyOwner: resolvedKeyOwner,
						inputTokens,
						outputTokens,
						cacheReadTokens,
						cacheWriteTokens,
					});
					// Persist to shared NDJSON (fire-and-forget; failures are non-fatal)
					void recordKeypoolUsageToNdjson({
						provider: providerName,
						modelId,
						keyOwner: resolvedKeyOwner ?? "unknown",
						keyHint: maskedKey,
						promptTokens: inputTokens,
						completionTokens: outputTokens,
					}).catch(() => {});
				}
				return; // Success - exit the retry loop
			} catch (err) {
				lastError = err;

				// Don't rotate keys for non-key errors or when using explicit keys
				if (!isAuto || !isKeyError(err)) {
					throw err;
				}

				// Key error detected - mark key as failed and rotate
				markKeyAsFailed(providerName, resolvedApiKey);
				clearVaultCache(); // Force vault reload in case it was updated
				const errorMessage = err instanceof Error ? err.message : String(err);
				context.logger?.log("KeypoolLive rotating key after provider error", {
					providerId: "keypoollive",
					severity: "warn",
					providerName,
					modelId,
					key: maskedKey,
					attempt,
					error: errorMessage,
				});

				// Persist error to shared NDJSON (fire-and-forget)
				void recordKeypoolErrorToNdjson({
					provider: providerName,
					modelId,
					keyOwner: resolvedKeyOwner ?? "unknown",
					keyHint: maskedKey,
					errorCode: extractHttpStatus(err),
				}).catch(() => {});

				context.keypoolEventHandler?.({
					type: "key-rotated",
					providerName,
					modelId,
					failedKeyHint: maskedKey,
					attempt,
					error: errorMessage,
				});

				yield {
					type: "reasoning-delta",
					text: `[keypoollive] Key rotation triggered for ${providerName}/${modelId}: ${maskedKey}`,
					redacted: true,
					metadata: {
						providerId: "keypoollive",
						event: "key-rotated",
						providerName,
						modelId,
						key: maskedKey,
						error: errorMessage,
					},
				};

				// If this was the last attempt, throw a comprehensive error
				if (attempt === MAX_KEY_ATTEMPTS - 1) {
					const exhaustedMsg = `[keypoollive] All key rotation attempts exhausted for "${providerName}/${modelId}". Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
					context.keypoolEventHandler?.({
						type: "key-exhausted",
						providerName,
						modelId,
						attempts: MAX_KEY_ATTEMPTS,
						error: exhaustedMsg,
					});
					throw new Error(exhaustedMsg);
				}
				// Otherwise, continue to next iteration to try another key
			}
		}

		// This should only be reached if the loop completes without success
		throw lastError;
	},
});
