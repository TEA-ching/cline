import type { LanguageModel } from "ai"
import { streamText } from "ai"
import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { ClineTool } from "@/shared/tools"
import type { ApiHandler, ApiHandlerModel, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import type { ApiStream } from "../transform/stream"
import { convertToAiSdkMessages, convertToAiSdkTools } from "../transform/ai-sdk-format"

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
 *
 * Example:
 *   import { createMyProvider } from "@ai-sdk/my-provider"
 *   class MyHandler extends AiSdkHandler {
 *     constructor(opts) {
 *       const provider = createMyProvider({ apiKey: opts.apiKey, fetch })
 *       super({ model: provider(modelId), modelInfo, modelId, ...opts })
 *     }
 *   }
 */
export class AiSdkHandler implements ApiHandler {
	protected options: AiSdkHandlerOptions

	constructor(options: AiSdkHandlerOptions) {
		this.options = options
	}

	@withRetry()
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
			tools: sdkTools as any, // avoid complex ToolSet generic inference
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
					// Cast needed because ToolSet generics obscure the known shape
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
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
							cacheWriteTokens: totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
							cacheReadTokens: totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
							totalCost: calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens),
						}
					}
					break
				}

				case "error": {
					const err = part.error
					// @ai-sdk/* wraps Zod schema failures as TypeValidationError, which carries the
					// original raw value that failed validation (.value field).  For Cohere error
					// responses (finish_reason: "ERROR", usage: {}) the raw event contains the
					// provider's own human-readable error string — surface that instead of the Zod
					// path dump so callers see e.g. "No valid response generated. Try updating
					// messages" rather than "Invalid input: expected object, received undefined".
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
