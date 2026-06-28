import type { LanguageModel } from "ai"
import { streamText } from "ai"
import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { ModelInfo } from "@shared/api"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { ClineTool } from "@/shared/tools"
import type { ApiHandlerModel } from "../"
import { convertToAiSdkMessages, convertToAiSdkTools } from "../transform/ai-sdk-format"

export interface CommonApiHandlerOptions {
	onRetryAttempt?: (attempt: number, error: unknown) => void
}

export interface ApiStreamTextChunk { type: "text"; text: string }
export interface ApiStreamReasoningChunk { type: "reasoning"; reasoning: string }
export interface ApiStreamUsageChunk {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number
}
export interface ApiStreamToolCall {
	call_id: string
	function: { id: string; name: string; arguments: string }
}
export interface ApiStreamToolCallsChunk { type: "tool_calls"; tool_call: ApiStreamToolCall }
export interface ApiStreamDoneChunk { type: "done" }

export type ApiStreamChunk =
	| ApiStreamTextChunk
	| ApiStreamReasoningChunk
	| ApiStreamUsageChunk
	| ApiStreamToolCallsChunk
	| ApiStreamDoneChunk

export type ApiStream = AsyncGenerator<ApiStreamChunk>

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ClineTool[],
		useResponseApi?: boolean,
	): ApiStream
	getModel(): ApiHandlerModel
}

export interface AiSdkHandlerOptions extends CommonApiHandlerOptions {
	model: LanguageModel
	modelInfo: ModelInfo
	modelId: string
	providerOptions?: ProviderOptions
	supportsImages?: boolean
}

/**
 * Generic ApiHandler backed by the Vercel AI SDK (ai@6).
 * Extend this class and call super() with a provider-specific LanguageModel to
 * add support for any provider that has an @ai-sdk/* package.
 */
export class AiSdkHandler implements ApiHandler {
	protected options: AiSdkHandlerOptions

	constructor(options: AiSdkHandlerOptions) {
		this.options = options
	}

	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ClineTool[],
	): ApiStream {
		const { model, modelInfo, providerOptions, supportsImages } = this.options

		const sdkMessages = convertToAiSdkMessages(systemPrompt, messages, supportsImages ?? false)
		const sdkTools = tools && tools.length > 0 ? convertToAiSdkTools(tools) : undefined

		const result = streamText({
			model,
			messages: sdkMessages,
			tools: sdkTools as any,
			maxOutputTokens: modelInfo.maxTokens,
			temperature: 0,
			providerOptions,
		})

		for await (const part of result.fullStream) {
			switch (part.type) {
				case "text-delta":
					if (part.text) yield { type: "text", text: part.text }
					break

				case "reasoning-delta":
					if (part.text) yield { type: "reasoning", reasoning: part.text }
					break

				case "tool-call": {
					const call = part as unknown as { toolCallId: string; toolName: string; input: unknown }
					yield {
						type: "tool_calls",
						tool_call: {
							call_id: call.toolCallId,
							function: {
								id: call.toolCallId,
								name: call.toolName,
								arguments:
									typeof call.input === "string" ? call.input : JSON.stringify(call.input),
							},
						},
					}
					break
				}

				case "finish": {
					const { totalUsage } = part
					if (totalUsage) {
						const inputTokens = totalUsage.inputTokens ?? 0
						const outputTokens = totalUsage.outputTokens ?? 0
						const totalCost =
							((inputTokens * (modelInfo.inputPrice ?? 0)) +
								(outputTokens * (modelInfo.outputPrice ?? 0))) /
							1_000_000
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
							cacheWriteTokens: totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
							cacheReadTokens: totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
							totalCost,
						}
					}
					break
				}

				case "error": {
					const err = part.error
					if (err != null && typeof err === "object" && "value" in err) {
						const raw = (err as { value?: unknown }).value
						if (
							raw != null &&
							typeof raw === "object" &&
							"delta" in raw &&
							(raw as { delta?: { error?: string } }).delta?.error
						) {
							throw new Error((raw as { delta: { error: string } }).delta.error)
						}
					}
					throw err instanceof Error ? err : new Error(String(err))
				}
			}
		}
	}

	getModel(): ApiHandlerModel {
		return { id: this.options.modelId, info: this.options.modelInfo }
	}
}
