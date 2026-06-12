/**
 * VaultCrawlerKeyResolver — picks a crawler key from the KeypoolLive vault.
 *
 * Implements the same CrawlerKeyResolver interface contract as the SDK's
 * KeypoolCrawlerResolver (@cline/llms) but is VS Code-native:
 *   - Uses VS Code's proxy-aware fetch (via AiVault which imports @/shared/net)
 *   - Gets vault URL + secret from env vars (KEYPOOL_VAULT_URL / KEYPOOL_LIVE_SECRET)
 *
 * Enhanced with load balancing: selects keys based on remaining credits,
 * with concurrent credit checking and 5-minute caching.
 */
import { loadAiVault } from "./AiVault";
import type { ResolvedCrawlerConfig, VaultCrawler, VaultCrawlerKey } from "./types";
import { fetch } from "@/shared/net";

export interface CrawlerKeyResolver {
	resolve(): Promise<ResolvedCrawlerConfig | null>;
}

// Credit cache entry with TTL
interface CreditCacheEntry {
	remainingCredits: number;
	timestamp: number;
}

// Global credit cache with 5-minute TTL
const CREDIT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const creditCache = new Map<string, CreditCacheEntry>();

export class VaultCrawlerKeyResolver implements CrawlerKeyResolver {
	constructor(private readonly vaultUrl: string) {}

	async resolve(): Promise<ResolvedCrawlerConfig | null> {
		let vault;
		try {
			vault = await loadAiVault(this.vaultUrl);
		} catch {
			return null;
		}

		const crawlers = vault.crawlers;
		if (!crawlers) return null;

		// Get all usable keys from all crawlers
		const allKeys: { crawlerName: string; crawler: VaultCrawler; key: VaultCrawlerKey }[] = [];

		for (const [crawlerName, crawler] of Object.entries(crawlers)) {
			const usable = crawler.keys.filter((k) => k.type !== "expired");
			allKeys.push(...usable.map(key => ({
				crawlerName,
				crawler,
				key
			})));
		}

		if (allKeys.length === 0) return null;

		// Check credits for all keys concurrently and select the one with most remaining credits
		const keysWithCredits = await this.checkCreditsConcurrently(allKeys);
		if (keysWithCredits.length === 0) return null;

		// Sort by remaining credits (descending) and pick the first
		keysWithCredits.sort((a, b) => b.remainingCredits - a.remainingCredits);
		const bestKey = keysWithCredits[0];

		return {
			crawlerName: bestKey.crawlerName,
			protocol: bestKey.crawler.protocol,
			endpoint: bestKey.crawler.endpoint,
			apiKey: bestKey.key.key,
			keyOwner: bestKey.key.owner,
		};
	}

	/**
	 * Check credits for multiple keys concurrently
	 */
	private async checkCreditsConcurrently(keys: { crawlerName: string; crawler: VaultCrawler; key: VaultCrawlerKey }[]): Promise<{ crawlerName: string; crawler: VaultCrawler; key: VaultCrawlerKey; remainingCredits: number }[]> {
		// Check cache first
		const cachedResults: { key: VaultCrawlerKey; remainingCredits: number }[] = [];
		const keysToFetch: { crawlerName: string; crawler: VaultCrawler; key: VaultCrawlerKey }[] = [];

		for (const { key } of keys) {
			const cacheKey = key.key;
			const cached = creditCache.get(cacheKey);

			if (cached && Date.now() - cached.timestamp < CREDIT_CACHE_TTL_MS) {
				cachedResults.push({ key, remainingCredits: cached.remainingCredits });
			} else {
				keysToFetch.push({ crawlerName: "", crawler: { protocol: "firecrawl", endpoint: "", keys: [] }, key });
			}
		}

		// Fetch credits for uncached keys concurrently
		const fetchPromises = keysToFetch.map(async ({ key }) => {
			try {
				const remainingCredits = await this.fetchRemainingCredits(key.key);
				// Update cache
				creditCache.set(key.key, {
					remainingCredits,
					timestamp: Date.now()
				});
				return { key, remainingCredits };
			} catch (error) {
				console.error(`Failed to fetch credits for key ${key.key}:`, error);
				// If we can't fetch credits, assume it has some credits available
				// but give it lower priority than cached keys
				return { key, remainingCredits: 1 };
			}
		});

		const fetchedResults = await Promise.all(fetchPromises);
		return [...cachedResults, ...fetchedResults].map(result => {
			// Find the original key info
			const original = keys.find(k => k.key.key === result.key.key);
			return {
				crawlerName: original?.crawlerName || "",
				crawler: original?.crawler || { protocol: "firecrawl", endpoint: "", keys: [] },
				key: result.key,
				remainingCredits: result.remainingCredits
			};
		});
	}

	/**
	 * Fetch remaining credits for a specific key from Firecrawl API
	 */
	private async fetchRemainingCredits(apiKey: string): Promise<number> {
		try {
			const response = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
				headers: {
					"authorization": `Bearer ${apiKey}`,
				},
				method: "GET",
				mode: "cors",
				credentials: "include"
			});

			if (!response.ok) {
				throw new Error(`API request failed with status ${response.status}`);
			}

			const data = await response.json();

			if (data.success && data.data && typeof data.data.remainingCredits === 'number') {
				return data.data.remainingCredits;
			} else {
				throw new Error("Invalid API response format");
			}
		} catch (error) {
			console.error(`Error fetching credits:`, error);
			// Return a default value if we can't fetch credits
			return 1;
		}
	}
}

/**
 * Returns a resolver if KEYPOOL_VAULT_URL is set, null otherwise.
 * Centralises the env-var check so handlers stay clean.
 */
export function createVaultCrawlerResolver(): CrawlerKeyResolver | null {
	const vaultUrl = process.env.KEYPOOL_VAULT_URL;
	if (!vaultUrl) return null;
	return new VaultCrawlerKeyResolver(vaultUrl);
}
