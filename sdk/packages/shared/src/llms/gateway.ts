import type {
	AgentMessage,
	AgentModelEvent,
	AgentToolDefinition,
} from "../agent";
import type { BasicLogger } from "../logging/logger";
import type { ProviderCapability, ProviderConfigField } from "../rpc/runtime";
import type { ITelemetryService } from "../services/telemetry";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

// AgentToolDefinition, AgentMessagePart, AgentMessage, AgentModelRequest,
// AgentModelFinishReason, AgentModelEvent, AgentModel, and AgentModelUsage
// previously lived here with gateway-local shapes. They have been retired in
// favor of the canonical AgentRuntime types in `../agent` (PLAN.md §3.6 Step 3,
// expanded). `AgentModelUsage` is superseded by `AgentUsage` (`AgentTokenUsage`
// + optional `totalCost`); usage deltas on `AgentModelEvent` are now
// `Partial<AgentUsage>`.

export type GatewayModelCapability =
	| "text"
	| "tools"
	| "reasoning"
	| "prompt-cache"
	| "images"
	| "audio"
	| "structured-output";

export type GatewayPromptCacheStrategy = "anthropic-automatic";
export type GatewayUsageCostDisplay = "show" | "hide";
export type GatewayPromptCacheFormat = "anthropic-cache-control";
export type GatewayReasoningFormat =
	| "anthropic-thinking"
	| "glm-thinking"
	| "minimax-thinking";
export type GatewayModelRoute =
	| { matcher: "anthropic-compatible" }
	| {
			matcher: "model-family";
			family: string;
			requiredCapability?: GatewayModelCapability;
	  }
	| {
			matcher: "model-id";
			modelId: string;
			requiredCapability?: GatewayModelCapability;
	  };
export interface GatewayProviderRouting {
	promptCache?: {
		format: GatewayPromptCacheFormat;
		routes: GatewayModelRoute[];
	};
	reasoning?: {
		format: GatewayReasoningFormat;
		routes: GatewayModelRoute[];
	};
}

export type GatewayStickySessionTransport = "json-body" | "header";

export interface GatewayStickySessionMetadata {
	/**
	 * Where the provider expects the sticky-session identifier on the wire.
	 * `field` is a JSON body property for `json-body`, and an HTTP header name
	 * for `header`.
	 */
	transport: GatewayStickySessionTransport;
	field: string;
	metadataKey: string;
}

export interface GatewayProviderMetadata {
	promptCacheStrategy?: GatewayPromptCacheStrategy;
	usageCostDisplay?: GatewayUsageCostDisplay;
	routing?: GatewayProviderRouting;
	stickySession?: GatewayStickySessionMetadata;
	configFields?: readonly ProviderConfigField[];
	[key: string]:
		| JsonValue
		| GatewayProviderRouting
		| GatewayStickySessionMetadata
		| readonly ProviderConfigField[]
		| undefined;
}

export interface GatewayModelDefinition {
	id: string;
	name: string;
	providerId: string;
	description?: string;
	contextWindow?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	capabilities?: readonly GatewayModelCapability[];
	metadata?: Record<string, JsonValue | undefined>;
}

export interface GatewayProviderManifest {
	id: string;
	name: string;
	description?: string;
	defaultModelId: string;
	models: readonly GatewayModelDefinition[];
	capabilities?: readonly ProviderCapability[];
	env?: readonly ("browser" | "node")[];
	api?: string;
	apiKeyEnv?: readonly string[];
	docsUrl?: string;
	metadata?: GatewayProviderMetadata;
}

export interface GatewayProviderSettings {
	apiKey?: string;
	apiKeyResolver?: () => string | undefined | Promise<string | undefined>;
	apiKeyEnv?: readonly string[];
	baseUrl?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	fetch?: typeof fetch;
	options?: Record<string, unknown>;
	metadata?: GatewayProviderMetadata;
}

export interface GatewayResolvedProviderConfig extends GatewayProviderSettings {
	providerId: string;
}

export interface GatewayProviderConfig extends GatewayProviderSettings {
	providerId: string;
	enabled?: boolean;
	defaultModelId?: string;
	models?: readonly Omit<GatewayModelDefinition, "providerId">[];
}

export interface GatewayModelSelection {
	providerId: string;
	modelId?: string;
}

export interface GatewayResolvedModel {
	provider: GatewayProviderManifest;
	model: GatewayModelDefinition;
}

// ─── Keypool live event types ─────────────────────────────────────────────────

/** Fired when keypoollive selects a key at the start of a stream (attempt 0). */
export interface KeypoolKeySelectedEvent {
	type: "key-selected";
	providerName: string;
	modelId: string;
	keyHint: string;
	keyOwner?: string;
	roundRobin: boolean;
}

/** Fired when keypoollive rotates to a new key after detecting a key error. */
export interface KeypoolKeyRotatedEvent {
	type: "key-rotated";
	providerName: string;
	modelId: string;
	/** Masked hint of the key that failed. */
	failedKeyHint: string;
	attempt: number;
	error: string;
}

/** Fired when keypoollive marks a key as healthy after a successful request. */
export interface KeypoolKeyRecoveredEvent {
	type: "key-recovered";
	providerName: string;
	modelId: string;
	keyHint: string;
	keyOwner?: string;
}

/** Fired when all rotation attempts are exhausted and the stream fails. */
export interface KeypoolKeyExhaustedEvent {
	type: "key-exhausted";
	providerName: string;
	modelId: string;
	attempts: number;
	error: string;
}

/** Fired after a successful stream with the cumulative token usage totals. */
export interface KeypoolUsageRecordedEvent {
	type: "usage-recorded";
	providerName: string;
	modelId: string;
	keyHint: string;
	keyOwner?: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/**
 * Fired once at provider initialisation when the User-Agent header is resolved.
 * `source: "config"` means the caller supplied it explicitly;
 * `source: "default"` means it was injected automatically.
 */
export interface KeypoolUserAgentSetEvent {
	type: "user-agent-set";
	userAgent: string;
	source: "config" | "default";
}

export type KeypoolEvent =
	| KeypoolKeySelectedEvent
	| KeypoolKeyRotatedEvent
	| KeypoolKeyRecoveredEvent
	| KeypoolKeyExhaustedEvent
	| KeypoolUsageRecordedEvent
	| KeypoolUserAgentSetEvent;

/** Callback invoked by the keypoollive provider at key lifecycle milestones. */
export type KeypoolEventHandler = (event: KeypoolEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────

export interface GatewayProviderContext {
	provider: GatewayProviderManifest;
	model: GatewayModelDefinition;
	config: GatewayResolvedProviderConfig;
	signal?: AbortSignal;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	/** Optional callback for keypoollive key lifecycle events. */
	keypoolEventHandler?: KeypoolEventHandler;
}

export interface GatewayStreamRequest {
	providerId: string;
	modelId: string;
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools?: readonly AgentToolDefinition[];
	temperature?: number;
	maxTokens?: number;
	metadata?: Record<string, unknown>;
	reasoning?: {
		enabled?: boolean;
		effort?: "low" | "medium" | "high";
		budgetTokens?: number;
	};
	signal?: AbortSignal;
}

export interface GatewayProvider {
	stream(
		request: GatewayStreamRequest,
		context: GatewayProviderContext,
	): AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>;
}

export type GatewayProviderFactory = (
	config: GatewayResolvedProviderConfig,
) => GatewayProvider | Promise<GatewayProvider>;

export interface GatewayProviderRegistration {
	manifest: GatewayProviderManifest;
	defaults?: GatewayProviderSettings;
	createProvider?: GatewayProviderFactory;
	loadProvider?: () => Promise<
		Pick<GatewayProviderRegistration, "createProvider">
	>;
}

export interface GatewayModelHandleOptions {
	tools?: readonly AgentToolDefinition[];
	temperature?: number;
	maxTokens?: number;
	metadata?: Record<string, unknown>;
	reasoning?: {
		enabled?: boolean;
		effort?: "low" | "medium" | "high";
		budgetTokens?: number;
	};
	signal?: AbortSignal;
}

export interface GatewayConfig {
	builtins?: false | readonly string[];
	providers?: readonly GatewayProviderRegistration[];
	providerConfigs?: readonly GatewayProviderConfig[];
	fetch?: typeof fetch;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	/** Optional callback forwarded into GatewayProviderContext for keypoollive events. */
	keypoolEventHandler?: KeypoolEventHandler;
}
