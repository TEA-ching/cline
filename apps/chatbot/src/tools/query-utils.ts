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

const FR_WORDS = new Set([
  'je', 'tu', 'il', 'nous', 'vous', 'ils', 'le', 'la', 'les', 'un', 'une', 'des',
  'et', 'ou', 'est', 'sont', 'avec', 'pour', 'dans', 'sur', 'pas', 'plus', 'très',
  'mais', 'comment', 'quoi', 'qui', 'que', 'quand', 'où', 'pourquoi', 'quel',
  'quelle', 'quels', 'quelles', 'meilleur', 'meilleure', 'comparer', 'comparaison',
  'cette', 'cet', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
])

function detectLanguage(text: string): 'fr' | 'en' {
  const words = text.toLowerCase().split(/\s+/)
  const frCount = words.filter(w => FR_WORDS.has(w)).length
  return frCount >= 2 ? 'fr' : 'en'
}

const COMPARISON_WORDS = [
  'vs', 'versus', 'compare', 'comparison', 'meilleur', 'best', 'top',
  'difference', 'différence', 'comparaison', 'contre', 'ou bien',
]
const HOWTO_WORDS = [
  'how', 'comment', 'tutorial', 'guide', 'setup', 'install', 'configure',
  'exemple', 'example', 'howto', 'implement', 'implémenter',
]
const REVIEW_WORDS = [
  'review', 'avis', 'test', 'benchmark', 'performance', 'vitesse', 'speed',
  'rating', 'évaluation', 'evaluation', 'recommande',
]

function detectIntent(question: string): 'comparison' | 'howto' | 'review' | 'general' {
  const lower = question.toLowerCase()
  if (COMPARISON_WORDS.some(w => lower.includes(w))) return 'comparison'
  if (HOWTO_WORDS.some(w => lower.includes(w))) return 'howto'
  if (REVIEW_WORDS.some(w => lower.includes(w))) return 'review'
  return 'general'
}

/**
 * Generate 2-5 search query variants from a user question.
 * Detects language (FR/EN) and intent to produce contextually relevant expansions.
 */
export function expandQuery(question: string, opts: { year: number }): string[] {
  const lang = detectLanguage(question)
  const intent = detectIntent(question)
  const { year } = opts
  const hasYear = question.includes(String(year))
  const variants: string[] = [question]

  if (!hasYear) {
    variants.push(`${question} ${year}`)
  }

  switch (intent) {
    case 'comparison':
      variants.push(
        lang === 'fr'
          ? `meilleur comparatif ${question} ${year}`
          : `best ${question} comparison ${year}`,
      )
      variants.push(
        lang === 'fr'
          ? `${question} avis experts ${year}`
          : `${question} expert review ${year}`,
      )
      break
    case 'howto':
      variants.push(
        lang === 'fr'
          ? `${question} documentation officielle`
          : `${question} official documentation`,
      )
      variants.push(
        lang === 'fr'
          ? `${question} guide complet`
          : `${question} complete guide`,
      )
      break
    case 'review':
      variants.push(
        lang === 'fr'
          ? `${question} test benchmark ${year}`
          : `${question} benchmark test ${year}`,
      )
      variants.push(
        lang === 'fr'
          ? `${question} avis utilisateurs`
          : `${question} user reviews ${year}`,
      )
      break
    default:
      variants.push(
        lang === 'fr'
          ? `${question} explication complète`
          : `${question} complete overview`,
      )
      variants.push(
        lang === 'fr'
          ? `actualités ${question} ${year}`
          : `latest ${question} ${year}`,
      )
  }

  return [...new Set(variants)].slice(0, 5)
}
