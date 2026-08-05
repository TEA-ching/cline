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
import React, { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react'
import { MessageItem } from './MessageItem'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { ChatMessage } from '@/hooks/useAgent'
import type { Source } from './SourcesPanel'

// Virtual scroll constants
const OVERSCAN = 8          // items rendered above/below visible area
const ESTIMATED_HEIGHT = 100 // px — fallback before first measurement
const GAP = 12              // gap between items (= gap-3 in Tailwind)
const PAD = 16              // top/bottom container padding (= p-4)

interface Props {
  messages: ChatMessage[]
  onImageCaptured?: (path: string, dataUrl: string) => void
  onFork?: (messageId: string) => void
  onRegenerate?: () => void
  onEdit?: (messageId: string, newContent: string) => void
  showReasoning?: boolean
  getReasoningSteps?: () => string[]
  sources?: Source[]
  isRunning?: boolean
}

export const MessageList: React.FC<Props> = ({
  messages,
  onImageCaptured,
  onFork,
  onRegenerate,
  onEdit,
  showReasoning,
  getReasoningSteps,
  sources,
  isRunning,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)

  // Height cache (mutable ref) + version counter to trigger re-render after measurement
  const heightsRef = useRef<Map<string, number>>(new Map())
  const [heightVersion, setHeightVersion] = useState(0)

  // Per-item ResizeObservers
  const itemROsRef = useRef<Map<string, ResizeObserver>>(new Map())

  // Attach/detach ResizeObserver for an item wrapper div
  const observeItem = useCallback((id: string, el: HTMLDivElement | null) => {
    itemROsRef.current.get(id)?.disconnect()
    if (!el) { itemROsRef.current.delete(id); return }
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      if (heightsRef.current.get(id) !== h) {
        heightsRef.current.set(id, h)
        setHeightVersion(v => v + 1)
      }
    })
    ro.observe(el)
    itemROsRef.current.set(id, ro)
  }, [])

  // Remove stale observers/heights when messages change
  useEffect(() => {
    const ids = new Set(messages.map(m => m.id))
    for (const [id, ro] of itemROsRef.current) {
      if (!ids.has(id)) { ro.disconnect(); itemROsRef.current.delete(id) }
    }
    for (const id of [...heightsRef.current.keys()]) {
      if (!ids.has(id)) heightsRef.current.delete(id)
    }
  }, [messages])

  // Watch container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerHeight(el.clientHeight)
    const ro = new ResizeObserver(([entry]) => setContainerHeight(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scroll listener — update scrollTop state and track pinned state
  const pinnedRef = useRef(true) // start pinned (auto-scroll to bottom)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      pinnedRef.current = dist < 80
      setScrollTop(el.scrollTop)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll to bottom when pinned and new content arrives (messages or height changes)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length, heightVersion])

  // Reset scroll on session change (first message id changes)
  const firstMsgIdRef = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const newFirst = messages[0]?.id
    if (newFirst !== firstMsgIdRef.current) {
      firstMsgIdRef.current = newFirst
      pinnedRef.current = true
      const el = containerRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [messages])

  // Compute virtual window: offsets, spacers, visible slice
  const { topPad, bottomPad, visibleItems, lastAssistantMsgId } = useMemo(() => {
    const n = messages.length
    if (n === 0) return { topPad: 0, bottomPad: 0, visibleItems: [], lastAssistantMsgId: null }

    const heights = heightsRef.current

    // Build cumulative offsets
    const offsets = new Array<number>(n)
    let y = PAD
    for (let i = 0; i < n; i++) {
      offsets[i] = y
      y += (heights.get(messages[i].id) ?? ESTIMATED_HEIGHT) + GAP
    }
    const totalHeight = y - GAP + PAD

    // Binary search: first item whose bottom edge >= viewStart
    const viewStart = scrollTop
    const viewEnd = scrollTop + containerHeight
    let lo = 0, hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const bottom = offsets[mid] + (heights.get(messages[mid].id) ?? ESTIMATED_HEIGHT)
      if (bottom < viewStart) lo = mid + 1
      else hi = mid
    }
    const firstVisible = lo

    // Binary search: last item whose top edge <= viewEnd
    lo = firstVisible; hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (offsets[mid] <= viewEnd) lo = mid
      else hi = mid - 1
    }
    const lastVisible = lo

    const startIdx = Math.max(0, firstVisible - OVERSCAN)
    const endIdx = Math.min(n - 1, lastVisible + OVERSCAN)

    const topPad = offsets[startIdx]
    const bottomEnd = offsets[endIdx] + (heights.get(messages[endIdx].id) ?? ESTIMATED_HEIGHT) + GAP
    const bottomPad = Math.max(0, totalHeight - bottomEnd)

    // Last assistant message id for regenerate button
    let lastAsstId: string | null = null
    for (let i = n - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { lastAsstId = messages[i].id; break }
    }

    return {
      topPad,
      bottomPad,
      visibleItems: messages.slice(startIdx, endIdx + 1),
      lastAssistantMsgId: lastAsstId,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, scrollTop, containerHeight, heightVersion])

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center text-default-400">
        <div className="text-center">
          <p className="text-4xl mb-3">🤖</p>
          <p className="text-sm">Start a conversation</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      role="log"
      aria-live="polite"
      aria-label="Messages"
      className="flex-1 overflow-y-auto"
    >
      {/* Top spacer */}
      <div aria-hidden="true" style={{ height: topPad }} />

      {visibleItems.map(msg => (
        <div
          key={msg.id}
          ref={el => observeItem(msg.id, el)}
          className="px-4"
          style={{ paddingBottom: GAP }}
        >
          <ErrorBoundary
            fallback={
              <div className="text-xs text-danger-400 bg-danger-50 dark:bg-danger-900/20 rounded-lg p-3">
                Erreur de rendu du message
              </div>
            }
          >
            <MessageItem
              message={msg}
              onImageCaptured={onImageCaptured}
              onFork={onFork}
              onRegenerate={msg.id === lastAssistantMsgId ? onRegenerate : undefined}
              onEdit={onEdit}
              showReasoning={showReasoning}
              getReasoningSteps={getReasoningSteps}
              sources={sources}
              isLast={msg.id === lastAssistantMsgId}
              isRunning={isRunning}
            />
          </ErrorBoundary>
        </div>
      ))}

      {/* Bottom spacer */}
      <div aria-hidden="true" style={{ height: bottomPad }} />
    </div>
  )
}
