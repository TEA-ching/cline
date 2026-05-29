import { describe, expect, it } from "vitest";
import { Agent } from "../index";
import { loadWorkspaceEnvFile } from "./load-workspace-env";

loadWorkspaceEnvFile();

const LIVE_TEST_ENABLED = process.env.CORE_LIVE_KEYPOOLLIVE_TESTS === "1";
const HAS_VAULT_ENV = Boolean(
	process.env.KEYPOOL_VAULT_URL && process.env.KEYPOOL_LIVE_SECRET,
);
const MODEL_ID = "mistral/devstral-latest";

const runLive = LIVE_TEST_ENABLED && HAS_VAULT_ENV ? it : it.skip;

runLive(
	"can perform a minimal call through keypoollive with real vault credentials",
	{ timeout: 120_000 },
	async () => {
		const agent = new Agent({
			providerId: "keypoollive",
			modelId: MODEL_ID,
			apiKey: "auto",
			systemPrompt: "You are a deterministic responder.",
			tools: [],
		});

		const result = await agent.run(
			'Return exactly this JSON object and nothing else: {"status":"ok","source":"keypoollive"}',
		);

		const output = (result.outputText ?? "").trim().toLowerCase();
		expect(output.length).toBeGreaterThan(0);
		expect(output).toContain("ok");
	},
);

describe("keypoollive vault integration preconditions", () => {
	it("requires env vars when live tests are enabled", () => {
		if (!LIVE_TEST_ENABLED) {
			expect(HAS_VAULT_ENV).toBeTypeOf("boolean");
			return;
		}
		expect(HAS_VAULT_ENV).toBe(true);
	});
});
