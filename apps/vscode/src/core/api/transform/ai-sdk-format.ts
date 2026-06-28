import type {
    AssistantModelMessage,
    ImagePart,
    ModelMessage,
    SystemModelMessage,
    TextPart,
    Tool,
    ToolCallPart,
    ToolModelMessage,
    ToolResultPart,
    UserModelMessage,
} from "ai";
import { jsonSchema } from "ai";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import type {
    ClineAssistantToolUseBlock,
    ClineImageContentBlock,
    ClineStorageMessage,
    ClineUserToolResultContentBlock,
} from "@/shared/messages/content";
import type { ClineTool } from "@/shared/tools";

/**
 * Converts ClineStorageMessage[] + systemPrompt to AI SDK ModelMessage[].
 *
 * Cline stores messages in Anthropic format (tool_use / tool_result blocks).
 * The AI SDK uses ModelMessage with role "tool" for tool results, so user messages
 * containing tool_result blocks are split: tool results go into a "tool" message,
 * text/images stay in a "user" message.
 */
export function convertToAiSdkMessages(
	systemPrompt: string,
	messages: ClineStorageMessage[],
	supportsImages = false,
): ModelMessage[] {
	// Pre-build toolCallId → toolName map from all assistant messages so tool
	// result parts can carry the required toolName field.
	const toolCallNames = new Map<string, string>()
	for (const msg of messages) {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use") {
					const b = block as ClineAssistantToolUseBlock
					toolCallNames.set(b.id, b.name)
				}
			}
		}
	}

	const result: ModelMessage[] = [
		{ role: "system", content: systemPrompt } satisfies SystemModelMessage,
	]

	for (const message of messages) {
		if (typeof message.content === "string") {
			if (message.role === "assistant") {
				result.push({ role: "assistant", content: message.content } satisfies AssistantModelMessage)
			} else {
				result.push({ role: "user", content: message.content } satisfies UserModelMessage)
			}
			continue
		}

		if (message.role === "assistant") {
			const parts: Array<TextPart | ToolCallPart> = []
			for (const block of message.content) {
				if (block.type === "text") {
					const text = (block as { type: "text"; text: string }).text
					if (text) parts.push({ type: "text", text })
				} else if (block.type === "tool_use") {
					const b = block as ClineAssistantToolUseBlock
					parts.push({
						type: "tool-call",
						toolCallId: b.id,
						toolName: b.name,
						input: b.input ?? {},
					})
				}
				// thinking / redacted_thinking: skip — handled by providerOptions
			}
			if (parts.length === 0) continue
			const content =
				parts.length === 1 && parts[0].type === "text"
					? (parts[0] as TextPart).text
					: parts
			result.push({ role: "assistant", content } satisfies AssistantModelMessage)
		} else {
			// user role — tool results must go in a separate "tool" message
			const contentParts: Array<TextPart | ImagePart> = []
			const toolResultParts: ToolResultPart[] = []

			for (const block of message.content) {
				if (block.type === "text") {
					const text = (block as { type: "text"; text: string }).text
					if (text) contentParts.push({ type: "text", text })
				} else if (block.type === "image" && supportsImages) {
					const img = block as ClineImageContentBlock
					if ("data" in img.source) {
						// Base64ImageSource
						contentParts.push({
							type: "image",
							image: img.source.data,
							mediaType: img.source.media_type as string,
						})
					} else if ("url" in img.source) {
						// URLImageSource (future-proofing: not in current SDK types)
						const urlSrc = img.source as unknown as { url: string; media_type?: string }
						contentParts.push({
							type: "image",
							image: urlSrc.url,
							mediaType: urlSrc.media_type,
						})
					}
				} else if (block.type === "tool_result") {
					const tr = block as ClineUserToolResultContentBlock
					const text =
						typeof tr.content === "string"
							? tr.content
							: Array.isArray(tr.content)
								? tr.content
										.filter((b) => b.type === "text")
										.map((b) => (b as { type: "text"; text: string }).text)
										.join("\n")
								: ""
					toolResultParts.push({
						type: "tool-result",
						toolCallId: tr.tool_use_id,
						toolName: toolCallNames.get(tr.tool_use_id) ?? "",
						output: { type: "text", value: text },
					})
				}
			}

			// Tool results before user text follows provider conversation semantics
			if (toolResultParts.length > 0) {
				result.push({ role: "tool", content: toolResultParts } satisfies ToolModelMessage)
			}
			if (contentParts.length > 0) {
				const content =
					contentParts.length === 1 && contentParts[0].type === "text"
						? (contentParts[0] as TextPart).text
						: contentParts
				result.push({ role: "user", content } satisfies UserModelMessage)
			}
		}
	}

	return result
}

/**
 * Converts ClineTool[] (OpenAI / Anthropic / Google format) to AI SDK Tool record.
 * The AI SDK handles routing to each provider's native tool format.
 */
export function convertToAiSdkTools(tools: ClineTool[]): Record<string, Tool> {
	const result: Record<string, Tool> = {}

	for (const rawTool of tools) {
		const tool = rawTool as unknown as Record<string, unknown>

		if (tool.type === "function" && typeof tool.function === "object") {
			// OpenAI ChatCompletionFunctionTool
			const fn = (rawTool as ChatCompletionFunctionTool).function
			result[fn.name] = {
				description: fn.description,
				inputSchema: jsonSchema(
					(fn.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
				),
			}
		} else if (typeof tool.input_schema === "object" && typeof tool.name === "string") {
			// Anthropic Tool
			result[tool.name as string] = {
				description: tool.description as string | undefined,
				inputSchema: jsonSchema(
					(tool.input_schema as Record<string, unknown>) ?? { type: "object", properties: {} },
				),
			}
		} else if (typeof tool.name === "string" && typeof tool.parameters === "object") {
			// Google FunctionDeclaration
			result[tool.name as string] = {
				description: tool.description as string | undefined,
				inputSchema: jsonSchema(
					(tool.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
				),
			}
		}
	}

	return result
}
