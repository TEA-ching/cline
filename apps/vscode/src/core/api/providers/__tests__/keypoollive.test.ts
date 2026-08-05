// Tests for KeypoolLiveHandler.getModel() — the entry point that reported context sizes to Cline.
// Two regressions are covered:
// 1. Field name mismatch: getModel() read `model.contextLength` (doesn't exist) instead of
//    `model.contextWindow`, so contextWindow was always the 128000 fallback.
// 2. Cold-start: getModel() relied on resolvedConfig which is only set after createMessage().
//    Before any message, the model picker always received 128000 regardless of vault content.

import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import { clearVaultCache } from "@/core/keypoollive/AiVault"
import { resetKeyPool } from "@/core/keypoollive/KeyPool"
import type { ResolvedApiConfig } from "@/core/keypoollive/types"
import { mockFetchForTesting } from "@/shared/net"
import { KeypoolLiveHandler } from "../keypoollive"

function makeHandler(modelId = "gemini/gemini-2.5-pro"): KeypoolLiveHandler {
	return new KeypoolLiveHandler({ apiModelId: modelId })
}

function injectResolvedConfig(handler: KeypoolLiveHandler, config: ResolvedApiConfig): void {
	;(handler as any).resolvedConfig = config
}

async function encryptConfig(config: object, pass: string): Promise<string> {
	const enc = new TextEncoder()
	const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
	const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"])
	const derived = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
		keyMaterial,
		(32 + 16) * 8,
	)
	const keyBytes = new Uint8Array(derived, 0, 32)
	const iv = new Uint8Array(derived, 32, 16)
	const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"])
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, enc.encode(JSON.stringify(config)))
	const combined = new Uint8Array(16 + ciphertext.byteLength)
	combined.set(enc.encode("Salted__"), 0)
	combined.set(salt, 8)
	combined.set(new Uint8Array(ciphertext), 16)
	return btoa(String.fromCharCode(...combined))
}

describe("KeypoolLiveHandler.getModel()", () => {
	let sandbox: sinon.SinonSandbox
	const secret = "test-secret"

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		process.env.KEYPOOL_LIVE_SECRET = secret
		clearVaultCache()
		resetKeyPool()
	})

	afterEach(() => {
		sandbox.restore()
		clearVaultCache()
		resetKeyPool()
	})

	it("falls back to 128000 contextWindow when vault cache is empty and no resolvedConfig", () => {
		const handler = makeHandler()
		const model = handler.getModel()
		model.info.contextWindow!.should.equal(128000)
		;(model.info.maxTokens === undefined).should.be.true()
	})

	it("returns contextWindow from vault model — regression for always-128000 bug", () => {
		const handler = makeHandler("gemini/gemini-2.5-pro")
		injectResolvedConfig(handler, {
			providerName: "gemini",
			protocol: "gemini",
			apiKey: "test-key",
			keyOwner: "test-owner",
			model: { id: "gemini-2.5-pro", contextWindow: 1048576, maxOutputTokens: 65536 },
		})
		const model = handler.getModel()
		// Before fix: would return 128000 because `model.contextLength` was always undefined
		model.info.contextWindow!.should.equal(1048576)
	})

	it("uses maxOutputTokens from vault model as maxTokens when available", () => {
		const handler = makeHandler("openai/gpt-4o")
		injectResolvedConfig(handler, {
			providerName: "openai",
			protocol: "openai",
			apiKey: "test-key",
			keyOwner: "test-owner",
			model: { id: "gpt-4o", contextWindow: 128000, maxOutputTokens: 16384 },
		})
		const model = handler.getModel()
		model.info.maxTokens!.should.equal(16384)
	})

	it("computes maxTokens as 80% of contextWindow when maxOutputTokens is absent", () => {
		const handler = makeHandler("groq/llama-3.3-70b")
		injectResolvedConfig(handler, {
			providerName: "groq",
			protocol: "openai",
			apiKey: "test-key",
			keyOwner: "test-owner",
			model: { id: "llama-3.3-70b", contextWindow: 131072 },
		})
		const model = handler.getModel()
		model.info.contextWindow!.should.equal(131072)
		model.info.maxTokens!.should.equal(Math.floor(131072 * 0.8)) // 104857
	})

	it("prefers explicit maxOutputTokens over 80% heuristic", () => {
		const handler = makeHandler("mistral/codestral-latest")
		injectResolvedConfig(handler, {
			providerName: "mistral",
			protocol: "openai",
			apiKey: "test-key",
			keyOwner: "test-owner",
			model: { id: "codestral-latest", contextWindow: 256000, maxOutputTokens: 256000 },
		})
		const model = handler.getModel()
		// 80% heuristic would give 204800 — but explicit value is 256000
		model.info.maxTokens!.should.equal(256000)
	})

	it("returns undefined maxTokens when both contextWindow and maxOutputTokens are absent", () => {
		const handler = makeHandler("groq/llama")
		injectResolvedConfig(handler, {
			providerName: "groq",
			protocol: "openai",
			apiKey: "test-key",
			keyOwner: "test-owner",
			model: { id: "llama" },
		})
		const model = handler.getModel()
		model.info.contextWindow!.should.equal(128000) // fallback
		;(model.info.maxTokens === undefined).should.be.true()
	})

	it("passes through supportsImages and supportsPromptCache flags", () => {
		const handler = makeHandler("anthropic/claude-haiku-4-5")
		injectResolvedConfig(handler, {
			providerName: "anthropic",
			protocol: "anthropic",
			apiKey: "test-key",
			keyOwner: "test-owner",
			model: { id: "claude-haiku-4-5", contextWindow: 200000, supportsImages: true, supportsPromptCache: true },
		})
		const model = handler.getModel()
		model.info.supportsImages!.should.be.true()
		model.info.supportsPromptCache!.should.be.true()
	})

	it("returns composed provider/modelId as model id", () => {
		const handler = makeHandler("mistral/codestral-latest")
		injectResolvedConfig(handler, {
			providerName: "mistral",
			protocol: "openai",
			apiKey: "test-key",
			keyOwner: "test-owner",
			model: { id: "codestral-latest", contextWindow: 256000, maxOutputTokens: 256000 },
		})
		const model = handler.getModel()
		model.id.should.equal("mistral/codestral-latest")
	})

	it("cold-start: returns correct contextWindow from vault cache before any createMessage() call", async () => {
		// Regression for the second bug: getModel() was always 128000 in the model picker
		// because resolvedConfig is only set after the first createMessage().
		// The constructor now preloads the vault; getModel() reads the cache directly.
		const vaultConfig = {
			version: 1,
			providers: {
				groq: {
					protocol: "openai",
					keys: [{ key: "gkey", owner: "gowner" }],
					models: [{ id: "llama-3.1-8b-instant", usage: "chat", contextWindow: 6000, maxOutputTokens: 6000 }],
				},
			},
		}
		const encrypted = await encryptConfig(vaultConfig, secret)
		const mockFetch = sandbox.stub().resolves({ ok: true, text: () => Promise.resolve(encrypted) })

		await mockFetchForTesting(mockFetch, async () => {
			// Simulate the constructor preload completing before getModel() is called
			const { loadAiVault } = await import("@/core/keypoollive/AiVault")
			await loadAiVault("https://example.com/vault.enc")

			// getModel() without any createMessage() — resolvedConfig is null
			const handler = makeHandler("groq/llama-3.1-8b-instant")
			const model = handler.getModel()

			// Before the fix: would return 128000 (resolvedConfig null → fallback)
			// After the fix: reads from vault cache → returns 6000
			model.info.contextWindow!.should.equal(6000)
			model.info.maxTokens!.should.equal(6000)
		})
	})

	it("handles 1M+ contextWindow values from Anthropic and Gemini providers", () => {
		const cases: Array<{ provider: string; modelId: string; contextWindow: number; maxOutputTokens: number }> = [
			{ provider: "anthropic", modelId: "claude-opus-4-6", contextWindow: 1000000, maxOutputTokens: 128000 },
			{ provider: "gemini", modelId: "gemini-3.1-pro-preview", contextWindow: 1048576, maxOutputTokens: 65536 },
		]
		for (const c of cases) {
			const handler = makeHandler(`${c.provider}/${c.modelId}`)
			injectResolvedConfig(handler, {
				providerName: c.provider,
				protocol: c.provider === "anthropic" ? "anthropic" : "gemini",
				apiKey: "test-key",
				keyOwner: "test-owner",
				model: { id: c.modelId, contextWindow: c.contextWindow, maxOutputTokens: c.maxOutputTokens },
			})
			const model = handler.getModel()
			model.info.contextWindow!.should.equal(c.contextWindow, `${c.provider}/${c.modelId}`)
			model.info.maxTokens!.should.equal(c.maxOutputTokens, `${c.provider}/${c.modelId}`)
		}
	})
})
