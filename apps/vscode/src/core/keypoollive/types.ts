// KeypoolLive — TypeScript interfaces
// © 2026 Ronan LE MEILLAT — MIT License

export interface VaultKey {
	key: string
	owner: string
	type: AiKeyTier
}

export interface VaultModel {
	id: string
	name?: string
	contextLength?: number
	usage?: "chat" | "embedding"
	supportsImages?: boolean
	supportsPromptCache?: boolean
	inputPrice?: number
	outputPrice?: number
	defaultDimensions?: number
}

export interface VaultProvider {
	protocol: AiProtocol
	endpoint?: string
	keys: VaultKey[]
	models: VaultModel[]
}

export interface AiVaultConfig {
	version: number
	providers: Record<string, VaultProvider>
}

export interface ResolvedApiConfig {
	providerName: string
	protocol: AiProtocol
	endpoint?: string
	apiKey: string
	keyOwner: string
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
	contextLength?: number
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

export interface KeypoolLiveConfig {
	vaultUrl?: string
	secret?: string
	useGateway?: boolean
	gatewaySecret?: string
	gatewayId?: string
	gatewayCacheSkip?: boolean
}
