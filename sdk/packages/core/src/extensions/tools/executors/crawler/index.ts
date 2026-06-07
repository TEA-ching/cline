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

import type { AgentToolContext } from '@cline/shared';
import type { WebFetchExecutor } from '../../types';
import { fetchWithExa } from './exa';
import { fetchWithFirecrawl } from './firecrawl';
import type { CrawlerKeyResolver } from './types';

export type { CrawlerKeyResolver, CrawlerProtocol, ResolvedCrawlerConfig } from './types';

export function createSmartWebFetchExecutor(
  resolver: CrawlerKeyResolver,
  nativeExecutor: WebFetchExecutor,
  timeoutMs = 30000,
): WebFetchExecutor {
  return async (url: string, prompt: string, context: AgentToolContext): Promise<string> => {

    // 1. Ask the resolver for a key (cache handled by resolver implementation)
    let config;
    try {
      config = await resolver.resolve();
    } catch (resolverErr) {
      console.warn('[SmartWebFetch] Resolver threw, native fallback:', resolverErr instanceof Error ? resolverErr.message : String(resolverErr));
      return nativeExecutor(url, prompt, context);
    }

    if (!config) {
      console.warn('[SmartWebFetch] Resolver returned null (no crawler key available), native fallback');
      return nativeExecutor(url, prompt, context);
    }

    // 2. Dispatch based on protocol
    try {
      switch (config.protocol) {
        case 'firecrawl':
          console.log(`[SmartWebFetch] Using Firecrawl (${config.crawlerName}) for ${url}`);
          return await fetchWithFirecrawl(url, prompt, config, timeoutMs);
        case 'exa':
          console.log(`[SmartWebFetch] Using Exa (${config.crawlerName}) for ${url}`);
          return await fetchWithExa(url, prompt, config, timeoutMs);
        case 'scrapegraphai':
          // Adapter not implemented in this version
          console.warn('[SmartWebFetch] scrapegraphai not implemented, native fallback');
          return nativeExecutor(url, prompt, context);
        default: {
          // Runtime protection if an out-of-contract protocol appears
          console.warn(`[SmartWebFetch] Unsupported protocol: ${String(config.protocol)}, fallback`);
          return nativeExecutor(url, prompt, context);
        }
      }
    } catch (crawlerError) {
      // 3. Crawler failed -> native fallback
      const hint = config.apiKey.slice(-6);
      console.warn(
        `[SmartWebFetch] ${config.protocol}/${config.crawlerName} (...${hint}) failed:`,
        crawlerError instanceof Error ? crawlerError.message : String(crawlerError),
      );
      return nativeExecutor(url, prompt, context);
    }
  };
}
