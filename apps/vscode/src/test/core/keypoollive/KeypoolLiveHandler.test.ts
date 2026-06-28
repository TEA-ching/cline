import { beforeEach, afterEach, describe, it } from "mocha"
import * as should from "should"
import * as sinon from "sinon"
import { KeypoolLiveHandler } from "../../../core/api/providers/keypoollive"
import { clearVaultCache } from "../../../core/keypoollive/AiVault"
import { KeypoolUsageDb } from "../../../core/keypoollive/KeypoolUsageDb"
import { resetKeyPool } from "../../../core/keypoollive/KeyPool"
import { cleanupSession, configureSessionKeyManager, getSessionApiConfig } from "../../../core/keypoollive/SessionKeyManager"
import { mockFetchForTesting } from "../../../shared/net"

describe("KeypoolLiveHandler", () => {
	let sandbox: sinon.SinonSandbox
	const vaultUrl = "https://example.com/vault.enc"
	const secret = "test-secret"

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		process.env.KEYPOOL_LIVE_SECRET = secret
		configureSessionKeyManager(vaultUrl)
		clearVaultCache()
		resetKeyPool()
		cleanupSession("kpl-global")
		sandbox.stub(KeypoolUsageDb, "recordUsage")
		sandbox.stub(KeypoolUsageDb, "recordError")
		sandbox.stub(Math, "random").returns(0)
		// TODO: OpenAiHandler moved to @cline/llms SDK — stub createHandler or mock
		// the SSE HTTP response via mockFetchForTesting to control handler output.
	})

	afterEach(() => {
		sandbox.restore()
		clearVaultCache()
		resetKeyPool()
		cleanupSession("kpl-global")
	})

	it("should record successful usage before the next selection", async () => {
		const encryptedVault = await createMockEncryptedVault(secret)
		const mockFetch = sandbox.stub().resolves({
			ok: true,
			text: () => Promise.resolve(encryptedVault),
		})

		await mockFetchForTesting(mockFetch, async () => {
			const handler = new KeypoolLiveHandler({
				keypoolliveVaultUrl: vaultUrl,
				keypoolliveSecret: secret,
				apiModelId: "openai/gpt-4",
			} as never)

			const chunks: unknown[] = []
			for await (const chunk of handler.createMessage("system prompt", [])) {
				chunks.push(chunk)
			}
			chunks.length.should.be.greaterThanOrEqual(1)

			cleanupSession("kpl-global")

			const nextConfig = await getSessionApiConfig("fresh-session", "openai")
			should.exist(nextConfig)
			nextConfig!.apiKey.should.equal("okey2")
		})
	})
})

async function createMockEncryptedVault(pass: string) {
	const config = {
		version: 1,
		providers: {
			openai: {
				protocol: "openai",
				keys: [
					{ key: "okey1", owner: "oowner1" },
					{ key: "okey2", owner: "oowner2" },
				],
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
