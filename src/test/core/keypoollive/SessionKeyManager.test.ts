import { afterEach, beforeEach, describe, it } from "mocha"
import * as should from "should"
import * as sinon from "sinon"
import { clearVaultCache } from "../../../core/keypoollive/AiVault"
import { resetKeyPool } from "../../../core/keypoollive/KeyPool"
import {
	cleanupSession,
	configureSessionKeyManager,
	getSessionApiConfig,
	getSessionKeyInfo,
	rotateSessionKey,
} from "../../../core/keypoollive/SessionKeyManager"
import { mockFetchForTesting } from "../../../shared/net"

describe("SessionKeyManager", () => {
	let sandbox: sinon.SinonSandbox
	const vaultUrl = "https://example.com/vault.enc"
	const secret = "test-secret"

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		process.env.KEYPOOL_LIVE_SECRET = secret
		configureSessionKeyManager(vaultUrl)
		clearVaultCache()
		resetKeyPool()
	})

	afterEach(() => {
		sandbox.restore()
		clearVaultCache()
		resetKeyPool()
	})

	it("should assign and reuse sticky keys for a session", async () => {
		const encryptedVault = await createMockEncryptedVault(secret)
		const mockFetch = sandbox.stub().resolves({
			ok: true,
			text: () => Promise.resolve(encryptedVault),
		})

		await mockFetchForTesting(mockFetch, async () => {
			const config1 = await getSessionApiConfig("session-1", "anthropic")
			should.exist(config1)
			config1!.apiKey.should.equal("key1")

			const config2 = await getSessionApiConfig("session-1", "anthropic")
			config2!.apiKey.should.equal("key1")

			// Different provider should get a different key (if available)
			const config3 = await getSessionApiConfig("session-1", "openai")
			config3!.apiKey.should.equal("okey1")
		})
	})

	it("should rotate keys on failure", async () => {
		const encryptedVault = await createMockEncryptedVault(secret)
		const mockFetch = sandbox.stub().resolves({
			ok: true,
			text: () => Promise.resolve(encryptedVault),
		})

		await mockFetchForTesting(mockFetch, async () => {
			const config1 = await getSessionApiConfig("session-2", "anthropic")
			config1!.apiKey.should.equal("key1")

			const config2 = await rotateSessionKey("session-2", "anthropic", undefined, "key_failure")
			config2!.apiKey.should.equal("key2")

			// key1 should be marked as failed now
		})
	})

	it("should provide session key info", async () => {
		const encryptedVault = await createMockEncryptedVault(secret)
		const mockFetch = sandbox.stub().resolves({
			ok: true,
			text: () => Promise.resolve(encryptedVault),
		})

		await mockFetchForTesting(mockFetch, async () => {
			await getSessionApiConfig("session-3", "anthropic")
			const info = getSessionKeyInfo("session-3")
			should.exist(info)
			info!.keyOwner.should.equal("owner1")
			info!.keyHint.should.equal("...key1")
		})
	})

	it("should cleanup session data", async () => {
		const encryptedVault = await createMockEncryptedVault(secret)
		const mockFetch = sandbox.stub().resolves({
			ok: true,
			text: () => Promise.resolve(encryptedVault),
		})

		await mockFetchForTesting(mockFetch, async () => {
			await getSessionApiConfig("session-4", "anthropic")
			cleanupSession("session-4")
			const info = getSessionKeyInfo("session-4")
			should.not.exist(info)
		})
	})
})

async function createMockEncryptedVault(pass: string) {
	const config = {
		version: 1,
		providers: {
			anthropic: {
				protocol: "anthropic",
				keys: [
					{ key: "key1", owner: "owner1" },
					{ key: "key2", owner: "owner2" },
				],
				models: [{ id: "claude-3", name: "Claude 3" }],
			},
			openai: {
				protocol: "openai",
				keys: [{ key: "okey1", owner: "oowner1" }],
				models: [{ id: "gpt-4", name: "GPT 4" }],
			},
		},
	}
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
