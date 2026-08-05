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
import React, { useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { ArrowLeft, Upload, Trash2, FileText } from 'lucide-react'
import type { Space } from '@/hooks/useSpaces'
import type { VFSSnapshotEntry } from '@/vfs/virtual-fs'

interface Props {
  space: Space | null
  onSave: (name: string, instructions: string) => Promise<void>
  onCancel: () => void
  onAddFile?: (path: string, entry: VFSSnapshotEntry) => Promise<void>
  onRemoveFile?: (path: string) => Promise<void>
}

function guessMimeType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    md: 'text/markdown', txt: 'text/plain', ts: 'text/typescript',
    tsx: 'text/typescript', js: 'text/javascript', json: 'application/json',
    csv: 'text/csv', html: 'text/html', css: 'text/css',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  }
  return map[ext] ?? 'application/octet-stream'
}

function isBinary(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf' || mimeType === 'application/octet-stream'
}


export const SpaceEditor: React.FC<Props> = ({ space, onSave, onCancel, onAddFile, onRemoveFile }) => {
  const [name, setName] = useState(space?.name ?? '')
  const [instructions, setInstructions] = useState(space?.instructions ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const files = space ? Object.entries(space.filesSnapshot) : []

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(name, instructions)
    } finally {
      setSaving(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onAddFile || !e.target.files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(e.target.files)) {
        const mimeType = guessMimeType(file)
        const binary = isBinary(mimeType)
        let content: string

        if (binary) {
          const buf = await file.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let b = ''
          for (let i = 0; i < bytes.byteLength; i++) b += String.fromCharCode(bytes[i])
          content = btoa(b)
        } else {
          content = await file.text()
        }

        const entry: VFSSnapshotEntry = { content, mimeType, binary: binary || undefined }
        await onAddFile(file.name, entry)
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button isIconOnly size="sm" variant="ghost" onPress={onCancel} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-semibold text-default-700">
          {space ? 'Edit Space' : 'New Space'}
        </h3>
      </div>

      {/* Name */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-default-600">Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. AI Research"
          className="w-full rounded-lg border border-default-200 bg-default-50 dark:bg-default-100/5 px-3 py-2 text-sm text-default-800 dark:text-default-200 placeholder-default-400 focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>

      {/* Instructions */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-default-600">Instructions</label>
        <p className="text-xs text-default-400">Added to the system prompt for every conversation in this space.</p>
        <textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="e.g. Always cite sources. Focus on peer-reviewed research."
          rows={4}
          className="w-full rounded-lg border border-default-200 bg-default-50 dark:bg-default-100/5 px-3 py-2 text-sm text-default-800 dark:text-default-200 placeholder-default-400 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
        />
      </div>

      {/* Files — only shown for existing spaces */}
      {space && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-default-600">
              Files ({files.length})
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              size="sm" variant="secondary" isDisabled={uploading}
              onPress={() => fileInputRef.current?.click()}
              className="h-6 text-xs flex items-center gap-1"
            >
              <Upload className="h-3 w-3" />
              {uploading ? '…' : 'Upload'}
            </Button>
          </div>

          {files.length === 0 ? (
            <p className="text-xs text-default-400 italic">No files — upload to make them available in every conversation.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
              {files.map(([path, entry]) => (
                <div key={path} className="group flex items-center gap-2 rounded-md border border-default-100 px-2 py-1.5 hover:border-default-200">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-default-400" />
                  <span className="flex-1 text-xs text-default-600 truncate">{path}</span>
                  <span className="text-xs text-default-400 shrink-0">{entry.mimeType.split('/')[1]}</span>
                  {onRemoveFile && (
                    <Button
                      isIconOnly size="sm" variant="danger-soft"
                      className="h-5 w-5 min-w-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onPress={() => void onRemoveFile(path)}
                      aria-label="Remove file"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" onPress={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          size="sm" variant="primary"
          onPress={() => void handleSave()}
          isDisabled={saving || !name.trim()}
          className="flex-1"
        >
          {space ? 'Save' : 'Create'}
        </Button>
      </div>
    </div>
  )
}
