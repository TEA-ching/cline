import { describe, expect, it } from 'vitest';
import { createSmartWebFetchExecutor, createWebFetchExecutor } from '../extensions/tools/executors/index';
import type { CrawlerKeyResolver } from '../extensions/tools/executors/crawler/types';

describe('Smart Web Fetch Integration Tests', () => {
  const HAS_FC = Boolean(process.env.FIRECRAWL_API_KEY);
  const HAS_EXA = Boolean(process.env.EXA_API_KEY);
  const LIVE = process.env.CORE_LIVE_CRAWLER_TESTS === '1';
  const run = (cond: boolean) => (LIVE && cond ? it : it.skip);

  function makeEnvResolver(): CrawlerKeyResolver {
    return {
      resolve: async () => {
        if (process.env.FIRECRAWL_API_KEY) {
          return { crawlerName: 'env-fc', protocol: 'firecrawl', endpoint: process.env.FIRECRAWL_ENDPOINT ?? 'https://api.firecrawl.dev', apiKey: process.env.FIRECRAWL_API_KEY };
        }
        if (process.env.EXA_API_KEY) {
          return { crawlerName: 'env-exa', protocol: 'exa', endpoint: process.env.EXA_ENDPOINT ?? 'https://api.exa.ai', apiKey: process.env.EXA_API_KEY };
        }
        return null;
      },
    };
  }

  run(HAS_FC || HAS_EXA)(
    'smart executor fetches a real URL via crawler',
    { timeout: 30_000 },
    async () => {
      const nativeExecutor = createWebFetchExecutor();
      const smartExecutor = createSmartWebFetchExecutor(makeEnvResolver(), nativeExecutor);
      const result = await smartExecutor('https://example.com', 'summarize', {} as any);
      expect(result).toContain('example.com');
      expect(result.length).toBeGreaterThan(100);
      // Verify that it's actually the crawler that responded (not native fetch)
      expect(result).toMatch(/Source: (Firecrawl|Exa)/);
    },
  );

  run(true)(
    'smart executor falls back to native fetch if no key',
    { timeout: 15_000 },
    async () => {
      const noopResolver: CrawlerKeyResolver = { resolve: async () => null };
      const nativeExecutor = createWebFetchExecutor();
      const smartExecutor = createSmartWebFetchExecutor(noopResolver, nativeExecutor);
      const result = await smartExecutor('https://example.com', 'summarize', {} as any);
      expect(result).toContain('example.com');
      // No "Source: Firecrawl" marker -> it's the native fetch
      expect(result).not.toMatch(/Source: (Firecrawl|Exa)/);
    },
  );
});
