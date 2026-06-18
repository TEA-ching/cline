import type { AiConfig, AiModel } from '@/types/ai-config'

export function modelSupportsImages(model: AiModel): boolean {
  return model.supportsImages === true || model.inputModalities?.includes('image') === true
}

export function modelSupportsTools(model: AiModel): boolean {
  return model.supportsTools !== false
}

/** Returns all chat-capable models across all providers, sorted by priority. */
export function listChatModels(config: AiConfig): Array<{ providerId: string; model: AiModel }> {
  return Object.entries(config.providers)
    .flatMap(([providerId, provider]) =>
      provider.models
        .filter(m => m.usage === 'chat')
        .map(model => ({ providerId, model }))
    )
    .sort((a, b) => a.model.priority - b.model.priority)
}

/** Returns Firecrawl keys from the vault, round-robin by call count. */
export function getFirecrawlKeys(config: AiConfig): string[] {
  return Object.values(config.crawlers)
    .filter(c => c.protocol === 'firecrawl')
    .flatMap(c => c.keys.map(k => k.key))
}
