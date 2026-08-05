/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 */

// Empirically calibrated chars-per-token ratios by model family.
// Claude / GPT / Gemini tokenizers all land in the 3.5–4.5 range for
// typical prose; code is denser (~3–3.5 chars/token).

type ModelFamily = 'claude' | 'gpt' | 'gemini' | 'mistral' | 'llama' | 'default'

function detectFamily(modelId: string): ModelFamily {
  const id = modelId.toLowerCase()
  if (id.includes('claude')) return 'claude'
  if (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return 'gpt'
  if (id.includes('gemini')) return 'gemini'
  if (id.includes('mistral') || id.includes('mixtral')) return 'mistral'
  if (id.includes('llama') || id.includes('meta-llama')) return 'llama'
  return 'default'
}

// { prose, code } = average chars per token for each content type
const CPT: Record<ModelFamily, { prose: number; code: number }> = {
  claude:  { prose: 4.0, code: 3.5 },
  gpt:     { prose: 3.8, code: 3.3 },
  gemini:  { prose: 4.2, code: 3.8 },
  mistral: { prose: 3.6, code: 3.2 },
  llama:   { prose: 3.8, code: 3.4 },
  default: { prose: 4.0, code: 3.5 },
}

/**
 * Estimate the number of tokens in `text` for the given model.
 *
 * - Fenced code blocks (``` ... ```) are handled separately because they
 *   tokenise more densely than prose.
 * - Falls back to `modelId = ''` (default family) when not provided.
 * - Always returns at least 1.
 */
export function estimateTokens(text: string, modelId = ''): number {
  if (!text) return 0
  const { prose, code } = CPT[detectFamily(modelId)]

  let remaining = text
  let codeTokens = 0

  // Extract fenced code blocks to apply the denser ratio
  const codeBlockRe = /```[\s\S]*?```/g
  for (const match of text.matchAll(codeBlockRe)) {
    codeTokens += Math.ceil(match[0].length / code)
    remaining = remaining.replace(match[0], '')
  }

  return Math.max(1, Math.ceil(remaining.length / prose) + codeTokens)
}
