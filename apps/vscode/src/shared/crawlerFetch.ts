/**
 * Firecrawl HTTP adapters for the VS Code extension.
 *
 * Mirrors sdk/packages/core/src/extensions/tools/executors/crawler/firecrawl.ts
 * but uses VS Code's proxy-aware fetch from @/shared/net instead of global fetch,
 * as required by the project's network guidelines.
 */

import { fetch } from "@/shared/net";
import type { ResolvedCrawlerConfig } from "@core/keypoollive/types";

export interface WebFetchOptions {
	formats?: Array<
		| { type: "markdown" }
		| { type: "html" }
		| { type: "rawHtml" }
		| { type: "links" }
		| { type: "summary" }
		| { type: "screenshot"; fullPage?: boolean; quality?: number }
		| { type: "json"; schema?: Record<string, unknown>; prompt?: string }
		| { type: "question"; question: string }
		| { type: "highlights"; query: string }
	>;
	onlyMainContent?: boolean;
	onlyCleanContent?: boolean;
	waitFor?: number;
	mobile?: boolean;
	proxy?: "basic" | "enhanced" | "auto";
	headers?: Record<string, string>;
	includeTags?: string[];
	excludeTags?: string[];
	location?: { country: string; languages?: string[] };
	actions?: Array<
		| { type: "click"; selector: string }
		| { type: "write"; text: string }
		| { type: "press"; key: string }
		| { type: "wait"; milliseconds: number }
		| { type: "wait"; selector: string }
		| { type: "scroll"; direction: "up" | "down"; selector?: string }
		| { type: "screenshot" }
		| { type: "executeJavascript"; script: string }
	>;
}

interface FirecrawlScrapeData {
	markdown?: string;
	html?: string;
	rawHtml?: string;
	links?: string[];
	screenshot?: string;
	summary?: string;
	answer?: string;
	highlights?: string;
	metadata?: { title?: string };
	actions?: {
		screenshots?: string[];
		javascriptReturns?: Array<{ type: string; value: unknown }>;
	};
}

function formatFirecrawlResponse(
	url: string,
	prompt: string,
	config: ResolvedCrawlerConfig,
	data: FirecrawlScrapeData,
): string {
	const sections: string[] = [
		`URL: ${url}`,
		`Title: ${data.metadata?.title ?? "N/A"}`,
		`Source: Firecrawl (${config.crawlerName})`,
		``,
	];

	if (data.markdown) {
		sections.push("--- Content (Markdown) ---");
		sections.push(data.markdown.slice(0, 50000));
		if (data.markdown.length > 50000) {
			sections.push(`[Truncated: ${data.markdown.length} total characters]`);
		}
		sections.push("");
	}

	if (data.html) {
		sections.push("--- Content (HTML) ---");
		sections.push(data.html.slice(0, 20000));
		if (data.html.length > 20000) {
			sections.push(`[Truncated: ${data.html.length} total characters]`);
		}
		sections.push("");
	}

	if (data.rawHtml) {
		sections.push("--- Content (Raw HTML) ---");
		sections.push(data.rawHtml.slice(0, 20000));
		if (data.rawHtml.length > 20000) {
			sections.push(`[Truncated: ${data.rawHtml.length} total characters]`);
		}
		sections.push("");
	}

	if (data.links && data.links.length > 0) {
		sections.push("--- Links ---");
		sections.push(data.links.join("\n"));
		sections.push("");
	}

	if (data.screenshot) {
		sections.push("--- Screenshot (URL expires after 24h) ---");
		sections.push(data.screenshot);
		sections.push("");
	}

	if (data.summary) {
		sections.push("--- Summary ---");
		sections.push(data.summary);
		sections.push("");
	}

	if (data.answer) {
		sections.push("--- Answer ---");
		sections.push(data.answer);
		sections.push("");
	}

	if (data.highlights) {
		sections.push("--- Highlights ---");
		sections.push(data.highlights);
		sections.push("");
	}

	if (data.actions?.screenshots && data.actions.screenshots.length > 0) {
		sections.push("--- Action Screenshots (URLs expire after 24h) ---");
		sections.push(data.actions.screenshots.map((s, i) => `[${i + 1}] ${s}`).join("\n"));
		sections.push("");
	}

	if (data.actions?.javascriptReturns && data.actions.javascriptReturns.length > 0) {
		sections.push("--- JavaScript Returns ---");
		sections.push(
			data.actions.javascriptReturns
				.map((r, i) => `[${i + 1}] (${r.type}) ${JSON.stringify(r.value)}`)
				.join("\n"),
		);
		sections.push("");
	}

	sections.push(
		`--- Analysis Prompt ---`,
		`Prompt: ${prompt}`,
	);

	return sections.join("\n");
}

export async function fetchWithFirecrawl(
	url: string,
	prompt: string,
	config: ResolvedCrawlerConfig,
	timeoutMs = 30000,
	options?: WebFetchOptions,
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const requestBody: Record<string, unknown> = {
			url,
			formats: options?.formats ?? [{ type: "markdown" }],
			onlyMainContent: options?.onlyMainContent ?? true,
		};

		if (options?.onlyCleanContent !== undefined) requestBody.onlyCleanContent = options.onlyCleanContent;
		if (options?.waitFor !== undefined) requestBody.waitFor = options.waitFor;
		if (options?.mobile !== undefined) requestBody.mobile = options.mobile;
		if (options?.proxy) requestBody.proxy = options.proxy;
		if (options?.headers && Object.keys(options.headers).length > 0) requestBody.headers = options.headers;
		if (options?.includeTags?.length) requestBody.includeTags = options.includeTags;
		if (options?.excludeTags?.length) requestBody.excludeTags = options.excludeTags;
		if (options?.location) requestBody.location = options.location;
		if (options?.actions?.length) requestBody.actions = options.actions;

		const response = await fetch(`${config.endpoint}/scrape`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify(requestBody),
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
			data?: FirecrawlScrapeData;
			error?: string;
		};

		if (!data.success || !data.data) {
			throw new Error(data.error ?? "Firecrawl: empty response");
		}

		return formatFirecrawlResponse(url, prompt, config, data.data);
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
