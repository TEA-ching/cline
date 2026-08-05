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
import { openDB, type IDBPDatabase } from 'idb'
import type { ChatMessage } from '@/hooks/useAgent'
import type { AgentMessage } from '@sctg/cline-agents'
import type { VFSSnapshotEntry } from '@/vfs/virtual-fs'

const DB_NAME = 'cline-chatbot'
const DB_VERSION = 2
const STORE = 'sessions'
const SPACES_STORE = 'spaces'

export interface Session {
  id: string
  title: string
  messages: ChatMessage[]
  /** SDK-format messages (includes tool calls/results). Absent in sessions
   * saved before this field was introduced; in that case the agent will
   * reconstruct a best-effort context from ChatMessage[] only. */
  agentMessages?: readonly AgentMessage[]
  /** Non-blob generated file URLs (e.g. Azure image links) that survive reload.
   * Ephemeral blob: URLs are omitted — those files live in vfsSnapshot instead. */
  generatedFileUrls?: Array<{ path: string; url: string; timestamp: number }>
  providerId: string
  modelId: string
  createdAt: number
  updatedAt: number
  vfsSnapshot?: Record<string, VFSSnapshotEntry>
}

/** A persistent knowledge space that groups files + sessions under shared instructions. */
export interface Space {
  id: string
  name: string
  /** Additional instructions prepended to the system prompt for all sessions in this space. */
  instructions: string
  /** Files persisted with this space — same snapshot format as Session.vfsSnapshot. */
  filesSnapshot: Record<string, VFSSnapshotEntry>
  /** IDs of sessions that belong to this space. */
  sessionIds: string[]
  createdAt: number
  updatedAt: number
}

let db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (!db) {
    db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt')
        }
        if (oldVersion < 2 && !database.objectStoreNames.contains(SPACES_STORE)) {
          const spacesStore = database.createObjectStore(SPACES_STORE, { keyPath: 'id' })
          spacesStore.createIndex('updatedAt', 'updatedAt')
        }
      },
    })
  }
  return db
}

export const SessionStore = {
  async save(session: Session): Promise<void> {
    const database = await getDB()
    await database.put(STORE, session)
  },

  async get(id: string): Promise<Session | undefined> {
    const database = await getDB()
    return database.get(STORE, id)
  },

  async list(): Promise<Session[]> {
    const database = await getDB()
    const all = await database.getAllFromIndex(STORE, 'updatedAt')
    return all.reverse() // newest first
  },

  async delete(id: string): Promise<void> {
    const database = await getDB()
    await database.delete(STORE, id)
  },

  async clear(): Promise<void> {
    const database = await getDB()
    await database.clear(STORE)
  },
}

export const SpaceStore = {
  async save(space: Space): Promise<void> {
    const database = await getDB()
    await database.put(SPACES_STORE, space)
  },

  async get(id: string): Promise<Space | undefined> {
    const database = await getDB()
    return database.get(SPACES_STORE, id)
  },

  async list(): Promise<Space[]> {
    const database = await getDB()
    const all = await database.getAllFromIndex(SPACES_STORE, 'updatedAt')
    return all.reverse() // newest first
  },

  async delete(id: string): Promise<void> {
    const database = await getDB()
    await database.delete(SPACES_STORE, id)
  },
}
