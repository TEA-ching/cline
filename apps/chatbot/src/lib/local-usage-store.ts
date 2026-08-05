// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import { openDB, IDBPDatabase } from 'idb'

let db: IDBPDatabase | null = null

async function getDB() {
  if (!db) {
    db = await openDB('byok-usage', 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('usage')) {
          const store = database.createObjectStore('usage', { keyPath: 'id', autoIncrement: true })
          store.createIndex('provider', 'provider')
          store.createIndex('keyHint', 'keyHint')
          store.createIndex('timestamp', 'timestamp')
        }
        if (!database.objectStoreNames.contains('errors')) {
          database.createObjectStore('errors', { keyPath: 'id', autoIncrement: true })
        }
      }
    })
  }
  return db
}

export async function recordLocalUsage(entry: { provider: string; modelId: string; keyOwner: string; keyHint: string; promptTokens: number; completionTokens: number }) {
  const database = await getDB()
  await database.add('usage', { ...entry, timestamp: Date.now() })
}

export async function recordLocalError(entry: { provider: string; modelId: string; keyOwner: string; keyHint: string; errorCode: number | null }) {
  const database = await getDB()
  await database.add('errors', { ...entry, timestamp: Date.now() })
}

export async function getLocalStats(period: 'hour' | 'day' | 'week' | 'month'): Promise<any[]> {
  const database = await getDB()
  const all = await database.getAll('usage')

  // Filter by period
  const now = Date.now()
  let timeThreshold = 0

  switch (period) {
    case 'hour':
      timeThreshold = now - 3600000 // 1 hour in ms
      break
    case 'day':
      timeThreshold = now - 86400000 // 24 hours in ms
      break
    case 'week':
      timeThreshold = now - 604800000 // 7 days in ms
      break
    case 'month':
      timeThreshold = now - 2592000000 // 30 days in ms
      break
  }

  const filtered = all.filter(item => item.timestamp >= timeThreshold)

  // Group by provider and keyHint
  const statsByProvider = filtered.reduce((acc, item) => {
    const key = `${item.provider}-${item.keyHint}`
    if (!acc[key]) {
      acc[key] = {
        provider: item.provider,
        keyHint: item.keyHint,
        promptTokens: 0,
        completionTokens: 0,
        count: 0
      }
    }
    acc[key].promptTokens += item.promptTokens
    acc[key].completionTokens += item.completionTokens
    acc[key].count += 1
    return acc
  }, {})

  return Object.values(statsByProvider)
}

export async function getAllLocalUsage(): Promise<any[]> {
  const database = await getDB()
  return database.getAll('usage')
}

export async function getAllLocalErrors(): Promise<any[]> {
  const database = await getDB()
  return database.getAll('errors')
}
