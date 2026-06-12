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
import markdownDocx, { Packer } from "markdown-docx";

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
	_options: WriteMarkdownToDocxExecutorOptions = {},
): WriteMarkdownToDocxExecutor {
	return async (
		markdown: string,
		outputPath: string,
		_context: AgentToolContext,
	): Promise<string> => {
		try {
			const outputDir = dirname(outputPath);
			await mkdir(outputDir, { recursive: true });

			const document = await markdownDocx(markdown);
			const docxBuffer = await Packer.toBuffer(document);
			writeFileSync(outputPath, docxBuffer);

			return `Successfully converted markdown to DOCX and saved to ${outputPath}`;
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Markdown to DOCX conversion failed: ${error.message}`);
			}
			throw new Error(`Markdown to DOCX conversion failed: ${String(error)}`);
		}
	};
}
