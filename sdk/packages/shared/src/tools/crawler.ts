/** Supported crawling protocols */
export type CrawlerProtocol = "firecrawl" | "exa" | "scrapegraphai";

/** Resolved crawler key config, ready to use. */
export interface ResolvedCrawlerConfig {
	crawlerName: string;
	protocol: CrawlerProtocol;
	endpoint: string;
	apiKey: string;
	keyOwner?: string;
}

/**
 * Resolver interface injected into WebFetchExecutorOptions.
 * Returns null if no crawler is available → fallback to native fetch.
 */
export interface CrawlerKeyResolver {
	resolve(): Promise<ResolvedCrawlerConfig | null>;
}
