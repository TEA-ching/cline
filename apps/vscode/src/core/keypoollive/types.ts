// KeypoolLive — TypeScript interfaces
// © 2026 Ronan LE MEILLAT — MIT License

/**
 * Represents an API key stored in the transformed AI Vault.
 */
export interface VaultKey {
	/** The actual API key string. */
	key: string
	/** The name or identifier of the key owner (e.g., an email address). */
	owner: string
	/** The billing tier or status of the key. */
	type: AiKeyTier
}

/**
 * Metadata for a specific AI model available in the vault.
 */
export interface VaultModel {
	id: string
	name?: string
	contextWindow?: number
	maxOutputTokens?: number
	usage?: "chat" | "embedding"
	supportsImages?: boolean
	supportsPromptCache?: boolean
	inputPrice?: number
	outputPrice?: number
	defaultDimensions?: number
}

/**
 * Configuration for an AI provider in the vault.
 */
export interface VaultProvider {
	/** Communication protocol used by the provider (e.g., openai, anthropic). */
	protocol: AiProtocol
	/** Optional custom API endpoint URL. */
	endpoint?: string
	/** Collection of API keys available for this provider. */
	keys: VaultKey[]
	/** List of models supported by this provider. */
	models: VaultModel[]
}

/**
 * The top-level vault configuration structure as used within the extension.
 */
export interface AiVaultConfig {
	version: number
	providers: Record<string, VaultProvider>
}

/**
 * Fully resolved configuration ready for use by an API provider handler.
 * Combines provider settings, model metadata, and a selected API key.
 */
export interface ResolvedApiConfig {
	/** Name of the provider (e.g., 'anthropic'). */
	providerName: string
	/** Protocol to use for communication. */
	protocol: AiProtocol
	/** The final endpoint URL. */
	endpoint?: string
	/** The selected API key. */
	apiKey: string
	/** Who owns the selected API key. */
	keyOwner: string
	/** Details of the model to be used. */
	model: VaultModel
}

export type AiProtocol = "openai" | "anthropic" | "gemini"
export type AiKeyTier = "expired" | "free" | "paid" | "premium" | "unlimited"

// Internal AiConfig format (mirrors the raw vault JSON)
export interface AiKey {
	key: string
	owner: string
	type?: AiKeyTier
}

export interface AiModel {
	id: string
	name?: string
	contextWindow?: number
	maxOutputTokens?: number
	usage?: "chat" | "embedding"
	supportsImages?: boolean
	supportsPromptCache?: boolean
	inputPrice?: number
	outputPrice?: number
	defaultDimensions?: number
}

export interface AiProvider {
	protocol: AiProtocol
	endpoint?: string
	keys: AiKey[]
	models: AiModel[]
}

export interface AiConfig {
	version: number
	providers: Record<string, AiProvider>
}

/**
 * Global configuration settings for the KeypoolLive system,
 * typically retrieved from the extension's persistent settings.
 */
export interface KeypoolLiveConfig {
	/** URL where the encrypted vault JSON is hosted. */
	vaultUrl?: string
	/** Decryption password for the vault. */
	secret?: string
	/** Whether to route requests through an AI Gateway (e.g., Cloudflare). */
	useGateway?: boolean
	/** Optional secret for gateway authentication. */
	gatewaySecret?: string
	/** Identifier for the gateway instance. */
	gatewayId?: string
	/** If true, instructs the gateway to bypass any caching layers. */
	gatewayCacheSkip?: boolean
}
