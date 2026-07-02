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
	GatewayModelCapability,
	GatewayProvider,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import type { CrawlerKeyResolver, ResolvedCrawlerConfig } from "@cline/shared";

/**
 * KeypoolLive is a sophisticated API key management system that provides:
 * 1. Automatic key rotation from encrypted vaults
 * 2. Intelligent key selection based on usage patterns and health status
 * 3. Failure detection and cooldown mechanisms
 * 4. Usage tracking and reporting
 * 5. Support for multiple AI protocols and crawler services
 *
 * The system is designed to maximize API availability and minimize costs by:
 * - Distributing requests across multiple keys
 * - Automatically detecting and rotating failed keys
 * - Tracking usage statistics to balance load
 * - Persisting state between sessions
 *
 * Maintenance notes for external contributors:
 * - This module is intentionally stateful. The maps below cache key health and
 *   round-robin positions in memory, while a small JSON state file preserves
 *   those decisions across process restarts.
 * - The vault is the source of truth for provider/model/key metadata. The local
 *   state file only stores operational decisions such as failures, cooldowns,
 *   and round-robin indexes.
 * - Keep secret material out of logs. The helpers in this file expose only
 *   key suffixes (the last 8 characters) through logs, events, and persisted
 *   state.
 * - When changing the rotation strategy, update both `selectNextKey` and the
 *   explanatory comments in the provider factory so the documented behavior
 *   matches the implementation.
 */

// ─── Vault types ─────────────────────────────────────────────────────────────
// This section describes the encrypted vault schema. The vault is produced by
// the Keypool tooling and consumed by this provider. It is deliberately kept
// separate from Cline's normal provider configuration because it can contain
// multiple providers, multiple keys per provider, model metadata, and optional
// crawler configurations.
//
// The `Raw*` interfaces mirror the JSON structure stored inside the encrypted
// vault. The `Vault*` interfaces represent the normalized shape used internally
// after decryption, because the raw file may omit optional metadata that should
// receive safe defaults at runtime.
/**
 * Type definitions for the AI vault configuration system.
 * These types define the structure of the encrypted vault and its components.
 *
 * The vault system supports:
 * - Multiple AI service providers (OpenAI, Anthropic, Gemini, etc.)
 * - Multiple crawler services (Firecrawl, Exa, ScrapeGraphAI)
 * - Key tiering for prioritization (expired, free, paid, premium, unlimited)
 * - Model metadata including capabilities and pricing
 * - Owner tracking for accountability
 */

/**
 * Supported AI protocols that the vault can handle.
 *
 * These values map to the protocol-specific provider factories imported in
 * `createSubProvider`. Unknown protocols fall back to the OpenAI-compatible
 * provider, which is useful for OpenAI-compatible gateways that are not listed
 * explicitly in the vault.
 */
type AiProtocol = "openai" | "anthropic" | "gemini" | "mistral" | "cohere" | "poolside";

/**
 * Supported crawler protocols that the vault can handle.
 *
 * Crawlers are configured separately from AI providers because they use their
 * own endpoints and key pools. The resolver in this file implements the shared
 * `CrawlerKeyResolver` interface so other parts of the application can request
 * a healthy crawler key without knowing vault internals.
 */
type CrawlerProtocol = "firecrawl" | "exa" | "scrapegraphai";

/**
 * Represents a crawler API key in the vault.
 *
 * `type` is optional in the raw vault and normalized later. Expired keys are
 * kept in the vault for auditability but are skipped by the selection logic.
 */
interface CrawlerKey {
	key: string;
	owner?: string;
	type?: AiKeyTier;
}

/**
 * Represents a crawler service configuration in the vault.
 *
 * `endpoint` is the base endpoint consumed by the crawler integration. `keys`
 * is the pool that this module rotates through using the same health/cooldown
 * concepts as AI API keys.
 */
interface VaultCrawler {
	protocol: CrawlerProtocol;
	endpoint: string;
	keys: CrawlerKey[];
}

/**
 * Key tier classification for prioritization and usage tracking.
 *
 * The current selector does not directly sort by tier, but the tier is still
 * useful for operators and future selection strategies. For example, a future
 * version could prefer `premium` keys for high-priority models while reserving
 * `free` keys for low-cost experimentation.
 */
type AiKeyTier = "expired" | "free" | "paid" | "premium" | "unlimited";

/**
 * Represents an API key stored in the vault with metadata.
 *
 * `owner` is intentionally normalized to a non-empty string so logs and events
 * can always report "unknown" rather than `undefined`. `key` is the actual
 * secret and must never be persisted or logged by this module.
 */
interface VaultKey {
	key: string;
	owner: string;
	type: AiKeyTier;
}

/**
 * Represents a Weather API key in the vault.
 */
export interface WeatherApiKey extends VaultKey {
  /** Optional shared secret for api signature */
  sharedSecret?: string;
  /** Optional hash type for the signature */
  signatureType?: 'hmac-md5' | 'hmac-sha256' | 'hmac-sha512';
}

export type WeatherApPiProtocol = 'meteoblue';

/**
 * Represents a Weather API provider configuration in the vault.
 */
export interface VaultWeatherProvider {
	  protocol: WeatherApPiProtocol;
	  endpoint?: string;
	  keys: WeatherApiKey[];
}

/**
 * Represents an AI model configuration in the vault.
 *
 * Vault model metadata is used to override the model advertised by the parent
 * gateway context. This lets the vault describe provider-specific capabilities
 * such as image support, prompt-cache support, tool support, context window,
 * and max output tokens.
 */
interface VaultModel {
	id: string;
	name?: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	usage?: "chat" | "embedding";
	supportsImages?: boolean;
	supportsPromptCache?: boolean;
	supportsTools?: boolean;
	inputPrice?: number;
	outputPrice?: number;
}

/**
 * Represents an AI service provider configuration in the vault.
 *
 * A provider groups keys and models that share the same protocol and optional
 * endpoint. The provider name is also the prefix used in `modelId` values, for
 * example `mistral/devstral-latest` selects the `mistral` vault provider and
 * the `devstral-latest` model inside it.
 */
interface VaultProvider {
	protocol: AiProtocol;
	endpoint?: string;
	userAgent?: string;
	keys: VaultKey[];
	models: VaultModel[];
}

/**
 * Top-level vault configuration containing all providers.
 *
 * The version field is checked by callers that need schema compatibility. At
 * the time of writing only version `1` is supported.
 */
interface AiVaultConfig {
	version: number;
	providers: Record<string, VaultProvider>;
	crawlers?: Record<string, VaultCrawler>;
}

// Internal raw format from the JSON file
/**
 * Raw key data as stored in the encrypted JSON file (before transformation).
 *
 * This mirrors the vault JSON exactly. Optional fields are filled by
 * `transformRawConfig` so the rest of the module can assume stable defaults.
 */
interface RawAiKey {
	key: string;
	owner?: string;
	type?: AiKeyTier;
}

/**
 * Raw model data as stored in the encrypted JSON file.
 *
 * Model metadata is copied as-is because missing optional fields remain
 * optional after transformation.
 */
interface RawAiModel {
	id: string;
	name?: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	usage?: "chat" | "embedding";
	supportsImages?: boolean;
	supportsPromptCache?: boolean;
	supportsTools?: boolean;
	inputPrice?: number;
	outputPrice?: number;
}

/**
 * Raw provider data as stored in the encrypted JSON file.
 */
interface RawAiProvider {
	protocol: AiProtocol;
	endpoint?: string;
	userAgent?: string;
	keys: RawAiKey[];
	models: RawAiModel[];
}

/**
 * Raw vault configuration as stored in the encrypted JSON file.
 *
 * The crawler shape is written inline here because it is only used during the
 * raw-to-normalized transformation. Do not import this type into runtime code;
 * prefer `AiVaultConfig` after decryption.
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
 *
 * Security properties:
 * - The vault is encrypted with AES-256-CBC using the OpenSSL-compatible
 *   `Salted__` container format.
 * - The password comes from `KEYPOOL_LIVE_SECRET` and is never stored by this
 *   module.
 * - The decrypted config is cached only in memory for a short TTL to avoid
 *   repeated decryption and network/file reads.
 * - The cache can be invalidated after a key failure so an operator can update
 *   the vault and have the next request observe the new key set.
 */

/**
 * Cache structure for vault configurations to avoid repeated decryption.
 *
 * The cache stores the transformed config rather than the raw JSON because the
 * rest of the module expects normalized defaults such as `owner: "unknown"`.
 */
interface VaultCache {
	config: AiVaultConfig;
	fetchedAt: number;
}

/**
 * Cache TTL (Time To Live) in milliseconds.
 *
 * Five minutes is a compromise between freshness and operational resilience:
 * vault changes become visible quickly, but a temporary network or file read
 * failure does not immediately break every request if a recent config exists.
 */
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Current vault cache instance.
 *
 * This is module-level state because the provider factory creates short-lived
 * provider objects per request. A single process-wide cache avoids decrypting
 * the same vault repeatedly while a task is running.
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
	// Convert base64 to Uint8Array.
	// The vault file stores the OpenSSL-compatible binary container as base64
	// text so it can be transported over HTTP or stored in a text file.
	const raw = Uint8Array.from(atob(base64Ciphertext.trim()), (c) =>
		c.charCodeAt(0),
	);

	// Validate vault format by checking for OpenSSL "Salted__" magic header.
	// This is a cheap integrity/schema check before attempting key derivation.
	// It does not prove the password is correct; a wrong password will fail
	// later during AES-CBC decryption.
	const magic = String.fromCharCode(...raw.slice(0, 8));
	if (magic !== "Salted__") {
		throw new Error("Invalid vault format: missing 'Salted__' magic header");
	}

	// Extract salt and ciphertext from the raw data.
	// OpenSSL's salted format is: 8-byte magic header, 8-byte salt, then
	// ciphertext. The salt is required for PBKDF2 so the same password can
	// derive different bytes for different vault files.
	const salt = raw.slice(8, 16);
	const ciphertext = raw.slice(16);

	// Derive encryption key using PBKDF2 with SHA-256.
	// OpenSSL's EVP_BytesToKey historically derives both key and IV from the
	// password and salt. This implementation follows the current Keypool vault
	// format by deriving 48 bytes total: 32 bytes for AES-256 plus 16 bytes for
	// the AES-CBC initialization vector.
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

	// Extract key and initialization vector.
	// The first 32 bytes are the AES key. The next 16 bytes are the CBC IV.
	const keyBytes = new Uint8Array(derived, 0, 32);
	const iv = new Uint8Array(derived, 32, 16);

	// Import key and decrypt the ciphertext.
	// AES-CBC decryption fails if the password, salt, or ciphertext is wrong.
	// Let that error surface to `loadAiVault`, where it becomes a user-facing
	// configuration error.
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

	// Parse and return the decrypted JSON configuration.
	// The result is still the raw vault shape; callers should pass it through
	// `transformRawConfig` before using it.
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

	// Transform providers.
	// The vault JSON makes `owner` and `type` optional to keep vault files
	// concise. This module needs stable values for logging and selection, so it
	// normalizes them here instead of adding null checks throughout the code.
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

	// Transform crawlers if present in the raw config.
	// Crawlers are optional and are only enabled when the vault contains a
	// `crawlers` object. This branch uses `any` because the raw schema is
	// intentionally minimal; after transformation, callers should rely on the
	// strongly typed `VaultCrawler` shape.
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
	// Support file:// for local development and offline deployments.
	// This lets operators store the encrypted vault next to their config or on
	// a mounted volume without exposing it over HTTP.
	if (url.startsWith("file://")) {
		const fs = await import("node:fs/promises");
		return fs.readFile(new URL(url), "utf8");
	}

	// Fetch remote vaults with a short timeout so a stalled provider does not
	// block the entire request indefinitely. Remote vaults are useful when keys
	// are managed centrally and need to be rotated without updating each host.
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
	// Return cached config if still valid.
	// The cache is intentionally process-local and time-based. Operators can
	// force a refresh by calling `clearVaultCache`, which is done after key
	// failures so vault updates become visible quickly.
	if (vaultCache && Date.now() - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
		return vaultCache.config;
	}

	// Validate required environment variable.
	// `KEYPOOL_LIVE_SECRET` is the only secret read directly by this module.
	const secret = process.env.KEYPOOL_LIVE_SECRET;
	if (!secret) {
		throw new Error("KEYPOOL_LIVE_SECRET environment variable is not set");
	}

	// Fetch, decrypt, and transform the vault.
	// These steps are intentionally kept together so a failed fetch, bad
	// password, or malformed vault fails fast before any provider key is used.
	const ciphertext = await fetchVaultText(vaultUrl);
	const raw = await decryptAiConfig(ciphertext, secret);
	const config = transformRawConfig(raw);

	// Update cache and return.
	// The timestamp is based on wall-clock time, which is sufficient for a
	// local TTL. If the process clock changes dramatically, the cache may be
	// refreshed earlier or later, but this does not expose key material.
	vaultCache = { config, fetchedAt: Date.now() };
	return config;
}

/**
 * Clears the vault cache, forcing the next load to fetch and decrypt fresh data.
 *
 * This is a conservative invalidation helper. It does not mutate any keys or
 * state; it only ensures that the next auto-mode request reads the latest vault
 * contents. The function is called after key-related failures because a vault
 * update may have already disabled or replaced the failing key.
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
// Crawler keys use the same health model as AI keys but do not use the 24h
// usage-stats optimizer. Crawlers usually do not emit token usage through the
// gateway model stream, so round-robin plus cooldown is the simplest reliable
// strategy.

/**
 * Tracks the current round-robin index for each crawler.
 *
 * The map key is the crawler name from the vault. The stored index is advanced
 * modulo the currently usable pool size, which means a failed key does not
 * permanently desynchronize the rotation.
 */
const crawlerRoundRobinIndexes = new Map<string, number>();

/**
 * Tracks health status for each crawler key.
 *
 * The internal map key is generated by `getCrawlerKeyId`, which includes only
 * the key suffix. The full key is kept in the value because it is needed when
 * persisting state and when checking cooldown expiration.
 */
const crawlerKeyStatuses = new Map<string, KeyStatus>();

/**
 * Generates a unique identifier for a crawler key.
 *
 * The suffix is used instead of the full key to avoid accidentally persisting
 * or logging complete secrets. Provider names are assumed to be non-secret
 * configuration labels.
 */
function getCrawlerKeyId(crawlerName: string, keyValue: string): string {
	return `${crawlerName}:${keyValue.slice(-8)}`;
}

/**
 * Checks if a crawler key is currently usable.
 *
 * A key with no tracked status is considered usable. Once a key reaches
 * `MAX_FAILURE_COUNT`, it enters cooldown and is skipped until
 * `KEY_COOLDOWN_MS` has elapsed. When cooldown expires, the status is removed
 * and the state file is scheduled for update so a future restart does not keep
 * the key disabled.
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
 * Marks a crawler key as failed.
 *
 * Failures are cumulative. The first failures are recorded so a later failure
 * can trigger cooldown, but the key remains eligible until the threshold is
 * reached. This avoids removing a key for a single transient provider outage.
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
 * Selects the next crawler key to use.
 *
 * Selection rules:
 * 1. Remove keys marked as `expired`.
 * 2. Prefer keys that are not currently in cooldown.
 * 3. If every key is cooling down, fall back to round-robin across all
 *    non-expired keys so the request can still be attempted.
 * 4. Advance the crawler's round-robin index after selection.
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

// ---- CrawlerKeyResolver implementation ----

/**
 * KeypoolCrawlerResolver - implements CrawlerKeyResolver for KeypoolLive.
 *
 * This resolver is intentionally small: it loads the vault, iterates through
 * configured crawlers, and returns the first crawler entry with a selectable
 * key. The caller owns what to do with the returned key, while this resolver
 * owns KeypoolLive-specific health tracking.
 */
export class KeypoolCrawlerResolver implements CrawlerKeyResolver {
	constructor(private readonly vaultUrl: string) {}

	async resolve(): Promise<ResolvedCrawlerConfig | null> {
		const vault = await loadAiVault(this.vaultUrl);

		// Access crawlers in the vault.
		// If the vault has no crawler section, this resolver cannot contribute a
		// key and returns `null` instead of throwing. That lets other resolvers
		// or fallback configuration be tried by the caller.
		const crawlers = vault.crawlers;
		if (!crawlers) return null;

		const entries = Object.entries(crawlers);
		if (!entries.length) return null;

		// Find the first crawler with a usable key.
		// The iteration order follows the vault JSON object order. Operators
		// can influence priority by ordering crawler entries accordingly.
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
 * Creates a CrawlerKeyResolver based on the KeypoolLive vault.
 *
 * This factory keeps the public API small. Callers only need the vault URL and
 * receive an object implementing the shared resolver interface.
 */
export function createKeypoolCrawlerResolver(
	vaultUrl: string,
): CrawlerKeyResolver {
	return new KeypoolCrawlerResolver(vaultUrl);
}

/**
 * Tracks the health and usage status of individual API keys.
 *
 * This is the runtime representation. The `key` field stores the full secret in
 * memory only so the module can compare cooldown expiration and persist the
 * correct suffix. It is never serialized directly.
 */
interface KeyStatus {
	key: string;
	cooledDownAt?: number; // Timestamp when key entered cooldown
	failureCount: number; // Number of consecutive failures
}

/**
 * Disk-safe representation of a key status.
 *
 * Unlike `KeyStatus`, this interface stores only the key suffix. This is the
 * privacy boundary between runtime memory and the local state file.
 */
interface PersistedKeyStatus {
	providerName: string;
	keySuffix: string;
	cooledDownAt?: number;
	failureCount: number;
}

/**
 * Disk-safe representation of the module's operational state.
 *
 * This file is not a secret store. It records selection hints and failure
 * cooldowns so rotation decisions survive process restarts, but it must never
 * contain full API keys.
 */
interface PersistedRoundRobinState {
	version: 1;
	roundRobinIndexes: Record<string, number>;
	keyStatuses: PersistedKeyStatus[];
}

/**
 * Cooldown period for failed keys (15 minutes).
 *
 * Cooldown is a circuit breaker, not a permanent ban. After three detected
 * key-related failures, the key is skipped long enough for provider-side rate
 * limits or temporary account issues to settle.
 */
const KEY_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Maximum allowed failures before a key enters cooldown.
 *
 * The threshold is intentionally low enough to protect availability, but high
 * enough to avoid abandoning a key for a single transient error.
 */
const MAX_FAILURE_COUNT = 3;

/**
 * Tracks the current round-robin index for each provider.
 *
 * This fallback index is used when all usable keys are cooling down. It is also
 * persisted so a restarted process does not always start from the first key.
 */
const roundRobinIndexes = new Map<string, number>();

/**
 * Tracks health status for each key.
 *
 * Keys are identified by provider name plus key suffix. The provider name
 * prevents a key suffix collision from affecting the wrong vault provider.
 */
const keyStatuses = new Map<string, KeyStatus>();

// Persistence is lazy-loaded and serialized through a single promise chain.
// Lazy loading avoids touching the filesystem on startup. The promise chain
// prevents concurrent writes from interleaving and corrupting the JSON state.
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
	// Allow tests and advanced deployments to choose an explicit path.
	// This is useful for hermetic tests, containers, or multi-tenant setups
	// where the default home-directory location is not appropriate.
	if (process.env[KEYPOOL_STATE_FILE_ENV]) {
		return process.env[KEYPOOL_STATE_FILE_ENV] as string;
	}

	// Default to ~/.cline/data/keypoolliveState.json if not specified.
	// This keeps KeypoolLive operational state next to Cline's other local data
	// without requiring a provider-specific config file.
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

		// Create the directory if it doesn't exist.
		// Persistence is best-effort, so filesystem errors are caught by the
		// outer `try`. In-memory rotation still works if the file cannot be
		// created.
		await fs.mkdir(path.dirname(statePath), { recursive: true });

		// Create an empty state file if it doesn't exist.
		// An empty file makes future writes deterministic and avoids repeated
		// attempts to create the same file on every request.
		try {
			await fs.access(statePath);
		} catch {
			// File doesn't exist, create an empty one.
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

		// Load existing state if available.
		// State is treated as advisory. If the file is missing, malformed, or
		// has an unsupported version, the module simply starts with empty
		// runtime maps.
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
						// The persisted value is a suffix, not the full key. The
						// runtime helper only needs the suffix for ID generation
						// and for re-persisting the same suffix later.
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
	// Schedule a serialized best-effort write.
	// Multiple failures can happen quickly while streaming a request. Chaining
	// writes through a single promise prevents two concurrent writes from
	// reading/stale state and overwriting each other.
	persistentStateWriteChain = persistentStateWriteChain
		.then(async () => {
			const statePath = await getPersistentStatePath();
			const fs = await import("node:fs/promises");
			const path = await import("node:path");

			await fs.mkdir(path.dirname(statePath), { recursive: true });

			// Convert runtime state into the disk-safe format.
			// The internal map key is `providerName:keySuffix`; split it before
			// writing so the file remains easy to inspect without full secrets.
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

			// Write through a temporary file and rename atomically.
			// This avoids leaving a partially written JSON file if the process
			// crashes during a write. The state is advisory, so write errors are
			// swallowed and rotation continues in memory.
			const tmpPath = `${statePath}.tmp`;
			await fs.writeFile(tmpPath, `${JSON.stringify(persisted)}\n`, "utf8");
			await fs.rename(tmpPath, statePath);
		})
		.catch(() => {
			// Ignore write failures: in-memory rotation still works.
		});
}

/**
 * Checks if a key is currently usable (not in cooldown and below failure threshold).
 *
 * This function is the main health gate used by the key selector. It treats
 * missing state as healthy, expires cooldowns lazily, and schedules a state
 * write when a previously disabled key becomes usable again.
 *
 * @param providerName - Name of the vault provider
 * @param keyValue - API key string to check
 * @returns true if key is usable, false if in cooldown or has too many failures
 */
function isKeyUsable(providerName: string, keyValue: string): boolean {
	const status = keyStatuses.get(keyStatusId(providerName, keyValue));
	if (!status) return true; // No status record means key is usable

	// Check if key has exceeded failure threshold but cooldown has expired.
	// Cooldown expiration is lazy: the key is re-enabled when selection checks
	// it, not by a background timer. This keeps the module simple and avoids
	// scheduling work for keys that may never be used again.
	if (status.failureCount >= MAX_FAILURE_COUNT) {
		if (
			status.cooledDownAt &&
			Date.now() - status.cooledDownAt >= KEY_COOLDOWN_MS
		) {
			// Cooldown expired, remove status and allow key to be used again.
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
		// Remove any prior failure/cooldown state for this key.
		// A successful stream proves that the selected key can currently make
		// progress, so keeping it marked as failed would unnecessarily reduce
		// the available pool on the next request.
		keyStatuses.delete(id);
		persistStateSoon();
	}
}

/**
 * Marks a key as failed and updates its failure count.
 *
 * This is the core failure-recording path for automatic rotation. The first two
 * failures do not disable the key; they only increase the recorded count. On the
 * third consecutive failure the key enters cooldown and `isKeyUsable` will skip
 * it until `KEY_COOLDOWN_MS` has elapsed.
 *
 * The function does not throw on persistence errors. State persistence is
 * best-effort because losing the state file should not break live requests; the
 * in-memory map remains the authoritative state for the current process.
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
 * Selects the next key using 24h usage stats: min output tokens → min input tokens → min requests.
 * Falls back to round-robin when all keys are in cooldown, or when no usage data is available yet.
 *
 * Round-robin (rather than random) is used for the no-usage-data case so that
 * repeated calls within the same process — including retries after a failure —
 * deterministically cycle through the pool instead of risking an immediate
 * re-selection of the key that just failed.
 *
 * @param providerName - Name of the vault provider
 * @param keys - Array of available keys from the vault
 * @param statsMap - 24h usage stats keyed by keyHint (keyMask format)
 * @returns Next usable key, or null if no keys are available
 */
function selectNextKey(
	providerName: string,
	keys: VaultKey[],
	statsMap: Map<string, KeyStats24h>,
): VaultKey | null {
	const eligible = keys.filter((k) => k.type !== "expired");
	if (eligible.length === 0) return null;

	const usable = eligible.filter((k) => isKeyUsable(providerName, k.key));

	if (usable.length === 0) {
		// All keys in cooldown — fall back to round-robin on eligible
		const idx = (roundRobinIndexes.get(providerName) ?? 0) % eligible.length;
		roundRobinIndexes.set(providerName, (idx + 1) % eligible.length);
		persistStateSoon();
		return eligible[idx];
	}

	// If no key has any recorded usage, fall back to round-robin on usable keys
	const keysWithUsage = usable.filter((k) => statsMap.has(keyMask(k.key)));
	if (keysWithUsage.length === 0) {
		const idx = (roundRobinIndexes.get(providerName) ?? 0) % usable.length;
		roundRobinIndexes.set(providerName, (idx + 1) % usable.length);
		persistStateSoon();
		return usable[idx];
	}

	// Sort: min output tokens → min input tokens → min request count
	const sorted = [...usable].sort((a, b) => {
		const sa: KeyStats24h = statsMap.get(keyMask(a.key)) ?? { completionTokens: 0, promptTokens: 0, requestCount: 0 };
		const sb: KeyStats24h = statsMap.get(keyMask(b.key)) ?? { completionTokens: 0, promptTokens: 0, requestCount: 0 };
		if (sa.completionTokens !== sb.completionTokens) return sa.completionTokens - sb.completionTokens;
		if (sa.promptTokens !== sb.promptTokens) return sa.promptTokens - sb.promptTokens;
		return sa.requestCount - sb.requestCount;
	});
	return sorted[0];
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
	statsMap: Map<string, KeyStats24h> = new Map(),
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
	const key = selectNextKey(providerName, provider.keys, statsMap);
	if (!key) return null;

	// Normalize supportsImages from inputModalities for vault providers that use
	// the modalities array instead of an explicit boolean (e.g. Mistral). Without
	// this, images capability is deleted for every model that lacks supportsImages.
	const rawModel = model as VaultModel & { inputModalities?: string[] };
	const normalizedModel: VaultModel = {
		...model,
		supportsImages:
			model.supportsImages ??
			(Array.isArray(rawModel.inputModalities) &&
				rawModel.inputModalities.includes("image")),
	};

	// Return complete resolved configuration
	return {
		providerName,
		protocol: provider.protocol,
		endpoint: provider.endpoint,
		userAgent: provider.userAgent,
		apiKey: key.key,
		keyOwner: key.owner,
		model: normalizedModel,
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
		case "poolside": {
			const { createPoolsideProvider } = await import("../ai-sdk");
			factory = createPoolsideProvider;
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

// ─── Remote storage configuration ─────────────────────────────────────────────

/**
 * Remote storage mode configuration.
 * When set, usage/error stats are sent to the Cloudflare Worker instead of local NDJSON.
 */
interface KeypoolRemoteStorageConfig {
	workerUrl: string;
	authToken: string;
}

let remoteStorageConfig: KeypoolRemoteStorageConfig | null = null;

/**
 * Configures remote storage mode.
 * Call this before using the provider to enable shared statistics.
 */
export function setKeypoolRemoteStorage(config: KeypoolRemoteStorageConfig): void {
	remoteStorageConfig = config;
}

/**
 * Returns the effective remote storage config.
 * Priority:
 * 1. Explicitly set via setKeypoolRemoteStorage() (workerUrl overridden by env if HTTP)
 * 2. Auto-detected from KEYPOOL_USAGE_DB_DIR (HTTP URL) + KEYPOOL_LIVE_SECRET
 */
function getEffectiveRemoteConfig(): KeypoolRemoteStorageConfig | null {
	const envUrl = process.env[KEYPOOL_USAGE_DB_DIR_ENV] ?? "";
	const isHttpUrl = envUrl.startsWith("https://") || envUrl.startsWith("http://");
	if (remoteStorageConfig) {
		return isHttpUrl ? { ...remoteStorageConfig, workerUrl: envUrl } : remoteStorageConfig;
	}
	// Auto-detect from env vars when no explicit config is set
	const secret = process.env.KEYPOOL_LIVE_SECRET ?? "";
	if (isHttpUrl && secret) {
		return { workerUrl: envUrl, authToken: secret };
	}
	return null;
}

/**
 * Returns whether remote storage mode is enabled.
 */
export function isKeypoolRemoteStorageEnabled(): boolean {
	return getEffectiveRemoteConfig() !== null;
}

// ─── NDJSON usage recording ───────────────────────────────────────────────────
// Compatible with apps/vscode/src/core/keypoollive/KeypoolUsageDb.ts record format.
// Directory: KEYPOOL_USAGE_DB_DIR env var, or ~/.cline/data/keypoollive/
// Usage recording can also use a https://github.com/sctg-development/ai-proxy-cloudflare backend for shared stats across multiple clients.
// If KEYPOOL_USAGE_DB_DIR starts with "https://" or "http://", it is treated as a remote worker URL and usage is sent there instead of local NDJSON.

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

/**
 * Records usage to the remote worker or local NDJSON.
 */
async function recordKeypoolUsage(
	entry: Omit<NdjsonUsageEntry, "ts">,
): Promise<void> {
	const effectiveRemoteConfig = getEffectiveRemoteConfig();
	if (effectiveRemoteConfig) {
		// Remote mode: send to Cloudflare Worker
		try {
			const response = await fetch(
				`${effectiveRemoteConfig.workerUrl}/v1/keypool/usage`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${effectiveRemoteConfig.authToken}`,
					},
					body: JSON.stringify(entry),
				},
			);
			if (!response.ok) {
				console.error(
					`[keypoollive] Remote usage recording failed: ${response.status}`,
				);
			}
		} catch (e) {
			console.error("[keypoollive] Failed to record usage remotely:", e);
		}
	} else {
		// Local mode: write to NDJSON
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const dbDir = await getUsageDbDir();
		await fs.mkdir(dbDir, { recursive: true });
		const line =
			JSON.stringify({ ts: Date.now(), ...entry } satisfies NdjsonUsageEntry) +
			"\n";
		await fs.appendFile(path.join(dbDir, "usage.ndjson"), line, "utf8");
	}
}

/**
 * Records error to the remote worker or local NDJSON.
 */
async function recordKeypoolError(
	entry: Omit<NdjsonErrorEntry, "ts">,
): Promise<void> {
	const effectiveRemoteConfig = getEffectiveRemoteConfig();
	if (effectiveRemoteConfig) {
		// Remote mode: send to Cloudflare Worker
		try {
			const response = await fetch(
				`${effectiveRemoteConfig.workerUrl}/v1/keypool/error`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${effectiveRemoteConfig.authToken}`,
					},
					body: JSON.stringify(entry),
				},
			);
			if (!response.ok) {
				console.error(
					`[keypoollive] Remote error recording failed: ${response.status}`,
				);
			}
		} catch (e) {
			console.error("[keypoollive] Failed to record error remotely:", e);
		}
	} else {
		// Local mode: write to NDJSON
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const dbDir = await getUsageDbDir();
		await fs.mkdir(dbDir, { recursive: true });
		const line =
			JSON.stringify({ ts: Date.now(), ...entry } satisfies NdjsonErrorEntry) +
			"\n";
		await fs.appendFile(path.join(dbDir, "errors.ndjson"), line, "utf8");
	}
}

// ─── Usage stats for key selection ───────────────────────────────────────────

type KeyStats24h = {
	completionTokens: number;
	promptTokens: number;
	requestCount: number;
};

// Session-level accumulator: remote/file stats have latency (fire-and-forget
// writes, HTTP caching at the CF Worker) so they may not yet reflect tokens
// spent in this process. This map is updated synchronously after every
// successful stream so the next key selection immediately sees the real cost
// and can distribute load correctly across keys.
const sessionStatsAccumulator = new Map<string, Map<string, KeyStats24h>>();

function addToSessionStats(
	providerName: string,
	keyHint: string,
	inputTokens: number,
	outputTokens: number,
): void {
	let providerMap = sessionStatsAccumulator.get(providerName);
	if (!providerMap) {
		providerMap = new Map();
		sessionStatsAccumulator.set(providerName, providerMap);
	}
	const existing = providerMap.get(keyHint);
	if (existing) {
		existing.completionTokens += outputTokens;
		existing.promptTokens += inputTokens;
		existing.requestCount += 1;
	} else {
		providerMap.set(keyHint, {
			completionTokens: outputTokens,
			promptTokens: inputTokens,
			requestCount: 1,
		});
	}
}

/** 
 * Reads usage.ndjson and returns a map from keyHint → 24h aggregated stats for the given provider. 
 * If environment variable is set, it will read from the remote storage instead.
 * remote endpoint can be used with: `curl "$KEYPOOL_USAGE_DB_DIR/v1/keypool/stats?period=day" -H "Authorization: Bearer $KEYPOOL_LIVE_SECRET"`
 * remote endpoint returns JSON of the form {"object":"list","data":[{"period":"2026-06-20","provider":"mistral","modelId":"mistral-vibe-cli-latest","keyOwner":"tester (apple)","keyHint":"***17ks0s12","promptTokens":39218,"completionTokens":559,"requestCount":3},{"period":"2026-06-20","provider":"mistral","modelId":"mistral-vibe-cli-latest","keyOwner":"example@none.com (microsoft)","keyHint":"***uUslaj","promptTokens":99348,"completionTokens":4987,"requestCount":8},{"period":"2026-06-20","provider":"mistral","modelId":"mistral-vibe-cli-latest","keyOwner":"user2.example.com","keyHint":"***a9ks98sd","promptTokens":48441,"completionTokens":2744,"requestCount":5}]
 * */
async function readProviderUsageStats24h(
	providerName: string,
): Promise<Map<string, KeyStats24h>> {
	const effectiveRemoteConfig = getEffectiveRemoteConfig();
	if (effectiveRemoteConfig) {
		try {
			const response = await fetch(
				`${effectiveRemoteConfig.workerUrl}/v1/keypool/stats?period=day`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${effectiveRemoteConfig.authToken}`,
					},
				},
			);
			if (!response.ok) {
				console.error(
					`[keypoollive] Remote usage stats fetch failed: ${response.status}`,
				);
				return new Map();
			}
			const data = (await response.json()) as {
				object: string;
				data: Array<{
					period: string;
					provider: string;
					keyHint: string;
					promptTokens: number;
					completionTokens: number;
					requestCount: number;
				}>;
			};
			const map = new Map<string, KeyStats24h>();
			for (const entry of data.data) {
				if (entry.provider !== providerName) continue;
				map.set(entry.keyHint, {
					completionTokens: entry.completionTokens,
					promptTokens: entry.promptTokens,
					requestCount: entry.requestCount,
				});
			}
			return map;
		} catch (e) {
			console.error("[keypoollive] Failed to fetch remote usage stats:", e);
			return new Map();
		}
	}

	// Local mode: read from usage.ndjson
	const map = new Map<string, KeyStats24h>();
	try {
		const [fs, path] = await Promise.all([
			import("node:fs/promises"),
			import("node:path"),
		]);
		const usagePath = path.join(await getUsageDbDir(), "usage.ndjson");
		let content: string;
		try {
			content = await fs.readFile(usagePath, "utf8");
		} catch {
			return map;
		}
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const r = JSON.parse(trimmed) as NdjsonUsageEntry;
				if (r.provider !== providerName || r.ts < cutoff) continue;
				const existing = map.get(r.keyHint);
				if (existing) {
					existing.completionTokens += r.completionTokens;
					existing.promptTokens += r.promptTokens;
					existing.requestCount++;
				} else {
					map.set(r.keyHint, {
						completionTokens: r.completionTokens,
						promptTokens: r.promptTokens,
						requestCount: 1,
					});
				}
			} catch {
				// skip malformed line
			}
		}
	} catch {
		// non-fatal: in-memory selection still works
	}
	return map;
}

/**
 * Reads usage stats (remote or file) and merges with the in-process session
 * accumulator. Session values are added on top of persistent stats so that
 * tokens spent in the current process are immediately visible to the key
 * selector even before the fire-and-forget write has completed.
 */
async function readProviderUsageStats24hMerged(
	providerName: string,
): Promise<Map<string, KeyStats24h>> {
	const base = await readProviderUsageStats24h(providerName);
	const session = sessionStatsAccumulator.get(providerName);
	if (!session || session.size === 0) return base;

	const merged = new Map(base);
	for (const [keyHint, sessionStat] of session) {
		const existing = merged.get(keyHint);
		if (existing) {
			merged.set(keyHint, {
				completionTokens: existing.completionTokens + sessionStat.completionTokens,
				promptTokens: existing.promptTokens + sessionStat.promptTokens,
				requestCount: existing.requestCount + sessionStat.requestCount,
			});
		} else {
			merged.set(keyHint, { ...sessionStat });
		}
	}
	return merged;
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
 *
 * The provider factory implements a sophisticated key rotation algorithm that:
 * 1. Supports both auto mode (vault-based) and explicit key mode
 * 2. Implements intelligent key selection based on usage statistics
 * 3. Automatically detects and handles key-related errors
 * 4. Provides detailed event logging and telemetry
 * 5. Persists usage and error data for analysis
 *
 * Key rotation strategy:
 * - Primary: Select key with lowest 24h output tokens (to balance costs)
 * - Secondary: Select key with lowest 24h input tokens
 * - Tertiary: Select key with lowest request count
 * - Fallback: Round-robin selection when all keys are in cooldown
 * - Emergency: Random selection when no usage data is available
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

		// Read 24h usage stats merged with the in-process session accumulator so
		// tokens spent earlier in this run are visible even before remote writes land.
		const statsMap = isAuto
			? await readProviderUsageStats24hMerged(providerName)
			: new Map<string, KeyStats24h>();

		// Maximum number of key rotation attempts before giving up.
		// Scale with the vault key pool so all available keys are tried instead
		// of a hardcoded ceiling that silently ignores most of them.
		let MAX_KEY_ATTEMPTS = 5;
		if (isAuto) {
			try {
				const _preVault = await loadAiVault(getRequiredVaultUrl());
				const _poolKeys = _preVault.providers[providerName]?.keys;
				if (_poolKeys?.length) MAX_KEY_ATTEMPTS = _poolKeys.length;
			} catch { /* keep default */ }
		}
		let lastError: unknown;

		/**
		 * Key rotation loop - the core of the automatic key rotation system.
		 *
		 * This loop implements the following logic:
		 * 1. Select the next key based on usage statistics and health status
		 * 2. Attempt to use the selected key to process the request
		 * 3. If successful, mark the key as healthy and return the result
		 * 4. If failed with a key-related error, mark the key as failed and try the next one
		 * 5. If failed with a non-key error, rethrow immediately
		 * 6. After MAX_KEY_ATTEMPTS failures, throw a comprehensive error
		 *
		 * This approach ensures maximum availability by automatically rotating through
		 * available keys when issues are detected, while preserving non-key errors
		 * that require different handling.
		 */
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
				const resolved = resolveNextApiConfig(vault, providerName, modelId, statsMap);
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
				const keyStat = statsMap.get(maskedKey);
				context.logger?.log("KeypoolLive active key", {
					providerId: "keypoollive",
					severity: "info",
					providerName,
					modelId,
					key: maskedKey,
					keyUsage: {
						in: keyStat?.promptTokens ?? 0,
						out: keyStat?.completionTokens ?? 0,
						requests: keyStat?.requestCount ?? 0,
					},
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
				if (resolvedUserAgent) {
					context.keypoolEventHandler?.({
						type: "user-agent-set",
						userAgent: resolvedUserAgent,
						source: "config",
					});
				}
			}

			// Create sub-request with the actual (un-prefixed) model ID
			const subRequest: GatewayStreamRequest = {
				...request,
				modelId,
			};

			// Derive capabilities from vault model flags, overlaid on the context model's caps
			let resolvedCapabilities = context.model.capabilities;
			if (resolvedVaultModel) {
				const caps = new Set<GatewayModelCapability>(context.model.capabilities ?? []);
				(resolvedVaultModel.supportsImages ?? false) ? caps.add("images") : caps.delete("images");
				(resolvedVaultModel.supportsPromptCache ?? false) ? caps.add("prompt-cache") : caps.delete("prompt-cache");
				(resolvedVaultModel.supportsTools ?? false) ? caps.add("tools") : caps.delete("tools");
				resolvedCapabilities = Array.from(caps);
			}

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
					capabilities: resolvedCapabilities,
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
					// The AI SDK sub-provider (ai-sdk.ts) converts HTTP errors (e.g. 429 rate
					// limit) into a finish event with reason="error" instead of throwing.
					// If we yield it as-is, the try/catch below never fires, isKeyError is
					// never called, and markKeyAsHealthy() is called incorrectly.
					// Convert the error finish to a thrown exception so key rotation triggers.
					if (event.type === "finish" && event.reason === "error") {
						throw new Error(
							typeof event.error === "string" && event.error
								? event.error
								: "Stream finished with error",
						);
					}
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
					// Update session accumulator synchronously so the next key
					// selection in this process reflects these tokens immediately,
					// without waiting for the remote/file write to complete.
					addToSessionStats(providerName, maskedKey, inputTokens, outputTokens);
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
					// Persist to shared storage (fire-and-forget; failures are non-fatal)
					void recordKeypoolUsage({
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

				// Persist error to shared storage (fire-and-forget)
				void recordKeypoolError({
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
