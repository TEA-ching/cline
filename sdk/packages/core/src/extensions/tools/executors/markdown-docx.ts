/**
 * Markdown to DOCX Executor
 *
 * Built-in implementation for converting markdown content to DOCX format.
 */

import type { AgentToolContext } from "@cline/shared";
import type { WriteMarkdownToDocxExecutor } from "../types";
import { writeFileSync } from "fs";
import { dirname } from "path";
import { mkdir } from "fs/promises";
import markdownDocx from "markdown-docx";

export interface WriteMarkdownToDocxExecutorOptions {
	/**
	 * Timeout for markdown to DOCX conversion in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;
}

/**
 * Create a markdown to DOCX executor
 *
 * @example
 * ```typescript
 * const markdownToDocx = createWriteMarkdownToDocxExecutor({
 *   timeoutMs: 15000,
 * })
 *
 * const result = await markdownToDocx(
 *   "# Hello World\n\nThis is **markdown** content",
 *   "/path/to/output.docx",
 *   context
 * )
 * ```
 */
export function createWriteMarkdownToDocxExecutor(
	options: WriteMarkdownToDocxExecutorOptions = {},
): WriteMarkdownToDocxExecutor {
	const { timeoutMs = 30000 } = options;

	return async (
		markdown: string,
		outputPath: string,
		context: AgentToolContext,
	): Promise<string> => {
		// Create abort controller for timeout
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		let contextAbortHandler: (() => void) | undefined;

		// Combine with context abort signal
		if (context.signal) {
			contextAbortHandler = () => controller.abort();
			context.signal.addEventListener("abort", contextAbortHandler);
		}

		try {
			// Ensure output directory exists
			const outputDir = dirname(outputPath);
			await mkdir(outputDir, { recursive: true });

			// Convert markdown to DOCX
			const docxBuffer = await markdownDocx({
				content: markdown,
				signal: controller.signal,
			});

			// Write the DOCX file
			writeFileSync(outputPath, docxBuffer);

			clearTimeout(timeout);

			return `Successfully converted markdown to DOCX and saved to ${outputPath}`;
		} catch (error) {
			clearTimeout(timeout);

			if (error instanceof Error) {
				if (error.name === "AbortError") {
					throw new Error(`Markdown to DOCX conversion timed out after ${timeoutMs}ms`);
				}
				throw new Error(`Markdown to DOCX conversion failed: ${error.message}`);
			}
			throw new Error(`Markdown to DOCX conversion failed: ${String(error)}`);
		} finally {
			if (context.signal && contextAbortHandler) {
				context.signal.removeEventListener("abort", contextAbortHandler);
			}
		}
	};
}
