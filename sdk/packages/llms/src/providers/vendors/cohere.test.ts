import type { GatewayResolvedProviderConfig } from "@sctg/cline-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cohereModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ modelId })),
);
const createCohereMock = vi.hoisted(() => vi.fn(() => cohereModelMock));

vi.mock("@ai-sdk/cohere", () => ({
	createCohere: createCohereMock,
}));

const { createCohereProviderModule } = await import("./cohere");

const ORIGINAL_ENV = { ...process.env };

function baseConfig(
	overrides: Partial<GatewayResolvedProviderConfig> = {},
): GatewayResolvedProviderConfig {
	return {
		providerId: "cohere",
		apiKey: "test-cohere-key",
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

/** Creates the provider module and returns the `fetch` wrapper it registered with createCohere(). */
async function capturePatchedFetch(
	config: Partial<GatewayResolvedProviderConfig> = {},
): Promise<typeof fetch> {
	await createCohereProviderModule(baseConfig(config));
	const lastCall =
		createCohereMock.mock.calls[createCohereMock.mock.calls.length - 1];
	return lastCall[0].fetch as typeof fetch;
}

describe("createCohereProviderModule", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		createCohereMock.mockClear();
		cohereModelMock.mockClear();
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	it("passes resolved apiKey, baseUrl, and headers to createCohere", async () => {
		await createCohereProviderModule(
			baseConfig({
				baseUrl: "https://api.cohere.ai/v2",
				headers: { "X-Test": "1" },
			}),
		);

		expect(createCohereMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "test-cohere-key",
				baseURL: "https://api.cohere.ai/v2",
				headers: { "X-Test": "1" },
			}),
		);
	});

	it("model() delegates to the underlying AI SDK provider unchanged", async () => {
		const result = await createCohereProviderModule(baseConfig());
		result.model("command-a-03-2025");
		expect(cohereModelMock).toHaveBeenCalledWith("command-a-03-2025");
	});

	describe("tool schema patching (strict_tools compatibility)", () => {
		it("does not modify the request body when no tools are present", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({ model: "command-a" }),
			});

			const [, init] = baseFetch.mock.calls[0];
			expect(JSON.parse(init.body as string)).toEqual({ model: "command-a" });
		});

		it("does not modify the body when the tools array is empty", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({ model: "command-a", tools: [] }),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.strict_tools).toBeUndefined();
		});

		it("injects strict_tools=true when tools are present", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

		it("forces strict_tools back to true even when the caller explicitly set it to false", async () => {
			// Documents current behavior: `!body.strict_tools` is true for both
			// `undefined` and `false`, so an explicit false is overwritten.
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
					strict_tools: false,
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
						format: "email",
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

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

		it("strips the 'format' constraint (Cohere-specific — Poolside allows it)", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: { when: { type: "string", format: "date-time" } },
				required: ["when"],
			};

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
					tools: [{ type: "function", function: { name: "f", parameters } }],
				}),
			});

			const [, init] = baseFetch.mock.calls[0];
			const sent = JSON.parse(init.body as string);
			expect(sent.tools[0].function.parameters.properties.when).toEqual({
				type: "string",
			});
		});

		it("adds a required field to object schemas that have properties but no required array", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: { a: { type: "string" }, b: { type: "number" } },
			};

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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
					value: {
						allOf: [{ type: "string", minLength: 5 }],
					},
				},
				required: ["value"],
			};

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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
			// "kind" is the only field common to both branches.
			expect(patched.required).toEqual(["kind"]);
		});

		it("falls back to {type: 'string'} when oneOf branches are not all objects", async () => {
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				oneOf: [{ type: "string" }, { type: "number" }],
			};

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({
					model: "command-a",
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

		it("does not mutate the raw request body reference passed by the caller before patching", async () => {
			// Guards against accidental cross-request state leaking through shared
			// object references, since the wrapper reconstructs `init.body`.
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const parameters = {
				type: "object",
				properties: { a: { type: "string" } },
			};
			const originalBody = {
				model: "command-a",
				tools: [{ type: "function", function: { name: "f", parameters } }],
			};
			const bodyString = JSON.stringify(originalBody);

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: bodyString,
			});

			// The original parameters object itself must remain untouched.
			expect(parameters).toEqual({
				type: "object",
				properties: { a: { type: "string" } },
			});
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

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
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

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
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

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
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

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
			});
			const text = await readAllText(response);

			expect(text.trim()).toBe(line);
		});

		it("passes through malformed JSON SSE lines unchanged without throwing", async () => {
			const line = "data: {not valid json";
			const baseFetch = vi.fn(async () => sseResponse([line]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
			});
			const text = await readAllText(response);

			expect(text.trim()).toBe(line);
		});

		it("processes multiple SSE lines split across a single chunk", async () => {
			const line1 = `data: ${JSON.stringify({
				type: "message-end",
				delta: {
					usage: { billed_units: { input_tokens: 1, output_tokens: 2 } },
				},
			})}`;
			const line2 = `data: ${JSON.stringify({ type: "content-delta", delta: { text: "x" } })}`;
			const baseFetch = vi.fn(async () => sseResponse([line1, line2]));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
			});
			const text = await readAllText(response);
			const outLines = text.trim().split("\n");

			expect(
				JSON.parse(outLines[0].replace(/^data: /, "")).delta.usage.tokens,
			).toEqual({
				input_tokens: 1,
				output_tokens: 2,
			});
			expect(outLines[1]).toBe(line2);
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

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
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

			const response = await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
			});

			expect(response.status).toBe(204);
		});
	});

	describe("debug fetch logging", () => {
		it("does not write a debug log file by default", async () => {
			delete process.env.COHERE_DEBUG_FETCH_LOG;
			const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
			const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

			await patchedFetch("https://api.cohere.ai/v2/chat", {
				method: "POST",
				body: JSON.stringify({ model: "command-a" }),
			});

			// No debug dir env var was set and logging is opt-in, so no extra
			// filesystem side effects beyond the mocked fetch call occur.
			expect(baseFetch).toHaveBeenCalledTimes(1);
		});

		it("writes a TypeScript request log file when COHERE_DEBUG_FETCH_LOG=1", async () => {
			const { mkdtemp, readdir, rm } = await import("node:fs/promises");
			const os = await import("node:os");
			const path = await import("node:path");
			const tempDir = await mkdtemp(path.join(os.tmpdir(), "cohere-debug-"));
			process.env.COHERE_DEBUG_FETCH_LOG = "1";
			process.env.COHERE_DEBUG_FETCH_DIR = tempDir;

			try {
				const baseFetch = vi.fn(async () => jsonResponse({ ok: true }));
				const patchedFetch = await capturePatchedFetch({ fetch: baseFetch });

				await patchedFetch("https://api.cohere.ai/v2/chat", {
					method: "POST",
					body: JSON.stringify({ model: "command-a" }),
				});

				const files = await readdir(tempDir);
				expect(files.some((f) => f.endsWith(".ts"))).toBe(true);
			} finally {
				await rm(tempDir, { recursive: true, force: true });
			}
		});
	});
});
