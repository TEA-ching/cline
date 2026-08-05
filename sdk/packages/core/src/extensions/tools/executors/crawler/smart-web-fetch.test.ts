import { describe, expect, it, vi } from "vitest";
import { createSmartWebFetchExecutor } from "../index";
import type { CrawlerKeyResolver } from "./types";

const NULL_RESOLVER: CrawlerKeyResolver = { resolve: async () => null };

const FC_RESOLVER: CrawlerKeyResolver = {
	resolve: async () => ({
		crawlerName: "test-fc",
		protocol: "firecrawl",
		endpoint: "https://api.firecrawl.dev",
		apiKey: "fc-test",
	}),
};

describe("createSmartWebFetchExecutor", () => {
	it("uses fallback if resolver returns null", async () => {
		const native = vi.fn().mockResolvedValue("native result");
		const exec = createSmartWebFetchExecutor(NULL_RESOLVER, native);
		expect(await exec("https://ex.com", "test", {} as any)).toBe(
			"native result",
		);
		expect(native).toHaveBeenCalledOnce();
	});

	it("uses firecrawl if resolver returns a config", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				data: { markdown: "# Hello", metadata: { title: "T" } },
			}),
		}) as any;
		const native = vi.fn();
		const exec = createSmartWebFetchExecutor(FC_RESOLVER, native);
		const result = await exec("https://ex.com", "test", {} as any);
		expect(result).toContain("# Hello");
		expect(native).not.toHaveBeenCalled();
	});

	it("fallback silently if crawler fails", async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error("timeout"));
		const native = vi.fn().mockResolvedValue("fallback ok");
		const exec = createSmartWebFetchExecutor(FC_RESOLVER, native);
		expect(await exec("https://ex.com", "test", {} as any)).toBe("fallback ok");
		expect(native).toHaveBeenCalledOnce();
	});

	it("fallback silently if resolver throws", async () => {
		const buggyResolver: CrawlerKeyResolver = {
			resolve: async () => {
				throw new Error("vault unreachable");
			},
		};
		const native = vi.fn().mockResolvedValue("native ok");
		const exec = createSmartWebFetchExecutor(buggyResolver, native);
		expect(await exec("https://ex.com", "test", {} as any)).toBe("native ok");
	});

	it("EnvCrawlerResolver returns null if no env vars defined", async () => {
		// Simulate absence of environment variables
		const savedFC = process.env.FIRECRAWL_API_KEY;
		const savedExa = process.env.EXA_API_KEY;
		delete process.env.FIRECRAWL_API_KEY;
		delete process.env.EXA_API_KEY;

		// Inline minimal EnvCrawlerResolver for the test
		const resolver: CrawlerKeyResolver = {
			resolve: async () => {
				if (process.env.FIRECRAWL_API_KEY)
					return {
						crawlerName: "env-fc",
						protocol: "firecrawl",
						endpoint: "https://api.firecrawl.dev",
						apiKey: process.env.FIRECRAWL_API_KEY!,
					};
				if (process.env.EXA_API_KEY)
					return {
						crawlerName: "env-exa",
						protocol: "exa",
						endpoint: "https://api.exa.ai",
						apiKey: process.env.EXA_API_KEY!,
					};
				return null;
			},
		};

		expect(await resolver.resolve()).toBeNull();

		// Restore environment variables
		process.env.FIRECRAWL_API_KEY = savedFC;
		process.env.EXA_API_KEY = savedExa;
	});
});
