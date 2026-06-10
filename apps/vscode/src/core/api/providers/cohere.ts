import { createCohere } from "@ai-sdk/cohere"
import { type CohereModelId, cohereDefaultModelId, cohereModels, type ModelInfo } from "@shared/api"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { fetch } from "@/shared/net"
import type { CommonApiHandlerOptions } from "../"
import { AiSdkHandler } from "./ai-sdk-handler"

interface CohereHandlerOptions extends CommonApiHandlerOptions {
	cohereBaseUrl?: string
	cohereApiKey?: string
	apiModelId?: string
}

export class CohereHandler extends AiSdkHandler {
	constructor(options: CohereHandlerOptions) {
		const { id: modelId, info: modelInfo } = resolveModel(options)

		const provider = createCohere({
			apiKey: options.cohereApiKey,
			baseURL: options.cohereBaseUrl,
			headers: buildExternalBasicHeaders() as Record<string, string>,
			// Wrap fetch to fix usage reporting: command-a* models with thinking set
			// tokens.input_tokens = 0 in message-end; billed_units.input_tokens is correct.
			fetch: patchCohereUsageFetch(fetch),
		})

		const providerOptions = modelInfo.supportsReasoning
			? {
					cohere: {
						thinking: {
							type: "enabled" as const,
							tokenBudget: modelInfo.thinkingConfig?.maxBudget
								? Math.floor(modelInfo.thinkingConfig.maxBudget / 2)
								: modelInfo.maxTokens
									? Math.floor(modelInfo.maxTokens / 3)
									: 5_000,
						},
					},
				}
			: undefined

		super({
			onRetryAttempt: options.onRetryAttempt,
			model: provider(modelId),
			modelInfo,
			modelId,
			providerOptions,
			supportsImages: modelInfo.supportsImages ?? false,
		})
	}
}

function resolveModel(options: CohereHandlerOptions): { id: CohereModelId; info: ModelInfo } {
	const modelId = options.apiModelId
	if (modelId && modelId in cohereModels) {
		return { id: modelId as CohereModelId, info: cohereModels[modelId as CohereModelId] }
	}
	return { id: cohereDefaultModelId, info: cohereModels[cohereDefaultModelId] }
}

// Cohere's command-a* models with thinking report tokens.input_tokens = 0 while
// billed_units.input_tokens holds the actual prompt size.  Patch the raw SSE stream
// so @ai-sdk/cohere always sees a non-zero tokens.input_tokens value.
function patchCohereUsageFetch(baseFetch: typeof fetch): typeof fetch {
	return async (input, init) => {
		const response = await baseFetch(input, init)
		if (!response.body || !response.headers.get("content-type")?.includes("event-stream")) {
			return response
		}
		const decoder = new TextDecoder()
		const encoder = new TextEncoder()
		let buffer = ""
		const patched = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					buffer += decoder.decode(chunk, { stream: true })
					const lines = buffer.split("\n")
					buffer = lines.pop() ?? ""
					for (const line of lines) {
						controller.enqueue(encoder.encode(patchMessageEndLine(line) + "\n"))
					}
				},
				flush(controller) {
					if (buffer) controller.enqueue(encoder.encode(patchMessageEndLine(buffer)))
				},
			}),
		)
		return new Response(patched, { status: response.status, statusText: response.statusText, headers: response.headers })
	}
}

function patchMessageEndLine(line: string): string {
	if (!line.startsWith("data: ")) return line
	try {
		const event = JSON.parse(line.slice(6))
		if (event.type === "message-end" && event.delta?.usage) {
			const usage = event.delta.usage
			const billed = usage.billed_units
			if (billed) {
				if (!usage.tokens) {
					usage.tokens = {
						input_tokens: billed.input_tokens ?? 0,
						output_tokens: billed.output_tokens ?? 0,
					}
				} else {
					if (!(usage.tokens.input_tokens > 0) && billed.input_tokens > 0) {
						usage.tokens.input_tokens = billed.input_tokens
					}
					if (!(usage.tokens.output_tokens > 0) && billed.output_tokens > 0) {
						usage.tokens.output_tokens = billed.output_tokens
					}
				}
			}
		}
		return `data: ${JSON.stringify(event)}`
	} catch {
		return line
	}
}
