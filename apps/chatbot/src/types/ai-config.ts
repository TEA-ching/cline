// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

export type AiProtocol =
  | 'openai'
  | 'groq'
  | 'sambanova'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'morph'
  | 'cohere'

export type CrawlerProtocol = 'firecrawl' | 'exa' | 'scrapegraphai'

export type AiModalityInput = 'text' | 'image' | 'audio' | 'video'
export type AiModalityOutput = 'text' | 'image' | 'audio'

export interface AiKey {
  key: string
  owner?: string
  type?: 'expired' | 'free' | 'paid' | 'premium' | 'unlimited'
}

export interface AiModel {
  id: string
  usage: 'chat' | 'embedding' | 'transcription' | 'tts' | 'image-generation'
  contextWindow: number
  maxOutputTokens: number
  tpmLimit: number | null
  priority: number
  tags?: string[]
  gatewayPrefix?: string
  inputModalities?: AiModalityInput[]
  outputModalities?: AiModalityOutput[]
  supportsImages?: boolean
  supportsPromptCache?: boolean
  supportsTools?: boolean
  supportsReasoning?: boolean
}

export interface AiProvider {
  protocol: AiProtocol
  endpoint: string
  gatewayEndpoint?: string
  gatewayModelPrefix?: string
  gatewayKey?: string
  keys: AiKey[]
  models: AiModel[]
  modelCardEndpoint?: string
  userAgent?: string
}

export interface Crawler {
  protocol: CrawlerProtocol
  endpoint: string
  keys: AiKey[]
}

export interface AiConfig {
  version: number
  providers: Record<string, AiProvider>
  crawlers: Record<string, Crawler>
}
