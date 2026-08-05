// Regression tests for the contextWindow/maxOutputTokens field name mismatch bug.
// Bug: AiModel and VaultModel had `contextLength` but the JSON vault uses `contextWindow`
// and `maxOutputTokens`, causing getModel() to always return the 128000 fallback.

import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import { mockFetchForTesting } from "@/shared/net"
import { clearVaultCache, loadAiVault } from "../AiVault"
import { resetKeyPool, resolveNextApiConfig } from "../KeyPool"
import type { AiConfig, AiVaultConfig } from "../types"

async function encryptConfig(config: AiConfig, pass: string): Promise<string> {
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

describe("KeypoolLive — contextWindow field mapping", () => {
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

	describe("AiVault.loadAiVault — transformation of contextWindow and maxOutputTokens", () => {
		it("preserves contextWindow from JSON into VaultModel", async () => {
			const config: AiConfig = {
				version: 1,
				providers: {
					gemini: {
						protocol: "gemini",
						keys: [{ key: "gkey", owner: "gowner" }],
						models: [{ id: "gemini-2.5-pro", contextWindow: 1048576, maxOutputTokens: 65536 }],
					},
				},
			}
			const encrypted = await encryptConfig(config, secret)
			const mockFetch = sandbox.stub().resolves({ ok: true, text: () => Promise.resolve(encrypted) })

			await mockFetchForTesting(mockFetch, async () => {
				const vault = await loadAiVault("https://example.com/vault.enc")
				const model = vault.providers.gemini.models[0]
				model.contextWindow!.should.equal(1048576)
				model.maxOutputTokens!.should.equal(65536)
			})
		})

		it("preserves maxOutputTokens independently of contextWindow", async () => {
			const config: AiConfig = {
				version: 1,
				providers: {
					openai: {
						protocol: "openai",
						keys: [{ key: "okey", owner: "oowner" }],
						models: [{ id: "gpt-4o", contextWindow: 128000, maxOutputTokens: 16384 }],
					},
				},
			}
			const encrypted = await encryptConfig(config, secret)
			const mockFetch = sandbox.stub().resolves({ ok: true, text: () => Promise.resolve(encrypted) })

			await mockFetchForTesting(mockFetch, async () => {
				const vault = await loadAiVault("https://example.com/vault.enc")
				const model = vault.providers.openai.models[0]
				model.contextWindow!.should.equal(128000)
				model.maxOutputTokens!.should.equal(16384)
			})
		})

		it("preserves large contextWindow values (1M+) without truncation", async () => {
			const config: AiConfig = {
				version: 1,
				providers: {
					anthropic: {
						protocol: "anthropic",
						keys: [{ key: "akey", owner: "aowner" }],
						models: [{ id: "claude-opus-4-6", contextWindow: 1000000, maxOutputTokens: 128000 }],
					},
				},
			}
			const encrypted = await encryptConfig(config, secret)
			const mockFetch = sandbox.stub().resolves({ ok: true, text: () => Promise.resolve(encrypted) })

			await mockFetchForTesting(mockFetch, async () => {
				const vault = await loadAiVault("https://example.com/vault.enc")
				const model = vault.providers.anthropic.models[0]
				model.contextWindow!.should.equal(1000000)
				model.maxOutputTokens!.should.equal(128000)
			})
		})

		it("leaves contextWindow undefined when absent from JSON (not silently 128000)", async () => {
			const config: AiConfig = {
				version: 1,
				providers: {
					groq: {
						protocol: "openai",
						keys: [{ key: "gkey", owner: "gowner" }],
						models: [{ id: "llama-3.3-70b" }],
					},
				},
			}
			const encrypted = await encryptConfig(config, secret)
			const mockFetch = sandbox.stub().resolves({ ok: true, text: () => Promise.resolve(encrypted) })

			await mockFetchForTesting(mockFetch, async () => {
				const vault = await loadAiVault("https://example.com/vault.enc")
				const model = vault.providers.groq.models[0]
				// Should be undefined — the 128000 fallback is only applied in getModel()
				;(model.contextWindow === undefined).should.be.true()
			})
		})

		it("handles multiple providers each with distinct contextWindow values", async () => {
			const config: AiConfig = {
				version: 1,
				providers: {
					gemini: {
						protocol: "gemini",
						keys: [{ key: "gk", owner: "go" }],
						models: [{ id: "gemini-2.5-pro", contextWindow: 1048576, maxOutputTokens: 65536 }],
					},
					mistral: {
						protocol: "openai",
						keys: [{ key: "mk", owner: "mo" }],
						models: [{ id: "codestral-latest", contextWindow: 256000, maxOutputTokens: 256000 }],
					},
					groq: {
						protocol: "openai",
						keys: [{ key: "grok", owner: "groo" }],
						models: [{ id: "llama-3.3-70b-versatile", contextWindow: 131072, maxOutputTokens: 32768 }],
					},
				},
			}
			const encrypted = await encryptConfig(config, secret)
			const mockFetch = sandbox.stub().resolves({ ok: true, text: () => Promise.resolve(encrypted) })

			await mockFetchForTesting(mockFetch, async () => {
				const vault = await loadAiVault("https://example.com/vault.enc")
				vault.providers.gemini.models[0].contextWindow!.should.equal(1048576)
				vault.providers.mistral.models[0].contextWindow!.should.equal(256000)
				vault.providers.groq.models[0].contextWindow!.should.equal(131072)
				vault.providers.groq.models[0].maxOutputTokens!.should.equal(32768)
			})
		})
	})

	describe("KeyPool.resolveNextApiConfig — contextWindow in resolved model", () => {
		it("returns model with correct contextWindow", async () => {
			const vault: AiVaultConfig = {
				version: 1,
				providers: {
					anthropic: {
						protocol: "anthropic",
						keys: [{ key: "key1", owner: "owner1", type: "paid" }],
						models: [{ id: "claude-opus-4-6", usage: "chat", contextWindow: 1000000, maxOutputTokens: 128000 }],
					},
				},
			}
			const config = await resolveNextApiConfig(vault, "anthropic")
			config!.model.contextWindow!.should.equal(1000000)
			config!.model.maxOutputTokens!.should.equal(128000)
		})

		it("returns model with contextWindow for specific modelId selection", async () => {
			const vault: AiVaultConfig = {
				version: 1,
				providers: {
					gemini: {
						protocol: "gemini",
						keys: [{ key: "gkey", owner: "gowner", type: "free" }],
						models: [
							{ id: "gemini-3-flash-preview", usage: "chat", contextWindow: 1048576, maxOutputTokens: 65536 },
							{ id: "gemini-3.1-pro-preview", usage: "chat", contextWindow: 1048576, maxOutputTokens: 65536 },
						],
					},
				},
			}
			const config = await resolveNextApiConfig(vault, "gemini", "gemini-3.1-pro-preview")
			config!.model.id.should.equal("gemini-3.1-pro-preview")
			config!.model.contextWindow!.should.equal(1048576)
		})
	})
})
