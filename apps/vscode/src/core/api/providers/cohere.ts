import { CohereClientV2 } from "cohere-ai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { CohereModelId, cohereDefaultModelId, cohereModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"
import { convertToCohereMessages, convertToCohereTools } from "../transform/cohere-format"

interface CohereHandlerOptions extends CommonApiHandlerOptions {
	cohereApiKey?: string
	apiModelId?: string
}

export class CohereHandler implements ApiHandler {
	private options: CohereHandlerOptions
	private client: CohereClientV2 | undefined

	constructor(options: CohereHandlerOptions) {
		this.options = options
	}

	private ensureClient(): CohereClientV2 {
		if (!this.client) {
			if (!this.options.cohereApiKey) {
				throw new Error("Cohere API key is required")
			}
			try {
				this.client = new CohereClientV2({
					token: this.options.cohereApiKey,
					headers: buildExternalBasicHeaders(),
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Cohere client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const cohereMessages = convertToCohereMessages(systemPrompt, messages, model.info.supportsImages ?? false)
		const cohereTools = tools ? convertToCohereTools(tools) : undefined

		const stream = await client.chatStream({
			model: model.id,
			messages: cohereMessages,
			tools: cohereTools,
			maxTokens: model.info.maxTokens,
			temperature: 0,
		})

		const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>()

		for await (const event of stream) {
			switch (event.type) {
				case "content-delta": {
					const text = event.delta?.message?.content?.text
					if (text) {
						yield { type: "text", text }
					}
					break
				}
				case "tool-call-start": {
					const index = event.index ?? 0
					const toolCall = event.delta?.message?.toolCalls
					if (toolCall) {
						toolCallAccumulator.set(index, {
							id: toolCall.id,
							name: toolCall.function?.name ?? "",
							arguments: toolCall.function?.arguments ?? "",
						})
					}
					break
				}
				case "tool-call-delta": {
					const index = event.index ?? 0
					const args = event.delta?.message?.toolCalls?.function?.arguments
					if (args) {
						const existing = toolCallAccumulator.get(index)
						if (existing) {
							existing.arguments += args
						}
					}
					break
				}
				case "tool-call-end": {
					const index = event.index ?? 0
					const accumulated = toolCallAccumulator.get(index)
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
						}
						toolCallAccumulator.delete(index)
					}
					break
				}
				case "message-end": {
					const usage = event.delta?.usage?.tokens
					if (usage) {
						const inputTokens = usage.inputTokens ?? 0
						const outputTokens = usage.outputTokens ?? 0
						const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens)
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
							cacheWriteTokens: 0,
							cacheReadTokens: 0,
							totalCost,
						}
					}
					break
				}
			}
		}
	}

	getModel(): { id: CohereModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in cohereModels) {
			return { id: modelId as CohereModelId, info: cohereModels[modelId as CohereModelId] }
		}
		return { id: cohereDefaultModelId, info: cohereModels[cohereDefaultModelId] }
	}
}
