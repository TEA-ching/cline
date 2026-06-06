/*
 * KeypoolLive — KeyPool: round-robin selection, health tracking, model descriptions
 * © 2026 Ronan LE MEILLAT — MIT License
 *
 * KeyPool est le composant central de KeypoolLive qui gère la sélection et la santé des clés API.
 *
 * Fonctionnalités principales :
 *   • Sélection round-robin : distribue les requêtes de manière équitable entre les clés d'un même fournisseur.
 *   • Suivi de la santé des clés : enregistre les échecs consécutifs et place les clés en cooldown après un seuil.
 *   • Gestion des cooldowns : les clés ayant trop échoué sont temporairement évitées (15 minutes par défaut).
 *   • Persistance d'état : sauvegarde les index round-robin et les statuts des clés dans un fichier JSON.
 *   • Résolution de configuration : sélectionne la meilleure clé disponible et résout la configuration API complète.
 *   • Génération de descriptions de modèles : construit une liste lisible pour l'interface utilisateur avec les détails des modèles.
 *   • Routage via gateway : supporte l'utilisation d'un AI Gateway (ex. Cloudflare) pour le trafic sortant.
 *   • Réinitialisation : permet de vider l'état interne lors de rechargements de configuration.
 *
 * Le module assure une haute disponibilité en évitant les clés défaillantes tout en maintenant une distribution équilibrée
 * des charges entre les clés valides, et fournit des métadonnées complètes pour l'affichage des modèles dans l'UI.
 */

import { homedir } from "os";
import path from "path";
import { Logger } from "@/shared/services/Logger";
import type {
	AiVaultConfig,
	KeypoolLiveConfig,
	ResolvedApiConfig,
	VaultKey,
	VaultModel,
} from "./types";

/**
 * Tracks the health and failure status of a specific API key.
 */
interface KeyStatus {
	/** The full API key string. */
	key: string;
	/** Timestamp (ms) when the key was put into cooldown due to too many failures. */
	cooledDownAt?: number;
	/** Number of consecutive failures observed for this key. */
	failureCount: number;
}

/**
 * Interface for persisted key status data.
 */
interface PersistedKeyStatus {
	providerName: string;
	keySuffix: string;
	cooledDownAt?: number;
	failureCount: number;
}

/**
 * Interface for the complete persisted state.
 */
interface PersistedRoundRobinState {
	version: 1;
	roundRobinIndexes: Record<string, number>;
	keyStatuses: PersistedKeyStatus[];
}

/**
 * Duration for which a key is put on "cooldown" after reaching MAX_FAILURE_COUNT.
 * During this time, the key is avoided unless no other keys are available.
 */
const KEY_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Threshold of consecutive failures before a key is marked as unhealthy.
 */
const MAX_FAILURE_COUNT = 3;

/**
 * Keeps track of the current index for round-robin selection per provider.
 * The key is the provider name, and the value is the last used index.
 */
const roundRobinIndexes = new Map<string, number>();

/**
 * Stores health information for keys that have encountered failures.
 * The map key is a unique ID generated from the provider and a hint of the API key.
 */
const keyStatuses = new Map<string, KeyStatus>();

/**
 * Tracks if persistent state has been loaded.
 */
let persistentStateLoaded = false;

/**
 * Tracks pending write operations to avoid overlapping file operations.
 */
let persistentStateWriteChain: Promise<void> = Promise.resolve();

/**
 * Environment variable name for custom state file path.
 */
const KEYPOOL_STATE_FILE_ENV = "KEYPOOL_STATE_FILE";

/**
 * Default state file name.
 */
const DEFAULT_KEYPOOL_STATE_FILE = "keypoollive-state.json";

/**
 * Generates a unique identifier for a key's health status.
 * We use the last 8 characters of the key as a hint to avoid storing full keys as map keys.
 *
 * @param providerName - The AI provider (e.g., 'anthropic').
 * @param keyValue - The full API key string.
 * @returns A unique identifier string.
 */
function getKeyStatusId(providerName: string, keyValue: string): string {
	return `${providerName}:${keyValue.slice(-8)}`;
}

/**
 * Gets the path to the persistent state file.
 * Uses KEYPOOL_STATE_FILE environment variable if set,
 * otherwise defaults to ~/.cline/data/keypoollive-state.json
 *
 * @returns Path to the state file
 */
async function getPersistentStatePath(): Promise<string> {
	if (process.env[KEYPOOL_STATE_FILE_ENV]) {
		return process.env[KEYPOOL_STATE_FILE_ENV] as string;
	}

	// Default to ~/.cline/data/keypoollive-state.json if not specified
	const homeDir = homedir();
	return path.join(homeDir, ".cline", "data", DEFAULT_KEYPOOL_STATE_FILE);
}

/**
 * Loads persistent state from file if it exists.
 * This should be called once at startup.
 */
export async function loadPersistentStateOnce(): Promise<void> {
	if (persistentStateLoaded) {
		return;
	}
	persistentStateLoaded = true;

	try {
		const statePath = await getPersistentStatePath();
		const fs = await import("fs");
		const path = await import("path");

		// Create the directory if it doesn't exist
		await fs.promises.mkdir(path.dirname(statePath), { recursive: true });

		// Create an empty state file if it doesn't exist
		try {
			await fs.promises.access(statePath);
		} catch {
			// File doesn't exist, create an empty one
			await fs.promises.writeFile(
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
			const raw = await fs.promises.readFile(statePath, "utf8");
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
 * Schedules a write of the current state to disk.
 * Uses a promise chain to avoid overlapping writes.
 */
function persistStateSoon(): void {
	persistentStateWriteChain = persistentStateWriteChain
		.then(async () => {
			try {
				const statePath = await getPersistentStatePath();
				const fs = await import("fs");
				const path = await import("path");

				await fs.promises.mkdir(path.dirname(statePath), { recursive: true });

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

				const tmpPath = `${statePath}.tmp`;
				await fs.promises.writeFile(
					tmpPath,
					`${JSON.stringify(persisted)}\n`,
					"utf8",
				);
				await fs.promises.rename(tmpPath, statePath);
			} catch {
				// Ignore write failures: in-memory rotation still works.
			}
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
	});
	Logger.warn(
		`[KeypoolLive] Key ...${keyValue.slice(-8)} for ${providerName} failed (count: ${failureCount})`,
	);
	persistStateSoon();
}

/**
 * Picks the next available key for a provider using a round-robin strategy.
 * It prioritizes keys that aren't on cooldown. If all keys are on cooldown,
 * it falls back to picking any non-expired key.
 *
 * @param providerName - The AI provider.
 * @param keys - List of available keys from the vault.
 * @returns The selected VaultKey or null if no keys are eligible.
 */
function selectNextKey(
	providerName: string,
	keys: VaultKey[],
): VaultKey | null {
	const eligible = keys.filter((k) => k.type !== "expired");
	if (eligible.length === 0) return null;

	const usable = eligible.filter((k) => isKeyUsable(providerName, k.key));
	if (usable.length === 0) {
		// All keys are in cooldown; pick any non-expired key as fallback
		const idx = (roundRobinIndexes.get(providerName) ?? 0) % eligible.length;
		roundRobinIndexes.set(providerName, (idx + 1) % eligible.length);
		persistStateSoon();
		return eligible[idx];
	}

	const idx = (roundRobinIndexes.get(providerName) ?? 0) % usable.length;
	roundRobinIndexes.set(providerName, (idx + 1) % usable.length);
	persistStateSoon();
	return usable[idx];
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
export function resolveNextApiConfig(
	vault: AiVaultConfig,
	providerName: string,
	modelId?: string,
): ResolvedApiConfig | null {
	const provider = vault.providers[providerName];
	if (!provider) return null;

	const chatModels = provider.models.filter(
		(m) => !m.usage || m.usage === "chat",
	);
	const model: VaultModel | undefined = modelId
		? (chatModels.find((m) => m.id === modelId) ?? chatModels[0])
		: chatModels[0];
	if (!model) return null;

	const key = selectNextKey(providerName, provider.keys);
	if (!key) return null;

	return {
		providerName,
		protocol: provider.protocol,
		endpoint: provider.endpoint,
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
