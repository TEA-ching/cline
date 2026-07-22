import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolsideModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ modelId })),
);
const createOpenAIMock = vi.hoisted(() => vi.fn(() => poolsideModelMock));

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: createOpenAIMock,
}));

const { createPoolsideProviderModule } = await import("./poolside");

const ORIGINAL_ENV = { ...process.env };

function baseConfig(
	overrides: Partial<GatewayResolvedProviderConfig> = {},
): GatewayResolvedProviderConfig {
	return {
		providerId: "poolside",
		apiKey: "test-poolside-key",
		...overrides,
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function sseResponse(lines: string[]): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const line of lines) {
				controller.enqueue(encoder.encode(`${line}\n`));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

async function readAllText(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const decoder = new TextDecoder();
	let out = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		out += decoder.decode(value, { stream: true });
	}
	return out;
}

/** Creates the provider module and returns the `fetch` wrapper it registered with createOpenAI(). */
async function capturePatchedFetch(
	config: Partial<GatewayResolvedProviderConfig> = {},
): Promise<typeof fetch> {
	await createPoolsideProviderModule(baseConfig(config));
	const lastCall =
		createOpenAIMock.mock.calls[createOpenAIMock.mock.calls.length - 1];
	return lastCall[0].fetch as typeof fetch;
}

describe("createPoolsideProviderModule", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		createOpenAIMock.mockClear();
		poolsideModelMock.mockClear();
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	it("passes resolved apiKey, baseUrl, and headers to createOpenAI", async () => {
		await createPoolsideProviderModule(
			baseConfig({
				baseUrl: "https://inference.poolside.ai/v1",
				headers: { "X-Test": "1" },
			}),
		);

		expect(createOpenAIMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "test-poolside-key",
				baseURL: "https://inference.poolside.ai/v1",
				headers: { "X-Test": "1" },
			}),
		);
	});

	describe("model ID prefixing", () => {
		it("adds the 'poolside/' prefix to a bare model ID", async () => {
			const result = await createPoolsideProviderModule(baseConfig());
			result.model("laguna-m.1");
			expect(poolsideModelMock).toHaveBeenCalledWith("poolside/laguna-m.1");
		});

		it("does not double-prefix a model ID that already has 'poolside/'", async () => {
			const result = await createPoolsideProviderModule(baseConfig());
			result.model("poolside/laguna-m.1");
			expect(poolsideModelMock).toHaveBeenCalledWith("poolside/laguna-m.1");
		});
	});

	describe("assistant input message tagging (untagged InputParam enum)", () => {
		// @ai-sdk/openai's Responses API prompt builder echoes a prior assistant text
		// turn as `{role: "assistant", content: [{type: "output_text", ...}]}` with no
		// `type` field. Captured live from production: Poolside (poolside/laguna-s-2.1)
		// rejects the *entire* request with a 400 ("did not match any variant of
		// untagged enum InputParam") unless assistant-role input items are tagged
		// `type: "message"`. Verified directly against the real API: the exact
		// captured request body that failed succeeds once this tag is added, and
		// nothing else about the request needs to change.

		it("tags an untyped assistant-role input item with type: message", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-s-2.1",
					input: [
						{ role: "system", content: "sys" },
						{ role: "user", content: [{ type: "input_text", text: "hi" }] },
						{ role: "assistant", content: [{ type: "output_text", text: "hello back" }] },
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.input[0]).toEqual({ role: "system", content: "sys" });
			expect(sent.input[1]).toEqual({ role: "user", content: [{ type: "input_text", text: "hi" }] });
			expect(sent.input[2]).toEqual({
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "hello back" }],
			});
		});

		it("leaves an assistant input item untouched when it already has a type", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-s-2.1",
					input: [
						{
							type: "message",
							id: "msg_1",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: "hello back", annotations: [], logprobs: [] }],
						},
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.input[0]).toEqual({
				type: "message",
				id: "msg_1",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "hello back", annotations: [], logprobs: [] }],
			});
		});

		it("does not touch function_call / function_call_output items (no role field)", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const functionCall = { type: "function_call", call_id: "c1", name: "read_files", arguments: "{}" }
			const functionCallOutput = { type: "function_call_output", call_id: "c1", output: "ok" }

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-s-2.1",
					input: [functionCall, functionCallOutput],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.input).toEqual([functionCall, functionCallOutput])
		});

		it("patches assistant input items even when the request has no tools", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-s-2.1",
					input: [{ role: "assistant", content: [{ type: "output_text", text: "hi" }] }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.input[0].type).toBe("message")
			expect(sent.strict_tools).toBeUndefined()
		});

		it("does not modify the body when there is no input array", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({ model: "poolside/laguna-s-2.1" }),
			});

			const [, init] = baseFetch.mock.calls[0];
			expect(JSON.parse(init.body as string)).toEqual({ model: "poolside/laguna-s-2.1" });
		});
	});

	describe("tool schema patching (strict_tools compatibility)", () => {
		it("does not modify the request body when no tools are present", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({ model: "poolside/laguna-m.1" }),
			});

			const [, init] = baseFetch.mock.calls[0];
			expect(JSON.parse(init.body as string)).toEqual({
				model: "poolside/laguna-m.1",
			});
		});

		it("does not modify the body when the tools array is empty", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({ model: "poolside/laguna-m.1", tools: [] }),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.strict_tools).toBeUndefined();
		});

		it("injects strict_tools=true when tools are present", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [
						{
							type: "function",
							function: {
								name: "noop",
								parameters: { type: "object", properties: {}, required: [] },
							},
						},
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.strict_tools).toBe(true);
		});

		it("strips unsupported constraints but keeps allowed ones (uniqueItems, exclusiveMinimum, default)", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: {
					email: {
						type: "string",
						minLength: 3,
						maxLength: 50,
						pattern: "^.+@.+$",
					},
					age: { type: "integer", minimum: 0, maximum: 120, multipleOf: 1 },
					tags: {
						type: "array",
						items: { type: "string" },
						minItems: 1,
						maxItems: 5,
						uniqueItems: true,
					},
					id: { type: "string", default: "abc", exclusiveMinimum: 0 },
				},
				required: ["email"],
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters).toEqual({
				type: "object",
				properties: {
					email: { type: "string" },
					age: { type: "integer" },
					tags: {
						type: "array",
						items: { type: "string" },
						uniqueItems: true,
					},
					id: { type: "string", default: "abc", exclusiveMinimum: 0 },
				},
				required: ["email"],
			});
		});

		it("keeps the 'format' constraint (Poolside-specific — Cohere strips it)", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: { when: { type: "string", format: "date-time" } },
				required: ["when"],
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters.properties.when).toEqual({
				type: "string",
				format: "date-time",
			});
		});

		it("adds a required field to object schemas that have properties but no required array", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: { a: { type: "string" }, b: { type: "number" } },
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters.required).toEqual(["a"]);
		});

		it("converts empty object schemas to {} for no-parameter tools", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [
						{
							type: "function",
							function: { name: "noop", parameters: { type: "object" } },
						},
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters).toEqual({});
		});

		it("replaces bare {} property schemas with a {type: 'string'} fallback", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: { payload: {}, headers: {} },
				required: ["payload"],
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters).toEqual({
				type: "object",
				properties: {
					payload: { type: "string" },
					headers: { type: "string" },
				},
				required: ["payload"],
			});
		});

		it("recurses into array item schemas nested several levels deep", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: {
					matrix: {
						type: "array",
						items: {
							type: "array",
							items: { type: "number", minimum: 0, maximum: 1 },
							minItems: 1,
						},
					},
				},
				required: ["matrix"],
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters.properties.matrix).toEqual({
				type: "array",
				items: { type: "array", items: { type: "number" } },
			});
		});

		it("recurses into anyOf branches and strips constraints (Zod .nullable() pattern)", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: {
					count: {
						anyOf: [{ type: "integer", maximum: 10 }, { type: "null" }],
					},
				},
				required: ["count"],
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters.properties.count).toEqual({
				anyOf: [{ type: "integer" }, { type: "null" }],
			});
		});

		it("recurses into allOf branches and strips constraints", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: {
					value: { allOf: [{ type: "string", minLength: 5 }] },
				},
				required: ["value"],
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters.properties.value).toEqual({
				allOf: [{ type: "string" }],
			});
		});

		it("flattens a oneOf discriminated union with well-typed discriminator fields into a merged enum", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				oneOf: [
					{
						type: "object",
						properties: {
							kind: { type: "string", const: "circle" },
							radius: { type: "number" },
						},
						required: ["kind", "radius"],
					},
					{
						type: "object",
						properties: {
							kind: { type: "string", const: "square" },
							side: { type: "number" },
						},
						required: ["kind", "side"],
					},
				],
			};

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			const patched = sent.tools[0].function.parameters;
			expect(patched.type).toBe("object");
			expect(patched.properties.kind).toEqual({
				type: "string",
				enum: ["circle", "square"],
			});
			expect(patched.properties.radius).toEqual({ type: "number" });
			expect(patched.properties.side).toEqual({ type: "number" });
			expect(patched.required).toEqual(["kind"]);
		});

		it("falls back to {type: 'string'} when oneOf branches are not all objects", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = { oneOf: [{ type: "string" }, { type: "number" }] };

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters).toEqual({ type: "string" });
		});

		it("patches every tool independently in a multi-tool request", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-m.1",
					tools: [
						{
							type: "function",
							function: {
								name: "toolA",
								parameters: {
									type: "object",
									properties: { x: { type: "string", minLength: 1 } },
								},
							},
						},
						{
							type: "function",
							function: {
								name: "toolB",
								parameters: { type: "object", properties: {} },
							},
						},
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters).toEqual({
				type: "object",
				properties: { x: { type: "string" } },
				required: ["x"],
			});
			expect(sent.tools[1].function.parameters).toEqual({});
		});
	});

	describe("tool schema patching — flat Responses API tool shape", () => {
		// Poolside is only ever called via /v1/responses. The Responses API's tool
		// objects are flat ({type, name, parameters}), unlike Chat Completions'
		// nested {type, function: {name, parameters}}. Captured live from a real
		// request (with poolside/laguna-s-2.1): every tool used this flat shape,
		// so the nested-only check above never actually patched anything in
		// production — these tests pin the flat-shape path.

		it("converts an empty-properties object schema to {} on a flat tool", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-s-2.1",
					tools: [
						{
							type: "function",
							name: "heroui-react__get_theme_variables",
							description: "Get HeroUI v3 default theme variables and design tokens.",
							parameters: { type: "object", properties: {} },
						},
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].parameters).toEqual({});
			expect(sent.strict_tools).toBe(true);
		});

		it("strips unsupported constraints (minLength, maximum) on a flat tool", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-s-2.1",
					tools: [
						{
							type: "function",
							name: "ask_question",
							parameters: {
								type: "object",
								properties: {
									question: { type: "string", minLength: 1 },
									options: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 1 } },
								},
								required: ["question", "options"],
							},
						},
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].parameters).toEqual({
				type: "object",
				properties: {
					question: { type: "string" },
					options: { type: "array", items: { type: "string" } },
				},
				required: ["question", "options"],
			});
		});

		it("adds a required field to a flat tool's object schema that has properties but no required array", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
				body: JSON.stringify({
					model: "poolside/laguna-s-2.1",
					tools: [
						{
							type: "function",
							name: "attempt_completion",
							parameters: {
								type: "object",
								properties: { result: { type: "string" }, command: { type: "string" } },
								required: ["result"],
							},
						},
						{
							type: "function",
							name: "switch_to_act_mode",
							parameters: { type: "object", properties: {} },
						},
					],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].parameters).toEqual({
				type: "object",
				properties: { result: { type: "string" }, command: { type: "string" } },
				required: ["result"],
			});
			expect(sent.tools[1].parameters).toEqual({});
		});
	});

	describe("SSE usage-token correction (message-end billed_units)", () => {
		it("fills in missing usage.tokens from billed_units", async () => {
			const line = `data: ${JSON.stringify({
				type: "message-end",
				delta: {
					usage: { billed_units: { input_tokens: 10, output_tokens: 20 } },
				},
			})}`;
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
			});
			const text = await readAllText(response);
			const event = JSON.parse(text.trim().replace(/^data: /, ""));

			expect(event.delta.usage.tokens).toEqual({
				input_tokens: 10,
				output_tokens: 20,
			});
		});

		it("overwrites zero-valued existing tokens with billed_units values", async () => {
			const line = `data: ${JSON.stringify({
				type: "message-end",
				delta: {
					usage: {
						tokens: { input_tokens: 0, output_tokens: 0 },
						billed_units: { input_tokens: 15, output_tokens: 25 },
					},
				},
			})}`;
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
			});
			const text = await readAllText(response);
			const event = JSON.parse(text.trim().replace(/^data: /, ""));

			expect(event.delta.usage.tokens).toEqual({
				input_tokens: 15,
				output_tokens: 25,
			});
		});

		it("leaves already-nonzero tokens untouched even if billed_units differ", async () => {
			const line = `data: ${JSON.stringify({
				type: "message-end",
				delta: {
					usage: {
						tokens: { input_tokens: 5, output_tokens: 7 },
						billed_units: { input_tokens: 99, output_tokens: 99 },
					},
				},
			})}`;
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
			});
			const text = await readAllText(response);
			const event = JSON.parse(text.trim().replace(/^data: /, ""));

			expect(event.delta.usage.tokens).toEqual({
				input_tokens: 5,
				output_tokens: 7,
			});
		});

		it("passes through non-message-end SSE lines unchanged", async () => {
			const line = `data: ${JSON.stringify({ type: "content-delta", delta: { text: "hi" } })}`;
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
			});
			const text = await readAllText(response);

			expect(text.trim()).toBe(line);
		});

		it("passes through malformed JSON SSE lines unchanged without throwing", async () => {
			const line = "data: {not valid json";
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
			});
			const text = await readAllText(response);

			expect(text.trim()).toBe(line);
		});

		it("does not touch the body when the response is not an event-stream", async () => {
			const baseFetch = vi.fn(
				async () =>
					new Response("plain text body", {
						status: 200,
						headers: { "content-type": "text/plain" },
					}),
			);
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
			});

			expect(await response.text()).toBe("plain text body");
		});

		it("passes through a response with no body untouched", async () => {
			const baseFetch = vi.fn(
				async () =>
					new Response(null, {
						status: 204,
						headers: { "content-type": "text/event-stream" },
					}),
			);
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
			});

			expect(response.status).toBe(204);
		});
	});

	describe("Responses API text-delta synthesis (missing incremental deltas)", () => {
		function responseCompletedLine(text: string): string {
			return `data: ${JSON.stringify({
				type: "response.completed",
				response: {
					output: [
						{
							type: "message",
							id: "msg_test123",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", annotations: [], logprobs: [], text }],
						},
					],
				},
			})}`;
		}

		it("synthesizes output_item.added/output_text.delta/output_item.done before a response.completed with no prior deltas", async () => {
			const line = responseCompletedLine("Hello! How can I assist you today?");
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
			});
			const text = await readAllText(response);
			const events = text
				.split("\n")
				.filter((l) => l.startsWith("data: "))
				.map((l) => JSON.parse(l.slice(6)));

			expect(events.map((e) => e.type)).toEqual([
				"response.output_item.added",
				"response.output_text.delta",
				"response.output_item.done",
				"response.completed",
			]);
			expect(events[0].item).toEqual({ type: "message", id: "msg_test123" });
			expect(events[1]).toMatchObject({ item_id: "msg_test123", delta: "Hello! How can I assist you today?" });
			expect(events[2].item).toEqual({ type: "message", id: "msg_test123" });
		});

		it("does not synthesize when response.output_text.delta events already streamed the text", async () => {
			const deltaLine = `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg_test123", delta: "Hi" })}`;
			const completedLine = responseCompletedLine("Hi");
			const baseFetch = vi.fn(async () => sseResponse([deltaLine, completedLine]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
			});
			const text = await readAllText(response);
			const events = text
				.split("\n")
				.filter((l) => l.startsWith("data: "))
				.map((l) => JSON.parse(l.slice(6)));

			expect(events.map((e) => e.type)).toEqual(["response.output_text.delta", "response.completed"]);
		});

		it("leaves a response.completed with no message output untouched", async () => {
			const line = `data: ${JSON.stringify({ type: "response.completed", response: { output: [] } })}`;
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", {
				method: "POST",
			});
			const text = await readAllText(response);

			expect(text.trim()).toBe(line);
		});
	});

	describe("function_call arguments fix (premature empty done before real deltas)", () => {
		// Exact event sequence captured from a live call to
		// https://inference.poolside.ai/v1/responses with poolside/laguna-xs-2.1:
		// the empty function_call_arguments.done/output_item.done fire BEFORE the
		// real argument deltas, which arrive right before response.completed.
		function realPoolsideFunctionCallSequence(finalArguments: string): string[] {
			return [
				`data: ${JSON.stringify({
					type: "response.output_item.added",
					output_index: 0,
					item: {
						type: "function_call",
						arguments: "",
						call_id: "chatcmpl-tool-88a7ef0b9b108a24",
						name: "read_files",
						id: "fc_test123",
						status: "in_progress",
					},
				})}`,
				`data: ${JSON.stringify({
					type: "response.function_call_arguments.delta",
					item_id: "fc_test123",
					output_index: 0,
					delta: "",
				})}`,
				`data: ${JSON.stringify({
					type: "response.function_call_arguments.done",
					name: "read_files",
					item_id: "fc_test123",
					output_index: 0,
					arguments: "",
				})}`,
				`data: ${JSON.stringify({
					type: "response.output_item.done",
					output_index: 0,
					item: {
						type: "function_call",
						arguments: "",
						call_id: "chatcmpl-tool-88a7ef0b9b108a24",
						name: "read_files",
						id: "fc_test123",
						status: "completed",
					},
				})}`,
				`data: ${JSON.stringify({
					type: "response.function_call_arguments.delta",
					item_id: "fc_test123",
					output_index: 0,
					delta: finalArguments,
				})}`,
				`data: ${JSON.stringify({
					type: "response.completed",
					response: {
						output: [
							{
								type: "function_call",
								arguments: finalArguments,
								call_id: "chatcmpl-tool-88a7ef0b9b108a24",
								name: "read_files",
								id: "fc_test123",
								status: "completed",
							},
						],
					},
				})}`,
			]
		}

		it("resynthesizes the premature empty done/args-done pair with the real arguments from response.completed", async () => {
			const finalArguments = '{"files": [{"path": "/etc/hosts"}]}'
			const lines = realPoolsideFunctionCallSequence(finalArguments)
			const baseFetch = vi.fn(async () => sseResponse(lines))
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch })

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", { method: "POST" })
			const text = await readAllText(response)
			const events = text
				.split("\n")
				.filter((l) => l.startsWith("data: "))
				.map((l) => JSON.parse(l.slice(6)))

			expect(events.map((e) => e.type)).toEqual([
				"response.output_item.added",
				"response.function_call_arguments.delta",
				"response.function_call_arguments.delta",
				"response.function_call_arguments.done",
				"response.output_item.done",
				"response.completed",
			])
			expect(events[3].arguments).toBe(finalArguments)
			expect(events[4].item.arguments).toBe(finalArguments)
			expect(events[4].item.status).toBe("completed")
		})

		it("does not touch a function_call whose done event already carries non-empty arguments", async () => {
			const finalArguments = '{"files": [{"path": "/etc/hosts"}]}'
			const lines = [
				`data: ${JSON.stringify({
					type: "response.output_item.added",
					output_index: 0,
					item: { type: "function_call", arguments: "", call_id: "c1", name: "read_files", id: "fc_ok", status: "in_progress" },
				})}`,
				`data: ${JSON.stringify({ type: "response.function_call_arguments.delta", item_id: "fc_ok", output_index: 0, delta: finalArguments })}`,
				`data: ${JSON.stringify({ type: "response.function_call_arguments.done", name: "read_files", item_id: "fc_ok", output_index: 0, arguments: finalArguments })}`,
				`data: ${JSON.stringify({
					type: "response.output_item.done",
					output_index: 0,
					item: { type: "function_call", arguments: finalArguments, call_id: "c1", name: "read_files", id: "fc_ok", status: "completed" },
				})}`,
				`data: ${JSON.stringify({ type: "response.completed", response: { output: [] } })}`,
			]
			const baseFetch = vi.fn(async () => sseResponse(lines))
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch })

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", { method: "POST" })
			const text = await readAllText(response)
			const events = text
				.split("\n")
				.filter((l) => l.startsWith("data: "))
				.map((l) => JSON.parse(l.slice(6)))

			expect(events.map((e) => e.type)).toEqual([
				"response.output_item.added",
				"response.function_call_arguments.delta",
				"response.function_call_arguments.done",
				"response.output_item.done",
				"response.completed",
			])
			expect(events[2].arguments).toBe(finalArguments)
			expect(events[3].item.arguments).toBe(finalArguments)
		})

		it("resolves correctly for two parallel function calls held at once", async () => {
			const args1 = '{"files":[{"path":"/a"}]}'
			const args2 = '{"files":[{"path":"/b"}]}'
			const lines = [
				`data: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", arguments: "", call_id: "c1", name: "read_files", id: "fc_1", status: "in_progress" } })}`,
				`data: ${JSON.stringify({ type: "response.output_item.added", output_index: 1, item: { type: "function_call", arguments: "", call_id: "c2", name: "read_files", id: "fc_2", status: "in_progress" } })}`,
				`data: ${JSON.stringify({ type: "response.function_call_arguments.done", name: "read_files", item_id: "fc_1", output_index: 0, arguments: "" })}`,
				`data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", arguments: "", call_id: "c1", name: "read_files", id: "fc_1", status: "completed" } })}`,
				`data: ${JSON.stringify({ type: "response.function_call_arguments.done", name: "read_files", item_id: "fc_2", output_index: 1, arguments: "" })}`,
				`data: ${JSON.stringify({ type: "response.output_item.done", output_index: 1, item: { type: "function_call", arguments: "", call_id: "c2", name: "read_files", id: "fc_2", status: "completed" } })}`,
				`data: ${JSON.stringify({
					type: "response.completed",
					response: {
						output: [
							{ type: "function_call", arguments: args1, call_id: "c1", name: "read_files", id: "fc_1", status: "completed" },
							{ type: "function_call", arguments: args2, call_id: "c2", name: "read_files", id: "fc_2", status: "completed" },
						],
					},
				})}`,
			]
			const baseFetch = vi.fn(async () => sseResponse(lines))
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch })

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", { method: "POST" })
			const text = await readAllText(response)
			const events = text
				.split("\n")
				.filter((l) => l.startsWith("data: "))
				.map((l) => JSON.parse(l.slice(6)))

			const doneEvents = events.filter((e) => e.type === "response.output_item.done")
			expect(doneEvents.find((e) => e.item.id === "fc_1")?.item.arguments).toBe(args1)
			expect(doneEvents.find((e) => e.item.id === "fc_2")?.item.arguments).toBe(args2)
		})

		it("falls back to empty arguments when response.completed has no matching output item", async () => {
			const lines = [
				`data: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", arguments: "", call_id: "c1", name: "read_files", id: "fc_missing", status: "in_progress" } })}`,
				`data: ${JSON.stringify({ type: "response.function_call_arguments.done", name: "read_files", item_id: "fc_missing", output_index: 0, arguments: "" })}`,
				`data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", arguments: "", call_id: "c1", name: "read_files", id: "fc_missing", status: "completed" } })}`,
				`data: ${JSON.stringify({ type: "response.completed", response: { output: [] } })}`,
			]
			const baseFetch = vi.fn(async () => sseResponse(lines))
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch })

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", { method: "POST" })
			const text = await readAllText(response)
			const events = text
				.split("\n")
				.filter((l) => l.startsWith("data: "))
				.map((l) => JSON.parse(l.slice(6)))

			const doneEvent = events.find((e) => e.type === "response.output_item.done")
			expect(doneEvent?.item.arguments).toBe("")
		})

		it("composes with the text-delta synthesis fix on the same response.completed event", async () => {
			const finalArguments = '{"files":[{"path":"/etc/hosts"}]}'
			const lines = [
				`data: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", arguments: "", call_id: "c1", name: "read_files", id: "fc_combo", status: "in_progress" } })}`,
				`data: ${JSON.stringify({ type: "response.function_call_arguments.done", name: "read_files", item_id: "fc_combo", output_index: 0, arguments: "" })}`,
				`data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", arguments: "", call_id: "c1", name: "read_files", id: "fc_combo", status: "completed" } })}`,
				`data: ${JSON.stringify({
					type: "response.completed",
					response: {
						output: [
							{ type: "message", id: "msg_combo", role: "assistant", status: "completed", content: [{ type: "output_text", annotations: [], logprobs: [], text: "Reading now" }] },
							{ type: "function_call", arguments: finalArguments, call_id: "c1", name: "read_files", id: "fc_combo", status: "completed" },
						],
					},
				})}`,
			]
			const baseFetch = vi.fn(async () => sseResponse(lines))
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch })

			const response = await patchedFetch("https://inference.poolside.ai/v1/responses", { method: "POST" })
			const text = await readAllText(response)
			const events = text
				.split("\n")
				.filter((l) => l.startsWith("data: "))
				.map((l) => JSON.parse(l.slice(6)))

			expect(events.map((e) => e.type)).toEqual([
				"response.output_item.added",
				"response.output_item.added",
				"response.output_text.delta",
				"response.output_item.done",
				"response.function_call_arguments.done",
				"response.output_item.done",
				"response.completed",
			])
			const textDelta = events.find((e) => e.type === "response.output_text.delta")
			expect(textDelta?.delta).toBe("Reading now")
			const fnDone = events.find((e) => e.type === "response.output_item.done" && e.item.type === "function_call")
			expect(fnDone?.item.arguments).toBe(finalArguments)
		})
	})

	describe("debug fetch logging", () => {
		it("does not write a debug log file by default", async () => {
			delete process.env.POOLSIDE_DEBUG_FETCH_LOG;
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://inference.poolside.ai/v1/chat", {
				method: "POST",
				body: JSON.stringify({ model: "poolside/laguna-m.1" }),
			});

			expect(baseFetch).toHaveBeenCalledTimes(1);
		});

		it("writes a TypeScript request log file when POOLSIDE_DEBUG_FETCH_LOG=1", async () => {
			const { mkdtemp, readdir, rm } = await import("node:fs/promises");
			const os = await import("node:os");
			const path = await import("node:path");
			const tempDir = await mkdtemp(path.join(os.tmpdir(), "poolside-debug-"));
			process.env.POOLSIDE_DEBUG_FETCH_LOG = "1";
			process.env.POOLSIDE_DEBUG_FETCH_DIR = tempDir;

			try {
				const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
				const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

				await patchedFetch("https://inference.poolside.ai/v1/chat", {
					method: "POST",
					body: JSON.stringify({ model: "poolside/laguna-m.1" }),
				});

				const files = await readdir(tempDir);
				expect(files.some((f) => f.endsWith(".ts"))).toBe(true);
			} finally {
				await rm(tempDir, { recursive: true, force: true });
			}
		});
	});
});
