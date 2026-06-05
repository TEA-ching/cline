import { Cohere } from "cohere-ai"
import { ChatCompletionFunctionTool, ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import {
	ClineAssistantToolUseBlock,
	ClineImageContentBlock,
	ClineStorageMessage,
	ClineUserToolResultContentBlock,
} from "@/shared/messages/content"

/**
 * Converts ClineStorageMessage array + systemPrompt to Cohere v2 ChatMessageV2 format.
 *
 * Cohere v2 uses camelCase (toolCalls, toolCallId) instead of OpenAI's snake_case.
 * System prompt is prepended as a separate system message.
 */
export function convertToCohereMessages(
	systemPrompt: string,
	messages: ClineStorageMessage[],
	supportsImages = false,
): Cohere.ChatMessageV2[] {
	const cohereMessages: Cohere.ChatMessageV2[] = [{ role: "system", content: systemPrompt }]

	for (const message of messages) {
		if (typeof message.content === "string") {
			cohereMessages.push({ role: message.role, content: message.content })
			continue
		}

		if (message.role === "assistant") {
			const textParts: string[] = []
			const toolCalls: Cohere.ToolCallV2[] = []

			for (const block of message.content) {
				if (block.type === "text") {
					if (block.text) {
						textParts.push(block.text)
					}
				} else if (block.type === "tool_use") {
					const toolBlock = block as ClineAssistantToolUseBlock
					toolCalls.push({
						id: toolBlock.id,
						type: "function",
						function: {
							name: toolBlock.name,
							arguments: JSON.stringify(toolBlock.input),
						},
					})
				}
				// Skip thinking/redacted thinking blocks — not supported by Cohere
			}

			const assistantMsg: Cohere.AssistantMessage & { role: "assistant" } = { role: "assistant" }
			if (textParts.length > 0) {
				assistantMsg.content = textParts.join("")
			}
			if (toolCalls.length > 0) {
				assistantMsg.toolCalls = toolCalls
			}
			cohereMessages.push(assistantMsg)
		} else {
			// user role — may contain text, images, or tool results
			const contentParts: Cohere.Content[] = []
			const toolResultMessages: Cohere.ChatMessageV2[] = []

			for (const block of message.content) {
				if (block.type === "text") {
					if (block.text) {
						contentParts.push({ type: "text", text: block.text })
					}
				} else if (block.type === "image" && supportsImages) {
					const imgBlock = block as ClineImageContentBlock
					const url = `data:${imgBlock.source.media_type};base64,${imgBlock.source.data}`
					contentParts.push({ type: "image_url", imageUrl: { url } })
				} else if (block.type === "tool_result") {
					const toolResult = block as ClineUserToolResultContentBlock
					const content =
						typeof toolResult.content === "string"
							? toolResult.content
							: Array.isArray(toolResult.content)
								? toolResult.content
									.filter((b) => b.type === "text")
									.map((b) => (b as { type: "text"; text: string }).text)
									.join("\n")
								: ""
					toolResultMessages.push({
						role: "tool",
						toolCallId: toolResult.tool_use_id,
						content,
					})
				}
			}

			if (contentParts.length > 0) {
				const hasImages = contentParts.some((p) => p.type === "image_url")
				const userContent: Cohere.UserMessageV2Content = hasImages
					? contentParts
					: contentParts.map((p) => (p as Cohere.Content.Text).text).join("")
				cohereMessages.push({ role: "user", content: userContent })
			}
			cohereMessages.push(...toolResultMessages)
		}
	}

	return cohereMessages
}

/**
 * Converts OpenAI-format function tools to Cohere v2 ToolV2 format.
 *
 * Only converts function tools (type === "function"); custom tools are skipped
 * as Cohere does not support them.
 */
export function convertToCohereTools(tools: OpenAITool[]): Cohere.ToolV2[] {
	return tools
		.filter((tool): tool is ChatCompletionFunctionTool => tool.type === "function")
		.map((tool) => ({
			type: "function" as const,
			function: {
				name: tool.function.name,
				description: tool.function.description,
				parameters: (tool.function.parameters as Record<string, unknown>) ?? {},
			},
		}))
}
