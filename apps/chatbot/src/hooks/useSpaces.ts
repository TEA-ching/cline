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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SpaceStore } from '@/session/session-store'
import type { Space } from '@/session/session-store'
import type { VFSSnapshotEntry } from '@/vfs/virtual-fs'

export type { Space }

const ACTIVE_SPACE_KEY = 'chatbot_active_space'

function uid(): string {
  return `space_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export interface UseSpacesReturn {
  spaces: Space[]
  activeSpaceId: string | null
  activeSpace: Space | null
  setActiveSpaceId: (id: string | null) => void
  createSpace: (name: string, instructions?: string) => Promise<Space>
  updateSpace: (id: string, patch: Partial<Pick<Space, 'name' | 'instructions' | 'filesSnapshot' | 'sessionIds'>>) => Promise<void>
  deleteSpace: (id: string) => Promise<void>
  addFileToSpace: (spaceId: string, path: string, entry: VFSSnapshotEntry) => Promise<void>
  removeFileFromSpace: (spaceId: string, path: string) => Promise<void>
  addSessionToSpace: (spaceId: string, sessionId: string) => Promise<void>
  /** Reload all spaces from IndexedDB. */
  refresh: () => Promise<void>
}

export function useSpaces(): UseSpacesReturn {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_SPACE_KEY),
  )

  const refresh = useCallback(async () => {
    const list = await SpaceStore.list().catch(() => [] as Space[])
    setSpaces(list)
  }, [])

  // Load spaces on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const setActiveSpaceId = useCallback((id: string | null) => {
    setActiveSpaceIdState(id)
    if (id) localStorage.setItem(ACTIVE_SPACE_KEY, id)
    else localStorage.removeItem(ACTIVE_SPACE_KEY)
  }, [])

  const createSpace = useCallback(async (name: string, instructions = ''): Promise<Space> => {
    const now = Date.now()
    const space: Space = {
      id: uid(),
      name: name.trim() || 'Unnamed Space',
      instructions,
      filesSnapshot: {},
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    await SpaceStore.save(space)
    setSpaces(prev => [space, ...prev])
    return space
  }, [])

  const updateSpace = useCallback(async (
    id: string,
    patch: Partial<Pick<Space, 'name' | 'instructions' | 'filesSnapshot' | 'sessionIds'>>,
  ): Promise<void> => {
    const existing = await SpaceStore.get(id)
    if (!existing) return
    const updated: Space = { ...existing, ...patch, updatedAt: Date.now() }
    await SpaceStore.save(updated)
    setSpaces(prev => prev.map(s => (s.id === id ? updated : s)))
  }, [])

  const deleteSpace = useCallback(async (id: string): Promise<void> => {
    await SpaceStore.delete(id)
    setSpaces(prev => prev.filter(s => s.id !== id))
    if (activeSpaceId === id) setActiveSpaceId(null)
  }, [activeSpaceId, setActiveSpaceId])

  const addFileToSpace = useCallback(async (spaceId: string, path: string, entry: VFSSnapshotEntry): Promise<void> => {
    const existing = await SpaceStore.get(spaceId)
    if (!existing) return
    const updated: Space = {
      ...existing,
      filesSnapshot: { ...existing.filesSnapshot, [path]: entry },
      updatedAt: Date.now(),
    }
    await SpaceStore.save(updated)
    setSpaces(prev => prev.map(s => (s.id === spaceId ? updated : s)))
  }, [])

  const removeFileFromSpace = useCallback(async (spaceId: string, path: string): Promise<void> => {
    const existing = await SpaceStore.get(spaceId)
    if (!existing) return
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [path]: _removed, ...rest } = existing.filesSnapshot
    const updated: Space = { ...existing, filesSnapshot: rest, updatedAt: Date.now() }
    await SpaceStore.save(updated)
    setSpaces(prev => prev.map(s => (s.id === spaceId ? updated : s)))
  }, [])

  const addSessionToSpace = useCallback(async (spaceId: string, sessionId: string): Promise<void> => {
    const existing = await SpaceStore.get(spaceId)
    if (!existing || existing.sessionIds.includes(sessionId)) return
    const updated: Space = {
      ...existing,
      sessionIds: [...existing.sessionIds, sessionId],
      updatedAt: Date.now(),
    }
    await SpaceStore.save(updated)
    setSpaces(prev => prev.map(s => (s.id === spaceId ? updated : s)))
  }, [])

  const activeSpace = useMemo(
    () => spaces.find(s => s.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  )

  return {
    spaces,
    activeSpaceId,
    activeSpace,
    setActiveSpaceId,
    createSpace,
    updateSpace,
    deleteSpace,
    addFileToSpace,
    removeFileFromSpace,
    addSessionToSpace,
    refresh,
  }
}
