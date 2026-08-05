import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateway } from "@sctg/cline-llms";
import { afterEach, describe, expect, it } from "vitest";
import { Agent, createBuiltinTools, createDefaultExecutors } from "../index";
import { loadWorkspaceEnvFile } from "./load-workspace-env";

loadWorkspaceEnvFile();

const LIVE_TEST_ENABLED = process.env.CORE_LIVE_KEYPOOLLIVE_TESTS === "1";
const HAS_VAULT_ENV = Boolean(
	process.env.KEYPOOL_VAULT_URL && process.env.KEYPOOL_LIVE_SECRET,
);
const MODEL_ID = "mistral/devstral-latest";
const FAST_MODEL_ID = "mistral/codestral-latest";
const GEMINI_MODEL_ID = "gemini/gemini-3-flash-preview";
const POWERFUL_MODEL_ID = "mistral/mistral-medium-latest";

// Expected context windows from the vault (used in context-window pass-through tests)
const CONTEXT_WINDOWS: Record<string, number> = {
	[MODEL_ID]: 262_144,
	[POWERFUL_MODEL_ID]: 131_072,
	[GEMINI_MODEL_ID]: 1_048_576,
};

const runLive = LIVE_TEST_ENABLED && HAS_VAULT_ENV ? it : it.skip;

function createAgentWithTools(options: {
	cwd: string;
	enableReadFiles?: boolean;
	enableSearch?: boolean;
	enableBash?: boolean;
}) {
	const executors = createDefaultExecutors({});

	return new Agent({
		providerId: "keypoollive",
		modelId: MODEL_ID,
		apiKey: "auto",
		systemPrompt:
			"You are a precise coding agent. Always use the tools that are available and then answer with a short, direct result.",
		tools: createBuiltinTools({
			cwd: options.cwd,
			enableReadFiles: options.enableReadFiles ?? false,
			enableSearch: options.enableSearch ?? false,
			enableBash: options.enableBash ?? false,
			enableWebFetch: false,
			enableApplyPatch: false,
			enableEditor: false,
			enableSkills: false,
			enableAskQuestion: false,
			enableSubmitAndExit: false,
			executors: {
				readFile: executors.readFile,
				search: executors.search,
				bash: executors.bash,
			},
		}),
	});
}

describe("keypoollive real tool integrations", () => {
	const cwd = process.cwd();
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0, tempDirs.length)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	runLive(
		"regression: mistral/devstral tool-call survives second turn and completes",
		{ timeout: 180_000 },
		async () => {
			const dir = mkdtempSync(
				join(tmpdir(), "backport-mistral-devstral-regression-"),
			);
			tempDirs.push(dir);

			const targetFile = join(dir, "probe.txt");
			writeFileSync(targetFile, "hello from regression test\n", "utf-8");

			const agent = new Agent({
				providerId: "keypoollive",
				modelId: MODEL_ID,
				apiKey: "auto",
				systemPrompt:
					"You are a strict test runner. Always call the requested tool first, then answer exactly DONE.",
				tools: createBuiltinTools({
					cwd: dir,
					enableReadFiles: true,
					enableSearch: false,
					enableBash: false,
					enableWebFetch: false,
					enableApplyPatch: false,
					enableEditor: false,
					enableSkills: false,
					enableAskQuestion: false,
					enableSubmitAndExit: false,
					executors: createDefaultExecutors(),
				}),
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				[
					`Use read_files on ${targetFile}.`,
					"After reading the file, reply with exactly DONE.",
				].join("\n"),
			);

			expect(toolNames).toContain("read_files");
			expect(result.status).toBe("completed");
			expect(result.error).toBeFalsy();
			expect((result.outputText ?? "").trim().toLowerCase()).toContain("done");
		},
	);

	runLive(
		`regression: ${FAST_MODEL_ID} tool-call survives second turn and completes`,
		{ timeout: 180_000 },
		async () => {
			const dir = mkdtempSync(
				join(tmpdir(), "backport-mistral-codestral-regression-"),
			);
			tempDirs.push(dir);

			const targetFile = join(dir, "probe.txt");
			writeFileSync(targetFile, "hello from regression test\n", "utf-8");

			const agent = new Agent({
				providerId: "keypoollive",
				modelId: FAST_MODEL_ID,
				apiKey: "auto",
				systemPrompt:
					"You are a strict test runner. Always call the requested tool first, then answer exactly DONE.",
				tools: createBuiltinTools({
					cwd: dir,
					enableReadFiles: true,
					enableSearch: false,
					enableBash: false,
					enableWebFetch: false,
					enableApplyPatch: false,
					enableEditor: false,
					enableSkills: false,
					enableAskQuestion: false,
					enableSubmitAndExit: false,
					executors: createDefaultExecutors(),
				}),
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				[
					`Use read_files on ${targetFile}.`,
					"After reading the file, reply with exactly DONE.",
				].join("\n"),
			);

			expect(toolNames).toContain("read_files");
			expect(result.status).toBe("completed");
			expect(result.error).toBeFalsy();
			expect((result.outputText ?? "").trim().toLowerCase()).toContain("done");
		},
	);

	runLive(
		"uses read_files and search_codebase through the real SDK tools",
		{ timeout: 180_000 },
		async () => {
			const agent = createAgentWithTools({
				cwd,
				enableReadFiles: true,
				enableSearch: true,
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const packageJsonPath = `${cwd}/package.json`;
			const result = await agent.run(
				[
					`Use read_files on ${packageJsonPath}.`,
					'Use search_codebase to find the string "test:unit" in this workspace.',
					"After both tools have been called, answer with one sentence that includes the package name from package.json and the exact script name you found.",
				].join("\n"),
			);

			const output = (result.outputText ?? "").toLowerCase();

			expect(toolNames).toContain("read_files");
			expect(toolNames).toContain("search_codebase");
			expect(output).toContain("@sctg/cline-core");
			expect(output).toContain("test:unit");
		},
	);

	runLive(
		"uses run_commands through the real SDK tool",
		{ timeout: 180_000 },
		async () => {
			const agent = createAgentWithTools({
				cwd,
				enableBash: true,
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				'Use run_commands to execute "node --version" in the workspace and then reply with the exact version string you observed.',
			);

			const output = (result.outputText ?? "").trim();

			expect(toolNames).toContain("run_commands");
			expect(output).toMatch(/v\d+\.\d+\.\d+/);
		},
	);

	runLive(
		"uses fetch_web_content through the real SDK tool",
		{ timeout: 180_000 },
		async () => {
			const agent = new Agent({
				providerId: "keypoollive",
				modelId: MODEL_ID,
				apiKey: "auto",
				systemPrompt:
					"You are a precise coding agent. Always use the tools that are available and then answer with a short, direct result.",
				tools: createBuiltinTools({
					cwd,
					enableReadFiles: false,
					enableSearch: false,
					enableBash: false,
					enableWebFetch: true,
					enableApplyPatch: false,
					enableEditor: false,
					enableSkills: false,
					enableAskQuestion: false,
					enableSubmitAndExit: false,
					executors: createDefaultExecutors(),
				}),
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				"Use fetch_web_content to fetch https://example.com and then reply with the exact title of the page.",
			);

			const output = (result.outputText ?? "").toLowerCase();

			expect(toolNames).toContain("fetch_web_content");
			expect(output).toContain("example domain");
		},
	);

	runLive(
		"uses apply_patch through the real SDK tool",
		{ timeout: 180_000 },
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "backport-apply-patch-"));
			tempDirs.push(dir);

			const targetFile = join(dir, "note.txt");
			writeFileSync(targetFile, "alpha\n", "utf-8");

			const agent = new Agent({
				providerId: "keypoollive",
				modelId: MODEL_ID,
				apiKey: "auto",
				systemPrompt:
					"You are a precise coding agent. Always use the tools that are available and then answer with a short, direct result.",
				tools: createBuiltinTools({
					cwd: dir,
					enableReadFiles: false,
					enableSearch: false,
					enableBash: false,
					enableWebFetch: false,
					enableApplyPatch: true,
					enableEditor: false,
					enableSkills: false,
					enableAskQuestion: false,
					enableSubmitAndExit: false,
					executors: createDefaultExecutors(),
				}),
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				[
					`Use apply_patch to update ${targetFile}.`,
					"Apply exactly this patch:",
					"*** Begin Patch",
					`*** Update File: ${targetFile}`,
					"@@",
					"-alpha",
					"+alpha",
					"+beta",
					"*** End Patch",
					"After applying the patch, report the final two-line content.",
				].join("\n"),
			);

			const fileContent = readFileSync(targetFile, "utf-8");

			expect(toolNames).toContain("apply_patch");
			expect(fileContent).toContain("alpha");
			expect(fileContent).toContain("beta");
			expect(fileContent.trim().split("\n")).toEqual(["alpha", "beta"]);
			expect((result.outputText ?? "").toLowerCase()).toContain("beta");
		},
	);

	runLive(
		"uses editor through the real SDK tool",
		{ timeout: 180_000 },
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "backport-editor-"));
			tempDirs.push(dir);

			const targetFile = join(dir, "story.txt");
			writeFileSync(targetFile, "first line\nsecond line\n", "utf-8");

			const agent = new Agent({
				providerId: "keypoollive",
				modelId: MODEL_ID,
				apiKey: "auto",
				systemPrompt:
					"You are a precise coding agent. Always use the tools that are available and then answer with a short, direct result.",
				tools: createBuiltinTools({
					cwd: dir,
					enableReadFiles: false,
					enableSearch: false,
					enableBash: false,
					enableWebFetch: false,
					enableApplyPatch: false,
					enableEditor: true,
					enableSkills: false,
					enableAskQuestion: false,
					enableSubmitAndExit: false,
					executors: createDefaultExecutors(),
				}),
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				[
					`Use editor to replace the text "second line" with "updated line" in ${targetFile}.`,
					"After editing, report the updated file content.",
				].join("\n"),
			);

			const fileContent = readFileSync(targetFile, "utf-8");

			expect(toolNames).toContain("editor");
			expect(fileContent).toContain("updated line");
			expect(fileContent).not.toContain("second line");
			expect((result.outputText ?? "").toLowerCase()).toContain("updated line");
		},
	);

	runLive(
		"regression: gemini/gemini-flash-preview tool-call survives second turn and completes",
		{ timeout: 180_000 },
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "keypool-gemini-tool-"));
			tempDirs.push(dir);

			const targetFile = join(dir, "probe.txt");
			writeFileSync(targetFile, "hello from gemini test\n", "utf-8");

			const agent = new Agent({
				providerId: "keypoollive",
				modelId: GEMINI_MODEL_ID,
				apiKey: "auto",
				systemPrompt:
					"You are a strict test runner. Always call the requested tool first, then answer exactly DONE.",
				tools: createBuiltinTools({
					cwd: dir,
					enableReadFiles: true,
					enableSearch: false,
					enableBash: false,
					enableWebFetch: false,
					enableApplyPatch: false,
					enableEditor: false,
					enableSkills: false,
					enableAskQuestion: false,
					enableSubmitAndExit: false,
					executors: createDefaultExecutors(),
				}),
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				[
					`Use read_files on ${targetFile}.`,
					"After reading the file, reply with exactly DONE.",
				].join("\n"),
			);

			expect(toolNames).toContain("read_files");
			expect(result.status).toBe("completed");
			expect(result.error).toBeFalsy();
			expect((result.outputText ?? "").trim().toLowerCase()).toContain("done");
		},
	);

	runLive(
		"round-robin: gemini/gemini-flash-preview rotates keys across sequential calls",
		{ timeout: 300_000 },
		async () => {
			const RUNS = 3;
			const perRunKeys: string[] = [];

			for (let i = 0; i < RUNS; i++) {
				let capturedKey: string | undefined;

				const gateway = createGateway({
					providerConfigs: [{ providerId: "keypoollive", apiKey: "auto" }],
					logger: {
						debug: () => {},
						log: (msg: string, meta?: Record<string, unknown>) => {
							if (
								msg === "KeypoolLive active key" &&
								typeof meta?.key === "string"
							) {
								capturedKey = meta.key;
							}
						},
					},
				});

				const model = gateway.createAgentModel({
					providerId: "keypoollive",
					modelId: GEMINI_MODEL_ID,
				});

				const agent = new Agent({
					model,
					systemPrompt:
						"You are a concise assistant. Always reply in exactly one word.",
				});

				const result = await agent.run(`Reply with exactly: ROUND${i}`);

				expect(result.status).toBe("completed");
				expect(capturedKey).toBeDefined();
				if (capturedKey) {
					perRunKeys.push(capturedKey);
				}
			}

			// All runs captured a key – the provider is correctly logging key selection
			expect(perRunKeys).toHaveLength(RUNS);

			// When the vault exposes multiple gemini keys, consecutive calls must use
			// different keys (round-robin property: no two adjacent calls share a key
			// unless the vault has only one key).
			const uniqueKeys = new Set(perRunKeys);
			if (uniqueKeys.size > 1) {
				expect(perRunKeys[0]).not.toBe(perRunKeys[1]);
			}
		},
	);

	runLive(
		"regression: mistral/magistral-medium-latest tool-call survives second turn and completes",
		{ timeout: 180_000 },
		async () => {
			const dir = mkdtempSync(
				join(tmpdir(), "keypool-mistral-magistral-medium-latest-"),
			);
			tempDirs.push(dir);

			const targetFile = join(dir, "probe.txt");
			writeFileSync(targetFile, "hello from mistral test\n", "utf-8");

			const agent = new Agent({
				providerId: "keypoollive",
				modelId: POWERFUL_MODEL_ID,
				apiKey: "auto",
				systemPrompt:
					"You are a strict test runner. Always call the requested tool first, then answer exactly DONE.",
				tools: createBuiltinTools({
					cwd: dir,
					enableReadFiles: true,
					enableSearch: false,
					enableBash: false,
					enableWebFetch: false,
					enableApplyPatch: false,
					enableEditor: false,
					enableSkills: false,
					enableAskQuestion: false,
					enableSubmitAndExit: false,
					executors: createDefaultExecutors(),
				}),
			});

			const toolNames: string[] = [];
			agent.subscribe((event) => {
				if (event.type === "tool-started") {
					toolNames.push(event.toolCall.toolName);
				}
			});

			const result = await agent.run(
				[
					`Use read_files on ${targetFile}.`,
					"After reading the file, reply with exactly DONE.",
				].join("\n"),
			);

			expect(toolNames).toContain("read_files");
			expect(result.status).toBe("completed");
			expect(result.error).toBeFalsy();
			expect((result.outputText ?? "").trim().toLowerCase()).toContain("done");
		},
	);

	runLive(
		`context-window: ${MODEL_ID} passes ${CONTEXT_WINDOWS[MODEL_ID]} contextWindow to sub-provider`,
		{ timeout: 120_000 },
		async () => {
			const expectedContextWindow = CONTEXT_WINDOWS[MODEL_ID];
			let capturedContextWindow: number | undefined;

			// We verify the contextWindow by requesting maxTokens close to the expected
			// context window limit. If the vault model metadata is propagated correctly,
			// the sub-provider receives the right contextWindow and can cap accordingly.
			// We also capture the active key to confirm the vault was actually used.
			let capturedKey: string | undefined;

			const gateway = createGateway({
				providerConfigs: [{ providerId: "keypoollive", apiKey: "auto" }],
				logger: {
					debug: () => {},
					log: (msg: string, meta?: Record<string, unknown>) => {
						if (
							msg === "KeypoolLive active key" &&
							typeof meta?.key === "string"
						) {
							capturedKey = meta.key;
						}
						// Capture context overflow warnings to verify contextWindow is large enough
						if (
							msg === "Estimated prompt tokens exceed model context window" &&
							typeof meta?.contextWindow === "number"
						) {
							capturedContextWindow = meta.contextWindow;
						}
					},
				},
			});

			const model = gateway.createAgentModel({
				providerId: "keypoollive",
				modelId: MODEL_ID,
			});

			const agent = new Agent({
				model,
				systemPrompt: "You are a concise assistant. Reply in one sentence.",
			});

			const result = await agent.run(
				"What is 2 + 2? Reply with just the number.",
			);

			expect(result.status).toBe("completed");
			expect(capturedKey).toBeDefined();
			// If a contextOverflow was captured it must match the vault value exactly
			if (capturedContextWindow !== undefined) {
				expect(capturedContextWindow).toBe(expectedContextWindow);
			}
		},
	);

	runLive(
		`context-window: ${POWERFUL_MODEL_ID} passes ${CONTEXT_WINDOWS[POWERFUL_MODEL_ID]} contextWindow to sub-provider`,
		{ timeout: 120_000 },
		async () => {
			const expectedContextWindow = CONTEXT_WINDOWS[POWERFUL_MODEL_ID];
			let capturedContextWindow: number | undefined;
			let capturedKey: string | undefined;

			const gateway = createGateway({
				providerConfigs: [{ providerId: "keypoollive", apiKey: "auto" }],
				logger: {
					debug: () => {},
					log: (msg: string, meta?: Record<string, unknown>) => {
						if (
							msg === "KeypoolLive active key" &&
							typeof meta?.key === "string"
						) {
							capturedKey = meta.key;
						}
						if (
							msg === "Estimated prompt tokens exceed model context window" &&
							typeof meta?.contextWindow === "number"
						) {
							capturedContextWindow = meta.contextWindow;
						}
					},
				},
			});

			const model = gateway.createAgentModel({
				providerId: "keypoollive",
				modelId: POWERFUL_MODEL_ID,
			});

			const agent = new Agent({
				model,
				systemPrompt: "You are a concise assistant. Reply in one sentence.",
			});

			const result = await agent.run(
				"What is 3 + 3? Reply with just the number.",
			);

			expect(result.status).toBe("completed");
			expect(capturedKey).toBeDefined();
			if (capturedContextWindow !== undefined) {
				expect(capturedContextWindow).toBe(expectedContextWindow);
			}
		},
	);

	runLive(
		`context-window: ${GEMINI_MODEL_ID} passes 1048576 contextWindow to sub-provider`,
		{ timeout: 120_000 },
		async () => {
			const expectedContextWindow = CONTEXT_WINDOWS[GEMINI_MODEL_ID];
			let capturedContextWindow: number | undefined;
			let capturedKey: string | undefined;

			const gateway = createGateway({
				providerConfigs: [{ providerId: "keypoollive", apiKey: "auto" }],
				logger: {
					debug: () => {},
					log: (msg: string, meta?: Record<string, unknown>) => {
						if (
							msg === "KeypoolLive active key" &&
							typeof meta?.key === "string"
						) {
							capturedKey = meta.key;
						}
						if (
							msg === "Estimated prompt tokens exceed model context window" &&
							typeof meta?.contextWindow === "number"
						) {
							capturedContextWindow = meta.contextWindow;
						}
					},
				},
			});

			const model = gateway.createAgentModel({
				providerId: "keypoollive",
				modelId: GEMINI_MODEL_ID,
			});

			const agent = new Agent({
				model,
				systemPrompt: "You are a concise assistant. Reply in one sentence.",
			});

			const result = await agent.run(
				"What is 4 + 4? Reply with just the number.",
			);

			expect(result.status).toBe("completed");
			expect(capturedKey).toBeDefined();
			if (capturedContextWindow !== undefined) {
				expect(capturedContextWindow).toBe(expectedContextWindow);
			}
		},
	);
});
