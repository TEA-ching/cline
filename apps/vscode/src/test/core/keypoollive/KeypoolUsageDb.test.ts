import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as should from "should"
import * as sinon from "sinon"
import { KeypoolUsageDb } from "../../../core/keypoollive/KeypoolUsageDb"
import { HostProvider } from "../../../hosts/host-provider"

describe("KeypoolUsageDb", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypool-test-"))
		sandbox.stub(HostProvider, "get").returns({
			globalStorageFsPath: tempDir,
		} as any)
	})

	afterEach(() => {
		KeypoolUsageDb.close()
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
		sandbox.restore()
	})

	it("should record and retrieve usage stats", async function () {
		// better-sqlite3 might not be available in all environments (e.g. arm64/x64 mismatch)
		// we skip the test if it fails to load
		try {
			require("better-sqlite3")
		} catch {
			this.skip()
		}

		KeypoolUsageDb.recordUsage({
			provider: "anthropic",
			modelId: "claude-3",
			keyOwner: "owner1",
			keyHint: "...abc",
			promptTokens: 100,
			completionTokens: 50,
		})

		const stats = await KeypoolUsageDb.getUsageStats("hour")
		stats.length.should.be.greaterThan(0)
		stats[0].provider.should.equal("anthropic")
		stats[0].promptTokens.should.equal(100)
		stats[0].completionTokens.should.equal(50)
	})

	it("should record and retrieve error stats", async function () {
		try {
			require("better-sqlite3")
		} catch {
			this.skip()
		}

		KeypoolUsageDb.recordUsage({
			provider: "openai",
			modelId: "gpt-4",
			keyOwner: "owner2",
			keyHint: "...xyz",
			promptTokens: 10,
			completionTokens: 10,
		})

		KeypoolUsageDb.recordError({
			provider: "openai",
			modelId: "gpt-4",
			keyOwner: "owner2",
			keyHint: "...xyz",
			errorCode: 429,
		})

		const stats = await KeypoolUsageDb.getErrorStats()
		stats.length.should.be.greaterThan(0)
		const stat = stats.find((s) => s.provider === "openai")
		should.exist(stat)
		if (stat) {
			stat.errorCount.should.equal(1)
			if (stat.lastErrorCode !== null) {
				stat.lastErrorCode.should.equal(429)
			}
		}
	})
})
