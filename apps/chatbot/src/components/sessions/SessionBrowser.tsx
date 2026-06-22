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
import React, { useEffect, useState, useCallback } from 'react'
import { Button } from '@heroui/react'
import { Trash2, MessageSquare, X, Download, Upload } from 'lucide-react'
import { SessionStore } from '@/session/session-store'
import { exportSession, importSession } from '@/session/session-export'
import type { Session } from '@/session/session-store'

interface Props {
  currentProviderId: string
  currentModelId: string
  onLoad: (session: Session) => void
  onClose?: () => void
}

export const SessionBrowser: React.FC<Props> = ({
  currentProviderId,
  currentModelId,
  onLoad,
}) => {
  const [sessions, setSessions] = useState<Session[]>([])
  const [filterProvider, setFilterProvider] = useState('')

  const refresh = useCallback(() => {
    SessionStore.list().then(setSessions)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this conversation?')) return
    await SessionStore.delete(id)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  const handleClearAll = async () => {
    if (!confirm('Delete ALL saved conversations? This cannot be undone.')) return
    await SessionStore.clear()
    setSessions([])
  }

  const handleImport = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const session = await importSession(file)
        await SessionStore.save(session)
        refresh()
      } catch {
        alert('Invalid session file')
      }
    }
    input.click()
  }

  const providers = [...new Set(sessions.map(s => s.providerId))]
  const filtered = filterProvider
    ? sessions.filter(s => s.providerId === filterProvider)
    : sessions

  return (
    <div className="flex flex-col h-full p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Saved Conversations</span>
        <Button isIconOnly variant="ghost" size="sm" onPress={handleImport} aria-label="Import session">
          <Upload className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Provider filter */}
      {providers.length > 1 && (
        <div>
          <select
            className="w-full text-xs rounded border border-default-200 bg-background px-2 py-1 outline-none"
            value={filterProvider}
            onChange={e => setFilterProvider(e.target.value)}
          >
            <option value="">All providers</option>
            {providers.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-default-400 text-sm">
            <MessageSquare className="h-8 w-8 opacity-30" />
            <span>No saved conversations</span>
          </div>
        ) : (
          filtered.map(session => {
            const isActive =
              session.providerId === currentProviderId &&
              session.modelId === currentModelId
            return (
              <button
                key={session.id}
                type="button"
                className="w-full text-left px-3 py-3 rounded border border-default-100 hover:bg-default-50 flex gap-2 group"
                onClick={() => onLoad(session)}
              >
                <MessageSquare className="h-4 w-4 text-default-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-default-700 truncate">{session.title}</p>
                  <p className={`text-xs font-mono truncate ${isActive ? 'text-primary-500' : 'text-default-400'}`}>
                    {session.modelId}
                  </p>
                  <p className="text-xs text-default-300">
                    {new Date(session.updatedAt).toLocaleDateString()} · {session.messages.length} msgs
                  </p>
                </div>
                <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="text-default-300 hover:text-default-600 p-0.5"
                    title="Export"
                    onClick={e => { e.stopPropagation(); exportSession(session) }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="text-default-300 hover:text-danger-500 p-0.5"
                    title="Delete"
                    onClick={e => handleDelete(session.id, e)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Footer */}
      {sessions.length > 0 && (
        <div className="pt-2 border-t border-default-200">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-danger-500 text-xs"
            onPress={handleClearAll}
          >
            Delete all conversations
          </Button>
        </div>
      )}
    </div>
  )
}
