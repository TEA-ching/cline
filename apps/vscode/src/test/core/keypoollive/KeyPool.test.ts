import { beforeEach, describe, it } from "mocha"
import * as should from "should"
import { buildModelDescriptions, markKeyAsFailed, resetKeyPool, resolveNextApiConfig } from "../../../core/keypoollive/KeyPool"
import type { AiVaultConfig } from "../../../core/keypoollive/types"

describe("KeyPool", () => {
	const mockVault: AiVaultConfig = {
		version: 1,
		providers: {
			anthropic: {
				protocol: "anthropic",
				keys: [
					{ key: "key1", owner: "owner1", type: "paid" },
					{ key: "key2", owner: "owner2", type: "paid" },
				],
				models: [
					{ id: "claude-3-opus", name: "Opus", usage: "chat" },
					{ id: "claude-3-sonnet", name: "Sonnet", usage: "chat" },
				],
			},
		},
	}

	beforeEach(() => {
		resetKeyPool()
	})

	describe("resolveNextApiConfig", () => {
		it("should pick keys in round-robin fashion", async () => {
			const res1 = await resolveNextApiConfig(mockVault, "anthropic")
			res1?.apiKey.should.equal("key1")

			const res2 = await resolveNextApiConfig(mockVault, "anthropic")
			res2?.apiKey.should.equal("key2")

			const res3 = await resolveNextApiConfig(mockVault, "anthropic")
			res3?.apiKey.should.equal("key1")
		})

		it("should respect model selection", async () => {
			const res = await resolveNextApiConfig(mockVault, "anthropic", "claude-3-sonnet")
			res?.model.id.should.equal("claude-3-sonnet")
		})

		it("should skip unhealthy keys", async () => {
			await markKeyAsFailed("anthropic", "key1")
			await markKeyAsFailed("anthropic", "key1")
			await markKeyAsFailed("anthropic", "key1") // 3 failures = cooldown

			const res1 = await resolveNextApiConfig(mockVault, "anthropic")
			res1?.apiKey.should.equal("key2")

			const res2 = await resolveNextApiConfig(mockVault, "anthropic")
			res2?.apiKey.should.equal("key2")
		})

		it("should fallback to any key if all are unhealthy", async () => {
			await markKeyAsFailed("anthropic", "key1")
			await markKeyAsFailed("anthropic", "key1")
			await markKeyAsFailed("anthropic", "key1")
			await markKeyAsFailed("anthropic", "key2")
			await markKeyAsFailed("anthropic", "key2")
			await markKeyAsFailed("anthropic", "key2")

			const res = await resolveNextApiConfig(mockVault, "anthropic")
			should.exist(res)
			if (res) {
				;["key1", "key2"].should.containEql(res.apiKey)
			}
		})
	})

	describe("buildModelDescriptions", () => {
		it("should build correct descriptions for the UI", () => {
			const descriptions = buildModelDescriptions(mockVault)
			descriptions.length.should.equal(2)
			descriptions[0].title.should.equal("[KeypoolLive] anthropic/Opus")
			if (descriptions[0].clineProvider) {
				descriptions[0].clineProvider.should.equal("anthropic")
			}
			descriptions[1].title.should.equal("[KeypoolLive] anthropic/Sonnet")
		})

		it("should inject gateway URL if configured", () => {
			const descriptions = buildModelDescriptions(mockVault, {
				useGateway: true,
				gatewayId: "my-gw",
				gatewaySecret: "secret",
			})
			if (descriptions[0].gatewayUrl) {
				descriptions[0].gatewayUrl.should.equal("https://gateway.ai.cloudflare.com/v1/my-gw/anthropic")
			}
		})
	})
})
