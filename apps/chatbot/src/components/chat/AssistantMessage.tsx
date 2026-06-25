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
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@heroui/react'
import { marked, type Tokens } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import { FileType, Check, SquareMinus, GlobeCheck } from 'lucide-react'
import 'highlight.js/styles/github.css'
import type { Source } from './SourcesPanel'
import { SourceCardStrip } from './SourceCardStrip'

interface Props {
  content: string
  isStreaming?: boolean
  reasoning?: string[]
  showReasoning?: boolean
  sources?: Source[]
  isLast?: boolean
}

// ── One-time library initialisation (runs when the module is first imported) ──

let _mdReady = false

function initMarkdownLibs() {
  if (_mdReady) return
  _mdReady = true

  // Custom code renderer: intercepts mermaid fences; delegates the rest to hljs.
  // This avoids the double-encoding bug where hljs would HTML-encode the mermaid
  // source (> → &gt;) making it unreadable by mermaid.run().
  marked.use({
    renderer: {
      code({ text, lang }: Tokens.Code): string {
        if (lang === 'mermaid') {
          // Escape & and < so the raw source survives DOMPurify as text content.
          // mermaid.run() reads element.textContent which decodes HTML entities,
          // so the original diagram source is correctly reconstructed.
          const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          return `<div class="mermaid-block">${safe}</div>`
        }
        const language = (lang && hljs.getLanguage(lang)) ? lang : 'plaintext'
        const highlighted = hljs.highlight(text, { language }).value
        return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
      },
    },
  })

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    fontFamily: 'Inter, sans-serif',
    flowchart: { useMaxWidth: true, htmlLabels: false },
  })
}

initMarkdownLibs()

// ── DOMPurify config ──────────────────────────────────────────────────────────

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ALLOWED_TAGS: [
    'div', 'span', 'sup', 'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'img',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // SVG elements produced by mermaid's rendered output
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse',
    'text', 'tspan', 'defs', 'marker', 'use', 'foreignObject', 'clipPath',
    'linearGradient', 'radialGradient', 'stop',
  ],
  ALLOWED_ATTR: [
    // HTML
    'href', 'src', 'alt', 'class', 'id', 'style', 'width', 'height', 'target', 'rel',
    // data-* wildcard (includes data-processed set by mermaid after rendering)
    'data-*',
    // SVG geometry
    'viewBox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
    'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points',
    // SVG presentation
    'transform', 'marker-end', 'marker-start', 'marker-mid',
    'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline',
    'preserveAspectRatio', 'clip-path', 'opacity', 'visibility',
    // SVG defs
    'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'markerUnits',
    'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity',
  ],
}

// Normalize Cohere's native citation format <citation:docIdx:[chunkIdx]> → [citation:chunkIdx+1]
// Must run on raw markdown BEFORE marked.parse() because DOMPurify strips unknown tags.
function normalizeCitations(text: string): string {
  return text.replace(/<citation:(\d+):\[(\d+)\]>/g, (_match, _docIdx, chunkIdx) =>
    `[citation:${parseInt(chunkIdx, 10) + 1}]`
  )
}

// Convert [citation:N] markers to placeholder spans that will host React portal Tooltips.
// Using empty spans avoids the anchor-URL bug and lets React own the interactive part.
function injectCitationLinks(html: string): string {
  return html.replace(/\[citation:(\d+)\]/g, (_match, num) =>
    `<sup class="citation"><span class="citation-placeholder" data-source-id="${num}"></span></sup>`
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AssistantMessage: React.FC<Props> = ({ content, isStreaming, reasoning, showReasoning, sources, isLast }) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const [safeHtml, setSafeHtml] = useState('')
  const [citationPortals, setCitationPortals] = useState<React.ReactPortal[]>([])
  const [copiedText, setCopiedText] = useState(false)
  const [copiedRaw, setCopiedRaw] = useState(false)
  const [copiedHtml, setCopiedHtml] = useState(false)

  // Markdown → sanitised HTML
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const html = await marked.parse(normalizeCitations(content))
      let safe = DOMPurify.sanitize(html, PURIFY_CONFIG) as string

      // Inject citation links if reasoning is enabled
      safe = injectCitationLinks(safe)

      if (!cancelled) setSafeHtml(safe)
    })()
    return () => { cancelled = true }
  }, [content])

  // Inject HTML directly via the ref — keeps the node outside React's reconciler
  // so mermaid's in-place SVG mutations survive re-renders caused by copy-button
  // state changes (dangerouslySetInnerHTML would reset the DOM on every render).
  useEffect(() => {
    if (contentRef.current) contentRef.current.innerHTML = safeHtml
  }, [safeHtml])

  // After innerHTML is set, inject HeroUI Tooltip portals into .citation-placeholder spans.
  // Portals render INTO the span so React owns the interactive element — no anchor-URL weirdness.
  useEffect(() => {
    if (!contentRef.current) return
    const placeholders = Array.from(
      contentRef.current.querySelectorAll<HTMLSpanElement>('.citation-placeholder')
    )
    if (placeholders.length === 0) { setCitationPortals([]); return }

    const portals = placeholders.map(el => {
      const sourceId = parseInt(el.dataset.sourceId ?? '0', 10)
      const source = sources?.find(s => s.id === sourceId)
      return createPortal(
        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <span className="text-primary-500 cursor-help font-medium select-none" tabIndex={0}>[{sourceId}]</span>
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>
            <Tooltip.Arrow />
            <div className="max-w-xs p-1 space-y-1">
              <div className="flex items-center gap-1.5">
                {source?.favicon && (
                  <img
                    src={source.favicon}
                    alt=""
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 shrink-0 rounded-sm"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {source?.domain && (
                  <span className="text-[10px] text-default-400 truncate">{source.domain}</span>
                )}
              </div>
              <a
                href={source?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium hover:underline text-primary-600 block"
              >
                {source?.title ?? `Source ${sourceId}`}
              </a>
              {source?.snippet && (
                <p className="text-xs text-default-500 line-clamp-3">{source.snippet}</p>
              )}
            </div>
          </Tooltip.Content>
        </Tooltip>,
        el,
      )
    })
    setCitationPortals(portals)
  }, [safeHtml, sources])

  // Render mermaid diagrams once streaming has finished and HTML is in the DOM
  useEffect(() => {
    if (!contentRef.current || !safeHtml || isStreaming) return
    const nodes = Array.from(
      contentRef.current.querySelectorAll<HTMLElement>('.mermaid-block')
    )
    if (nodes.length === 0) return
    mermaid.run({ nodes, suppressErrors: true }).catch(() => {})
  }, [safeHtml, isStreaming])

  // Copy rendered plain text (what the user sees)
  const handleCopyText = useCallback(() => {
    const text = contentRef.current?.innerText ?? content
    navigator.clipboard.writeText(text).then(() => {
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 2000)
    }).catch(() => {})
  }, [content])

  // Copy raw markdown as returned by the LLM
  const handleCopyRaw = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedRaw(true)
      setTimeout(() => setCopiedRaw(false), 2000)
    }).catch(() => {})
  }, [content])

  // Copy rendered HTML content
  const handleCopyHtml = useCallback(() => {
    const html = contentRef.current?.innerHTML ?? safeHtml
    navigator.clipboard.writeText(html).then(() => {
      setCopiedHtml(true)
      setTimeout(() => setCopiedHtml(false), 2000)
    }).catch(() => {})
  }, [safeHtml])

  return (
    <div className="group relative prose prose-sm max-w-none text-default-800 dark:prose-invert">
      {/* Action buttons — appear on hover */}
      <div className="absolute -top-10 right-0 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={handleCopyText}
          className="p-1 rounded text-default-400 hover:text-default-600 hover:bg-default-100 dark:hover:bg-default-800"
          aria-label="Copy text"
          title="Copy text"
        >
          {copiedText
            ? <Check className="h-3.5 w-3.5 text-green-500" />
            : <FileType className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleCopyRaw}
          className="p-1 rounded text-default-400 hover:text-default-600 hover:bg-default-100 dark:hover:bg-default-800"
          aria-label="Copy raw markdown"
          title="Copy raw markdown"
        >
          {copiedRaw
            ? <Check className="h-3.5 w-3.5 text-green-500" />
            : <SquareMinus className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleCopyHtml}
          className="p-1 rounded text-default-400 hover:text-default-600 hover:bg-default-100 dark:hover:bg-default-800"
          aria-label="Copy HTML"
          title="Copy HTML"
        >
          {copiedHtml
            ? <Check className="h-3.5 w-3.5 text-green-500" />
            : <GlobeCheck className="h-3.5 w-3.5" />}
        </button>
      </div>

      {showReasoning && reasoning && reasoning.length > 0 && (
        <details className="mb-3 text-xs bg-default-50 rounded-md p-2 border border-default-200">
          <summary className="cursor-pointer font-mono text-default-500 hover:text-default-700">
            🧠 View reasoning ({reasoning.length} steps)
          </summary>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {reasoning.map((step, idx) => (
              <div key={idx} className="border-l-2 border-primary-300 pl-2 py-0.5 text-default-600">
                {step}
              </div>
            ))}
          </div>
        </details>
      )}
      <div
        ref={contentRef}
        className="markdown-content"
        // innerHTML managed via useEffect — not dangerouslySetInnerHTML —
        // so React's reconciler never overwrites mermaid's rendered SVG.
      />
      {/* Citation Tooltip portals — rendered INTO their .citation-placeholder spans */}
      {citationPortals}
      {isStreaming && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary-500" />
      )}
      {isLast && !isStreaming && sources && sources.length > 0 && (
        <SourceCardStrip sources={sources} />
      )}
    </div>
  )
}
