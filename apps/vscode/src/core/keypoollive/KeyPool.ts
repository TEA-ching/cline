// KeypoolLive — KeyPool: round-robin selection, health tracking, model descriptions
// © 2026 Ronan LE MEILLAT — MIT License

import { Logger } from "@/shared/services/Logger"
import type { AiVaultConfig, KeypoolLiveConfig, ResolvedApiConfig, VaultKey, VaultModel } from "./types"

/**
 * Tracks the health and failure status of a specific API key.
 */
interface KeyStatus {
	/** The full API key string. */
	key: string
	/** Timestamp (ms) when the key was put into cooldown due to too many failures. */
	cooledDownAt?: number
	/** Number of consecutive failures observed for this key. */
	failureCount: number
}

/**
 * Duration for which a key is put on "cooldown" after reaching MAX_FAILURE_COUNT.
 * During this time, the key is avoided unless no other keys are available.
 */
const KEY_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Threshold of consecutive failures before a key is marked as unhealthy.
 */
const MAX_FAILURE_COUNT = 3

/**
 * Keeps track of the current index for round-robin selection per provider.
 * The key is the provider name, and the value is the last used index.
 */
const roundRobinIndexes = new Map<string, number>()

/**
 * Stores health information for keys that have encountered failures.
 * The map key is a unique ID generated from the provider and a hint of the API key.
 */
const keyStatuses = new Map<string, KeyStatus>()

/**
 * Generates a unique identifier for a key's health status.
 * We use the last 8 characters of the key as a hint to avoid storing full keys as map keys.
 *
 * @param providerName - The AI provider (e.g., 'anthropic').
 * @param keyValue - The full API key string.
 * @returns A unique identifier string.
 */
function getKeyStatusId(providerName: string, keyValue: string): string {
	return `${providerName}:${keyValue.slice(-8)}`
}

/**
 * Determines if an API key is currently healthy and eligible for use.
 * A key is unusable if it has exceeded the failure threshold and is still in its cooldown period.
 *
 * @param providerName - The AI provider.
 * @param keyValue - The API key string.
 * @returns True if the key is usable, false otherwise.
 */
function isKeyUsable(providerName: string, keyValue: string): boolean {
	const status = keyStatuses.get(getKeyStatusId(providerName, keyValue))
	// No recorded failures means it's usable.
	if (!status) return true

	// If the failure threshold is reached, check if the cooldown has expired.
	if (status.failureCount >= MAX_FAILURE_COUNT) {
		if (status.cooledDownAt && Date.now() - status.cooledDownAt >= KEY_COOLDOWN_MS) {
			// Cooldown finished: reset the status and make it usable again.
			keyStatuses.delete(getKeyStatusId(providerName, keyValue))
			return true
		}
		// Still in cooldown.
		return false
	}
	// Below threshold, still usable.
	return true
}

/**
 * Records a failure for a specific API key.
 * If consecutive failures exceed the threshold, the key is placed on cooldown.
 *
 * @param providerName - The AI provider.
 * @param keyValue - The API key string.
 */
export function markKeyAsFailed(providerName: string, keyValue: string): void {
	const id = getKeyStatusId(providerName, keyValue)
	const existing = keyStatuses.get(id)
	const failureCount = (existing?.failureCount ?? 0) + 1
	keyStatuses.set(id, {
		key: keyValue,
		failureCount,
		cooledDownAt: failureCount >= MAX_FAILURE_COUNT ? Date.now() : existing?.cooledDownAt,
	})
	Logger.warn(`[KeypoolLive] Key ...${keyValue.slice(-8)} for ${providerName} failed (count: ${failureCount})`)
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
function selectNextKey(providerName: string, keys: VaultKey[]): VaultKey | null {
	const eligible = keys.filter((k) => k.type !== "expired")
	if (eligible.length === 0) return null

	const usable = eligible.filter((k) => isKeyUsable(providerName, k.key))
	if (usable.length === 0) {
		// All keys are in cooldown; pick any non-expired key as fallback
		const idx = (roundRobinIndexes.get(providerName) ?? 0) % eligible.length
		roundRobinIndexes.set(providerName, (idx + 1) % eligible.length)
		return eligible[idx]
	}

	const idx = (roundRobinIndexes.get(providerName) ?? 0) % usable.length
	roundRobinIndexes.set(providerName, (idx + 1) % usable.length)
	return usable[idx]
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
export function resolveNextApiConfig(vault: AiVaultConfig, providerName: string, modelId?: string): ResolvedApiConfig | null {
	const provider = vault.providers[providerName]
	if (!provider) return null

	const chatModels = provider.models.filter((m) => !m.usage || m.usage === "chat")
	const model: VaultModel | undefined = modelId ? (chatModels.find((m) => m.id === modelId) ?? chatModels[0]) : chatModels[0]
	if (!model) return null

	const key = selectNextKey(providerName, provider.keys)
	if (!key) return null

	return {
		providerName,
		protocol: provider.protocol,
		endpoint: provider.endpoint,
		apiKey: key.key,
		keyOwner: key.owner,
		model,
	}
}

export type ModelDescription = {
	title: string
	provider: string
	clineProvider: string | null
	clineModelId: string
	endpoint?: string
	gatewayUrl?: string
	vaultProviderName: string
	vaultModelId: string
	contextWindow?: number
	maxOutputTokens?: number
	supportsImages?: boolean
	supportsPromptCache?: boolean
}

/**
 * Builds the list of model descriptions that will be injected into the UI.
 * Each entry corresponds to a chat-capable model in the vault.
 */
export function buildModelDescriptions(vault: AiVaultConfig, kplConfig?: KeypoolLiveConfig): ModelDescription[] {
	// Determine if we should route requests through an AI Gateway (e.g., Cloudflare AI Gateway).
	const useGateway = (kplConfig?.useGateway ?? false) && !!kplConfig?.gatewaySecret && !!kplConfig?.gatewayId
	const descriptions: ModelDescription[] = []

	for (const [providerName, provider] of Object.entries(vault.providers)) {
		// We only expose models intended for 'chat' usage to the UI.
		const chatModels = provider.models.filter((m) => !m.usage || m.usage === "chat")
		const clineProvider = mapToClineProvider(providerName, provider.protocol)

		for (const model of chatModels) {
			const endpoint = provider.endpoint
			let gatewayUrl: string | undefined

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
								: providerName
				gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${kplConfig.gatewayId}/${cfSlug}`
			}

			const modelLabel = model.name ?? model.id
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
			})
		}
	}

	return descriptions
}

/**
 * Maps a vault provider name to the provider identifier used by the Cline extension core.
 * This ensures compatibility with existing Cline API handlers.
 *
 * @param providerName - Provider name from the vault.
 * @param protocol - The protocol used (openai, anthropic, gemini).
 * @returns The Cline-compatible provider name or null.
 */
function mapToClineProvider(providerName: string, protocol: string): string | null {
	const mapping: Record<string, string> = {
		anthropic: "anthropic",
		openai: "openai",
		gemini: "gemini",
		google: "gemini",
		mistral: "mistral",
		groq: "groq",
		openrouter: "openrouter",
		sambanova: "sambanova",
	}
	return mapping[providerName.toLowerCase()] ?? (protocol === "openai" ? "openai" : null)
}

/**
 * Resets the entire key pool state.
 * Clears round-robin indexes and all key health tracking info.
 * Useful when the vault is reloaded or the configuration changes significantly.
 */
export function resetKeyPool(): void {
	roundRobinIndexes.clear()
	keyStatuses.clear()
}
