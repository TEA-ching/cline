import type { ResolvedCrawlerConfig } from './types';

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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Firecrawl HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as {
      success: boolean;
      data?: { markdown?: string; metadata?: { title?: string } };
      error?: string;
    };

    if (!data.success || !data.data?.markdown) {
      throw new Error(data.error ?? 'Firecrawl: empty response');
    }

    // Get remaining credits from GET /team/credit-usage
    const creditResponse = await fetch(`${config.endpoint}/team/credit-usage`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    let creditsInfo = '';
    if (creditResponse.ok) {
      const creditData = await creditResponse.json() as { success: boolean; data?: { remainingCredits: number } };
      if (creditData.success && creditData.data) {
        creditsInfo = ` (remaining credits: ${creditData.data.remainingCredits})`;
      }
    }

    const { markdown, metadata } = data.data;
    return [
      `URL: ${url}`,
      `Title: ${metadata?.title ?? 'N/A'}`,
      `Source: Firecrawl (${config.crawlerName})`,
      ``,
      `--- Content (Markdown) ---`,
      markdown.slice(0, 50000),
      ...(markdown.length > 50000
        ? [`\n[Truncated: ${markdown.length} total characters]`]
        : []),
      ``,
      `--- Analysis Prompt with Firecrawl (remaining key: ${config.apiKey.slice(0, 5)}...${config.apiKey.slice(-5)} credits: ${creditsInfo})---`,
      `Prompt: ${prompt}`,
    ].join('\n');

  } finally {
    clearTimeout(timer);
  }
}
