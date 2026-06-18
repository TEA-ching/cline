/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
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
