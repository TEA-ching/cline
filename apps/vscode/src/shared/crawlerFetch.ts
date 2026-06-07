/**
 * Firecrawl HTTP adapters for the VS Code extension.
 *
 * Mirrors sdk/packages/core/src/extensions/tools/executors/crawler/firecrawl.ts
 * but uses VS Code's proxy-aware fetch from @/shared/net instead of global fetch,
 * as required by the project's network guidelines.
 */

import { fetch } from "@/shared/net";
import type { ResolvedCrawlerConfig } from "@core/keypoollive/types";

export async function fetchWithFirecrawl(
	url: string,
	prompt: string,
	config: ResolvedCrawlerConfig,
	timeoutMs = 30000,
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${config.endpoint}/scrape`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({
				url,
				formats: ["markdown"],
				onlyMainContent: true,
			}),
			signal: controller.signal,
		});

		clearTimeout(timer);

		if (!response.ok) {
			throw new Error(
				`Firecrawl HTTP ${response.status}: ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			success: boolean;
			data?: { markdown?: string; metadata?: { title?: string } };
			error?: string;
		};

		if (!data.success || !data.data?.markdown) {
			throw new Error(data.error ?? "Firecrawl: empty response");
		}

		const { markdown, metadata } = data.data;
		return [
			`URL: ${url}`,
			`Title: ${metadata?.title ?? "N/A"}`,
			`Source: Firecrawl (${config.crawlerName})`,
			``,
			`--- Content (Markdown) ---`,
			markdown.slice(0, 50000),
			...(markdown.length > 50000
				? [`\n[Truncated: ${markdown.length} total characters]`]
				: []),
			``,
			`--- Analysis Prompt ---`,
			`Prompt: ${prompt}`,
		].join("\n");
	} finally {
		clearTimeout(timer);
	}
}

export async function searchWithFirecrawl(
	query: string,
	prompt: string,
	config: ResolvedCrawlerConfig,
	timeoutMs = 30000,
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${config.endpoint}/search`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({
				query,
				limit: 5,
				scrapeOptions: {
					formats: [{ type: "markdown" }],
					onlyMainContent: true,
				},
			}),
			signal: controller.signal,
		});

		clearTimeout(timer);

		if (!response.ok) {
			throw new Error(
				`Firecrawl HTTP ${response.status}: ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			success: boolean;
			data?: {
				web?: Array<{
					url?: string;
					title?: string;
					description?: string;
					markdown?: string | null;
				}>;
			};
			error?: string;
		};

		if (!data.success) {
			throw new Error(data.error ?? "Firecrawl search: empty response");
		}

		const results = data.data?.web ?? [];
		if (results.length === 0) {
			return `No results found for query: "${query}"`;
		}

		const sections = results.map((result, i) => {
			const lines = [
				`### Result ${i + 1}: ${result.title ?? "Untitled"}`,
				`URL: ${result.url ?? "N/A"}`,
			];
			if (result.description) {
				lines.push(`Description: ${result.description}`);
			}
			if (result.markdown) {
				const content = result.markdown.slice(0, 10000);
				lines.push("", "--- Content ---", content);
				if (result.markdown.length > 10000) {
					lines.push(
						`[Truncated: ${result.markdown.length} total characters]`,
					);
				}
			}
			return lines.join("\n");
		});

		return [
			`Query: ${query}`,
			`Source: Firecrawl search (${config.crawlerName})`,
			`Results: ${results.length}`,
			"",
			sections.join("\n\n"),
			"",
			`--- Analysis Prompt ---`,
			`Prompt: ${prompt}`,
		].join("\n");
	} finally {
		clearTimeout(timer);
	}
}
