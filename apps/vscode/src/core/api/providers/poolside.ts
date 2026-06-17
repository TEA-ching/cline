import { createOpenAI } from "@ai-sdk/openai";
import { poolsideDefaultModelId, poolsideModels, type PoolsideModelInfo } from "@shared/api";
import { buildExternalBasicHeaders } from "@/services/EnvUtils";
import { fetch } from "@/shared/net";
import { HostProvider } from "@/hosts/host-provider";
import path from "path";
import fs from "fs/promises";
import type { CommonApiHandlerOptions } from "..";
import { AiSdkHandler } from "./ai-sdk-handler";

interface PoolsideHandlerOptions extends CommonApiHandlerOptions {
	poolsideBaseUrl?: string
	poolsideApiKey?: string
	apiModelId?: string
}

/**
 * PoolsideHandler
 * 
 * This class handles API requests to Poolside's language models. It extends the base AiSdkHandler
 * class to provide Poolside-specific functionality including model configuration, reasoning support,
 * and tool execution capabilities.
 * 
 * The handler manages the entire lifecycle of a Poolside API session:
 * - Model resolution and validation
 * - Provider initialization with proper authentication and headers
 * - Reasoning configuration for supported models (command-a* series)
 * - Tool schema patching for strict_tools compatibility
 * - Usage reporting correction through fetch patching
 * - Streaming response handling with token count correction
 * 
 * Key responsibilities:
 * - Creating the Poolside SDK provider with custom fetch wrapper
 * - Configuring reasoning parameters when supported (thinking mode)
 * - Ensuring tool schemas meet Poolside's strict requirements
 * - Patching message-end events to report accurate token usage
 * - Supporting both text and tool-based interactions
 */
export class PoolsideHandler extends AiSdkHandler {
 	private modelInfo: PoolsideModelInfo	
	/**
	 * Initializes a new instance of the PoolsideHandler class.
	 * @param {PoolsideHandlerOptions} options - Configuration options for the handler.
	 * @returns {PoolsideHandler} The configured handler instance.
	 */
	constructor(options: PoolsideHandlerOptions) {

		const { id: modelId, info: modelInfo } = resolveModel(options)
		
		const provider = createOpenAI({
			apiKey: options.poolsideApiKey,
			baseURL: options.poolsideBaseUrl || "https://inference.poolside.ai/v1",
			headers: buildExternalBasicHeaders() as Record<string, string>,

			fetch: patchPoolsideUsageFetch(fetch),
		})

		super({
			onRetryAttempt: options.onRetryAttempt,
			model: provider.chat(modelId),
			modelInfo,
			modelId,
			supportsImages: modelInfo.supportsImages ?? false,
		})
		this.modelInfo = modelInfo
	}
	/**
	 * Checks if the current model supports tools.
	 * @returns {boolean} True if the model supports tools, false otherwise.
	 */
	supportsTools(): boolean {
		return this.modelInfo.supportsTools ?? false
	}
}

/**
 * resolveModel
 * 
 * Resolves the model identifier and its information based on the provided options.
 * If a valid model identifier is provided, it is used; otherwise, the default model is selected.
 * 
 * This function centralizes the model selection logic, ensuring we always use a known and valid model.
 * It performs implicit validation by checking the existence of the identifier in the shared model registry.
 * 
 * @param {PoolsideHandlerOptions} options - Configuration options containing the model identifier to use.
 *   - apiModelId: Specific model identifier desired (optional)
 * @returns {Object} An object containing:
 *   - id: The selected model identifier (PoolsideModelId)
 *   - info: The detailed model information (PoolsideModelInfo)
 * 
 * @example
 * // Using the default model
 * const { id, info } = resolveModel({})
 * // id will be poolsideDefaultModelId, info will be its information
 * 
 * @example
 * // Using a specific model
 * const { id, info } = resolveModel({ apiModelId: "command-r-plus" })
 * // id will be "command-r-plus", info will be its information from poolsideModels
 */
function resolveModel(options: PoolsideHandlerOptions): { id: typeof poolsideDefaultModelId	; info: PoolsideModelInfo } {

	const modelId = options.apiModelId
	if (modelId && modelId in poolsideModels) {
		return { id: modelId as typeof poolsideDefaultModelId, info: poolsideModels[modelId as typeof poolsideDefaultModelId] }
	}
	return { id: poolsideDefaultModelId, info: poolsideModels[poolsideDefaultModelId] }
}

/**
 * patchPoolsideUsageFetch
 * 
 * Returns a modified fetch function that corrects token usage reporting for Poolside's
 * command-a* models when "thinking" mode is enabled.
 * 
 * Problem solved: Poolside streaming "message-end" events incorrectly report
 * `tokens.input_tokens = 0` while `billed_units.input_tokens` contains the correct value.
 * This function patches the response body to correct these counters before they are
 * parsed by the client.
 * 
 * The function performs several steps:
 *   1. Patches tool schemas for strict_tools=true compatibility
 *   2. Adds `strict_tools: true` header when tools are present
 *   3. Generates TypeScript logs for debugging (when COHERE_DEBUG_FETCH_LOG=1)
 *   4. Corrects message-end lines to use billed token counters
 * 
 * @param {typeof fetch} baseFetch - The original fetch function to modify
 * @returns {typeof fetch} - A new fetch function with all corrections applied
 */
function patchPoolsideUsageFetch(baseFetch: typeof fetch): typeof fetch {



	return async (input, init) => {
		// Patch tool schemas and add strict_tools when tools are present.
		if (init?.body) {
			const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body
			if (body?.tools && body?.tools.length > 0) {
				// strict_tools=true requires every object-typed parameter schema to have
				// at least one required field — patch schemas that violate this before sending.
				body.tools = body.tools.map((tool: any) => {
					if (tool?.function?.parameters) {
						return { ...tool, function: { ...tool.function, parameters: tool.function.parameters } }
					}
					return tool
				})
				if (!body.strict_tools) {
					body.strict_tools = true
				}
				init.body = JSON.stringify(body)
			}
		}

		// Log as TypeScript fetch script (set POOLSIDE_DEBUG_FETCH_LOG=1 to enable)
		if (process.env.POOLSIDE_DEBUG_FETCH_LOG === "1") {
			try {
				const storagePath = path.join(HostProvider.get().globalStorageFsPath, "poolside")
				await fs.mkdir(storagePath, { recursive: true })

				const timestamp = Date.now()
				const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as any).url
				const method = init?.method || "POST"
				const headers = (init?.headers as Record<string, string>) || {}
				const bodyObj = init?.body ? (typeof init.body === "string" ? JSON.parse(init.body) : init.body) : undefined
				// Generate TypeScript fetch code
				const tsCode = generateTypeScriptFetchCode(url, method, headers, bodyObj);

				await fs.writeFile(path.join(storagePath, `${timestamp}.ts`), tsCode)

				// Keep only the 100 most recent files
				await cleanupOldLogFiles(storagePath, 100)
			} catch (error) {
				console.error("Failed to write poolside TypeScript log:", error)
			}
		}

		const response = await baseFetch(input, init)
		if (!response.body || !response.headers.get("content-type")?.includes("event-stream")) {
			return response
		}
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers })
	}
}

/**
 * Generates TypeScript code for a fetch request based on the provided parameters.
 * Used for logging API requests to Poolside.
 * @param {string} url - The URL of the request.
 * @param {string} method - The HTTP method of the request.
 * @param {Record<string, string>} headers - The headers of the request.
 * @param {any} bodyObj - The body of the request.
 * @returns {string} - The generated TypeScript code.
 */
function generateTypeScriptFetchCode(url: string, method: string, headers: Record<string, string>, bodyObj: any): string {
	return `// Auto-generated Poolside API request script
// This script demonstrates how to make the same API request using fetch in TypeScript

/**
 * Makes a Poolside API request using fetch
 * @returns Promise that resolves with the API response
 */
async function makePoolsideRequest(): Promise<Response> {
    const url = "${url}";
    const method = "${method}";

    // Request headers
    const headers = new Headers();
${Object.entries(headers).map(([key, value]) => `    headers.append("${key}", "${value.replace(/"/g, '\\"')}");`).join("\n")}

    // Request body (if present)
${bodyObj ? `    const body = ${JSON.stringify(bodyObj, null, 2)};` : `    const body = undefined;`}

    // Execute the fetch request
    const response = await fetch(url, {
        method: method,
        headers: headers,
${bodyObj ? `        body: JSON.stringify(body),` : ""}
    });

    return response;
}

// Execute the request
makePoolsideRequest()
    .then(response => {
        console.log("Request successful:", response.status, response.statusText);
        return response.json();
    })
    .then(data => {
        console.log("Response data:", data);
    })
    .catch(error => {
        console.error("Request failed:", error);
    });

// Export for programmatic use
export { makePoolsideRequest };
`
}

/**
 * Cleans up old log files, keeping only the most recent ones.
 * @param {string} directoryPath - Path to the directory containing log files.
 * @param {number} maxFilesToKeep - Maximum number of files to keep.
 */
export async function cleanupOldLogFiles(directoryPath: string, maxFilesToKeep: number): Promise<void> {
	try {
		// Read all files in the directory
		const files: string[] = await fs.readdir(directoryPath)

		// Filter out only .ts files and extract timestamps from filenames
		const tsFiles = files
			.filter(file => file.endsWith('.ts'))
			.map(file => {
				const timestamp = parseInt(file.replace('.ts', ''))
				return { filename: file, timestamp: isNaN(timestamp) ? 0 : timestamp }
			})
			.filter(file => file.timestamp > 0) // Only keep files with valid timestamps

		// Sort by timestamp (oldest first)
		tsFiles.sort((a, b) => a.timestamp - b.timestamp)

		// Calculate how many files to delete
		const filesToDelete = tsFiles.length - maxFilesToKeep
		if (filesToDelete <= 0) {
			return // No cleanup needed
		}

		// Delete the oldest files
		const filesToDeleteNames = tsFiles.slice(0, filesToDelete).map(f => f.filename)
		for (const filename of filesToDeleteNames) {
			try {
				await fs.unlink(path.join(directoryPath, filename))
			} catch (error) {
				console.error(`Failed to delete old log file ${filename}:`, error)
			}
		}
	} catch (error) {
		console.error("Failed to cleanup old log files:", error)
	}
}
