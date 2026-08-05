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
import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, Terminal, Pencil, Check, X, RotateCcw } from 'lucide-react'

interface Props {
  systemPrompt: string
  defaultSystemPrompt: string
  onUpdate: (value: string) => void
}

export const SystemPromptBanner: React.FC<Props> = ({ systemPrompt, defaultSystemPrompt, onUpdate }) => {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(systemPrompt)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(draft.length, draft.length)
    }
  }, [editing])

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(systemPrompt)
    setEditing(true)
    setExpanded(true)
  }

  const save = () => {
    onUpdate(draft.trim())
    setEditing(false)
  }

  const cancel = () => {
    setDraft(systemPrompt)
    setEditing(false)
  }

  const resetToDefault = () => {
    onUpdate(defaultSystemPrompt)
    setEditing(false)
  }

  const preview =
    systemPrompt.length > 80
      ? `${systemPrompt.slice(0, 80)}…`
      : systemPrompt

  return (
    <div className="border-b border-default-200 bg-default-50">
      <div className="flex items-center">
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center gap-1.5 px-4 py-2 text-left hover:bg-default-100 transition-colors"
          onClick={() => !editing && setExpanded(v => !v)}
        >
          <Terminal className="h-3 w-3 text-default-400 shrink-0" />
          {expanded
            ? <ChevronDown className="h-3 w-3 text-default-400 shrink-0" />
            : <ChevronRight className="h-3 w-3 text-default-400 shrink-0" />}
          <span className="text-xs text-default-400 font-mono truncate">
            {expanded ? 'System prompt' : (systemPrompt.trim() ? preview : 'No system prompt')}
          </span>
        </button>

        {!editing && (
          <>
            <button
              type="button"
              onClick={startEdit}
              title="Modifier le system prompt"
              className="mr-1 shrink-0 rounded p-1 text-default-400 hover:text-default-600 hover:bg-default-100 transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={resetToDefault}
              title="Rétablir le system prompt par défaut"
              className="mr-2 shrink-0 rounded p-1 text-default-400 hover:text-default-600 hover:bg-default-100 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </>
        )}

        {editing && (
          <div className="mr-2 flex shrink-0 gap-1">
            <button
              type="button"
              onClick={save}
              title="Enregistrer"
              className="rounded p-1 text-success-600 hover:bg-success-50 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={cancel}
              title="Annuler"
              className="rounded p-1 text-danger-500 hover:bg-danger-50 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {expanded && !editing && systemPrompt.trim() && (
        <pre className="px-8 pb-3 text-xs text-default-500 font-mono whitespace-pre-wrap wrap-reak-word">
          {systemPrompt}
        </pre>
      )}

      {editing && (
        <div className="px-4 pb-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
              if (e.key === 'Escape') cancel()
            }}
            rows={6}
            className="w-full resize-y rounded-md border border-default-300 bg-white px-3 py-2 text-xs font-mono text-default-700 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
            placeholder="Entrez le system prompt…"
          />
          <p className="mt-1 text-[10px] text-default-400">Ctrl+Entrée pour sauvegarder · Échap pour annuler</p>
        </div>
      )}
    </div>
  )
}
