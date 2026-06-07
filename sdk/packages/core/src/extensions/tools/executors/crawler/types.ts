/**
 * Types shared for crawler integration in fetch_web_content.
 *
 * The SDK defines the contract (CrawlerKeyResolver) but does not provide
 * implementation tied to KeypoolLive - that's the role of the consumer (VS Code, CLI).
 */

/** Crawling protocols supported by built-in adapters */
export type CrawlerProtocol = 'firecrawl' | 'exa' | 'scrapegraphai';

/**
 * Configuration for a resolved crawler key, ready for use.
 * This is what the SDK consumes - it doesn't know how this config was obtained.
 */
export interface ResolvedCrawlerConfig {
  /** Logical name of the pool (e.g., "firecrawl", for logging) */
  crawlerName: string;
  /** Protocol to use for choosing the adapter */
  protocol: CrawlerProtocol;
  /** Base URL of the crawler API (without trailing slash) */
  endpoint: string;
  /** Selected API key */
  apiKey: string;
  /** Owner of the key (for logging, never logged in full) */
  keyOwner?: string;
}

/**
 * Interface for the resolver injected into WebFetchExecutorOptions.
 *
 * Called on each fetch - should be fast (implementations should cache).
 * Returns null if no crawler is available -> fallback to native fetch.
 *
 * @example KeypoolLive implementation (VS Code):
 * ```typescript
 * const resolver: CrawlerKeyResolver = new KeypoolCrawlerResolver(vaultUrl);
 * ```
 */
export interface CrawlerKeyResolver {
  resolve(): Promise<ResolvedCrawlerConfig | null>;
}
