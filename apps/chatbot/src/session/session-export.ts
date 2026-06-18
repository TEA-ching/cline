import type { Session } from './session-store'

export function exportSession(session: Session): void {
  const json = JSON.stringify(session, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cline-session-${session.id.slice(0, 8)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importSession(file: File): Promise<Session> {
  const text = await file.text()
  const data = JSON.parse(text) as Session
  if (!data.id || !Array.isArray(data.messages)) {
    throw new Error('Invalid session file')
  }
  return data
}
