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
import React, { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Button, Modal, Input } from '@heroui/react'
import { Send, Paperclip, Square, ImagePlus, Link, GripHorizontal } from 'lucide-react'
import {
  isGitHubUrl,
  parseGitHubUrl,
  fetchGitHubFile,
  fetchGitHubDirectory
} from '../../utils/github'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { FOCUS_MODES } from '@/tools/focus-modes'
import type { FocusMode } from '@/tools/focus-modes'

export interface SlashCommand {
  cmd: string
  desc: string
}

interface Props {
  onSend: (text: string, images?: string[]) => void
  onAbort: () => void
  isRunning: boolean
  supportsImages: boolean
  onUploadFiles?: (files: FileList) => void
  commands?: SlashCommand[]
  focusMode?: FocusMode
  onFocusChange?: (mode: FocusMode) => void
}

const DESKTOP_INIT_HEIGHT = 120
const MOBILE_INIT_HEIGHT = 80

export const InputBar: React.FC<Props> = ({
  onSend, onAbort, isRunning, supportsImages, onUploadFiles, commands = [],
  focusMode = 'web', onFocusChange,
}) => {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [panelHeight, setPanelHeight] = useState(MOBILE_INIT_HEIGHT)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  // Set initial height based on screen size, and reset on breakpoint change
  useEffect(() => {
    setPanelHeight(isMobile ? MOBILE_INIT_HEIGHT : DESKTOP_INIT_HEIGHT)
  }, [isMobile])

  // Global drag handlers for resize
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current) return
      const y = 'touches' in e ? e.touches[0].clientY : e.clientY
      const delta = dragStartY.current - y
      setPanelHeight(Math.max(60, Math.min(600, dragStartH.current + delta)))
    }
    const onUp = () => { isDragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [])

  const onResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStartY.current = 'touches' in e ? e.touches[0].clientY : e.clientY
    dragStartH.current = panelHeight
  }

  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [suggestionIdx, setSuggestionIdx] = useState(-1)
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Extract filename from URL
  const extractFilenameFromUrl = (url: string) => {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      return pathname.substring(pathname.lastIndexOf('/') + 1) || 'downloaded-file'
    } catch {
      return 'downloaded-file'
    }
  }

  // Check if URL is a Wikipedia article URL
  const isWikipediaUrl = (url: string) => {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname.endsWith('.wikipedia.org') &&
             urlObj.pathname.startsWith('/wiki/')
    } catch {
      return false
    }
  }

  // Convert Wikipedia article URL to REST API v1 URL
  const getWikipediaApiUrl = (url: string) => {
    try {
      const urlObj = new URL(url)
      const title = urlObj.pathname.substring('/wiki/'.length)
      return `${urlObj.origin}/api/rest_v1/page/html/${encodeURIComponent(title)}?redirect=true`
    } catch {
      return url // Fallback to original URL if conversion fails
    }
  }



  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value
    setUrl(newUrl)
    if (!filename || filename === 'downloaded-file') {
      setFilename(extractFilenameFromUrl(newUrl))
    }
  }

  const handleAddFromUrl = async () => {
    if (!url.trim()) return

    try {
      // Handle GitHub URLs
      if (isGitHubUrl(url)) {
        const githubInfo = parseGitHubUrl(url)

        if (githubInfo.type === 'blob') {
          // Single file download
          const file = await fetchGitHubFile(githubInfo.apiUrl, filename || extractFilenameFromUrl(url))

          // Create a FileList-like object to pass to onUploadFiles
          const fileList = {
            0: file,
            length: 1,
            item: (index: number) => index === 0 ? file : null
          } as unknown as FileList

          onUploadFiles?.(fileList)
        }
        else if (githubInfo.type === 'tree' || githubInfo.type === 'repo') {
          // Directory download - fetch all files
          const files = await fetchGitHubDirectory(githubInfo.apiUrl)

          if (files.length > 0) {
            // Create a FileList-like object with multiple files
            const fileList = {
              length: files.length,
              item: (index: number) => files[index] || null
            } as unknown as FileList

            // Add numeric indices for FileList compatibility
            files.forEach((file: File, index: number) => {
              fileList[index] = file
            })

            onUploadFiles?.(fileList)
          }
        }
        else {
          throw new Error('Unsupported GitHub URL format')
        }

        setIsUrlModalOpen(false)
        setUrl('')
        setFilename('')
        return
      }

      // Special handling for Wikipedia URLs
      let targetUrl = url
      if (isWikipediaUrl(url)) {
        targetUrl = getWikipediaApiUrl(url)
      }

      const response = await fetch(targetUrl, {
        headers: {
          'accept': 'text/html; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/HTML/2.1.0"'
        }
      })

      if (!response.ok) throw new Error('Failed to fetch URL')

      const content = await response.text()
      const file = new File([content], filename, { type: 'text/html' })

      // Create a FileList-like object to pass to onUploadFiles
      const fileList = {
        0: file,
        length: 1,
        item: (index: number) => index === 0 ? file : null
      } as unknown as FileList

      onUploadFiles?.(fileList)
      setIsUrlModalOpen(false)
      setUrl('')
      setFilename('')
    } catch (error) {
      console.error('Error downloading file:', error)
      // TODO: Show error to user
    }
  }

  // Compute suggestions when text starts with /
  const suggestions = React.useMemo(() => {
    if (!text.startsWith('/') || text.includes(' ')) return []
    const lower = text.toLowerCase()
    return commands.filter(c => c.cmd.startsWith(lower))
  }, [text, commands])

  const submit = (overrideText?: string) => {
    const value = (overrideText ?? text).trim()
    if (!value && images.length === 0) return
    onSend(value, images.length > 0 ? images : undefined)
    setText('')
    setImages([])
    setSuggestionIdx(-1)
  }

  const applySuggestion = (cmd: string) => {
    // For commands that take arguments, leave a trailing space
    const withSpace = cmd === '/prompt' || cmd === '/compact' ? `${cmd} ` : cmd
    setText(withSpace)
    setSuggestionIdx(-1)
    textareaRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggestionIdx(i => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestionIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestionIdx >= 0)) {
        e.preventDefault()
        const target = suggestionIdx >= 0 ? suggestions[suggestionIdx] : suggestions[0]
        if (target) applySuggestion(target.cmd)
        return
      }
      if (e.key === 'Escape') {
        setSuggestionIdx(-1)
        setText('')
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isRunning) submit()
    }
  }

  const addImages = (files: FileList) => {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = e => {
        const url = e.target?.result as string
        setImages(prev => [...prev, url])
      }
      reader.readAsDataURL(file)
    })
  }

  return (
    <div
      className="border-t border-default-200 bg-background flex flex-col relative"
      style={{ height: panelHeight }}
    >

      {/* Drag zone — in-flow so it receives pointer events reliably */}
      <div
        className="relative h-4 shrink-0 cursor-ns-resize select-none group"
        onMouseDown={onResizeStart}
        onTouchStart={onResizeStart}
        aria-label="Resize input area"
      >
        {/* Visual handle centered on the border-t line */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-5 rounded-full bg-background border border-default-200 group-hover:bg-default-100 transition-colors">
          <GripHorizontal className="h-3.5 w-3.5 text-default-400 group-hover:text-default-600 transition-colors" />
        </div>
      </div>

      {/* Slash command suggestions */}
      {suggestions.length > 0 && (
        <div className="mx-3 mb-2 rounded-xl border border-default-200 bg-background shadow-md overflow-hidden shrink-0">
          {suggestions.map((s, i) => (
            <button
              key={s.cmd}
              type="button"
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                i === suggestionIdx
                  ? 'bg-primary-50 text-primary-700'
                  : 'hover:bg-default-50 text-default-700'
              }`}
              onClick={() => applySuggestion(s.cmd)}
              onMouseEnter={() => setSuggestionIdx(i)}
            >
              <span className="shrink-0 font-mono text-xs font-semibold w-20">{s.cmd}</span>
              <span className="text-xs text-default-400">{s.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Image preview strip */}
      {images.length > 0 && (
        <div className="px-3 mb-2 flex flex-wrap gap-1 shrink-0">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="h-14 w-14 rounded object-cover border border-default-200" />
              <button
                type="button"
                onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger-500 text-white text-xs"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Focus mode selector */}
      <div className="px-3 pb-1 flex gap-1 shrink-0 overflow-x-auto self-end" style={{ scrollbarWidth: 'none' }}>
        {(Object.entries(FOCUS_MODES) as [FocusMode, typeof FOCUS_MODES[FocusMode]][]).map(([mode, cfg]) => (
          <button
            key={mode}
            type="button"
            onClick={() => onFocusChange?.(mode)}
            className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap flex items-center gap-1 ${
              focusMode === mode
                ? 'border-primary-400 bg-accent text-white font-medium'
                : 'border-default-200 text-default-400 hover:text-default-600 hover:border-default-300'
            }`}
          >
            <span className="flex items-center bg">{cfg.icon}</span>
            <span>{cfg.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 flex items-end gap-2 px-3 pb-3 min-h-0">
        {/* Add from URL button */}
        <Button
          isIconOnly variant="ghost" size="sm"
          onPress={() => setIsUrlModalOpen(true)}
          aria-label="Add file from URL"
        >
          <Link className="h-4 w-4" />
        </Button>

        {/* Add from URL Modal */}
        <Modal isOpen={isUrlModalOpen} onOpenChange={setIsUrlModalOpen}>
          <Modal.Backdrop >
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Add File from URL</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">URL</label>
                    <Input
                      type="url"
                      value={url}
                      onChange={handleUrlChange}
                      placeholder="https://example.com/file.txt"
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Filename</label>
                    <Input
                      value={filename}
                      onChange={(e) => setFilename(e.target.value)}
                      placeholder="Enter filename"
                      className="w-full"
                    />
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setIsUrlModalOpen(false)}>
                  Cancel
                </Button>
                <Button onPress={handleAddFromUrl} isDisabled={!url.trim()}>
                  Add
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
          </Modal.Backdrop>
        </Modal>

        {/* File upload (VFS) */}
        <Button
          isIconOnly variant="ghost" size="sm"
          onPress={() => fileInputRef.current?.click()}
          aria-label="Upload file to workspace"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => e.target.files && onUploadFiles?.(e.target.files)}
        />

        {/* Image attach (multimodal) */}
        {supportsImages && (
          <>
            <Button
              isIconOnly variant="ghost" size="sm"
              onPress={() => imageInputRef.current?.click()}
              aria-label="Attach image to message"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={e => e.target.files && addImages(e.target.files)}
            />
          </>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => { setText(e.target.value); setSuggestionIdx(-1) }}
          onKeyDown={onKeyDown}
          placeholder="Message… or type / for commands (Enter to send, Shift+Enter for newline)"
          className="flex-1 self-stretch resize-none rounded-xl border border-default-300 bg-default-50 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400"
        />

        {/* Send / Abort */}
        {isRunning
          ? (
            <Button isIconOnly size="sm" className="text-danger-500" onPress={onAbort} aria-label="Stop generation">
              <Square className="h-4 w-4" />
            </Button>
          )
          : (
            <Button
              isIconOnly size="sm"
              onPress={() => submit()}
              isDisabled={!text.trim() && images.length === 0}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
      </div>
    </div>
  )
}
