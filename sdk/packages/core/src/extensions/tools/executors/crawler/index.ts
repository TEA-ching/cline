/**
 * createSmartWebFetchExecutor
 *
 * Wraps a native WebFetchExecutor with a crawler resolver.
 * Automatically dispatches to Firecrawl or Exa based on the resolved protocol.
 * Silently falls back to native fetch if:
 *   - the resolver returns null (no key available)
 *   - the crawler fails (network error, quota, etc.)
 *
 * No dependency on KeypoolLive or apps/vscode.
 */

import type { AgentToolContext } from "@sctg/cline-shared";
import type { WebFetchExecutor, WebSearchExecutor } from "../../types";
import { fetchWithExa } from "./exa";
import { fetchWithFirecrawl, searchWithFirecrawl } from "./firecrawl";
import type { CrawlerKeyResolver } from "./types";

export type {
	CrawlerKeyResolver,
	CrawlerProtocol,
	ResolvedCrawlerConfig,
} from "./types";

export function createSmartWebFetchExecutor(
	resolver: CrawlerKeyResolver,
	nativeExecutor: WebFetchExecutor,
	timeoutMs = 30000,
): WebFetchExecutor {
	return async (url, prompt, context, options) => {
		// 1. Ask the resolver for a key (cache handled by resolver implementation)
		let config;
		try {
			config = await resolver.resolve();
		} catch (resolverErr) {
			console.warn(
				"[SmartWebFetch] Resolver threw, native fallback:",
				resolverErr instanceof Error
					? resolverErr.message
					: String(resolverErr),
			);
			return nativeExecutor(url, prompt, context, options);
		}

		if (!config) {
			console.warn(
				"[SmartWebFetch] Resolver returned null (no crawler key available), native fallback",
			);
			return nativeExecutor(url, prompt, context, options);
		}

		// 2. Dispatch based on protocol
		try {
			switch (config.protocol) {
				case "firecrawl":
					console.log(
						`[SmartWebFetch] Using Firecrawl (${config.crawlerName}) for ${url}`,
					);
					return await fetchWithFirecrawl(
						url,
						prompt,
						config,
						timeoutMs,
						options,
					);
				case "exa":
					console.log(
						`[SmartWebFetch] Using Exa (${config.crawlerName}) for ${url}`,
					);
					return await fetchWithExa(url, prompt, config, timeoutMs);
				case "scrapegraphai":
					// Adapter not implemented in this version
					console.warn(
						"[SmartWebFetch] scrapegraphai not implemented, native fallback",
					);
					return nativeExecutor(url, prompt, context, options);
				default: {
					// Runtime protection if an out-of-contract protocol appears
					console.warn(
						`[SmartWebFetch] Unsupported protocol: ${String(config.protocol)}, fallback`,
					);
					return nativeExecutor(url, prompt, context, options);
				}
			}
		} catch (crawlerError) {
			// 3. Crawler failed -> native fallback
			const hint = config.apiKey.slice(-6);
			console.warn(
				`[SmartWebFetch] ${config.protocol}/${config.crawlerName} (...${hint}) failed:`,
				crawlerError instanceof Error
					? crawlerError.message
					: String(crawlerError),
			);
			return nativeExecutor(url, prompt, context, options);
		}
	};
}

/**
 * Create a web search executor using Firecrawl
 *
 * @param resolver - Crawler key resolver
 * @param timeoutMs - Timeout in milliseconds
 * @returns WebSearchExecutor that uses Firecrawl for web searches
 */
export function createWebSearchExecutor(
	resolver: CrawlerKeyResolver,
	timeoutMs = 30000,
): WebSearchExecutor {
	return async (
		request: {
			query: string;
			allowed_domains?: string[];
			blocked_domains?: string[];
		},
		_context: AgentToolContext,
	): Promise<string> => {
		// 1. Ask the resolver for a key
		let config;
		try {
			config = await resolver.resolve();
		} catch (resolverErr) {
			console.warn(
				"[WebSearch] Resolver threw:",
				resolverErr instanceof Error
					? resolverErr.message
					: String(resolverErr),
			);
			throw new Error("No crawler key available for web search");
		}

		if (!config) {
			console.warn(
				"[WebSearch] Resolver returned null (no crawler key available)",
			);
			throw new Error("No crawler key available for web search");
		}

		// 2. Use Firecrawl for web search
		try {
			if (config.protocol === "firecrawl") {
				console.log(
					`[WebSearch] Using Firecrawl (${config.crawlerName}) for query: ${request.query}`,
				);

				// Always use search (not fetch) since we only have query now
				return await searchWithFirecrawl(
					request.query,
					"Extract relevant information from search results",
					config,
					timeoutMs,
					request.allowed_domains,
					request.blocked_domains,
				);
			} else {
				throw new Error(
					`Unsupported protocol for web search: ${String(config.protocol)}`,
				);
			}
		} catch (crawlerError) {
			const hint = config.apiKey.slice(-6);
			console.warn(
				`[WebSearch] ${config.protocol}/${config.crawlerName} (...${hint}) failed:`,
				crawlerError instanceof Error
					? crawlerError.message
					: String(crawlerError),
			);
			throw new Error(
				`Web search failed: ${crawlerError instanceof Error ? crawlerError.message : String(crawlerError)}`,
			);
		}
	};
}
