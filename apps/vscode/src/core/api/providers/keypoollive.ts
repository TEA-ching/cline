// KeypoolLive — API Handler: delegates to ephemeral Anthropic/OpenAI/Gemini handlers
// © 2026 Ronan LE MEILLAT — MIT License

import { ModelInfo } from "@shared/api"
import { KeypoolUsageDb } from "@/core/keypoollive/KeypoolUsageDb"
import { configureSessionKeyManager, getSessionApiConfig, rotateSessionKey } from "@/core/keypoollive/SessionKeyManager"
import type { AiProtocol, ResolvedApiConfig } from "@/core/keypoollive/types"
import { ClineStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, ApiHandlerModel, CommonApiHandlerOptions } from "../index"
import { ApiStream } from "../transform/stream"
import { AnthropicHandler } from "./anthropic"
import { GeminiHandler } from "./gemini"
import { OpenAiHandler } from "./openai"

/**
 * Maps an AiProtocol to the correct Cloudflare AI Gateway provider slug.
 * Cloudflare uses 'google-ai-studio' for Gemini (not 'gemini').
 */
function toCfGatewaySlug(protocol: AiProtocol, fallback: string): string {
	switch (protocol) {
		case "gemini":
			return "google-ai-studio"
		case "anthropic":
			return "anthropic"
		case "openai":
			return "openai"
		default:
			return fallback
	}
}

const KEYPOOLLIVE_SESSION_ID = "kpl-global"

/** Returns first 6 chars + "..." + last 6 chars of an API key for safe logging. */
function formatKeyHint(apiKey: string): string {
	if (apiKey.length <= 12) return apiKey
	return `${apiKey.slice(0, 6)}...${apiKey.slice(-6)}`
}

/** Shows a VSCode information toast if running inside the extension host (no-op in standalone). */
function tryShowVscodeInfo(message: string): void {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const vsc = require("vscode") as typeof import("vscode")
		vsc.window.showInformationMessage(message)
	} catch {
		// Not in VSCode context (standalone mode), ignore
	}
}

/** Errors that warrant key rotation */
function isKeyError(e: any): boolean {
	const code = e?.status ?? e?.statusCode ?? e?.error?.status ?? 0
	return [401, 403, 429].includes(Number(code))
}

interface KeypoolLiveHandlerOptions extends CommonApiHandlerOptions {
	keypoolliveVaultUrl?: string
	keypoolliveSecret?: string
	keypoolliveGatewaySecret?: string
	keypoolliveUseGateway?: boolean
	keypoolliveGatewayId?: string
	keypoolliveGatewayCacheSkip?: boolean
	/** Format: "providerName/modelId" e.g. "openai/gpt-4o" */
	apiModelId?: string
	ulid?: string
}

export class KeypoolLiveHandler implements ApiHandler {
	private options: KeypoolLiveHandlerOptions
	private resolvedConfig: ResolvedApiConfig | null = null

	constructor(options: KeypoolLiveHandlerOptions) {
		this.options = options
		// Inject the vault secret into process.env so AiVault can find it
		if (options.keypoolliveSecret) {
			process.env.KEYPOOL_LIVE_SECRET = options.keypoolliveSecret
		}
		if (options.keypoolliveVaultUrl) {
			configureSessionKeyManager(options.keypoolliveVaultUrl)
		}
	}

	private parseModelId(): { vaultProviderName: string; vaultModelId: string } {
		const raw = this.options.apiModelId ?? ""
		const slashIdx = raw.indexOf("/")
		if (slashIdx === -1) {
			return { vaultProviderName: raw, vaultModelId: "" }
		}
		return {
			vaultProviderName: raw.slice(0, slashIdx),
			vaultModelId: raw.slice(slashIdx + 1),
		}
	}

	private buildEphemeralHandler(config: ResolvedApiConfig): ApiHandler {
		const { protocol, apiKey, endpoint, model } = config
		const gatewayBase =
			this.options.keypoolliveUseGateway && this.options.keypoolliveGatewayId
				? `https://gateway.ai.cloudflare.com/v1/${this.options.keypoolliveGatewayId}/${toCfGatewaySlug(protocol, config.providerName)}`
				: undefined

		const baseUrl = gatewayBase ?? endpoint
		Logger.warn(
			`[KeypoolLive] buildEphemeralHandler protocol=${protocol} model=${model.id} endpoint=${endpoint ?? "(default)"} gateway=${gatewayBase ?? "(none)"} baseUrl=${baseUrl ?? "(sdk default)"}`,
		)

		switch (protocol) {
			case "anthropic":
				return new AnthropicHandler({
					apiKey,
					anthropicBaseUrl: baseUrl,
					apiModelId: model.id,
					onRetryAttempt: this.options.onRetryAttempt,
				})
			case "gemini":
				return new GeminiHandler({
					geminiApiKey: apiKey,
					geminiBaseUrl: baseUrl,
					apiModelId: model.id,
					onRetryAttempt: this.options.onRetryAttempt,
				})
			case "openai":
			default:
				return new OpenAiHandler({
					openAiApiKey: apiKey,
					openAiBaseUrl: baseUrl ?? "https://api.openai.com/v1",
					openAiModelId: model.id,
					openAiHeaders: this.buildGatewayHeaders(),
					onRetryAttempt: this.options.onRetryAttempt,
				})
		}
	}

	private buildGatewayHeaders(): Record<string, string> {
		if (!this.options.keypoolliveUseGateway || !this.options.keypoolliveGatewaySecret) {
			return {}
		}
		const headers: Record<string, string> = {
			"cf-aig-authorization": `Bearer ${this.options.keypoolliveGatewaySecret}`,
		}
		if (this.options.keypoolliveGatewayCacheSkip) {
			headers["cf-aig-cache-ttl"] = "0"
		}
		return headers
	}

	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const { vaultProviderName, vaultModelId } = this.parseModelId()

		if (!vaultProviderName) {
			throw new Error("[KeypoolLive] No vault provider name in model ID. Select a vault model first.")
		}
		if (!this.options.keypoolliveVaultUrl) {
			throw new Error("[KeypoolLive] Vault URL not configured.")
		}

		let config = await getSessionApiConfig(KEYPOOLLIVE_SESSION_ID, vaultProviderName, vaultModelId || undefined)
		if (!config) {
			throw new Error(`[KeypoolLive] Could not resolve API key for provider "${vaultProviderName}"`)
		}

		this.resolvedConfig = config
		Logger.log(
			`[KeypoolLive] Using key owner=${config.keyOwner}, key=${formatKeyHint(config.apiKey)}, model=${config.model.id}`,
		)

		let lastError: any
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const ephemeral = this.buildEphemeralHandler(config)
				let promptTokens = 0
				let completionTokens = 0

				for await (const chunk of ephemeral.createMessage(systemPrompt, messages)) {
					if (chunk.type === "usage") {
						promptTokens = chunk.inputTokens
						completionTokens = chunk.outputTokens
					}
					yield chunk
				}

				// Record usage on success
				KeypoolUsageDb.recordUsage({
					provider: vaultProviderName,
					modelId: vaultModelId || config.model.id,
					keyOwner: config.keyOwner,
					keyHint: `...${config.apiKey.slice(-8)}`,
					promptTokens,
					completionTokens,
				})
				return
			} catch (e: any) {
				lastError = e
				Logger.warn(`[KeypoolLive] Request failed (attempt ${attempt + 1}):`, e?.message ?? e)

				// Record error
				KeypoolUsageDb.recordError({
					provider: vaultProviderName,
					modelId: vaultModelId || config.model.id,
					keyOwner: config.keyOwner,
					keyHint: `...${config.apiKey.slice(-8)}`,
					errorCode: e?.status ?? e?.statusCode ?? null,
				})

				if (attempt === 0 && isKeyError(e)) {
					// Rotate key and retry once
					const rotated = await rotateSessionKey(
						KEYPOOLLIVE_SESSION_ID,
						vaultProviderName,
						vaultModelId || undefined,
						"key_failure",
					)
					if (rotated) {
						const hint = formatKeyHint(rotated.apiKey)
						Logger.log(`[KeypoolLive] Key rotated → owner=${rotated.keyOwner}, key=${hint}`)
						tryShowVscodeInfo(`[KeypoolLive] Key rotated — owner: ${rotated.keyOwner} | key: ${hint}`)
						config = rotated
						this.resolvedConfig = rotated
						continue
					}
				}
				break
			}
		}

		throw lastError
	}

	getModel(): ApiHandlerModel {
		const { vaultProviderName, vaultModelId } = this.parseModelId()
		const config = this.resolvedConfig
		const modelInfo: ModelInfo = {
			contextWindow: config?.model.contextLength ?? 128000,
			maxTokens: config?.model.contextLength ? Math.floor(config.model.contextLength * 0.8) : undefined,
			supportsImages: config?.model.supportsImages ?? false,
			supportsPromptCache: config?.model.supportsPromptCache ?? false,
			inputPrice: config?.model.inputPrice,
			outputPrice: config?.model.outputPrice,
		}
		return {
			id: vaultModelId ? `${vaultProviderName}/${vaultModelId}` : vaultProviderName,
			info: modelInfo,
		}
	}
}
