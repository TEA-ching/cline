import { createCohere } from "@ai-sdk/cohere";
import { type CohereModelId, cohereDefaultModelId, cohereModels, type CohereModelInfo } from "@shared/api";
import { buildExternalBasicHeaders } from "@/services/EnvUtils";
import { fetch } from "@/shared/net";
import { HostProvider } from "@/hosts/host-provider";
import path from "path";
import fs from "fs/promises";
import type { CommonApiHandlerOptions } from "../";
import { AiSdkHandler } from "./ai-sdk-handler";

interface CohereHandlerOptions extends CommonApiHandlerOptions {
	cohereBaseUrl?: string
	cohereApiKey?: string
	apiModelId?: string
}

/**
 * CohereHandler
 * 
 * This class handles API requests to Cohere's language models. It extends the base AiSdkHandler
 * class to provide Cohere-specific functionality including model configuration, reasoning support,
 * and tool execution capabilities.
 * 
 * The handler manages the entire lifecycle of a Cohere API session:
 * - Model resolution and validation
 * - Provider initialization with proper authentication and headers
 * - Reasoning configuration for supported models (command-a* series)
 * - Tool schema patching for strict_tools compatibility
 * - Usage reporting correction through fetch patching
 * - Streaming response handling with token count correction
 * 
 * Key responsibilities:
 * - Creating the Cohere SDK provider with custom fetch wrapper
 * - Configuring reasoning parameters when supported (thinking mode)
 * - Ensuring tool schemas meet Cohere's strict requirements
 * - Patching message-end events to report accurate token usage
 * - Supporting both text and tool-based interactions
 */
export class CohereHandler extends AiSdkHandler {
 	private modelInfo: CohereModelInfo	
	/**
	 * Initializes a new instance of the CohereHandler class.
	 * @param {CohereHandlerOptions} options - Configuration options for the handler.
	 * @returns {CohereHandler} The configured handler instance.
	 */
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
			: { cohere: { strict_tools: "true" } }

		super({
			onRetryAttempt: options.onRetryAttempt,
			model: provider(modelId),
			modelInfo,
			modelId,
			providerOptions,
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
 * @param {CohereHandlerOptions} options - Configuration options containing the model identifier to use.
 *   - apiModelId: Specific model identifier desired (optional)
 * @returns {Object} An object containing:
 *   - id: The selected model identifier (CohereModelId)
 *   - info: The detailed model information (CohereModelInfo)
 * 
 * @example
 * // Using the default model
 * const { id, info } = resolveModel({})
 * // id will be cohereDefaultModelId, info will be its information
 * 
 * @example
 * // Using a specific model
 * const { id, info } = resolveModel({ apiModelId: "command-r-plus" })
 * // id will be "command-r-plus", info will be its information from cohereModels
 */
function resolveModel(options: CohereHandlerOptions): { id: CohereModelId; info: CohereModelInfo } {

	const modelId = options.apiModelId
	if (modelId && modelId in cohereModels) {
		return { id: modelId as CohereModelId, info: cohereModels[modelId as CohereModelId] }
	}
	return { id: cohereDefaultModelId, info: cohereModels[cohereDefaultModelId] }
}

/**
 * patchCohereUsageFetch
 * 
 * Returns a modified fetch function that corrects token usage reporting for Cohere's
 * command-a* models when "thinking" mode is enabled.
 * 
 * Problem solved: Cohere streaming "message-end" events incorrectly report
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
function patchCohereUsageFetch(baseFetch: typeof fetch): typeof fetch {



	return async (input, init) => {
		// Patch tool schemas and add strict_tools when tools are present.
		if (init?.body) {
			const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body
			if (body?.tools && body?.tools.length > 0) {
				// strict_tools=true requires every object-typed parameter schema to have
				// at least one required field — patch schemas that violate this before sending.
				body.tools = body.tools.map((tool: any) => {
					if (tool?.function?.parameters) {
						return { ...tool, function: { ...tool.function, parameters: patchObjectSchemaRequired(tool.function.parameters) } }
					}
					return tool
				})
				if (!body.strict_tools) {
					body.strict_tools = true
				}
				init.body = JSON.stringify(body)
			}
		}

		// Log as TypeScript fetch script (set COHERE_DEBUG_FETCH_LOG=1 to enable)
		if (process.env.COHERE_DEBUG_FETCH_LOG === "1") {
			try {
				const storagePath = path.join(HostProvider.get().globalStorageFsPath, "cohere")
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
				console.error("Failed to write cohere TypeScript log:", error)
			}
		}

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

// Constraints that Cohere strict_tools=true does not support and must be stripped.
// Verified by testing: minItems, maxItems, minLength, maxLength, pattern, minimum, maximum, multipleOf
// are rejected; uniqueItems, exclusiveMinimum, default are accepted.
const COHERE_UNSUPPORTED_CONSTRAINTS = new Set([
	"minItems", "maxItems",
	"minLength", "maxLength", "pattern",
	"minimum", "maximum", "multipleOf",
	"format",
])

function stripUnsupportedConstraints(s: Record<string, unknown>): Record<string, unknown> {
	const result = { ...s }
	for (const key of COHERE_UNSUPPORTED_CONSTRAINTS) delete result[key]
	return result
}

/**
 * Recursively patches tool parameter schemas for Cohere strict_tools=true compatibility:
 * 1. Strips unsupported JSON Schema constraints (minItems, maxItems, minLength, maxLength,
 *    pattern, minimum, maximum, multipleOf).
 * 2. Ensures every non-empty object schema has at least one required field.
 * 3. Converts empty object schemas ({type:"object", properties:{}}) to {} so Cohere
 *    accepts no-parameter tools.
 * 4. Recurses into anyOf/oneOf/allOf sub-schemas (produced by Zod's .nullable(), z.union(), etc.).
 * @param {unknown} schema - The schema to be patched.
 * @returns {unknown} - The patched schema.
 */
function patchObjectSchemaRequired(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return schema
	const s = schema as Record<string, unknown>
	// Recurse into anyOf/oneOf/allOf: Zod's .nullable() generates {anyOf: [{type: "integer", maximum: ...}, {type: "null"}]},
	// so constraints inside sub-schemas must be stripped too.
	if (Array.isArray(s.anyOf)) {
		return stripUnsupportedConstraints({ ...s, anyOf: (s.anyOf as unknown[]).map(patchObjectSchemaRequired) })
	}
	if (Array.isArray(s.oneOf)) {
		return stripUnsupportedConstraints({ ...s, oneOf: (s.oneOf as unknown[]).map(patchObjectSchemaRequired) })
	}
	if (Array.isArray(s.allOf)) {
		return stripUnsupportedConstraints({ ...s, allOf: (s.allOf as unknown[]).map(patchObjectSchemaRequired) })
	}
	if (s.type === "object") {
		const props = s.properties as Record<string, unknown> | undefined
		const keys = props ? Object.keys(props) : []
		// No properties (absent or empty): strict_tools=true rejects object schemas without
		// at least one required field. For no-parameter tools, {} is the form Cohere accepts.
		if (keys.length === 0) {
			return {}
		}
		const existing = (s.required as string[] | undefined) ?? []
		const patchedProps = Object.fromEntries(
			Object.entries(props!).map(([k, v]) => [k, patchObjectSchemaRequired(v)])
		)
		return stripUnsupportedConstraints({
			...s,
			properties: patchedProps,
			...(existing.length === 0 ? { required: [keys[0]] } : {}),
		})
	}
	if (s.items) {
		return stripUnsupportedConstraints({ ...s, items: patchObjectSchemaRequired(s.items) })
	}
	return stripUnsupportedConstraints(s)
}

/**
 * Patches the message-end line to correct token counts based on billed units.
 * Ensures that input and output token counts are accurately reported.
 * @param {string} line - The message-end line to be patched.
 * @returns {string} - The patched message-end line.
 */
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

/**
 * Generates TypeScript code for a fetch request based on the provided parameters.
 * Used for logging API requests to Cohere.
 * @param {string} url - The URL of the request.
 * @param {string} method - The HTTP method of the request.
 * @param {Record<string, string>} headers - The headers of the request.
 * @param {any} bodyObj - The body of the request.
 * @returns {string} - The generated TypeScript code.
 */
function generateTypeScriptFetchCode(url: string, method: string, headers: Record<string, string>, bodyObj: any): string {
	return `// Auto-generated Cohere API request script
// This script demonstrates how to make the same API request using fetch in TypeScript

/**
 * Makes a Cohere API request using fetch
 * @returns Promise that resolves with the API response
 */
async function makeCohereRequest(): Promise<Response> {
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
makeCohereRequest()
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
export { makeCohereRequest };
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
