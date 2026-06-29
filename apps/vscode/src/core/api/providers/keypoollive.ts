// KeypoolLive — API Handler: delegates to ephemeral Anthropic/OpenAI/Gemini handlers
// © 2026 Ronan LE MEILLAT — MIT License

import type { OpenAiCompatibleModelInfo } from "@shared/api";
import type { Message } from "@cline/shared";
import type { ApiStreamChunk as SdkApiStreamChunk } from "@cline/llms";
import { getCachedVaultModel, getCachedVaultProvider, loadAiVault } from "@/core/keypoollive/AiVault";

// SDK ApiStream type (not exported but used by handlers)
type SdkApiStream = AsyncGenerator<SdkApiStreamChunk> & { id?: string };
import { KeypoolLog } from "@/core/keypoollive/KeypoolLog";
import { KeypoolUsageDb } from "@/core/keypoollive/KeypoolUsageDb";
import { markKeyAsUsed } from "@/core/keypoollive/KeyPool";
import {
    configureSessionKeyManager,
    getSessionApiConfig,
    rotateSessionKey,
} from "@/core/keypoollive/SessionKeyManager";
import type { AiProtocol, ResolvedApiConfig } from "@/core/keypoollive/types";
import type { ClineStorageMessage } from "@/shared/messages/content";
import { Logger } from "@/shared/services/Logger";
import { fetch } from "@/shared/net";
import type {
    ApiHandler,
    CommonApiHandlerOptions,
} from "./ai-sdk-handler";
import { createHandler } from "@cline/llms";
import { CohereHandler } from "./cohere";
import { PoolsideHandler } from "./poolside";

/**
 * Maps an AiProtocol to the correct Cloudflare AI Gateway provider slug.
 * Cloudflare uses 'google-ai-studio' for Gemini (not 'gemini').
 *
 * @param protocol - The AI protocol to map (e.g., "gemini", "anthropic")
 * @param fallback - Fallback value if protocol is not recognized
 * @returns Cloudflare AI Gateway slug for the given protocol
 */
function toCfGatewaySlug(protocol: AiProtocol, fallback: string): string {
	switch (protocol) {
		case "gemini":
			return "google-ai-studio";
		case "anthropic":
			return "anthropic";
		case "openai":
			return "openai";
		case "cohere":
			return "cohere";
		case "mistral":
			return "mistral";
		default:
			return fallback;
	}
}

const KEYPOOLLIVE_SESSION_ID = "kpl-global";

/**
 * Returns "***" + last 8 chars of an API key for safe logging.
 * This prevents exposing full API keys in logs while still providing identifiable information.
 *
 * @param apiKey - The full API key to format
 * @returns Formatted key hint (e.g., "***xyz78901ab")
 */
function formatKeyHint(apiKey: string): string {
	if (apiKey.length <= 8) return apiKey;
	return `***${apiKey.slice(-8)}`;
}

/**
 * Generates a unique response ID for streaming responses
 */
function generateResponseId(): string {
	return `keypool-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Shows a VSCode information toast if running inside the extension host (no-op in standalone).
 * This provides user feedback for key rotation events and other important notifications.
 *
 * @param message - The message to display to the user
 */
function tryShowVscodeInfo(message: string): void {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const vsc = require("vscode") as typeof import("vscode");
		vsc.window.showInformationMessage(message);
	} catch {
		// Not in VSCode context (standalone mode), ignore
	}
}

/**
 * Determines if an error warrants key rotation.
 * Returns true for authentication errors (401, 403) and rate limiting (429).
 *
 * @param e - The error object to check
 * @returns true if the error indicates a key problem that might be resolved by rotation
 */
function isKeyError(e: any): boolean {
	const code = e?.status ?? e?.statusCode ?? e?.error?.status ?? 0;
	if ([401, 403, 429].includes(Number(code))) return true;
	// Also match message-based rate-limit signals: sub-handlers (Mistral, OpenAI, etc.)
	// sometimes wrap 429s without a numeric status field.
	const msg = ((e?.message ?? "") + " " + (e?.error?.message ?? "")).toLowerCase();
	return /rate.?limit|too many requests|quota|throttle|resource.?exhausted/.test(msg);
}

interface KeypoolLiveHandlerOptions extends CommonApiHandlerOptions {
	keypoolliveVaultUrl?: string;
	keypoolliveSecret?: string;
	keypoolliveRemoteStorageUrl?: string;
	keypoolliveGatewaySecret?: string;
	keypoolliveUseGateway?: boolean;
	keypoolliveGatewayId?: string;
	keypoolliveGatewayCacheSkip?: boolean;
	keypoolliveMaxDbSizeMb?: number;
	keypoolliveAggressiveRotation?: boolean;
	/** Format: "providerName/modelId" e.g. "openai/gpt-4o" */
	apiModelId?: string;
	ulid?: string;
}

/**
 * KeypoolLiveHandler - Main API handler class
 *
 * This class manages API requests to various AI providers using keys from a KeypoolLive vault.
 * It handles key rotation, usage tracking, and Cloudflare AI Gateway integration.
 *
 * Implements the SDK ApiHandler interface (duck typing), delegating to ephemeral provider-specific handlers
 * while managing key rotation and vault access.
 */

// Protocols that correctly return tool calls via delta.tool_calls in the streaming response.
// Unknown protocols (e.g. "poolside") must use XML system-prompt mode instead.
const NATIVE_TOOL_PROTOCOLS: string[] = ["openai", "anthropic", "gemini", "cohere", "mistral"];

export class KeypoolLiveHandler {
	private options: KeypoolLiveHandlerOptions;
	private resolvedConfig: ResolvedApiConfig | null = null;

	/**
	 * Constructor - Initializes the handler with configuration options
	 *
	 * @param options - Configuration options including vault URL, secrets, and gateway settings
	 */
	constructor(options: KeypoolLiveHandlerOptions) {
		this.options = options;
		// Inject the vault secret into process.env so AiVault can find it
		if (options.keypoolliveSecret) {
			process.env.KEYPOOL_LIVE_SECRET = options.keypoolliveSecret;
		}
		// Inject the remote storage URL so KeypoolUsageDb.getEffectiveRemoteConfig()
		// auto-detects remote mode without waiting for the model selector RPC.
		if (options.keypoolliveRemoteStorageUrl) {
			process.env.KEYPOOL_LIVE_REMOTE_STORAGE_URL = options.keypoolliveRemoteStorageUrl;
		}
		// Explicitly configure remote mode when both URL and secret are available.
		// This is belt-and-suspenders on top of the env-var auto-detection.
		if (
			options.keypoolliveRemoteStorageUrl &&
			options.keypoolliveSecret &&
			(options.keypoolliveRemoteStorageUrl.startsWith("https://") ||
				options.keypoolliveRemoteStorageUrl.startsWith("http://"))
		) {
			KeypoolUsageDb.setRemoteMode({
				workerUrl: options.keypoolliveRemoteStorageUrl,
				authToken: options.keypoolliveSecret,
			});
		}
		if (options.keypoolliveVaultUrl) {
			configureSessionKeyManager(options.keypoolliveVaultUrl);
			// Preload vault so getCachedVaultModel() works synchronously in getModel()
			// before the first createMessage() call (e.g. for the model picker UI).
			loadAiVault(options.keypoolliveVaultUrl).catch(() => {});
		}
		// Apply the user-configured DB size limit (default 50 MB if not set)
		if (options.keypoolliveMaxDbSizeMb !== undefined) {
			KeypoolUsageDb.setMaxSizeMb(options.keypoolliveMaxDbSizeMb);
		}
		// Apply the aggressive rotation flag if set
		if (options.keypoolliveAggressiveRotation) {
			process.env.KEYPOOL_LIVE_AGGRESSIVE_ROTATION = "true";
		}
	}

	/**
	 * Parses the model ID from the configuration options.
	 * Expected format: "providerName/modelId" (e.g., "openai/gpt-4o")
	 *
	 * @returns Object containing vaultProviderName and vaultModelId
	 */
	private parseModelId(): { vaultProviderName: string; vaultModelId: string } {
		const raw = this.options.apiModelId ?? "";
		const slashIdx = raw.indexOf("/");
		if (slashIdx === -1) {
			return { vaultProviderName: raw, vaultModelId: "" };
		}
		return {
			vaultProviderName: raw.slice(0, slashIdx),
			vaultModelId: raw.slice(slashIdx + 1),
		};
	}

	/**
	 * Builds an ephemeral provider-specific handler based on the resolved configuration.
	 * This creates the appropriate handler (Anthropic, OpenAI, Gemini, etc.) with the
	 * correct API key, endpoint, and model configuration.
	 *
	 * @param config - Resolved API configuration from the vault
	 * @returns Provider-specific API handler instance
	 */
	private buildEphemeralHandler(config: ResolvedApiConfig): ApiHandler {
		const { protocol, apiKey, endpoint, model } = config;
		const gatewayBase =
			this.options.keypoolliveUseGateway && this.options.keypoolliveGatewayId
				? `https://gateway.ai.cloudflare.com/v1/${this.options.keypoolliveGatewayId}/${toCfGatewaySlug(protocol, config.providerName)}`
				: undefined;

		const baseUrl = gatewayBase ?? endpoint;
		Logger.warn(
			`[KeypoolLive] buildEphemeralHandler protocol=${protocol} model=${model.id} endpoint=${endpoint ?? "(default)"} gateway=${gatewayBase ?? "(none)"} baseUrl=${baseUrl ?? "(sdk default)"}`,
		);

		switch (protocol) {
			case "cohere":
				return new CohereHandler({
					cohereBaseUrl: baseUrl,
					cohereApiKey: apiKey,
					apiModelId: model.id,
				});
			case "poolside":
				return new PoolsideHandler({
					poolsideApiKey: apiKey,
					poolsideBaseUrl: baseUrl,
					apiModelId: model.id,
				});
			case "anthropic":
				return createHandler({
					providerId: "anthropic",
					modelId: model.id,
					apiKey,
					baseUrl,
					fetch,
					onRetryAttempt: this.options.onRetryAttempt,
				} as Parameters<typeof createHandler>[0]) as unknown as ApiHandler;
			case "gemini":
				return createHandler({
					providerId: "gemini",
					modelId: model.id,
					apiKey,
					baseUrl,
					fetch,
					onRetryAttempt: this.options.onRetryAttempt,
				} as Parameters<typeof createHandler>[0]) as unknown as ApiHandler;
			case "mistral":
				return createHandler({
					providerId: "mistral",
					modelId: model.id,
					apiKey,
					fetch,
					onRetryAttempt: this.options.onRetryAttempt,
				} as Parameters<typeof createHandler>[0]) as unknown as ApiHandler;
			case "openai":
			default: {
				const headers: Record<string, string> = {
					...this.buildGatewayHeaders(),
					...(config.userAgent ? { "User-Agent": config.userAgent } : {}),
				};
				return createHandler({
					providerId: "openai-compatible",
					modelId: model.id,
					apiKey,
					baseUrl: baseUrl ?? "https://api.openai.com/v1",
					headers,
					fetch,
					onRetryAttempt: this.options.onRetryAttempt,
				} as Parameters<typeof createHandler>[0]) as unknown as ApiHandler;
			}
		}
	}

	/**
	 * Builds HTTP headers for Cloudflare AI Gateway requests.
	 * Includes authorization and optional cache control headers.
	 *
	 * @returns Object containing the required headers
	 */
	private buildGatewayHeaders(): Record<string, string> {
		if (
			!this.options.keypoolliveUseGateway ||
			!this.options.keypoolliveGatewaySecret
		) {
			return {};
		}
		const headers: Record<string, string> = {
			"cf-aig-authorization": `Bearer ${this.options.keypoolliveGatewaySecret}`,
		};
		if (this.options.keypoolliveGatewayCacheSkip) {
			headers["cf-aig-cache-ttl"] = "0";
		}
		return headers;
	}

	/**
	 * Main message creation method - handles the complete API request lifecycle
	 *
	 * This method:
	 * 1. Resolves the API configuration from the vault
	 * 2. Creates an ephemeral provider-specific handler
	 * 3. Logs the API exchange
	 * 4. Streams the response
	 * 5. Records usage metrics
	 * 6. Handles errors with automatic key rotation and retry
	 *
	 * @param systemPrompt - System prompt for the AI model
	 * @param messages - Conversation history (SDK format)
	 * @param tools - Optional tools for function calling (SDK format)
	 * @param useResponseApi - Whether to use response API format
	 * @returns Async generator yielding API response chunks (SDK format)
	 * @throws Will throw the last error if all attempts fail
	 */
	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: any[],
		useResponseApi?: boolean,
	): SdkApiStream {
		// Convert SDK Message format to ClineStorageMessage for internal use
		const clineMessages = messages as unknown as ClineStorageMessage[];
		const responseId = generateResponseId();
		const { vaultProviderName, vaultModelId } = this.parseModelId();

		if (!vaultProviderName) {
			throw new Error(
				"[KeypoolLive] No vault provider name in model ID. Select a vault model first.",
			);
		}
		if (!this.options.keypoolliveVaultUrl) {
			throw new Error("[KeypoolLive] Vault URL not configured.");
		}

		let config: ResolvedApiConfig | null;
		// Check aggressive rotation from both option and environment variable
		// Environment variable is used for runtime changes to the setting
		const aggressiveRotation = this.options.keypoolliveAggressiveRotation ||
			process.env.KEYPOOL_LIVE_AGGRESSIVE_ROTATION === "true";

		if (aggressiveRotation) {
			// In aggressive rotation mode, force a new key for each request
			config = await rotateSessionKey(
				KEYPOOLLIVE_SESSION_ID,
				vaultProviderName,
				vaultModelId || undefined,
				"user_request",
			);
		} else {
			config = await getSessionApiConfig(
				KEYPOOLLIVE_SESSION_ID,
				vaultProviderName,
				vaultModelId || undefined,
			);
		}
		if (!config) {
			throw new Error(
				`[KeypoolLive] Could not resolve API key for provider "${vaultProviderName}"`,
			);
		}

		this.resolvedConfig = config;
		{
			const keyHint = config.apiKey.slice(-8);
			const dayStats = await KeypoolUsageDb.getUsageStats("day");
			const keyStat = dayStats.find(
				(s) => s.provider === vaultProviderName && s.keyHint.replace(/^\*+/, "") === keyHint,
			);
			Logger.log(
				`[KeypoolLive] Using key owner=${config.keyOwner}, key=${formatKeyHint(config.apiKey)}, key usage (in=${keyStat?.promptTokens ?? 0}, out=${keyStat?.completionTokens ?? 0}, requests=${keyStat?.requestCount ?? 0}) model=${config.model.id}`,
			);
		}

		let lastError: any;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const ephemeral = this.buildEphemeralHandler(config);
				let promptTokens = 0;
				let completionTokens = 0;

				// Log the API exchange before making the request
				await KeypoolLog.logEntry({
					provider: vaultProviderName,
					modelId: vaultModelId || config.model.id,
					messages: [
						{ role: "system", content: systemPrompt },
						...clineMessages.map(msg => ({
							role: msg.role === "user" ? "user" : "assistant",
							content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
						}))
					],
					metadata: {
						keyOwner: config.keyOwner,
						keyHint: `***${config.apiKey.slice(-8)}`,
						attempt: attempt + 1
					}
				});

				for await (const chunk of ephemeral.createMessage(
					systemPrompt,
					clineMessages,
					tools,
					useResponseApi,
				)) {
					if (chunk.type === "usage") {
						promptTokens = chunk.inputTokens;
						completionTokens = chunk.outputTokens;
					}
					// Adapt local chunk types to SDK format by adding response ID
					const sdkChunk: SdkApiStreamChunk = {
						...chunk,
						id: responseId,
					} as SdkApiStreamChunk;
					yield sdkChunk;
				}

				// Record usage on success
				await markKeyAsUsed(vaultProviderName, config.apiKey);
				KeypoolUsageDb.recordUsage({
					provider: vaultProviderName,
					modelId: vaultModelId || config.model.id,
					keyOwner: config.keyOwner,
					keyHint: `***${config.apiKey.slice(-8)}`,
					promptTokens,
					completionTokens,
				});
				return;
			} catch (e: any) {
				lastError = e;
				Logger.warn(
					`[KeypoolLive] Request failed (attempt ${attempt + 1}):`,
					e?.message ?? e,
				);

				// Record error
				KeypoolUsageDb.recordError({
					provider: vaultProviderName,
					modelId: vaultModelId || config.model.id,
					keyOwner: config.keyOwner,
					keyHint: `***${config.apiKey.slice(-8)}`,
					errorCode: e?.status ?? e?.statusCode ?? null,
				});

				if (attempt === 0 && isKeyError(e)) {
					// Rotate key and retry once
					const rotated = await rotateSessionKey(
						KEYPOOLLIVE_SESSION_ID,
						vaultProviderName,
						vaultModelId || undefined,
						"key_failure",
					);
					if (rotated) {
						const hint = formatKeyHint(rotated.apiKey);
						Logger.log(
							`[KeypoolLive] Key rotated → owner=${rotated.keyOwner}, key=${hint}`,
						);
						tryShowVscodeInfo(
							`[KeypoolLive] Key rotated — owner: ${rotated.keyOwner} | key: ${hint}`,
						);
						config = rotated;
						this.resolvedConfig = rotated;
						continue;
					}
				}
				break;
			}
		}

		// Purge the session key cache so the next createMessage() call is forced to
		// pick a fresh key from the vault rather than reusing the rate-limited one.
		await rotateSessionKey(
			KEYPOOLLIVE_SESSION_ID,
			vaultProviderName,
			vaultModelId || undefined,
			"key_failure",
		).catch(() => {});
		throw lastError;
	}

	/**
	 * Convert messages to the format expected by the provider.
	 * Since KeypoolLiveHandler delegates to ephemeral handlers,
	 * this returns messages in standard format for the underlying protocol.
	 *
	 * @param systemPrompt - System prompt for the request
	 * @param messages - Conversation history (SDK format)
	 * @returns Formatted messages for the provider
	 */
	getMessages(systemPrompt: string, messages: Message[]): unknown {
		// Convert SDK Message format to ClineStorageMessage for internal use
		const clineMessages = messages as unknown as ClineStorageMessage[];
		return {
			systemPrompt,
			messages: clineMessages.map(msg => ({
				role: msg.role === "user" ? "user" : "assistant",
				content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
			}))
		}
	}

	/**
	 * Returns model information for the configured provider and model.
	 * This is used by the UI model picker and for validating model capabilities.
	 *
	 * @returns Model info compatible with SDK ApiHandler interface
	 */
	getModel(): any {
		const { vaultProviderName, vaultModelId } = this.parseModelId();
		// resolvedConfig is set after the first createMessage(); before that, fall back to the
		// vault cache (populated by the constructor preload) so the model picker shows correct values.
		const vaultModel =
			this.resolvedConfig?.model ??
			getCachedVaultModel(vaultProviderName, vaultModelId);
		const vaultProtocol =
			this.resolvedConfig?.protocol ??
			getCachedVaultProvider(vaultProviderName)?.protocol;
		// Only enable native OpenAI function-calling for protocols known to return
		// delta.tool_calls in the streaming response. Unknown protocols (e.g. "poolside")
		// use XML system-prompt mode so the model follows Cline's <read_file> format.
		const supportsTools = NATIVE_TOOL_PROTOCOLS.includes(vaultProtocol ?? "")
			? (vaultModel?.supportsTools ?? false)
			: false;
		const modelInfo: OpenAiCompatibleModelInfo = {
			contextWindow: vaultModel?.contextWindow ?? 128000,
			maxTokens:
				vaultModel?.maxOutputTokens ??
				(vaultModel?.contextWindow
					? Math.floor(vaultModel.contextWindow * 0.8)
					: undefined),
			supportsImages: vaultModel?.supportsImages ?? false,
			supportsPromptCache: vaultModel?.supportsPromptCache ?? false,
			supportsTools,
			inputPrice: vaultModel?.inputPrice,
			outputPrice: vaultModel?.outputPrice,
		};
		return {
			id: vaultModelId
				? `${vaultProviderName}/${vaultModelId}`
				: vaultProviderName,
			info: modelInfo,
		};
	}
}
