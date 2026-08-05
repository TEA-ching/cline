/**
 * Markdown to DOCX Executor
 *
 * Environment-agnostic implementation for converting markdown content to DOCX format.
 * Works in both Node.js (file system) and browser (buffer-based) environments.
 */

import type { AgentToolContext } from "@sctg/cline-shared";
import type { WriteMarkdownToDocxExecutor } from "../types";
import { writeFileSync } from "fs";
import { dirname } from "path";
import { mkdir } from "fs/promises";
import markdownDocx, { Packer } from "markdown-docx";

/**
 * Global window interface for browser environment detection
 */
declare const window: any;

export interface WriteMarkdownToDocxExecutorOptions {
	/**
	 * Timeout for markdown to DOCX conversion in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;
}

/**
 * Simple cross-platform event emitter for environment-agnostic event handling.
 * Works in both Node.js and browser environments.
 */
class EventEmitter<T = any> {
	private listeners: Array<(data: T) => void> = [];

	/**
	 * Subscribe to events
	 * @param listener - Callback function to handle emitted data
	 * @returns Unsubscribe function to remove the listener
	 */
	on(listener: (data: T) => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	/**
	 * Emit data to all subscribers
	 * @param data - Data to emit to listeners
	 */
	emit(data: T): void {
		this.listeners.forEach((listener) => listener(data));
	}
}

/**
 * Enhanced markdown to DOCX executor that supports both Node.js and browser environments.
 *
 * This executor provides environment-agnostic markdown to DOCX conversion with event-based
 * communication for browser environments and traditional file system operations for Node.js.
 *
 * Key Features:
 * - Automatic environment detection (Node.js vs browser)
 * - Cross-platform event system for buffer delivery
 * - Progress tracking via events
 * - Backward compatibility with original interface
 * - Type-safe event subscriptions
 *
 * @param _options - Configuration options (currently supports timeoutMs)
 * @returns Enhanced executor with event subscription methods
 *
 * @example
 * ```typescript
 * // Basic Node.js usage (original behavior)
 * const executor = createWriteMarkdownToDocxExecutor();
 * const result = await executor(
 *   "# Hello World\n\nThis is **markdown** content",
 *   "/path/to/output.docx",
 *   context
 * );
 * console.log(result); // "Successfully converted markdown to DOCX and saved to /path/to/output.docx"
 * ```
 *
 * @example
 * ```typescript
 * // Browser usage with event subscription
 * const executor = createWriteMarkdownToDocxExecutor();
 *
 * // Subscribe to progress updates
 * const unsubscribeProgress = executor.onProgress(({ progress, status }) => {
 *   console.log(`Progress: ${Math.round(progress * 100)}% - ${status}`);
 *   // Update UI progress bar
 * });
 *
 * // Subscribe to DOCX buffer
 * const unsubscribeBuffer = executor.onDocxBuffer(({ buffer, markdown }) => {
 *   console.log(`Received DOCX buffer (${buffer.length} bytes)`);
 *
 *   // Example: Create download link
 *   const blob = new Blob([buffer], {
 *     type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 *   });
 *   const url = URL.createObjectURL(blob);
 *   const a = document.createElement('a');
 *   a.href = url;
 *   a.download = 'document.docx';
 *   a.click();
 *   URL.revokeObjectURL(url);
 * });
 *
 * // Execute conversion
 * const result = await executor(
 *   "# Browser Markdown\n\nThis works in **browser** environment",
 *   "output.docx", // Path is ignored in browser
 *   context
 * );
 *
 * // Clean up subscriptions when done
 * unsubscribeProgress();
 * unsubscribeBuffer();
 * ```
 *
 * @example
 * ```typescript
 * // Advanced usage with error handling and multiple subscribers
 * const executor = createWriteMarkdownToDocxExecutor();
 *
 * // Multiple progress subscribers
 * const progressSub1 = executor.onProgress(({ progress }) => {
 *   updateProgressBar(progress);
 * });
 *
 * const progressSub2 = executor.onProgress(({ status }) => {
 *   updateStatusText(status);
 * });
 *
 * // Buffer subscriber for server upload
 * const bufferSub = executor.onDocxBuffer(async ({ buffer, markdown }) => {
 *   try {
 *     const response = await fetch('/api/upload-docx', {
 *       method: 'POST',
 *       body: buffer,
 *       headers: {
 *         'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 *       }
 *     });
 *     const result = await response.json();
 *     console.log('Upload successful:', result);
 *   } catch (error) {
 *     console.error('Upload failed:', error);
 *   }
 * });
 *
 * try {
 *   const result = await executor(
 *     "# Important Report\n\n## Summary\n\nDetailed content here...",
 *     "reports/monthly.docx",
 *     context
 *   );
 *   console.log('Conversion result:', result);
 * } catch (error) {
 *   console.error('Conversion failed:', error);
 * } finally {
 *   // Always clean up subscriptions
 *   progressSub1();
 *   progressSub2();
 *   bufferSub();
 * }
 * ```
 */
export function createWriteMarkdownToDocxExecutor(
	_options: WriteMarkdownToDocxExecutorOptions = {},
): WriteMarkdownToDocxExecutor & {
	/**
	 * Subscribe to DOCX buffer events
	 * @param listener - Callback that receives the DOCX buffer and original markdown
	 * @returns Unsubscribe function to remove the listener
	 *
	 * @example
	 * ```typescript
	 * const executor = createWriteMarkdownToDocxExecutor();
	 * const unsubscribe = executor.onDocxBuffer(({ buffer, markdown }) => {
	 *   console.log(`Received DOCX buffer with ${buffer.length} bytes`);
	 *   // Process the buffer: upload to server, create download, etc.
	 * });
	 *
	 * // Later, when no longer needed
	 * unsubscribe();
	 * ```
	 */
	onDocxBuffer: (
		listener: (data: { buffer: Uint8Array; markdown: string }) => void,
	) => () => void;

	/**
	 * Subscribe to progress events
	 * @param listener - Callback that receives progress updates
	 * @returns Unsubscribe function to remove the listener
	 *
	 * @example
	 * ```typescript
	 * const executor = createWriteMarkdownToDocxExecutor();
	 * const unsubscribe = executor.onProgress(({ progress, status }) => {
	 *   console.log(`Progress: ${Math.round(progress * 100)}% - ${status}`);
	 *   // Update UI elements, progress bars, etc.
	 * });
	 *
	 * // Clean up when done
	 * unsubscribe();
	 * ```
	 */
	onProgress: (
		listener: (data: { progress: number; status: string }) => void,
	) => () => void;
} {
	// Event emitters for cross-environment communication
	const docxBufferEmitter = new EventEmitter<{
		buffer: Uint8Array;
		markdown: string;
	}>();
	const progressEmitter = new EventEmitter<{
		progress: number;
		status: string;
	}>();

	/**
	 * Main executor function - environment-agnostic implementation
	 */
	const executor: WriteMarkdownToDocxExecutor = async (
		markdown: string,
		outputPath: string,
		_context: AgentToolContext,
	): Promise<string> => {
		try {
			// Detect execution environment
			const isBrowser = typeof window !== "undefined";
			const isNode =
				typeof process !== "undefined" &&
				process.versions &&
				process.versions.node;

			// Emit initial progress
			progressEmitter.emit({
				progress: 0.1,
				status: "Starting markdown to DOCX conversion",
			});

			if (isBrowser) {
				// Browser environment: return buffer via events
				progressEmitter.emit({
					progress: 0.3,
					status: "Converting markdown to DOCX document",
				});

				const document = await markdownDocx(markdown);
				progressEmitter.emit({
					progress: 0.7,
					status: "Generating DOCX buffer",
				});

				const docxBuffer = await Packer.toBuffer(document);

				// Convert Node.js Buffer to Uint8Array for browser compatibility
				const uint8Array = new Uint8Array(
					docxBuffer.buffer,
					docxBuffer.byteOffset,
					docxBuffer.length,
				);

				// Emit the DOCX buffer to subscribers
				docxBufferEmitter.emit({ buffer: uint8Array, markdown });

				progressEmitter.emit({
					progress: 1.0,
					status: "Conversion completed successfully",
				});
				return `Successfully converted markdown to DOCX (${uint8Array.length} bytes)`;
			} else if (isNode) {
				// Node.js environment: write to filesystem (original behavior)
				progressEmitter.emit({
					progress: 0.4,
					status: "Preparing output directory",
				});

				const outputDir = dirname(outputPath);
				await mkdir(outputDir, { recursive: true });

				progressEmitter.emit({
					progress: 0.6,
					status: "Converting markdown to DOCX document",
				});

				const document = await markdownDocx(markdown);
				progressEmitter.emit({
					progress: 0.8,
					status: "Writing DOCX file to disk",
				});

				const docxBuffer = await Packer.toBuffer(document);
				writeFileSync(outputPath, docxBuffer);

				progressEmitter.emit({
					progress: 1.0,
					status: "File saved successfully",
				});
				return `Successfully converted markdown to DOCX and saved to ${outputPath}`;
			} else {
				throw new Error(
					"Unsupported execution environment: neither browser nor Node.js detected",
				);
			}
		} catch (error) {
			progressEmitter.emit({ progress: 0.0, status: "Conversion failed" });
			if (error instanceof Error) {
				throw new Error(`Markdown to DOCX conversion failed: ${error.message}`);
			}
			throw new Error(`Markdown to DOCX conversion failed: ${String(error)}`);
		}
	};

	return Object.assign(executor, {
		/**
		 * Subscribe to DOCX buffer events
		 * @param listener - Callback that receives the DOCX buffer and original markdown
		 * @returns Unsubscribe function
		 *
		 * @example
		 * ```typescript
		 * const { onDocxBuffer } = createWriteMarkdownToDocxExecutor();
		 * const unsubscribe = onDocxBuffer(({ buffer, markdown }) => {
		 *   console.log(`Received DOCX buffer with ${buffer.length} bytes`);
		 *   // Send buffer to server, download as file, etc.
		 * });
		 * ```
		 */
		onDocxBuffer: docxBufferEmitter.on.bind(docxBufferEmitter),

		/**
		 * Subscribe to progress events
		 * @param listener - Callback that receives progress updates
		 * @returns Unsubscribe function
		 *
		 * @example
		 * ```typescript
		 * const { onProgress } = createWriteMarkdownToDocxExecutor();
		 * const unsubscribe = onProgress(({ progress, status }) => {
		 *   console.log(`Progress: ${Math.round(progress * 100)}% - ${status}`);
		 * });
		 * ```
		 */
		onProgress: progressEmitter.on.bind(progressEmitter),
	});
}
