// KeypoolLive — KeyPool: round-robin selection, health tracking, model descriptions
// © 2026 Ronan LE MEILLAT — MIT License

import { Logger } from "@/shared/services/Logger"
import type { AiVaultConfig, KeypoolLiveConfig, ResolvedApiConfig, VaultKey, VaultModel } from "./types"

interface KeyStatus {
	key: string
	cooledDownAt?: number
	failureCount: number
}

const KEY_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes
const MAX_FAILURE_COUNT = 3

const roundRobinIndexes = new Map<string, number>()
const keyStatuses = new Map<string, KeyStatus>()

function getKeyStatusId(providerName: string, keyValue: string): string {
	return `${providerName}:${keyValue.slice(-8)}`
}

function isKeyUsable(providerName: string, keyValue: string): boolean {
	const status = keyStatuses.get(getKeyStatusId(providerName, keyValue))
	if (!status) return true
	if (status.failureCount >= MAX_FAILURE_COUNT) {
		// Check if cooldown has expired
		if (status.cooledDownAt && Date.now() - status.cooledDownAt >= KEY_COOLDOWN_MS) {
			// Reset the key status after cooldown
			keyStatuses.delete(getKeyStatusId(providerName, keyValue))
			return true
		}
		return false
	}
	return true
}

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
	const useGateway = (kplConfig?.useGateway ?? false) && !!kplConfig?.gatewaySecret && !!kplConfig?.gatewayId
	const descriptions: ModelDescription[] = []

	for (const [providerName, provider] of Object.entries(vault.providers)) {
		const chatModels = provider.models.filter((m) => !m.usage || m.usage === "chat")
		const clineProvider = mapToClineProvider(providerName, provider.protocol)

		for (const model of chatModels) {
			const endpoint = provider.endpoint
			let gatewayUrl: string | undefined

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

export function resetKeyPool(): void {
	roundRobinIndexes.clear()
	keyStatuses.clear()
}
