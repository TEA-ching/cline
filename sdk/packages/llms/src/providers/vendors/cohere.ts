import { createCohere } from "@ai-sdk/cohere";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createCohereProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const provider = createCohere({
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: patchCohereUsageFetch(config.fetch ?? globalThis.fetch),
	});
	return {
		model: (modelId) => provider(modelId),
	};
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
 * Returns a modified fetch function that:
 * 1. Patches tool schemas for strict_tools=true compatibility (strips unsupported constraints,
 *    ensures required fields on object schemas).
 * 2. Injects strict_tools=true when tools are present in the request body.
 * 3. Corrects message-end token counts: command-a* models with thinking report
 *    tokens.input_tokens=0 in the SSE stream; billed_units.input_tokens holds the correct value.
 */
function patchCohereUsageFetch(baseFetch: typeof fetch): typeof fetch {
	return async (input, init) => {
		if (init?.body) {
			const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body
			if (body?.tools && body?.tools.length > 0) {
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
