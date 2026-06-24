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
import React, { useEffect, useState } from 'react'
import { Modal, Switch } from '@heroui/react'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'

interface Props {
  path: string
  mimeType: string
  content?: string
  blobUrl?: string
  onClose: () => void
}

const langMap: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  xml: 'xml',
  svg: 'xml',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  r: 'r',
  dockerfile: 'dockerfile',
  csv: 'plaintext',
  txt: 'plaintext',
}

function getLanguage(path: string): string {
  const name = path.split('/').pop() ?? path
  if (name.toLowerCase() === 'dockerfile') return 'dockerfile'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return langMap[ext] ?? 'plaintext'
}

function highlight(text: string, lang: string): string {
  try {
    const result = lang === 'plaintext'
      ? hljs.highlightAuto(text)
      : hljs.highlight(text, { language: lang, ignoreIllegals: true })
    return DOMPurify.sanitize(`<pre><code class="hljs language-${result.language ?? lang}">${result.value}</code></pre>`)
  } catch {
    return DOMPurify.sanitize(`<pre><code class="hljs">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)
  }
}

export const FileViewerModal: React.FC<Props> = ({ path, mimeType, content, blobUrl, onClose }) => {
  const name = path.split('/').pop() ?? path
  const isPdf = mimeType === 'application/pdf'
  const isImage = mimeType.startsWith('image/')
  const isText = !isPdf && !isImage
  const isHtml = isText && (mimeType === 'text/html' || path.endsWith('.html') || path.endsWith('.htm'))

  const [textContent, setTextContent] = useState<string | null>(content ?? null)
  const [loading, setLoading] = useState(isText && !content && !!blobUrl)
  const [renderHtml, setRenderHtml] = useState(true)
  const [htmlBlobUrl, setHtmlBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isText || content || !blobUrl) return
    setLoading(true)
    fetch(blobUrl)
      .then(r => r.text())
      .then(t => { setTextContent(t); setLoading(false) })
      .catch(() => { setTextContent('(erreur de lecture)'); setLoading(false) })
  }, [isText, content, blobUrl])

  useEffect(() => {
    if (!isHtml || !renderHtml || !textContent) { setHtmlBlobUrl(null); return }
    const blob = new Blob([textContent], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setHtmlBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [isHtml, renderHtml, textContent])

  // For PDFs from workspace (no blobUrl), create one on the fly
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(blobUrl ?? null)
  useEffect(() => {
    if (!isPdf || blobUrl) return
    if (!content) return
    const blob = new Blob([content], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setPdfBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [isPdf, blobUrl, content])

  const lang = getLanguage(path)
  const highlightedHtml = isText && textContent !== null ? highlight(textContent, lang) : null

  return (
    <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onClose() }}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="h-[80vh] w-[90vw] max-w-[90vw] max-h-[80vh]">
          <Modal.CloseTrigger />
          <Modal.Header className="flex flex-row items-center justify-between gap-4">
            <Modal.Heading className="font-mono text-sm truncate min-w-0 flex-1">{name}</Modal.Heading>
            {isHtml && (
              <Switch className="-mt-1.5 mr-5" size="sm" isSelected={renderHtml} onChange={setRenderHtml}>
                <Switch.Content className="flex-row items-center">
                  Rendering
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            )}
          </Modal.Header>
          <Modal.Body className="overflow-hidden p-0">
            {isPdf && (
              pdfBlobUrl
                ? <iframe src={pdfBlobUrl} className="w-full h-full border-0" title={name} />
                : <div className="flex items-center justify-center h-full text-default-400 text-sm">Chargement…</div>
            )}

            {isImage && (
              <div className="flex items-center justify-center h-full overflow-auto p-4">
                <img src={blobUrl ?? content} alt={name} className="max-w-full max-h-full object-contain" />
              </div>
            )}

            {isText && (
              loading
                ? <div className="flex items-center justify-center h-full text-default-400 text-sm">Chargement…</div>
                : isHtml && renderHtml
                  ? htmlBlobUrl
                    ? <iframe src={htmlBlobUrl} className="w-full h-full border-0" title={name} sandbox="allow-scripts allow-same-origin" />
                    : <div className="flex items-center justify-center h-full text-default-400 text-sm">Chargement…</div>
                  : highlightedHtml !== null
                    ? (
                      <div className="h-full overflow-auto">
                        <div
                          className="text-xs p-4"
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify
                          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                        />
                      </div>
                    )
                    : <div className="flex items-center justify-center h-full text-default-400 text-sm">Aucun contenu</div>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
