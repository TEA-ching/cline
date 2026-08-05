// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import { z } from 'zod'
import type { AiConfig } from '@/types/ai-config'

const AiKeySchema = z.object({
  key: z.string(),
  owner: z.string().optional(),
  type: z.enum(['expired', 'free', 'paid', 'premium', 'unlimited']).optional(),
  sharedSecret: z.string().optional(),
  signatureType: z.enum(['hmac-md5', 'hmac-sha256', 'hmac-sha512']).optional(),
})

const AiModelSchema = z.object({
  id: z.string(),
  usage: z.enum(['chat', 'embedding', 'transcription', 'tts', 'image-generation']),
  contextWindow: z.number(),
  maxOutputTokens: z.number(),
  tpmLimit: z.number().nullable(),
  priority: z.number(),
  tags: z.array(z.string()).optional(),
  gatewayPrefix: z.string().optional(),
  inputModalities: z.array(z.enum(['text', 'image', 'audio', 'video'])).optional(),
  outputModalities: z.array(z.enum(['text', 'image', 'audio'])).optional(),
  supportsImages: z.boolean().optional(),
  supportsPromptCache: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
})

const AiProviderSchema = z.object({
  protocol: z.enum(['openai', 'groq', 'sambanova', 'anthropic', 'gemini', 'mistral', 'openrouter', 'morph', 'cohere', 'poolside']),
  endpoint: z.string(),
  gatewayEndpoint: z.string().optional(),
  gatewayModelPrefix: z.string().optional(),
  gatewayKey: z.string().optional(),
  keys: z.array(AiKeySchema),
  models: z.array(AiModelSchema),
  modelCardEndpoint: z.string().optional(),
  userAgent: z.string().optional(),
})

const CrawlerSchema = z.object({
  protocol: z.enum(['firecrawl', 'exa', 'scrapegraphai']),
  endpoint: z.string(),
  keys: z.array(AiKeySchema),
})

const WeatherApiSchema = z.object({
  protocol: z.object({ protocol: z.literal('meteoblue') }),
  endpoint: z.string(),
  keys: z.array(AiKeySchema),
})

export const AiConfigSchema = z.object({
  version: z.number(),
  providers: z.record(z.string(), AiProviderSchema),
  crawlers: z.record(z.string(), CrawlerSchema),
  weatherApi: WeatherApiSchema.optional(),
})

export function parseAiConfig(raw: unknown): AiConfig {
  const result = AiConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Configuration invalide : ${issues}`)
  }
  return result.data as AiConfig
}
