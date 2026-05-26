import { afterEach, beforeEach, describe, it } from "mocha"
import * as should from "should"
import * as sinon from "sinon"
import { clearVaultCache, decryptAiConfig, loadAiVault } from "../../../core/keypoollive/AiVault"
import type { AiConfig } from "../../../core/keypoollive/types"
import { mockFetchForTesting } from "../../../shared/net"

describe("AiVault", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		clearVaultCache()
	})

	afterEach(() => {
		sandbox.restore()
		clearVaultCache()
	})

	describe("decryptAiConfig", () => {
		it("should decrypt a valid encrypted vault", async () => {
			const config: AiConfig = {
				version: 1,
				providers: {
					anthropic: {
						protocol: "anthropic",
						keys: [{ key: "test-key", owner: "test-owner" }],
						models: [{ id: "claude-3-sonnet", name: "Sonnet" }],
					},
				},
			}
			const password = "test-password"
			const plaintext = JSON.stringify(config)

			// Helper to simulate OpenSSL-compatible encryption
			const encrypt = async (text: string, pass: string) => {
				const enc = new TextEncoder()
				const salt = crypto.getRandomValues(new Uint8Array(8))
				const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"])
				const derived = await crypto.subtle.deriveBits(
					{
						name: "PBKDF2",
						hash: "SHA-256",
						salt,
						iterations: 100000,
					},
					keyMaterial,
					(32 + 16) * 8,
				)
				const keyBytes = new Uint8Array(derived, 0, 32)
				const iv = new Uint8Array(derived, 32, 16)
				const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"])
				const ciphertext = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, enc.encode(text))

				const combined = new Uint8Array(8 + 8 + ciphertext.byteLength)
				combined.set(enc.encode("Salted__"), 0)
				combined.set(salt, 8)
				combined.set(new Uint8Array(ciphertext), 16)

				return btoa(String.fromCharCode(...combined))
			}

			const encrypted = await encrypt(plaintext, password)
			const decrypted = await decryptAiConfig(encrypted, password)

			decrypted.should.deepEqual(config)
		})

		it("should throw error for invalid magic header", async () => {
			const invalidBase64 = btoa("NotSalted__somecontent")
			try {
				await decryptAiConfig(invalidBase64, "any")
				should.fail("Should have thrown error", "", "Expected error to be thrown", "")
			} catch (e: any) {
				e.message.should.equal("Invalid vault format: missing 'Salted__' magic header")
			}
		})
	})

	describe("loadAiVault", () => {
		it("should fetch, decrypt and cache the vault", async () => {
			const config: AiConfig = {
				version: 1,
				providers: {
					openai: {
						protocol: "openai",
						keys: [{ key: "okey", owner: "oowner" }],
						models: [{ id: "gpt-4", name: "GPT4" }],
					},
				},
			}
			const password = "vault-secret"
			process.env.KEYPOOL_LIVE_SECRET = password

			const encrypt = async (text: string, pass: string) => {
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
				const ciphertext = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, enc.encode(text))
				const combined = new Uint8Array(16 + ciphertext.byteLength)
				combined.set(enc.encode("Salted__"), 0)
				combined.set(salt, 8)
				combined.set(new Uint8Array(ciphertext), 16)
				return btoa(String.fromCharCode(...combined))
			}

			const encrypted = await encrypt(JSON.stringify(config), password)
			const mockFetch = sandbox.stub().resolves({
				ok: true,
				text: () => Promise.resolve(encrypted),
			})

			await mockFetchForTesting(mockFetch, async () => {
				const vault1 = await loadAiVault("https://example.com/vault.enc")
				vault1.providers.openai.keys[0].key.should.equal("okey")

				// Second call should use cache (mockFetch called only once)
				const vault2 = await loadAiVault("https://example.com/vault.enc")
				vault2.should.deepEqual(vault1)
				sinon.assert.calledOnce(mockFetch)
			})
		})

		it("should throw if KEYPOOL_LIVE_SECRET is missing", async () => {
			const originalSecret = process.env.KEYPOOL_LIVE_SECRET
			delete process.env.KEYPOOL_LIVE_SECRET
			try {
				await loadAiVault("some-url")
				should.fail("Should have thrown error", "", "Expected error to be thrown", "")
			} catch (e: any) {
				e.message.should.equal("KEYPOOL_LIVE_SECRET environment variable is not set")
			} finally {
				process.env.KEYPOOL_LIVE_SECRET = originalSecret
			}
		})
	})
})
