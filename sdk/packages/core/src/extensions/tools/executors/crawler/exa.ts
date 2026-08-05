import type { ResolvedCrawlerConfig } from "./types";

export async function fetchWithExa(
	url: string,
	prompt: string,
	config: ResolvedCrawlerConfig,
	timeoutMs = 30000,
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${config.endpoint}/contents`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": config.apiKey, // Exa: x-api-key, not Authorization
			},
			body: JSON.stringify({
				ids: [url],
				contents: { text: { maxCharacters: 50000 }, livecrawl: "preferred" },
			}),
			signal: controller.signal,
		});

		clearTimeout(timer);

		if (!response.ok) {
			throw new Error(`Exa HTTP ${response.status}: ${response.statusText}`);
		}

		const data = (await response.json()) as {
			results?: Array<{
				url: string;
				title?: string;
				text?: string;
				publishedDate?: string;
			}>;
		};

		const result = data.results?.[0];
		if (!result?.text) throw new Error("Exa: no content returned");

		return [
			`URL: ${result.url}`,
			`Title: ${result.title ?? "N/A"}`,
			`Published: ${result.publishedDate ?? "N/A"}`,
			`Source: Exa (${config.crawlerName})`,
			``,
			`--- Content ---`,
			result.text,
			``,
			`--- Analysis Prompt ---`,
			`Prompt: ${prompt}`,
		].join("\n");
	} finally {
		clearTimeout(timer);
	}
}
