// Converts Cline storage messages and system prompt to Cohere v2 ChatMessageV2 format.
// This function prepares messages for the Cohere API by handling different message roles
// and content types (text, tool_use, image). It also ensures proper formatting for
// Cohere's camelCase requirements and skips unsupported content types.

import type { Cohere } from "cohere-ai";
import type {
	ChatCompletionFunctionTool,
	ChatCompletionTool as OpenAITool,
} from "openai/resources/chat/completions";
import type {
	ClineAssistantToolUseBlock,
	ClineImageContentBlock,
	ClineStorageMessage,
	ClineUserToolResultContentBlock,
} from "@/shared/messages/content";

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
	// Initialize the message array with the system prompt as the first message
	const cohereMessages: Cohere.ChatMessageV2[] = [
		{ role: "system", content: systemPrompt },
	];

	// Iterate over each Cline storage message to convert it to Cohere format
	for (const message of messages) {
		// Handle simple string-based messages directly
		if (typeof message.content === "string") {
			cohereMessages.push({ role: message.role, content: message.content });
			continue;
		}

		// Process assistant role messages (may contain text and tool calls)
		if (message.role === "assistant") {
			const textParts: string[] = []; // Collects plain text segments
			const toolCalls: Cohere.ToolCallV2[] = []; // Collects tool call information

			// Loop through each content block in the assistant message
			for (const block of message.content) {
				if (block.type === "text") {
					// Add non-empty text blocks to the text parts array
					if (block.text) {
						textParts.push(block.text);
					}
				} else if (block.type === "tool_use") {
					// Convert tool use block to Cohere's function tool call format
					const toolBlock = block as ClineAssistantToolUseBlock;
					toolCalls.push({
						id: toolBlock.id,
						type: "function",
						function: {
							name: toolBlock.name,
							arguments: JSON.stringify(toolBlock.input),
						},
					});
				}
				// Note: thinking and redacted thinking blocks are intentionally skipped
				// because Cohere does not support these content types.
			}

			// Create the assistant message object for Cohere
			const assistantMsg: Cohere.AssistantMessage & { role: "assistant" } = {
				role: "assistant",
			};
			if (textParts.length > 0) {
				// Combine all text parts into a single string
				assistantMsg.content = textParts.join("");
			}
			if (toolCalls.length > 0) {
				// Attach tool calls if any were collected
				assistantMsg.toolCalls = toolCalls;
			}
			cohereMessages.push(assistantMsg);
		} else {
			// Process user role messages (may contain text, images, or tool results)
			const contentParts: Cohere.Content[] = []; // Holds text and image content
			const toolResultMessages: Cohere.ChatMessageV2[] = []; // Holds tool result messages

			// Iterate through each block in the user message content
			for (const block of message.content) {
				if (block.type === "text") {
					// Add text blocks to content parts if they contain text
					if (block.text) {
						contentParts.push({ type: "text", text: block.text });
					}
				} else if (block.type === "image" && supportsImages) {
					// Convert image block to base64 data URL for Cohere
					const imgBlock = block as ClineImageContentBlock;
					const url = `data:${imgBlock.source.media_type};base64,${imgBlock.source.data}`;
					contentParts.push({ type: "image_url", imageUrl: { url } });
				} else if (block.type === "tool_result") {
					// Convert tool result block to a separate tool message
					const toolResult = block as ClineUserToolResultContentBlock;
					// Extract text content from tool result (handles string or array content)
					const content =
						typeof toolResult.content === "string"
							? toolResult.content
							: Array.isArray(toolResult.content)
								? toolResult.content
										.filter((b) => b.type === "text")
										.map((b) => (b as { type: "text"; text: string }).text)
										.join("\n")
								: "";
					toolResultMessages.push({
						role: "tool",
						toolCallId: toolResult.tool_use_id,
						content,
					});
				}
			}

			// Add user content to messages if any text or images were found
			if (contentParts.length > 0) {
				const hasImages = contentParts.some((p) => p.type === "image_url");
				// Format user content differently if images are present
				const userContent: Cohere.UserMessageV2Content = hasImages
					? contentParts
					: contentParts.map((p) => (p as Cohere.Content.Text).text).join("");
				cohereMessages.push({ role: "user", content: userContent });
			}
			// Append any tool result messages after the user content
			cohereMessages.push(...toolResultMessages);
		}
	}

	return cohereMessages;
}

/**
 * Converts OpenAI-format function tools to Cohere v2 ToolV2 format.
 *
 * Only converts function tools (type === "function"); custom tools are skipped
 * as Cohere does not support them.
 */
export function convertToCohereTools(tools: OpenAITool[]): Cohere.ToolV2[] {
	// Filter tools to keep only function-type tools (skip custom tools)
	return tools
		.filter(
			(tool): tool is ChatCompletionFunctionTool => tool.type === "function",
		)
		.map((tool) => ({
			type: "function" as const,
			function: {
				name: tool.function.name,
				description: tool.function.description,
				parameters: (tool.function.parameters as Record<string, unknown>) ?? {},
			},
		}));
}
