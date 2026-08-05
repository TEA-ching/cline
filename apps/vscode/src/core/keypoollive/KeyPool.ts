/*
 * KeypoolLive — KeyPool: round-robin selection, health tracking, model descriptions
 * © 2026 Ronan LE MEILLAT — MIT License
 *
 * KeyPool is the central component of KeypoolLive that manages API key selection and health tracking.
 *
 * Main Features:
 *   • Round-robin selection: distributes requests evenly among keys from the same provider.
 *   • Key health tracking: records consecutive failures and places keys on cooldown after a threshold.
 *   • Cooldown management: keys that have failed too many times are temporarily avoided (default 15 minutes).
 *   • State persistence: saves round-robin indexes and key statuses in a JSON file.
 *   • Configuration resolution: selects the best available key and resolves the complete API configuration.
 *   • Model description generation: builds a readable list for the user interface with model details.
 *   • Gateway routing: supports the use of an AI Gateway (e.g., Cloudflare) for outgoing traffic.
 *   • Reset: allows clearing the internal state during configuration reloads.
 *
 * The module ensures high availability by avoiding failed keys while maintaining balanced load distribution
 * of loads among valid keys, and provides complete metadata for displaying models in the UI.
 */

import { accessSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { Logger } from "@/shared/services/Logger";
import { KeypoolUsageDb } from "./KeypoolUsageDb";
import type {
	AiVaultConfig,
	KeypoolLiveConfig,
	ResolvedApiConfig,
	VaultKey,
	VaultModel,
} from "./types";

/**
 * Tracks the health and failure status of a specific API key.
 * This interface stores metadata about key performance including failure counts,
 * cooldown periods, and usage statistics for load balancing decisions.
 */
interface KeyStatus {
	/** The full API key string. */
	key: string;
	/** Timestamp (ms) when the key was put into cooldown due to too many failures. */
	cooledDownAt?: number;
	/** Number of consecutive failures observed for this key. */
	failureCount: number;
	/** Timestamp (ms) of the last successful request for this key. */
	lastUsedAt?: number;
	/** Number of requests made with this key in the last 24 hours. */
	requestCount24h?: number;
}

/**
 * Interface for persisted key status data.
 * Used for serialization to disk, containing only the essential information
 * needed to restore key status without storing sensitive full API keys.
 */
interface PersistedKeyStatus {
	providerName: string;
	keySuffix: string;
	cooledDownAt?: number;
	failureCount: number;
	lastUsedAt?: number;
	requestCount24h?: number;
}

/**
 * Interface for the complete persisted state.
 * Represents the entire state that gets saved to and loaded from disk,
 * including round-robin indexes and key health statuses.
 */
interface PersistedRoundRobinState {
	version: 1;
	roundRobinIndexes: Record<string, number>;
	keyStatuses: PersistedKeyStatus[];
}

/**
 * Duration for which a key is put on "cooldown" after reaching MAX_FAILURE_COUNT.
 * During this time, the key is avoided unless no other keys are available.
 * This prevents repeatedly trying failed keys while giving them time to recover.
 */
const KEY_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Threshold of consecutive failures before a key is marked as unhealthy.
 * Once a key reaches this threshold, it's placed on cooldown to prevent
 * further failures from affecting the user experience.
 */
const MAX_FAILURE_COUNT = 3;

/**
 * Keeps track of the current index for round-robin selection per provider.
 * The key is the provider name, and the value is the last used index.
 * This ensures even distribution of requests across available keys.
 */
const roundRobinIndexes = new Map<string, number>();

/**
 * Stores health information for keys that have encountered failures.
 * The map key is a unique ID generated from the provider and a hint of the API key.
 * This allows tracking key health without storing sensitive full API keys in memory.
 */
const keyStatuses = new Map<string, KeyStatus>();

/**
 * Tracks if persistent state has been loaded.
 * Prevents multiple concurrent loads and ensures state is loaded before use.
 */
let persistentStateLoaded = false;

/**
 * Cached path to the persistent state file, set after loadPersistentStateOnce resolves it.
 * This avoids repeated path resolution and provides consistent file location.
 */
let cachedStatePath: string | null = null;

/**
 * Environment variable name for custom state file path.
 * Allows users to override the default state file location for testing or special configurations.
 */
const KEYPOOL_STATE_FILE_ENV = "KEYPOOL_STATE_FILE";

/**
 * Default state file name.
 * Used when no custom path is specified via environment variable.
 */
const DEFAULT_KEYPOOL_STATE_FILE = "keypoollive-state.json";

/**
 * Generates a unique identifier for a key's health status.
 * We use the last 8 characters of the key as a hint to avoid storing full keys as map keys.
 * This provides a balance between security (not storing full keys) and functionality (tracking individual keys).
 *
 * @param providerName - The AI provider (e.g., 'anthropic').
 * @param keyValue - The full API key string.
 * @returns A unique identifier string in the format "provider:last8chars".
 */
function getKeyStatusId(providerName: string, keyValue: string): string {
	return `${providerName}:${keyValue.slice(-8)}`;
}

/**
 * Gets the path to the persistent state file.
 * Uses KEYPOOL_STATE_FILE environment variable if set,
 * otherwise defaults to ~/.cline/data/keypoollive-state.json
 *
 * The state file stores round-robin indexes and key health statuses to persist
 * load balancing decisions across application restarts.
 *
 * @returns Path to the state file
 */
function getPersistentStatePath(): string {
	if (process.env[KEYPOOL_STATE_FILE_ENV]) {
		return process.env[KEYPOOL_STATE_FILE_ENV] as string;
	}
	return path.join(homedir(), ".cline", "data", DEFAULT_KEYPOOL_STATE_FILE);
}

/**
 * Loads persistent state from file if it exists.
 * This should be called once at startup to restore round-robin indexes and key health statuses.
 *
 * The function handles several scenarios:
 * 1. Creates the state file if it doesn't exist
 * 2. Loads existing state if available and valid
 * 3. Validates the state version and data integrity
 * 4. Gracefully handles any errors (file not found, corrupt data, etc.)
 *
 * This ensures that load balancing decisions persist across application restarts.
 */
export async function loadPersistentStateOnce(): Promise<void> {
	if (persistentStateLoaded) {
		return;
	}
	persistentStateLoaded = true;

	try {
		const statePath = getPersistentStatePath();
		cachedStatePath = statePath;

		mkdirSync(path.dirname(statePath), { recursive: true });

		// Create an empty state file if it doesn't exist
		let fileExists = false;
		try {
			accessSync(statePath);
			fileExists = true;
		} catch {
			// File doesn't exist
		}

		if (!fileExists) {
			writeFileSync(
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
			const raw = readFileSync(statePath, "utf8");
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
				keyStatuses.set(`${status.providerName}:${status.keySuffix}`, {
					key: status.keySuffix,
					failureCount: Math.max(0, Math.trunc(status.failureCount)),
					cooledDownAt:
						typeof status.cooledDownAt === "number"
							? status.cooledDownAt
							: undefined,
					lastUsedAt:
						typeof status.lastUsedAt === "number"
							? status.lastUsedAt
							: undefined,
					requestCount24h:
						typeof status.requestCount24h === "number"
							? Math.max(0, Math.trunc(status.requestCount24h))
							: undefined,
				});
			}
		} catch {
			// Ignore: state file is optional and recreated on next write.
		}
	} catch {
		// Ignore: state file is optional and recreated on next write.
	}
}

/**
 * Writes the current state to disk synchronously.
 * Synchronous I/O guarantees the state survives process exit, matching the
 * behaviour of KeypoolUsageDb.recordUsage() which also uses appendFileSync.
 *
 * This function uses an atomic write pattern (write to temp file, then rename)
 * to prevent corruption and ensure data integrity. If the write fails,
 * the system continues to work with in-memory state, providing graceful degradation.
 */
function persistStateSoon(): void {
	try {
		const statePath = cachedStatePath ?? getPersistentStatePath();
		mkdirSync(path.dirname(statePath), { recursive: true });

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
					lastUsedAt: status.lastUsedAt,
					requestCount24h: status.requestCount24h,
				};
			}),
		};

		const tmpPath = `${statePath}.tmp`;
		writeFileSync(tmpPath, `${JSON.stringify(persisted)}\n`, "utf8");
		renameSync(tmpPath, statePath);
	} catch {
		// Ignore write failures: in-memory rotation still works.
	}
}

/**
 * Checks if a key is currently usable (not in cooldown and below failure threshold)
 *
 * @param providerName - Name of the vault provider
 * @param keyValue - API key string to check
 * @returns true if key is usable, false if in cooldown or has too many failures
 */
export function isKeyUsable(providerName: string, keyValue: string): boolean {
	const status = keyStatuses.get(getKeyStatusId(providerName, keyValue));
	if (!status) return true; // No status record means key is usable

	// Check if key has exceeded failure threshold but cooldown has expired
	if (status.failureCount >= MAX_FAILURE_COUNT) {
		if (
			status.cooledDownAt &&
			Date.now() - status.cooledDownAt >= KEY_COOLDOWN_MS
		) {
			// Cooldown expired, remove status and allow key to be used again
			keyStatuses.delete(getKeyStatusId(providerName, keyValue));
			persistStateSoon();
			return true;
		}
		return false; // Still in cooldown
	}
	return true; // Below failure threshold
}

/**
 * Records a failure for a specific API key.
 * If consecutive failures exceed the threshold, the key is placed on cooldown.
 *
 * @param providerName - The AI provider.
 * @param keyValue - The API key string.
 */
export async function markKeyAsFailed(
	providerName: string,
	keyValue: string,
): Promise<void> {
	// Ensure persistent state is loaded
	if (!persistentStateLoaded) {
		await loadPersistentStateOnce();
	}

	const id = getKeyStatusId(providerName, keyValue);
	const existing = keyStatuses.get(id);
	const failureCount = (existing?.failureCount ?? 0) + 1;
	keyStatuses.set(id, {
		key: keyValue,
		failureCount,
		cooledDownAt:
			failureCount >= MAX_FAILURE_COUNT ? Date.now() : existing?.cooledDownAt,
		lastUsedAt: existing?.lastUsedAt,
		requestCount24h: existing?.requestCount24h,
	});
	Logger.warn(
		`[KeypoolLive] Key ***${keyValue.slice(-8)} for ${providerName} failed (count: ${failureCount})`,
	);
	persistStateSoon();
}

/**
 * Picks the next available key for a provider using a balanced strategy.
 * It prioritizes keys that aren't on cooldown and have the least recent usage.
 * If all keys are on cooldown, it falls back to picking any non-expired key.
 *
 * @param providerName - The AI provider.
 * @param keys - List of available keys from the vault.
 * @returns The selected VaultKey or null if no keys are eligible.
 */
/**
 * A key with a future `quotaResetAt` is known to be exhausted until that
 * instant (e.g. a Mistral monthly quota). Unlike a cooldown guess, this is
 * externally-confirmed dead weight, so it's excluded at the same tier as
 * `type === "expired"` — never used, even as a last-resort fallback.
 */
function isQuotaExhausted(key: VaultKey): boolean {
	return !!key.quotaResetAt && Date.now() < Date.parse(key.quotaResetAt);
}

async function selectNextKey(
	providerName: string,
	keys: VaultKey[],
): Promise<VaultKey | null> {
	const eligible = keys.filter((k) => k.type !== "expired" && !isQuotaExhausted(k));
	if (eligible.length === 0) return null;

	const usable = eligible.filter((k) => isKeyUsable(providerName, k.key));
	if (usable.length === 0) {
		// All keys are in cooldown; pick any non-expired key as fallback
		const idx = (roundRobinIndexes.get(providerName) ?? 0) % eligible.length;
		roundRobinIndexes.set(providerName, (idx + 1) % eligible.length);
		persistStateSoon();
		return eligible[idx];
	}

	// Get 24h usage stats from the persistent DB and build a per-keyHint lookup
	const dayStats = await KeypoolUsageDb.getUsageStats("day");
	type KeyStats24h = { completionTokens: number; promptTokens: number; requestCount: number };
	const statsMap = new Map<string, KeyStats24h>();
	for (const stat of dayStats) {
		if (stat.provider !== providerName) continue;
		const hint = stat.keyHint.replace(/^\*+/, "");
		const existing = statsMap.get(hint);
		if (existing) {
			existing.completionTokens += stat.completionTokens;
			existing.promptTokens += stat.promptTokens;
			existing.requestCount += stat.requestCount;
		} else {
			statsMap.set(hint, {
				completionTokens: stat.completionTokens,
				promptTokens: stat.promptTokens,
				requestCount: stat.requestCount,
			});
		}
	}

	// If no key has any recorded usage, pick randomly
	const keysWithUsage = usable.filter((k) => statsMap.has(k.key.slice(-8)));
	if (keysWithUsage.length === 0) {
		const randomIdx = Math.floor(Math.random() * usable.length);
		Logger.debug(
			`[KeypoolLive] All keys for ${providerName} have no usage in the last 24h, selecting randomly key ***${usable[randomIdx].key.slice(-8)} owner ${usable[randomIdx].owner}`,
		);
		return usable[randomIdx];
	}

	// Sort: min input tokens → min output tokens → min request count
	const sorted = [...usable].sort((a, b) => {
		const sa: KeyStats24h = statsMap.get(a.key.slice(-8)) ?? { completionTokens: 0, promptTokens: 0, requestCount: 0 };
		const sb: KeyStats24h = statsMap.get(b.key.slice(-8)) ?? { completionTokens: 0, promptTokens: 0, requestCount: 0 };
		if (sa.promptTokens !== sb.promptTokens) return sa.promptTokens - sb.promptTokens;
		if (sa.completionTokens !== sb.completionTokens) return sa.completionTokens - sb.completionTokens;
		return sa.requestCount - sb.requestCount;
	});

	const selectedKey = sorted[0];
	const sel = statsMap.get(selectedKey.key.slice(-8));
	Logger.debug(
		`[KeypoolLive] Selected key with min output tokens for ${providerName}: ***${selectedKey.key.slice(-8)} (out=${sel?.completionTokens ?? 0}, in=${sel?.promptTokens ?? 0}, requests=${sel?.requestCount ?? 0})`,
	);
	return selectedKey;
}

/**
 * Resolves the complete API configuration for a given provider and model.
 * This includes picking the best available key and finding the model details.
 *
 * @param vault - The active AI vault configuration.
 * @param providerName - Name of the provider.
 * @param modelId - Optional model identifier. If omitted, the first chat model is used.
 * @returns A ResolvedApiConfig object ready for the API handler, or null if resolution fails.
 */
export async function resolveNextApiConfig(
	vault: AiVaultConfig,
	providerName: string,
	modelId?: string,
): Promise<ResolvedApiConfig | null> {
	const provider = vault.providers[providerName];
	if (!provider) return null;

	const chatModels = provider.models.filter(
		(m) => !m.usage || m.usage === "chat",
	);
	const model: VaultModel | undefined = modelId
		? (chatModels.find((m) => m.id === modelId) ?? chatModels[0])
		: chatModels[0];
	if (!model) return null;

	const key = await selectNextKey(providerName, provider.keys);
	if (!key) return null;

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

export type ModelDescription = {
	title: string;
	provider: string;
	clineProvider: string | null;
	clineModelId: string;
	endpoint?: string;
	gatewayUrl?: string;
	vaultProviderName: string;
	vaultModelId: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsImages?: boolean;
	supportsPromptCache?: boolean;
};

/**
 * Builds the list of model descriptions that will be injected into the UI.
 * Each entry corresponds to a chat-capable model in the vault.
 */
export function buildModelDescriptions(
	vault: AiVaultConfig,
	kplConfig?: KeypoolLiveConfig,
): ModelDescription[] {
	// Determine if we should route requests through an AI Gateway (e.g., Cloudflare AI Gateway).
	const useGateway =
		(kplConfig?.useGateway ?? false) &&
		!!kplConfig?.gatewaySecret &&
		!!kplConfig?.gatewayId;
	const descriptions: ModelDescription[] = [];

	for (const [providerName, provider] of Object.entries(vault.providers)) {
		// We only expose models intended for 'chat' usage to the UI.
		const chatModels = provider.models.filter(
			(m) => !m.usage || m.usage === "chat",
		);
		const clineProvider = mapToClineProvider(providerName, provider.protocol);

		for (const model of chatModels) {
			const endpoint = provider.endpoint;
			let gatewayUrl: string | undefined;

			// If the gateway is enabled, we construct a Cloudflare-compatible gateway URL.
			// The slug often differs from our internal provider name (e.g., Gemini is 'google-ai-studio').
			if (useGateway && kplConfig?.gatewayId) {
				const cfSlug =
					provider.protocol === "gemini"
						? "google-ai-studio"
						: provider.protocol === "anthropic"
							? "anthropic"
							: provider.protocol === "openai"
								? "openai"
								: providerName;
				gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${kplConfig.gatewayId}/${cfSlug}`;
			}

			const modelLabel = model.name ?? model.id;
			descriptions.push({
				title: `[KeypoolLive] ${providerName}/${modelLabel}`,
				provider: providerName,
				clineProvider,
				clineModelId: model.id,
				endpoint,
				gatewayUrl,
				vaultProviderName: providerName,
				vaultModelId: model.id,
				contextWindow: model.contextWindow,
				maxOutputTokens: model.maxOutputTokens,
				supportsImages: model.supportsImages,
				supportsPromptCache: model.supportsPromptCache,
			});
		}
	}

	return descriptions;
}

/**
 * Maps a vault provider name to the provider identifier used by the Cline extension core.
 * This ensures compatibility with existing Cline API handlers.
 *
 * @param providerName - Provider name from the vault.
 * @param protocol - The protocol used (openai, anthropic, gemini).
 * @returns The Cline-compatible provider name or null.
 */
function mapToClineProvider(
	providerName: string,
	protocol: string,
): string | null {
	const mapping: Record<string, string> = {
		anthropic: "anthropic",
		openai: "openai",
		gemini: "gemini",
		google: "gemini",
		mistral: "mistral",
		groq: "groq",
		openrouter: "openrouter",
		sambanova: "sambanova",
		cohere: "cohere",
	};
	return (
		mapping[providerName.toLowerCase()] ??
		(protocol === "openai" ? "openai" : null)
	);
}

/**
 * Resets the entire key pool state.
 * Clears round-robin indexes and all key health tracking info.
 * Useful when the vault is reloaded or the configuration changes significantly.
 */
export function resetKeyPool(): void {
	roundRobinIndexes.clear();
	keyStatuses.clear();
	persistStateSoon();
}

/**
 * Records a successful request for a specific API key.
 * Updates the last used timestamp and request count for the last 24 hours.
 *
 * @param providerName - The AI provider.
 * @param keyValue - The API key string.
 */
export async function markKeyAsUsed(
	providerName: string,
	keyValue: string,
): Promise<void> {
	// Ensure persistent state is loaded
	if (!persistentStateLoaded) {
		await loadPersistentStateOnce();
	}

	const id = getKeyStatusId(providerName, keyValue);
	const existing = keyStatuses.get(id);
	const now = Date.now();

	// Reset request count if it's from a different day
	let requestCount24h = 1;
	if (existing?.lastUsedAt) {
		// If last used was more than 24 hours ago, reset count
		if (now - existing.lastUsedAt > 24 * 60 * 60 * 1000) {
			requestCount24h = 1;
		} else {
			requestCount24h = (existing.requestCount24h ?? 0) + 1;
		}
	}

	keyStatuses.set(id, {
		key: keyValue,
		failureCount: existing?.failureCount ?? 0,
		cooledDownAt: existing?.cooledDownAt,
		lastUsedAt: now,
		requestCount24h: requestCount24h,
	});

	persistStateSoon();
}
