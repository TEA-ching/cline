import { createOpenAI } from "@ai-sdk/openai";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";
import fs from "fs/promises";
import path from "path";

export async function createPoolsideProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const provider = createOpenAI({
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: patchPoolsideUsageFetch(config.fetch ?? globalThis.fetch),
	});
	return {
		// poolside.ai requires the "poolside/" namespace prefix in the model ID
		// (e.g. "poolside/laguna-m.1"). When invoked via keypoollive, the composite
		// vault ID is parsed into providerName + bare modelId before reaching this
		// vendor, so the prefix has been stripped. Re-add it if absent.
		model: (modelId) => provider(modelId.startsWith("poolside/") ? modelId : `poolside/${modelId}`),
	};
}

// Constraints that Poolside strict_tools=true does not support and must be stripped.
// Verified by testing: minItems, maxItems, minLength, maxLength, pattern, minimum, maximum, multipleOf
// are rejected; uniqueItems, exclusiveMinimum, default are accepted.
const POOLSIDE_UNSUPPORTED_CONSTRAINTS = new Set([
	"minItems", "maxItems",
	"minLength", "maxLength", "pattern",
	"minimum", "maximum", "multipleOf",
])

function stripUnsupportedConstraints(s: Record<string, unknown>): Record<string, unknown> {
	const result = { ...s }
	for (const key of POOLSIDE_UNSUPPORTED_CONSTRAINTS) delete result[key]
	return result
}

/**
 * Flattens a oneOf schema into a single object schema Poolside can accept with strict_tools=true.
 * Poolside rejects oneOf/discriminatedUnion schemas entirely.
 *
 * Strategy:
 * - All-object branches: merge properties (union), required = intersection across all branches.
 *   Discriminator fields with const values are merged into a single enum.
 * - Mixed or non-object branches: fall back to {type:"string"}.
 */
function flattenOneOf(branches: unknown[]): Record<string, unknown> {
	const patchedBranches = branches.map(b => patchObjectSchemaRequired(b)) as Record<string, unknown>[]
	const allObjects = patchedBranches.every(b => b.type === "object" && b.properties && typeof b.properties === "object")
	if (!allObjects) {
		return { type: "string" }
	}
	const mergedProps: Record<string, unknown> = {}
	for (const branch of patchedBranches) {
		const props = branch.properties as Record<string, unknown>
		for (const [k, v] of Object.entries(props)) {
			if (!(k in mergedProps)) {
				mergedProps[k] = v
			} else {
				// Merge discriminator field: combine const/enum values into a single enum
				const existing = mergedProps[k] as Record<string, unknown>
				const incoming = v as Record<string, unknown>
				const existingVals: unknown[] = existing.const !== undefined ? [existing.const] : (existing.enum as unknown[] | undefined) ?? []
				const incomingVals: unknown[] = incoming.const !== undefined ? [incoming.const] : (incoming.enum as unknown[] | undefined) ?? []
				if (existingVals.length > 0 || incomingVals.length > 0) {
					mergedProps[k] = { type: "string", enum: [...existingVals, ...incomingVals] }
				}
			}
		}
	}
	const requiredSets = patchedBranches.map(b => (b.required as string[] | undefined) ?? [])
	const intersection = requiredSets.length > 0
		? requiredSets.reduce((acc, reqs) => acc.filter(r => reqs.includes(r)))
		: []
	const required = intersection.length > 0 ? intersection : (Object.keys(mergedProps).length > 0 ? [Object.keys(mergedProps)[0]] : undefined)
	return stripUnsupportedConstraints({
		type: "object",
		properties: mergedProps,
		...(required ? { required } : {}),
	})
}

/**
 * Recursively patches tool parameter schemas for Poolside strict_tools=true compatibility:
 * 1. Strips unsupported JSON Schema constraints (minItems, maxItems, minLength, maxLength,
 *    pattern, minimum, maximum, multipleOf).
 * 2. Ensures every non-empty object schema has at least one required field.
 * 3. Converts empty object schemas ({type:"object", properties:{}}) to {} so Poolside
 *    accepts no-parameter tools.
 * 4. Flattens oneOf (discriminated unions) into a single merged object schema, since Poolside
 *    strict_tools=true rejects oneOf entirely.
 * 5. Recurses into anyOf/allOf sub-schemas (produced by Zod's .nullable(), etc.).
 */
function patchObjectSchemaRequired(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return schema
	const s = schema as Record<string, unknown>
	// Poolside strict_tools=true rejects oneOf entirely — flatten variants into a single object.
	if (Array.isArray(s.oneOf)) {
		return flattenOneOf(s.oneOf)
	}
	// Recurse into anyOf/allOf: Zod's .nullable() generates {anyOf: [{type: "integer", maximum: ...}, {type: "null"}]},
	// so constraints inside sub-schemas must be stripped too.
	if (Array.isArray(s.anyOf)) {
		return stripUnsupportedConstraints({ ...s, anyOf: (s.anyOf as unknown[]).map(patchObjectSchemaRequired) })
	}
	if (Array.isArray(s.allOf)) {
		return stripUnsupportedConstraints({ ...s, allOf: (s.allOf as unknown[]).map(patchObjectSchemaRequired) })
	}
	if (s.type === "object") {
		const props = s.properties as Record<string, unknown> | undefined
		const keys = props ? Object.keys(props) : []
		// No properties (absent or empty): strict_tools=true rejects object schemas without
		// at least one required field. For no-parameter tools, {} is the form Poolside accepts.
		if (keys.length === 0) {
			return {}
		}
		const existing = (s.required as string[] | undefined) ?? []
		const patchedProps = Object.fromEntries(
			Object.entries(props!).map(([k, v]) => {
				const patched = patchObjectSchemaRequired(v)
				// Poolside strict_tools=true requires every property schema to have a 'type'.
				// Bare {} (any-value catchalls like 'schema: {}' or 'headers: {}') have none —
				// use "string" as the least-wrong fallback so Poolside accepts the tool.
				if (isBareSchema(patched)) return [k, { type: "string" }]
				return [k, patched]
			})
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

/** Returns true when a schema is a bare {} with no type/anyOf/oneOf/allOf. */
function isBareSchema(v: unknown): boolean {
	if (!v || typeof v !== "object" || Array.isArray(v)) return false
	const s = v as Record<string, unknown>
	return !s.type && !s.anyOf && !s.oneOf && !s.allOf
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

interface PoolsideResponsesStreamState {
	sawTextDelta: boolean
}

/**
 * Splits a (possibly already-expanded, multi-line) patched SSE line into the
 * synthetic content prepended by earlier passes and the trailing original
 * data line, so multiple synthesis passes can each prepend their own
 * synthetic events without stepping on what a previous pass already added.
 */
function splitSyntheticTail(line: string): { prefix: string; tail: string; event: any } {
	const lastNewline = line.lastIndexOf("\n")
	const prefix = lastNewline === -1 ? "" : line.slice(0, lastNewline + 1)
	const tail = lastNewline === -1 ? line : line.slice(lastNewline + 1)
	if (!tail.startsWith("data: ")) return { prefix, tail, event: null }
	try {
		return { prefix, tail, event: JSON.parse(tail.slice(6)) }
	} catch {
		return { prefix, tail, event: null }
	}
}

/**
 * Some Poolside models (observed with poolside/laguna-xs.2) skip incremental
 * `response.output_text.delta` events on the Responses API (/v1/responses) stream
 * entirely and emit the full text only in the terminal `response.completed` event.
 * @ai-sdk/openai's Responses stream parser builds text exclusively from
 * `response.output_text.delta` chunks — it never reads the completed event's
 * embedded `response.output[].content[].text` — so without synthesizing the
 * missing delta, no text ever reaches the AI SDK's stream (and thus the UI),
 * even though the full answer is present in the payload.
 */
function synthesizeMissingResponseTextDeltas(line: string, state: PoolsideResponsesStreamState): string {
	const { prefix, tail, event } = splitSyntheticTail(line)
	if (!event) return line

	if (event.type === "response.output_text.delta") {
		state.sawTextDelta = true
		return line
	}

	if (state.sawTextDelta || (event.type !== "response.completed" && event.type !== "response.incomplete")) {
		return line
	}

	const output = event.response?.output as Array<Record<string, unknown>> | undefined
	const message = output?.find((item) => item.type === "message")
	const textPart = (message?.content as Array<Record<string, unknown>> | undefined)?.find(
		(part) => part.type === "output_text",
	)
	const text = textPart?.text as string | undefined
	if (!message || typeof text !== "string" || text.length === 0) {
		return line
	}

	state.sawTextDelta = true
	const itemId = message.id as string
	const synthetic = [
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId } },
		{ type: "response.output_text.delta", item_id: itemId, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId } },
	]
		.map((e) => `data: ${JSON.stringify(e)}\n\n`)
		.join("")
	return `${prefix}${synthetic}${tail}`
}

interface PoolsideHeldFunctionCall {
	argumentsDoneEvent?: any
	itemDoneEvent?: any
}

interface PoolsideFunctionCallFixState {
	held: Map<string, PoolsideHeldFunctionCall>
}

/**
 * Some Poolside models emit `response.function_call_arguments.done` and the
 * paired `response.output_item.done` for a function_call BEFORE the real
 * argument deltas have finished streaming — both with `arguments: ""` — then
 * continue sending `response.function_call_arguments.delta` events afterward.
 * @ai-sdk/openai's Responses stream parser finalizes the tool call from the
 * (premature, empty) `output_item.done` and clears its ongoing-call tracking
 * at that point, so the correct deltas that follow are silently dropped and
 * the tool call reaches Cline with empty arguments. Hold the premature
 * done/args-done pair and resynthesize them from the authoritative
 * `response.completed` output once the response finishes.
 */
function fixPrematureFunctionCallArgumentsDone(line: string, state: PoolsideFunctionCallFixState): string {
	const { prefix, tail, event } = splitSyntheticTail(line)
	if (!event) return line

	if (event.type === "response.function_call_arguments.done" && event.arguments === "") {
		const held = state.held.get(event.item_id) ?? {}
		held.argumentsDoneEvent = event
		state.held.set(event.item_id, held)
		return ""
	}

	if (event.type === "response.output_item.done" && event.item?.type === "function_call" && event.item?.arguments === "") {
		const held = state.held.get(event.item.id) ?? {}
		held.itemDoneEvent = event
		state.held.set(event.item.id, held)
		return ""
	}

	if (event.type !== "response.completed" && event.type !== "response.incomplete") return line
	if (state.held.size === 0) return line

	const output = (event.response?.output as Array<Record<string, unknown>> | undefined) ?? []
	const synthetic: string[] = []
	for (const [itemId, held] of state.held) {
		const finalItem = output.find((item) => item.id === itemId && item.type === "function_call")
		const correctedArguments = (finalItem?.arguments as string | undefined) ?? ""
		if (held.argumentsDoneEvent) {
			synthetic.push(`data: ${JSON.stringify({ ...held.argumentsDoneEvent, arguments: correctedArguments })}\n\n`)
		}
		if (held.itemDoneEvent) {
			synthetic.push(
				`data: ${JSON.stringify({
					...held.itemDoneEvent,
					item: { ...held.itemDoneEvent.item, arguments: correctedArguments },
				})}\n\n`,
			)
		}
	}
	state.held.clear()
	return `${prefix}${synthetic.join("")}${tail}`
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
async function cleanupOldLogFiles(directoryPath: string, maxFilesToKeep: number): Promise<void> {
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

/**
 * Returns a modified fetch function that:
 * 1. Patches tool schemas for strict_tools=true compatibility (strips unsupported constraints,
 *    ensures required fields on object schemas).
 * 2. Injects strict_tools=true when tools are present in the request body.
 * 3. Corrects message-end token counts: command-a* models with thinking report
 *    tokens.input_tokens=0 in the SSE stream; billed_units.input_tokens holds the correct value.
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

		// Log as TypeScript fetch script (set POOLSIDE_DEBUG_FETCH_LOG=1 to enable)
		const debugLogEnabled = process.env.POOLSIDE_DEBUG_FETCH_LOG === "1"
		if (debugLogEnabled) {
			try {
				const storagePath = process.env.POOLSIDE_DEBUG_FETCH_DIR || path.join(process.cwd(), "poolside")

				await fs.mkdir(storagePath, { recursive: true })

				const timestamp = Date.now()
				const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as any).url
				const method = init?.method || "POST"
				const headers = (init?.headers as Record<string, string>) || {}
				const bodyObj = init?.body ? (typeof init.body === "string" ? JSON.parse(init.body) : init.body) : undefined
				// Generate TypeScript fetch code
				const tsCode = generateTypeScriptFetchCode(url, method, headers, bodyObj);

				const filePath = path.join(storagePath, `${timestamp}.ts`)
				await fs.writeFile(filePath, tsCode)

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
		const decoder = new TextDecoder()
		const encoder = new TextEncoder()
		let buffer = ""
		const responsesStreamState: PoolsideResponsesStreamState = { sawTextDelta: false }
		const functionCallFixState: PoolsideFunctionCallFixState = { held: new Map() }
		const patchLine = (line: string) =>
			fixPrematureFunctionCallArgumentsDone(
				synthesizeMissingResponseTextDeltas(patchMessageEndLine(line), responsesStreamState),
				functionCallFixState,
			)
		const patched = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					buffer += decoder.decode(chunk, { stream: true })
					const lines = buffer.split("\n")
					buffer = lines.pop() ?? ""
					for (const line of lines) {
						controller.enqueue(encoder.encode(patchLine(line) + "\n"))
					}
				},
				flush(controller) {
					if (buffer) controller.enqueue(encoder.encode(patchLine(buffer)))
					// Defensive: if the stream ended without a response.completed/incomplete
					// event to resynthesize from (abnormal termination), still emit the
					// premature (empty-arguments) events rather than silently dropping the
					// tool call entirely.
					for (const held of functionCallFixState.held.values()) {
						if (held.argumentsDoneEvent) {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(held.argumentsDoneEvent)}\n\n`))
						}
						if (held.itemDoneEvent) {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(held.itemDoneEvent)}\n\n`))
						}
					}
				},
			}),
		)
		return new Response(patched, { status: response.status, statusText: response.statusText, headers: response.headers })
	}
}
