// File: apps/vscode/src/core/api/providers/cohere.ts
//
// This file implements the Cohere API handler for Cline. It provides the integration
// with Cohere's Chat API (v2) to generate AI responses, handle tool calls, and
// manage streaming responses. The handler follows the common API handler interface
// defined in the extension's API system.
//
// The implementation includes:
// - Client initialization with proper error handling and proxy support
// - Streaming response processing with tool call accumulation
// - Token usage tracking and cost calculation
// - Model selection and configuration management
//
import {
	type CohereModelId,
	cohereDefaultModelId,
	cohereModels,
	type ModelInfo,
} from "@shared/api";
import { calculateApiCostOpenAI } from "@utils/cost";
import { type Cohere, CohereClientV2 } from "cohere-ai";
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions";
import { buildExternalBasicHeaders } from "@/services/EnvUtils";
import type { ClineStorageMessage } from "@/shared/messages/content";
import { fetch } from "@/shared/net";
import { Logger } from "@/shared/services/Logger";
import type { ApiHandler, CommonApiHandlerOptions } from "../";
import { withRetry } from "../retry";
import {
	convertToCohereMessages,
	convertToCohereTools,
} from "../transform/cohere-format";
import type { ApiStream } from "../transform/stream";

// Configuration options specific to Cohere API integration
interface CohereHandlerOptions extends CommonApiHandlerOptions {
	cohereBaseUrl?: string;
	cohereApiKey?: string;
	apiModelId?: string;
}

// CohereHandler implements the ApiHandler interface for Cohere's AI service.
// It manages the API client lifecycle, processes streaming responses, and handles
// tool execution through Cohere's function calling capabilities.
export class CohereHandler implements ApiHandler {
	private options: CohereHandlerOptions;
	private client: CohereClientV2 | undefined;

	// Initialize the handler with configuration options
	constructor(options: CohereHandlerOptions) {
		this.options = options;
	}

	// Ensure the Cohere client is initialized. Creates a new client if needed.
	// Throws an error if the API key is missing, which is required for authentication.
	// The client is configured with:
	// - API token from options
	// - Custom headers for authentication and environment context
	// - Proxy-aware fetch implementation
	private ensureClient(): CohereClientV2 {
		if (!this.client) {
			if (!this.options.cohereApiKey) {
				throw new Error("Cohere API key is required");
			}
			try {
				this.client = new CohereClientV2({
					token: this.options.cohereApiKey,
					baseUrl: this.options.cohereBaseUrl,
					headers: buildExternalBasicHeaders(),
					fetch, // Use configured fetch with proxy support
				});
			} catch (error) {
				throw new Error(
					`Error creating Cohere client: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		return this.client;
	}

	// Main method to generate AI responses. Uses @withRetry decorator for automatic
	// retry on transient failures. Processes streaming events from Cohere's chat API.
	// Handles:
	// - Text content streaming
	// - Tool call start/delta/end events
	// - Final message with usage statistics
	// Returns an async generator yielding response chunks
	@withRetry()
	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: OpenAITool[],
	): ApiStream {
		const client = this.ensureClient();
		const model = this.getModel();

		// Convert internal message format to Cohere's expected format
		const cohereMessages = convertToCohereMessages(
			systemPrompt,
			messages,
			model.info.supportsImages ?? false,
		);
		// Transform tools to Cohere's format if provided
		const cohereTools = tools ? convertToCohereTools(tools) : undefined;

		// Start streaming chat with configured parameters
		const stream = await client.chatStream({
			model: model.id,
			messages: cohereMessages as unknown as Cohere.ChatMessageV2[],
			tools: cohereTools,
			maxTokens: model.info.maxTokens,
			temperature: 0, // Use deterministic output for better tool call consistency
			strictTools: cohereTools && cohereTools.length > 0 ? true : undefined, // Enforce strict tool usage if tools are provided
			thinking: model.info.supportsReasoning
				? {
						type: "enabled",
						tokenBudget: model.info.maxTokens
							? Math.floor(model.info.maxTokens / 3)
							: 500,
					}
				: undefined,
		});

		// Accumulator for tool calls to send complete tool invocations when finished
		const toolCallAccumulator = new Map<
			number,
			{ id: string; name: string; arguments: string }
		>();

		// Process each streaming event from Cohere API
		for await (const event of stream) {
			switch (event.type) {
				case "content-delta": {
					// Yield text content chunks as they arrive
					const text = event.delta?.message?.content?.text;
					if (text) {
						yield { type: "text", text };
					}
					break;
				}
				case "tool-call-start": {
					// Begin accumulating tool call arguments when a tool is invoked
					const index = event.index ?? 0;
					const toolCall = event.delta?.message?.toolCalls;
					if (toolCall) {
						toolCallAccumulator.set(index, {
							id: toolCall.id,
							name: toolCall.function?.name ?? "",
							arguments: toolCall.function?.arguments ?? "",
						});
					}
					break;
				}
				case "tool-call-delta": {
					// Append additional arguments as they stream in
					const index = event.index ?? 0;
					const args = event.delta?.message?.toolCalls?.function?.arguments;
					if (args) {
						const existing = toolCallAccumulator.get(index);
						if (existing) {
							existing.arguments += args;
						}
					}
					break;
				}
				case "tool-call-end": {
					// When tool call completes, yield the full tool invocation
					const index = event.index ?? 0;
					const accumulated = toolCallAccumulator.get(index);
					if (accumulated) {
						yield {
							type: "tool_calls",
							tool_call: {
								call_id: accumulated.id,
								function: {
									id: accumulated.id,
									name: accumulated.name,
									arguments: accumulated.arguments || "{}",
								},
							},
						};
						toolCallAccumulator.delete(index);
					}
					break;
				}
				case "message-end": {
					Logger.debug(
						`[CohereHandler] Message stream ended, event: ${JSON.stringify(event)}`,
					);
					// Process final message containing usage statistics and cost calculation
					const usageData = event.delta?.usage;
					// Cohere may use different field naming conventions (camelCase vs snake_case)
					const tokenSource =
						usageData?.tokens ??
						usageData?.billedUnits ??
						(usageData as any)?.billed_units;
					if (tokenSource) {
						const inputTokens =
							tokenSource.inputTokens ?? (tokenSource as any).input_tokens ?? 0;
						const outputTokens =
							tokenSource.outputTokens ??
							(tokenSource as any).output_tokens ??
							0;
						// Calculate cost using shared utility
						const totalCost = calculateApiCostOpenAI(
							model.info,
							inputTokens,
							outputTokens,
						);
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
							cacheWriteTokens: 0,
							cacheReadTokens: 0,
							totalCost,
						};
					}
					break;
				}
			}
		}
	}

	// Select appropriate model based on configuration. Uses apiModelId if provided
	// and valid, otherwise falls back to the default model defined in shared config.
	getModel(): { id: CohereModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId;
		if (modelId && modelId in cohereModels) {
			return {
				id: modelId as CohereModelId,
				info: cohereModels[modelId as CohereModelId],
			};
		}
		return {
			id: cohereDefaultModelId,
			info: cohereModels[cohereDefaultModelId],
		};
	}
}
