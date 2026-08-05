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
import React, { useState } from 'react'
import { Button } from '@heroui/react'
import { Plus, Folder, Pencil, Trash2, Check } from 'lucide-react'
import type { Space } from '@/hooks/useSpaces'
import { SpaceEditor } from './SpaceEditor'

interface Props {
  spaces: Space[]
  activeSpaceId: string | null
  onActivate: (spaceId: string | null) => void
  onCreate: (name: string, instructions: string) => Promise<Space>
  onUpdate: (id: string, patch: Partial<Pick<Space, 'name' | 'instructions' | 'filesSnapshot'>>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onAddFile: (spaceId: string, path: string, entry: import('@/vfs/virtual-fs').VFSSnapshotEntry) => Promise<void>
  onRemoveFile: (spaceId: string, path: string) => Promise<void>
}

export const SpacesBrowser: React.FC<Props> = ({
  spaces,
  activeSpaceId,
  onActivate,
  onCreate,
  onUpdate,
  onDelete,
  onAddFile,
  onRemoveFile,
}) => {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)

  const handleCreate = async (name: string, instructions: string) => {
    const space = await onCreate(name, instructions)
    setEditingId(null)
    onActivate(space.id)
  }

  const handleUpdate = async (name: string, instructions: string) => {
    if (editingId && editingId !== 'new') {
      await onUpdate(editingId, { name, instructions })
    }
    setEditingId(null)
  }

  const handleDelete = async (id: string) => {
    await onDelete(id)
    if (editingId === id) setEditingId(null)
  }

  if (editingId) {
    const spaceBeingEdited = editingId === 'new' ? null : spaces.find(s => s.id === editingId) ?? null
    return (
      <SpaceEditor
        space={spaceBeingEdited}
        onSave={editingId === 'new' ? handleCreate : handleUpdate}
        onCancel={() => setEditingId(null)}
        onAddFile={spaceBeingEdited ? (path, entry) => onAddFile(spaceBeingEdited.id, path, entry) : undefined}
        onRemoveFile={spaceBeingEdited ? (path) => onRemoveFile(spaceBeingEdited.id, path) : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 p-1">
      <Button
        size="sm"
        variant="primary"
        onPress={() => setEditingId('new')}
        className="w-full flex items-center gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        New Space
      </Button>

      {spaces.length === 0 && (
        <p className="text-xs text-default-400 text-center py-4">
          No spaces yet. Create one to group files and instructions for related conversations.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {spaces.map(space => {
          const isActive = space.id === activeSpaceId
          const fileCount = Object.keys(space.filesSnapshot).length
          return (
            <div
              key={space.id}
              className={`group flex items-start gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                isActive
                  ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-default-200 hover:border-default-300 hover:bg-default-50 dark:hover:bg-default-100/5'
              }`}
              onClick={() => onActivate(isActive ? null : space.id)}
            >
              <Folder className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? 'text-primary-500' : 'text-default-400'}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isActive ? 'text-primary-700 dark:text-primary-300' : 'text-default-700 dark:text-default-300'}`}>
                  {space.name}
                </p>
                <p className="text-xs text-default-400 mt-0.5">
                  {fileCount} file{fileCount !== 1 ? 's' : ''}
                  {space.sessionIds.length > 0 && ` · ${space.sessionIds.length} session${space.sessionIds.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div
                className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={e => e.stopPropagation()}
              >
                {isActive && <Check className="h-3.5 w-3.5 text-primary-500 mt-0.5" />}
                <Button
                  isIconOnly size="sm" variant="ghost"
                  className="h-6 w-6 min-w-0"
                  onPress={() => setEditingId(space.id)}
                  aria-label="Edit space"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  isIconOnly size="sm" variant="danger-soft"
                  className="h-6 w-6 min-w-0"
                  onPress={() => void handleDelete(space.id)}
                  aria-label="Delete space"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
