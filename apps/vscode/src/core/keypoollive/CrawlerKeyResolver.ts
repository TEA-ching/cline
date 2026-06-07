/**
 * VaultCrawlerKeyResolver — picks a crawler key from the KeypoolLive vault.
 *
 * Implements the same CrawlerKeyResolver interface contract as the SDK's
 * KeypoolCrawlerResolver (@cline/llms) but is VS Code-native:
 *   - Uses VS Code's proxy-aware fetch (via AiVault which imports @/shared/net)
 *   - Gets vault URL + secret from env vars (KEYPOOL_VAULT_URL / KEYPOOL_LIVE_SECRET)
 *
 * Kept intentionally stateless — key health tracking is delegated to the
 * existing KeyPool module which already handles round-robin and cooldowns.
 */

import { loadAiVault } from "./AiVault";
import type { ResolvedCrawlerConfig } from "./types";

export interface CrawlerKeyResolver {
	resolve(): Promise<ResolvedCrawlerConfig | null>;
}

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

		for (const [crawlerName, crawler] of Object.entries(crawlers)) {
			const usable = crawler.keys.filter((k) => k.type !== "expired");
			if (usable.length === 0) continue;
			const key = usable[0];
			return {
				crawlerName,
				protocol: crawler.protocol,
				endpoint: crawler.endpoint,
				apiKey: key.key,
				keyOwner: key.owner,
			};
		}

		return null;
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
