import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	AgentModelEvent,
	GatewayProvider,
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Strip any real KEYPOOL_* variables from the developer's shell (e.g. a personal
// vault URL/secret exported for local use) so tests stay hermetic regardless of
// the machine they run on.
const ORIGINAL_ENV = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith("KEYPOOL_")),
);

const createOpenAICompatibleProviderMock = vi.fn();
const createAnthropicProviderMock = vi.fn();
const createGoogleProviderMock = vi.fn();
const createCohereProviderMock = vi.fn();
const createPoolsideProviderMock = vi.fn();
const createMistralProviderMock = vi.fn();

vi.mock("../ai-sdk", () => ({
	createOpenAICompatibleProvider: createOpenAICompatibleProviderMock,
	createAnthropicProvider: createAnthropicProviderMock,
	createGoogleProvider: createGoogleProviderMock,
	createCohereProvider: createCohereProviderMock,
	createPoolsideProvider: createPoolsideProviderMock,
	createMistralProvider: createMistralProviderMock,
}));

describe("keypoollive provider", () => {
	let tempDir: string;
	let stateFilePath: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env = { ...ORIGINAL_ENV };

		tempDir = await mkdtemp(path.join(os.tmpdir(), "keypoollive-test-"));
		stateFilePath = path.join(tempDir, "state.json");
		process.env.KEYPOOL_STATE_FILE = stateFilePath;
		process.env.KEYPOOL_VAULT_URL = "https://vault.example.local/encrypted";
		process.env.KEYPOOL_LIVE_SECRET = "test-secret";
	});

	afterEach(async () => {
		// The module's persistence writer is fire-and-forget and reads
		// KEYPOOL_STATE_FILE lazily when it runs, so give any write still in
		// flight from this test a chance to settle before the next test points
		// that env var at a different tempDir (otherwise a late write can land
		// in the next test's state file).
		await new Promise((resolve) => setTimeout(resolve, 50));
		process.env = { ...ORIGINAL_ENV };
		vi.unstubAllGlobals();
		// Retry past any remaining transient ENOTEMPTY from a write that raced
		// with cleanup.
		await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
	});

	it("round-robin auto-rotates keys and emits active-key notice", async () => {
		mockVaultEnvironment(vaultConfig(["k_live_1", "k_live_2"]));
		const usedKeys: string[] = [];

		createOpenAICompatibleProviderMock.mockImplementation(
			(cfg: GatewayResolvedProviderConfig) => ({
				async *stream(): AsyncIterable<AgentModelEvent> {
					usedKeys.push(String(cfg.apiKey));
					yield { type: "text-delta", text: "ok" };
					yield { type: "finish", reason: "stop" };
				},
			}),
		);

		const { createKeypoolliveProvider } = await importFreshKeypoollive();
		const provider = createKeypoolliveProvider(baseConfig());

		const run1 = await collectEvents(provider, baseRequest(), baseContext());
		const run2 = await collectEvents(provider, baseRequest(), baseContext());

		expect(usedKeys).toEqual(["k_live_1", "k_live_2"]);
		expect(findNotice(run1, "active-key")?.key).toBe("***k_live_1");
		expect(findNotice(run2, "active-key")?.key).toBe("***k_live_2");
	});

	it("rotates key on resource exhausted and emits key-rotated notice", async () => {
		mockVaultEnvironment(vaultConfig(["k_live_a", "k_live_b"]));
		let attempts = 0;
		const usedKeys: string[] = [];

		createOpenAICompatibleProviderMock.mockImplementation(
			(cfg: GatewayResolvedProviderConfig) => ({
				async *stream(): AsyncIterable<AgentModelEvent> {
					attempts += 1;
					usedKeys.push(String(cfg.apiKey));
					if (attempts === 1) {
						throw new Error("Resource has been exhausted (quota)");
					}
					yield { type: "text-delta", text: "recovered" };
					yield { type: "finish", reason: "stop" };
				},
			}),
		);

		const { createKeypoolliveProvider } = await importFreshKeypoollive();
		const provider = createKeypoolliveProvider(baseConfig());
		const events = await collectEvents(provider, baseRequest(), baseContext());

		expect(usedKeys).toEqual(["k_live_a", "k_live_b"]);
		expect(findNotice(events, "active-key")?.key).toBe("***k_live_a");
		expect(findNotice(events, "key-rotated")?.key).toBe("***k_live_a");
		expect(findNotice(events, "key-rotated")?.error).toContain(
			"Resource has been exhausted",
		);
	});

	it("restores round-robin index after module reload via KEYPOOL_STATE_FILE", async () => {
		mockVaultEnvironment(vaultConfig(["k_live_x", "k_live_y"]));
		const usedKeys: string[] = [];

		createOpenAICompatibleProviderMock.mockImplementation(
			(cfg: GatewayResolvedProviderConfig) => ({
				async *stream(): AsyncIterable<AgentModelEvent> {
					usedKeys.push(String(cfg.apiKey));
					yield { type: "text-delta", text: "ok" };
					yield { type: "finish", reason: "stop" };
				},
			}),
		);

		const firstModule = await importFreshKeypoollive();
		const firstProvider = firstModule.createKeypoolliveProvider(baseConfig());
		await collectEvents(firstProvider, baseRequest(), baseContext());
		await waitForStateFile(stateFilePath);

		mockVaultEnvironment(vaultConfig(["k_live_x", "k_live_y"]));
		const secondModule = await importFreshKeypoollive();
		const secondProvider = secondModule.createKeypoolliveProvider(baseConfig());
		await collectEvents(secondProvider, baseRequest(), baseContext());

		expect(usedKeys).toEqual(["k_live_x", "k_live_y"]);
	});

	it("fails after max key attempts when all keys are rate-limited", async () => {
		mockVaultEnvironment(vaultConfig(["k_live_p", "k_live_q"]));
		const usedKeys: string[] = [];

		createOpenAICompatibleProviderMock.mockImplementation(
			(cfg: GatewayResolvedProviderConfig) => ({
				async stream(): Promise<AsyncIterable<AgentModelEvent>> {
					usedKeys.push(String(cfg.apiKey));
					throw new Error("Resource has been exhausted");
				},
			}),
		);

		const { createKeypoolliveProvider } = await importFreshKeypoollive();
		const provider = createKeypoolliveProvider(baseConfig());

		const result = await collectEventsUntilError(
			provider,
			baseRequest(),
			baseContext(),
		);

		expect(result.error).toBeInstanceOf(Error);
		expect((result.error as Error).message).toContain(
			"All key rotation attempts exhausted",
		);
		// MAX_KEY_ATTEMPTS scales with the vault's key pool size (2 keys here),
		// so each key is tried exactly once before rotation gives up.
		expect(usedKeys).toEqual(["k_live_p", "k_live_q"]);

		const activeNotices = result.events.filter(
			(event) =>
				event.type === "reasoning-delta" &&
				typeof event.metadata === "object" &&
				event.metadata !== null &&
				(event.metadata as Record<string, unknown>).event === "active-key",
		);
		const rotatedNotices = result.events.filter(
			(event) =>
				event.type === "reasoning-delta" &&
				typeof event.metadata === "object" &&
				event.metadata !== null &&
				(event.metadata as Record<string, unknown>).event === "key-rotated",
		);

		expect(activeNotices).toHaveLength(1);
		expect(rotatedNotices).toHaveLength(2);
	});

	it("rejects a modelId that is not in \"providerName/modelId\" format", async () => {
		const { createKeypoolliveProvider } = await importFreshKeypoollive();
		const provider = createKeypoolliveProvider(baseConfig());

		const result = await collectEventsUntilError(
			provider,
			{ ...baseRequest(), modelId: "no-slash-here" },
			baseContext(),
		);

		expect(result.error).toBeInstanceOf(Error);
		expect((result.error as Error).message).toContain(
			'modelId must be in format "providerName/modelId"',
		);
	});

	it("uses the explicit apiKey directly and skips the vault entirely", async () => {
		// No mockVaultEnvironment call: an explicit (non-"auto") apiKey must never
		// touch the vault, so no fetch/crypto mocking is needed for this to pass.
		const usedKeys: string[] = [];
		createOpenAICompatibleProviderMock.mockImplementation(
			(cfg: GatewayResolvedProviderConfig) => ({
				async *stream(): AsyncIterable<AgentModelEvent> {
					usedKeys.push(String(cfg.apiKey));
					usedKeys.push(String(cfg.baseUrl));
					yield { type: "finish", reason: "stop" };
				},
			}),
		);

		const { createKeypoolliveProvider } = await importFreshKeypoollive();
		const provider = createKeypoolliveProvider(
			baseConfig({ apiKey: "sk-explicit-key", baseUrl: "https://explicit.example/v1" }),
		);
		await collectEvents(provider, baseRequest(), baseContext());

		expect(usedKeys).toEqual(["sk-explicit-key", "https://explicit.example/v1"]);
	});

	it("propagates a non-key error immediately without rotating to another key", async () => {
		mockVaultEnvironment(vaultConfig(["k_live_1", "k_live_2"]));
		const usedKeys: string[] = [];

		createOpenAICompatibleProviderMock.mockImplementation(
			(cfg: GatewayResolvedProviderConfig) => ({
				async *stream(): AsyncIterable<AgentModelEvent> {
					usedKeys.push(String(cfg.apiKey));
					throw new Error("boom: totally unrelated failure");
				},
			}),
		);

		const { createKeypoolliveProvider } = await importFreshKeypoollive();
		const provider = createKeypoolliveProvider(baseConfig());
		const result = await collectEventsUntilError(
			provider,
			baseRequest(),
			baseContext(),
		);

		expect((result.error as Error).message).toBe("boom: totally unrelated failure");
		expect(usedKeys).toEqual(["k_live_1"]);
	});

	describe("sub-provider protocol routing", () => {
		it.each([
			["anthropic", () => createAnthropicProviderMock],
			["gemini", () => createGoogleProviderMock],
			["cohere", () => createCohereProviderMock],
			["poolside", () => createPoolsideProviderMock],
			["mistral", () => createMistralProviderMock],
			["openai", () => createOpenAICompatibleProviderMock],
		])("routes vault protocol %s to the matching AI SDK factory", async (protocol, getMock) => {
			mockVaultEnvironment(vaultConfig(["k_live_1"], protocol));
			const mock = getMock();
			mock.mockImplementation(() => ({
				async *stream(): AsyncIterable<AgentModelEvent> {
					yield { type: "finish", reason: "stop" };
				},
			}));

			const { createKeypoolliveProvider } = await importFreshKeypoollive();
			const provider = createKeypoolliveProvider(baseConfig());
			await collectEvents(provider, baseRequest(), baseContext());

			expect(mock).toHaveBeenCalledTimes(1);
		});
	});

	it("overlays vault model capability flags onto the context model capabilities", async () => {
		const vault = vaultConfig(["k_live_1"]);
		vault.providers.mistral.models = [
			{
				id: "devstral-latest",
				usage: "chat",
				supportsImages: true,
				supportsPromptCache: false,
				supportsTools: true,
			},
		];
		mockVaultEnvironment(vault);

		let capturedCapabilities: string[] | undefined;
		createOpenAICompatibleProviderMock.mockImplementation(() => ({
			async *stream(
				_req: GatewayStreamRequest,
				ctx: GatewayProviderContext,
			): AsyncIterable<AgentModelEvent> {
				capturedCapabilities = ctx.model.capabilities as string[] | undefined;
				yield { type: "finish", reason: "stop" };
			},
		}));

		const { createKeypoolliveProvider } = await importFreshKeypoollive();
		const provider = createKeypoolliveProvider(baseConfig());
		const context = baseContext();
		context.model.capabilities = ["prompt-cache"];
		await collectEvents(provider, baseRequest(), context);

		expect(capturedCapabilities).toContain("images");
		expect(capturedCapabilities).toContain("tools");
		expect(capturedCapabilities).not.toContain("prompt-cache");
	});

	describe("crawler key resolution", () => {
		it("returns null when the vault has no crawlers section", async () => {
			mockVaultEnvironment(vaultConfig(["k_live_1"]));
			const { createKeypoolCrawlerResolver } = await importFreshKeypoollive();
			const resolver = createKeypoolCrawlerResolver(
				"https://vault.example.local/encrypted",
			);

			expect(await resolver.resolve()).toBeNull();
		});

		it("resolves the first crawler's key when usable", async () => {
			mockVaultEnvironment(crawlerVaultConfig(["fc_key_1", "fc_key_2"]));
			const { createKeypoolCrawlerResolver } = await importFreshKeypoollive();
			const resolver = createKeypoolCrawlerResolver(
				"https://vault.example.local/encrypted",
			);

			const resolved = await resolver.resolve();
			expect(resolved).toMatchObject({
				crawlerName: "firecrawl",
				protocol: "firecrawl",
				apiKey: "fc_key_1",
			});
		});

		it("round-robins across crawler keys on successive resolve() calls", async () => {
			mockVaultEnvironment(crawlerVaultConfig(["fc_key_1", "fc_key_2"]));
			const { createKeypoolCrawlerResolver } = await importFreshKeypoollive();
			const resolver = createKeypoolCrawlerResolver(
				"https://vault.example.local/encrypted",
			);

			const first = await resolver.resolve();
			const second = await resolver.resolve();

			expect(first?.apiKey).toBe("fc_key_1");
			expect(second?.apiKey).toBe("fc_key_2");
		});

		it("skips a crawler key that has cooled down after repeated failures", async () => {
			mockVaultEnvironment(crawlerVaultConfig(["fc_key_1", "fc_key_2"]));
			const { createKeypoolCrawlerResolver, markCrawlerKeyAsFailed } =
				await importFreshKeypoollive();
			const resolver = createKeypoolCrawlerResolver(
				"https://vault.example.local/encrypted",
			);

			markCrawlerKeyAsFailed("firecrawl", "fc_key_1");
			markCrawlerKeyAsFailed("firecrawl", "fc_key_1");
			markCrawlerKeyAsFailed("firecrawl", "fc_key_1");

			const first = await resolver.resolve();
			const second = await resolver.resolve();

			expect(first?.apiKey).toBe("fc_key_2");
			expect(second?.apiKey).toBe("fc_key_2");
		});
	});

	describe("key state utilities", () => {
		it("reports failure counts and cooldown state via getKeypoolKeyStates", async () => {
			const { rotateKeypoolliveKey, getKeypoolKeyStates } =
				await importFreshKeypoollive();

			rotateKeypoolliveKey("mistral", "k_live_1", false);
			let states = getKeypoolKeyStates("mistral");
			expect(states).toHaveLength(1);
			expect(states[0]).toMatchObject({ failureCount: 1, inCooldown: false });

			rotateKeypoolliveKey("mistral", "k_live_1", false);
			rotateKeypoolliveKey("mistral", "k_live_1", false);
			states = getKeypoolKeyStates("mistral");
			expect(states[0]).toMatchObject({ failureCount: 3, inCooldown: true });
			expect(states[0].cooldownRemainingMs).toBeGreaterThan(0);
		});

		it("filters getKeypoolKeyStates by provider name", async () => {
			const { rotateKeypoolliveKey, getKeypoolKeyStates } =
				await importFreshKeypoollive();

			rotateKeypoolliveKey("mistral", "k_live_1", false);
			rotateKeypoolliveKey("other-provider", "k_live_9", false);

			expect(getKeypoolKeyStates("mistral")).toHaveLength(1);
			expect(getKeypoolKeyStates("other-provider")).toHaveLength(1);
			expect(getKeypoolKeyStates()).toHaveLength(2);
		});
	});

	describe("remote storage configuration", () => {
		it("is disabled by default with no env var or explicit config", async () => {
			const { isKeypoolRemoteStorageEnabled } = await importFreshKeypoollive();
			expect(isKeypoolRemoteStorageEnabled()).toBe(false);
		});

		it("is enabled after an explicit setKeypoolRemoteStorage call", async () => {
			const { setKeypoolRemoteStorage, isKeypoolRemoteStorageEnabled } =
				await importFreshKeypoollive();

			setKeypoolRemoteStorage({
				workerUrl: "https://usage.example.com",
				authToken: "worker-token",
			});

			expect(isKeypoolRemoteStorageEnabled()).toBe(true);
		});

		it("auto-detects remote storage from KEYPOOL_USAGE_DB_DIR + KEYPOOL_LIVE_SECRET", async () => {
			process.env.KEYPOOL_USAGE_DB_DIR = "https://usage.example.com";
			const { isKeypoolRemoteStorageEnabled } = await importFreshKeypoollive();

			expect(isKeypoolRemoteStorageEnabled()).toBe(true);
		});

		it("does not auto-detect remote storage for a non-HTTP KEYPOOL_USAGE_DB_DIR", async () => {
			process.env.KEYPOOL_USAGE_DB_DIR = "/local/path/to/db";
			const { isKeypoolRemoteStorageEnabled } = await importFreshKeypoollive();

			expect(isKeypoolRemoteStorageEnabled()).toBe(false);
		});
	});
});

function baseConfig(
	overrides: Partial<GatewayResolvedProviderConfig> = {},
): GatewayResolvedProviderConfig {
	return {
		providerId: "keypoollive",
		apiKey: "auto",
		...overrides,
	};
}

function baseRequest(): GatewayStreamRequest {
	return {
		providerId: "keypoollive",
		modelId: "mistral/devstral-latest",
		messages: [],
	};
}

function baseContext(): GatewayProviderContext {
	return {
		provider: {
			id: "keypoollive",
			name: "KeypoolLive",
			defaultModelId: "mistral/devstral-latest",
			models: [],
		},
		model: {
			providerId: "keypoollive",
			id: "mistral/devstral-latest",
			name: "devstral-latest",
		},
		config: baseConfig(),
		logger: {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		},
	};
}

function vaultConfig(keys: string[], protocol = "openai") {
	return {
		version: 1,
		providers: {
			mistral: {
				protocol,
				endpoint: "https://api.mistral.local/v1",
				keys: keys.map((key) => ({ key, owner: "test", type: "paid" })),
				models: [{ id: "devstral-latest", usage: "chat" }],
			},
		},
	};
}

function crawlerVaultConfig(keys: string[]) {
	return {
		version: 1,
		providers: {},
		crawlers: {
			firecrawl: {
				protocol: "firecrawl",
				endpoint: "https://api.firecrawl.local/v1",
				keys: keys.map((key) => ({ key, owner: "test", type: "paid" })),
			},
		},
	};
}

function mockVaultEnvironment(rawConfig: unknown): void {
	const ciphertext = makeSaltedCiphertextBase64();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => ciphertext,
		})),
	);
	vi.stubGlobal("atob", (input: string) =>
		Buffer.from(input, "base64").toString("binary"),
	);
	vi.stubGlobal("crypto", {
		subtle: {
			importKey: vi.fn(async () => ({})),
			deriveBits: vi.fn(async () => new Uint8Array(48).buffer),
			decrypt: vi.fn(
				async () => new TextEncoder().encode(JSON.stringify(rawConfig)).buffer,
			),
		},
	} as unknown as Crypto);
}

function makeSaltedCiphertextBase64(): string {
	const header = Buffer.from("Salted__", "ascii");
	const salt = Buffer.alloc(8, 1);
	const payload = Buffer.from([1, 2, 3, 4]);
	return Buffer.concat([header, salt, payload]).toString("base64");
}

async function collectEvents(
	provider: GatewayProvider,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Promise<AgentModelEvent[]> {
	const streamResult = provider.stream(request, context);
	const iterable =
		streamResult instanceof Promise ? await streamResult : streamResult;
	const events: AgentModelEvent[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
}

async function collectEventsUntilError(
	provider: GatewayProvider,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Promise<{ events: AgentModelEvent[]; error: unknown }> {
	const streamResult = provider.stream(request, context);
	const iterable =
		streamResult instanceof Promise ? await streamResult : streamResult;
	const events: AgentModelEvent[] = [];
	try {
		for await (const event of iterable) {
			events.push(event);
		}
		return { events, error: undefined };
	} catch (error) {
		return { events, error };
	}
}

async function importFreshKeypoollive() {
	vi.resetModules();
	return import("./keypoollive");
}

function findNotice(events: AgentModelEvent[], expectedEvent: string) {
	for (const event of events) {
		if (event.type !== "reasoning-delta") {
			continue;
		}
		if (!event.metadata || typeof event.metadata !== "object") {
			continue;
		}
		const metadata = event.metadata as Record<string, unknown>;
		if (metadata.event === expectedEvent) {
			return metadata;
		}
	}
	return undefined;
}

async function waitForStateFile(filePath: string): Promise<void> {
	// The state file is created (empty roundRobinIndexes) synchronously before the
	// key rotation logic runs, then rewritten asynchronously once a key is
	// selected. Wait for the actual round-robin index, not just file existence,
	// so callers don't race the fire-and-forget persistence write.
	const timeoutMs = 2_000;
	const start = Date.now();
	for (;;) {
		try {
			const content = await readFile(filePath, "utf8");
			const parsed = JSON.parse(content) as {
				roundRobinIndexes?: Record<string, number>;
			};
			if (Object.keys(parsed.roundRobinIndexes ?? {}).length > 0) {
				return;
			}
		} catch {
			// Keep polling until timeout.
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for keypool state file: ${filePath}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
