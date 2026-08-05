/**
 * Browser-compatible KeypoolLive provider
 *
 * This provider adapts the KeypoolLive functionality for browser environments
 * by using browser-compatible storage and environment configuration.
 */

import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
	CrawlerKeyResolver,
	ResolvedCrawlerConfig,
} from "@sctg/cline-shared";
import {
	getEnv,
	BrowserFileStorage,
	isBrowserEnvironment,
} from "@sctg/cline-core/browser-env";

// Re-export types for compatibility
export type {
	AgentModelEvent,
	GatewayProvider,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
	KeypoolEventHandler,
	CrawlerKeyResolver,
	ResolvedCrawlerConfig,
} from "@sctg/cline-shared";

// Browser-specific constants
const KEYPOOL_STATE_FILE_ENV = "KEYPOOL_STATE_FILE";
const DEFAULT_KEYPOOL_STATE_FILE = "keypoollive-state.json";
const KEYPOOL_USAGE_DB_DIR_ENV = "KEYPOOL_USAGE_DB_DIR";
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const KEY_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURE_COUNT = 3;
const MAX_KEY_ATTEMPTS = 5;

// Browser-compatible vault cache
interface VaultCache {
	config: any;
	fetchedAt: number;
}

let vaultCache: VaultCache | null = null;

// Browser-compatible key status tracking
interface KeyStatus {
	key: string;
	cooledDownAt?: number;
	failureCount: number;
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

const roundRobinIndexes = new Map<string, number>();
const keyStatuses = new Map<string, KeyStatus>();
let persistentStateLoaded = false;
let persistentStateWriteChain: Promise<void> = Promise.resolve();

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
export function setKeypoolRemoteStorage(
	config: KeypoolRemoteStorageConfig,
): void {
	remoteStorageConfig = config;
}

/**
 * Returns whether remote storage mode is enabled.
 */
export function isKeypoolRemoteStorageEnabled(): boolean {
	return remoteStorageConfig !== null;
}

/**
 * Browser-compatible environment variable access
 */
function getBrowserEnv(name: string): string | undefined {
	if (isBrowserEnvironment()) {
		return getEnv(name);
	}
	return process.env[name];
}

/**
 * Browser-compatible vault decryption and loading
 */
async function loadAiVault(vaultUrl: string): Promise<any> {
	// Return cached config if still valid
	if (vaultCache && Date.now() - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
		return vaultCache.config;
	}

	// Validate required environment variable
	const secret = getBrowserEnv("KEYPOOL_LIVE_SECRET");
	if (!secret) {
		throw new Error("KEYPOOL_LIVE_SECRET environment variable is not set");
	}

	// Fetch vault content. The secret doubles as the Bearer token: multi-tenant
	// backends (e.g. an ai-proxy Cloudflare Worker with per-group vaults) use it
	// to identify the caller and serve/re-encrypt their specific vault. Without
	// it, the backend cannot tell this caller apart from an anonymous request
	// and may fall back to a default vault encrypted with a different
	// password, which then fails to decrypt below.
	const ciphertext = await fetchVaultText(vaultUrl, secret);

	// Decrypt and transform the vault
	const raw = await decryptAiConfig(ciphertext, secret);
	const config = transformRawConfig(raw);

	// Update cache and return
	vaultCache = { config, fetchedAt: Date.now() };
	return config;
}

async function fetchVaultText(
	url: string,
	bearerToken?: string,
): Promise<string> {
	// Support file:// for local development (not applicable in browser)
	if (url.startsWith("file://")) {
		throw new Error("file:// protocol not supported in browser environment");
	}

	const res = await globalThis.fetch(url, {
		signal: AbortSignal.timeout(10_000),
		...(bearerToken
			? { headers: { Authorization: `Bearer ${bearerToken}` } }
			: {}),
	});

	if (!res.ok) {
		throw new Error(`Failed to fetch vault from ${url}: HTTP ${res.status}`);
	}

	return res.text();
}

async function decryptAiConfig(
	base64Ciphertext: string,
	password: string,
): Promise<any> {
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
	return JSON.parse(new TextDecoder().decode(plaintext));
}

function transformRawConfig(raw: any): any {
	const vault: any = {
		version: raw.version,
		providers: {},
	};

	// Transform providers
	for (const [name, p] of Object.entries(raw.providers)) {
		vault.providers[name] = {
			protocol: p.protocol,
			endpoint: p.endpoint,
			userAgent: p.userAgent,
			keys: p.keys.map((k: any) => ({
				key: k.key,
				owner: k.owner ?? "unknown",
				type: k.type ?? "paid",
			})),
			models: p.models.map((m: any) => ({ ...m })),
		};
	}

	// Transform crawlers if present in the raw config
	if ("crawlers" in raw) {
		const rawCrawlers = raw as any;
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

function clearVaultCache(): void {
	vaultCache = null;
}

/**
 * Browser-compatible persistent state management
 */
async function getPersistentStatePath(): Promise<string> {
	const envPath = getBrowserEnv(KEYPOOL_STATE_FILE_ENV);
	if (envPath) {
		return envPath;
	}

	// In browser, we'll use a consistent storage key
	return DEFAULT_KEYPOOL_STATE_FILE;
}

async function loadPersistentStateOnce(): Promise<void> {
	if (persistentStateLoaded) {
		return;
	}
	persistentStateLoaded = true;

	try {
		const statePath = await getPersistentStatePath();
		const storage = new BrowserFileStorage(statePath);
		const existingState = await storage.read();

		if (existingState && existingState.version === 1) {
			// Load round robin indexes
			for (const [providerName, index] of Object.entries(
				existingState.roundRobinIndexes ?? {},
			)) {
				if (Number.isInteger(index) && index >= 0) {
					roundRobinIndexes.set(providerName, index);
				}
			}

			// Load key statuses
			for (const status of existingState.keyStatuses ?? []) {
				if (
					typeof status.providerName !== "string" ||
					typeof status.keySuffix !== "string" ||
					typeof status.failureCount !== "number"
				) {
					continue;
				}
				keyStatuses.set(`${status.providerName}:${status.keySuffix}`, {
					key: status.keySuffix,
					failureCount: Math.max(0, Math.trunc(status.failureCount)),
					cooledDownAt:
						typeof status.cooledDownAt === "number"
							? status.cooledDownAt
							: undefined,
				});
			}
		}
	} catch {
		// Ignore: state file is optional and recreated on next write.
	}
}

function persistStateSoon(): void {
	persistentStateWriteChain = persistentStateWriteChain
		.then(async () => {
			const statePath = await getPersistentStatePath();
			const storage = new BrowserFileStorage(statePath);

			const persisted: PersistedRoundRobinState = {
				version: 1,
				roundRobinIndexes: Object.fromEntries(roundRobinIndexes.entries()),
				keyStatuses: Array.from(keyStatuses.entries()).map(([id, status]) => {
					const sep = id.indexOf(":");
					return {
						providerName: sep >= 0 ? id.slice(0, sep) : "unknown",
						keySuffix: sep >= 0 ? id.slice(sep + 1) : status.key.slice(-8),
						cooledDownAt: status.cooledDownAt,
						failureCount: status.failureCount,
					};
				}),
			};

			await storage.write(persisted);
		})
		.catch(() => {
			// Ignore write failures: in-memory rotation still works.
		});
}

/**
 * Browser-compatible key management functions
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

function isKeyUsable(providerName: string, keyValue: string): boolean {
	const status = keyStatuses.get(keyStatusId(providerName, keyValue));
	if (!status) return true;

	if (status.failureCount >= MAX_FAILURE_COUNT) {
		if (
			status.cooledDownAt &&
			Date.now() - status.cooledDownAt >= KEY_COOLDOWN_MS
		) {
			keyStatuses.delete(keyStatusId(providerName, keyValue));
			persistStateSoon();
			return true;
		}
		return false;
	}
	return true;
}

function markKeyAsHealthy(providerName: string, keyValue: string): void {
	const id = keyStatusId(providerName, keyValue);
	if (keyStatuses.has(id)) {
		keyStatuses.delete(id);
		persistStateSoon();
	}
}

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

function selectNextKey(providerName: string, keys: any[]): any | null {
	const eligible = keys.filter((k) => k.type !== "expired");
	if (eligible.length === 0) return null;

	const usable = eligible.filter((k) => isKeyUsable(providerName, k.key));
	const pool = usable.length ? usable : eligible;

	const idx = (roundRobinIndexes.get(providerName) ?? 0) % pool.length;
	roundRobinIndexes.set(providerName, (idx + 1) % pool.length);
	persistStateSoon();
	return pool[idx];
}

// ─── Browser-compatible usage recording ───────────────────────────────────────────
async function getUsageDbDir(): Promise<string> {
	const envDir = getBrowserEnv(KEYPOOL_USAGE_DB_DIR_ENV);
	if (envDir) {
		return envDir;
	}

	// In browser, we'll use a consistent storage key
	return "keypoollive";
}

/**
 * Records usage to the remote worker or local NDJSON.
 */
async function recordKeypoolUsage(entry: any): Promise<void> {
	if (remoteStorageConfig) {
		// Remote mode: send to Cloudflare Worker
		try {
			const response = await fetch(
				`${remoteStorageConfig.workerUrl}/v1/keypool/usage`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${remoteStorageConfig.authToken}`,
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
		const dbDir = await getUsageDbDir();
		const storage = new BrowserFileStorage(`${dbDir}/usage.ndjson`);

		const existingData = await storage.read();
		const lines = existingData
			? Array.isArray(existingData)
				? existingData
				: [existingData]
			: [];
		lines.push(entry);

		await storage.write(lines);
	}
}

/**
 * Records error to the remote worker or local NDJSON.
 */
async function recordKeypoolError(entry: any): Promise<void> {
	if (remoteStorageConfig) {
		// Remote mode: send to Cloudflare Worker
		try {
			const response = await fetch(
				`${remoteStorageConfig.workerUrl}/v1/keypool/error`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${remoteStorageConfig.authToken}`,
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
		const dbDir = await getUsageDbDir();
		const storage = new BrowserFileStorage(`${dbDir}/errors.ndjson`);

		const existingData = await storage.read();
		const lines = existingData
			? Array.isArray(existingData)
				? existingData
				: [existingData]
			: [];
		lines.push(entry);

		await storage.write(lines);
	}
}

/**
 * Browser-compatible KeypoolLive provider factory
 */
export const createKeypoolliveProvider: GatewayProviderFactory = (config) => ({
	async *stream(
		request: GatewayStreamRequest,
		context: GatewayProviderContext,
	): AsyncIterable<AgentModelEvent> {
		await loadPersistentStateOnce();

		// Parse the composite modelId to extract provider name and actual model ID
		const slashIndex = request.modelId.indexOf("/");
		if (slashIndex <= 0) {
			throw new Error(
				`[keypoollive] modelId must be in format "providerName/modelId", got: "${request.modelId}"`,
			);
		}
		const providerName = request.modelId.slice(0, slashIndex);
		const modelId = request.modelId.slice(slashIndex + 1);

		// Determine if we're in auto mode (vault-based) or explicit key mode
		const apiKeyValue = config.apiKey?.trim();
		const isAuto = !apiKeyValue || apiKeyValue === "auto";

		// Validate vault URL if in auto mode
		let vaultUrl: string | undefined;
		if (isAuto) {
			vaultUrl = getBrowserEnv("KEYPOOL_VAULT_URL");
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

		// Key rotation loop
		for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
			let resolvedApiKey: string;
			let resolvedEndpoint: string | undefined;
			let resolvedProtocol: string = "openai";
			let resolvedVaultModel: any | undefined;
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
				const provider = vault.providers[providerName];
				if (!provider) {
					throw new Error(
						`[keypoollive] No provider found for "${providerName}" in vault`,
					);
				}

				// Find the requested model or use the first available chat model
				const chatModels = provider.models.filter(
					(m: any) => !m.usage || m.usage === "chat",
				);
				const model = modelId
					? (chatModels.find((m: any) => m.id === modelId) ?? chatModels[0])
					: chatModels[0];
				if (!model) {
					throw new Error(
						`[keypoollive] No chat model found for provider "${providerName}"`,
					);
				}

				// Select the next key to use
				const key = selectNextKey(providerName, provider.keys);
				if (!key) {
					throw new Error(
						`[keypoollive] No usable key found for provider "${providerName}" model "${modelId}"`,
					);
				}

				resolvedApiKey = key.key;
				resolvedEndpoint = provider.endpoint;
				resolvedProtocol = provider.protocol;
				resolvedVaultModel = model;
				resolvedKeyOwner = key.owner;
				resolvedUserAgent = provider.userAgent;
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
				(context as any).keypoolEventHandler?.({
					type: "key-selected",
					providerName,
					modelId,
					keyHint: maskedKey,
					keyOwner: resolvedKeyOwner,
					roundRobin: selectedByRoundRobin,
				});
				if (resolvedUserAgent) {
					(context as any).keypoolEventHandler?.({
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
				// Import the appropriate provider factory based on protocol
				let factory: GatewayProviderFactory;
				switch (resolvedProtocol) {
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
						const { createOpenAICompatibleProvider } = await import(
							"../ai-sdk"
						);
						factory = createOpenAICompatibleProvider;
						break;
					}
				}

				// Create protocol-specific provider and stream the request
				const subProvider = factory(subConfig);
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
				(context as any).keypoolEventHandler?.({
					type: "key-recovered",
					providerName,
					modelId,
					keyHint: maskedKey,
					keyOwner: resolvedKeyOwner,
				});
				if (inputTokens > 0 || outputTokens > 0) {
					(context as any).keypoolEventHandler?.({
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
				const lastError = err;

				// Don't rotate keys for non-key errors or when using explicit keys
				if (!isAuto) {
					throw err;
				}

				// Simple error detection for key-related failures
				const isKeyError = detectKeyError(err);
				if (!isKeyError) {
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

				(context as any).keypoolEventHandler?.({
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
					(context as any).keypoolEventHandler?.({
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
		throw new Error("KeypoolLive: All key rotation attempts failed");
	},
});

/**
 * Browser-compatible crawler key resolver
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
			const key = selectNextKey(crawlerName, crawler.keys);
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

export function createKeypoolCrawlerResolver(
	vaultUrl: string,
): CrawlerKeyResolver {
	return new KeypoolCrawlerResolver(vaultUrl);
}

/**
 * Helper functions for error detection
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

function detectKeyError(error: unknown): boolean {
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

/**
 * Manual key rotation function for browser environment
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

/**
 * Get keypool key states for monitoring
 */
export function getKeypoolKeyStates(providerName?: string): any[] {
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
