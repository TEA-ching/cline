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

const ORIGINAL_ENV = { ...process.env };

const createOpenAICompatibleProviderMock = vi.fn();
const createAnthropicProviderMock = vi.fn();
const createGoogleProviderMock = vi.fn();

vi.mock("../ai-sdk", () => ({
	createOpenAICompatibleProvider: createOpenAICompatibleProviderMock,
	createAnthropicProvider: createAnthropicProviderMock,
	createGoogleProvider: createGoogleProviderMock,
}));

describe("keypoollive provider", () => {
	let tempDir: string;
	let stateFilePath: string;
	let originalFetch: typeof globalThis.fetch | undefined;
	let originalAtob: ((data: string) => string) | undefined;
	let originalCrypto: Crypto;

	beforeEach(async () => {
		vi.clearAllMocks();
		process.env = { ...ORIGINAL_ENV };
		originalFetch = globalThis.fetch;
		originalAtob = globalThis.atob;
		originalCrypto = globalThis.crypto;

		tempDir = await mkdtemp(path.join(os.tmpdir(), "keypoollive-test-"));
		stateFilePath = path.join(tempDir, "state.json");
		process.env.KEYPOOL_STATE_FILE = stateFilePath;
		process.env.KEYPOOL_VAULT_URL = "https://vault.example.local/encrypted";
		process.env.KEYPOOL_LIVE_SECRET = "test-secret";
	});

	afterEach(async () => {
		process.env = { ...ORIGINAL_ENV };
		if (originalFetch) {
			globalThis.fetch = originalFetch;
		}
		if (originalAtob) {
			globalThis.atob = originalAtob;
		}
		globalThis.crypto = originalCrypto;
		await rm(tempDir, { recursive: true, force: true });
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
		expect(usedKeys).toEqual([
			"k_live_p",
			"k_live_q",
			"k_live_p",
			"k_live_q",
			"k_live_p",
		]);

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
		expect(rotatedNotices).toHaveLength(5);
	});
});

function baseConfig(): GatewayResolvedProviderConfig {
	return {
		providerId: "keypoollive",
		apiKey: "auto",
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

function vaultConfig(keys: string[]) {
	return {
		version: 1,
		providers: {
			mistral: {
				protocol: "openai",
				endpoint: "https://api.mistral.local/v1",
				keys: keys.map((key) => ({ key, owner: "test", type: "paid" })),
				models: [{ id: "devstral-latest", usage: "chat" }],
			},
		},
	};
}

function mockVaultEnvironment(rawConfig: unknown): void {
	const ciphertext = makeSaltedCiphertextBase64();
	globalThis.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		text: async () => ciphertext,
	})) as unknown as typeof fetch;
	globalThis.atob = (input: string) =>
		Buffer.from(input, "base64").toString("binary");
	globalThis.crypto = {
		subtle: {
			importKey: vi.fn(async () => ({})),
			deriveBits: vi.fn(async () => new Uint8Array(48).buffer),
			decrypt: vi.fn(
				async () => new TextEncoder().encode(JSON.stringify(rawConfig)).buffer,
			),
		},
	} as unknown as Crypto;
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
	const cacheBust = `${Date.now()}-${Math.random()}`;
	return import(`./keypoollive.ts?fresh=${cacheBust}`);
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
	const timeoutMs = 2_000;
	const start = Date.now();
	for (;;) {
		try {
			const content = await readFile(filePath, "utf8");
			if (content.trim().length > 0) {
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
