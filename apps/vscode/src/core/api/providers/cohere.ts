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

export class CohereHandler extends AiSdkHandler {
 	private modelInfo: CohereModelInfo	
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
	 * Checks if the current model supports tools
	 */
	supportsTools(): boolean {
		return this.modelInfo.supportsTools ?? false
	}
}

function resolveModel(options: CohereHandlerOptions): { id: CohereModelId; info: CohereModelInfo } {
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

		// Log as TypeScript fetch script
		// if (process.env.COHERE_DEBUG_FETCH_LOG === "1") {
		if (true) { // curently always log
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

// Cohere strict_tools=true requires every object-type parameter schema to declare at least
// one required field.  Recursively add the first property key to `required` for any object
// schema that has properties but no required array (or an empty one).
function patchObjectSchemaRequired(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return schema
	const s = schema as Record<string, unknown>
	if (s.type === "object") {
		const props = s.properties as Record<string, unknown> | undefined
		const keys = props ? Object.keys(props) : []
		const existing = (s.required as string[] | undefined) ?? []
		const patchedProps = props
			? Object.fromEntries(Object.entries(props).map(([k, v]) => [k, patchObjectSchemaRequired(v)]))
			: props
		return {
			...s,
			...(patchedProps ? { properties: patchedProps } : {}),
			...(keys.length > 0 && existing.length === 0 ? { required: [keys[0]] } : {}),
		}
	}
	if (s.items) {
		return { ...s, items: patchObjectSchemaRequired(s.items) }
	}
	return s
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
 * Cleans up old log files, keeping only the most recent ones
 * @param directoryPath Path to the directory containing log files
 * @param maxFilesToKeep Maximum number of files to keep
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


