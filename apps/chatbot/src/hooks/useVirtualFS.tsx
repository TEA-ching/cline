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
import { useCallback, useRef, useState } from 'react'
import { VirtualFS } from '@/vfs/virtual-fs'
import type { VFSSnapshotEntry } from '@/vfs/virtual-fs'

export interface VFSFile {
  path: string
  mimeType: string
  size: number
}

export interface UseVirtualFSReturn {
  files: VFSFile[]
  uploadFiles: (fileList: FileList | File[]) => Promise<void>
  removeFile: (path: string) => void
  readFile: (path: string) => string | null
  clear: () => void
  syncFromWorker: (path: string, content: string) => void
  toSnapshot: () => Record<string, VFSSnapshotEntry>
  loadSnapshot: (snapshot: Record<string, VFSSnapshotEntry> | undefined) => void
}

function guessMimeType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mimeMap: Record<string, string> = {
    ts: 'text/typescript',
    tsx: 'text/typescript',
    js: 'text/javascript',
    jsx: 'text/javascript',
    json: 'application/json',
    md: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    css: 'text/css',
    xml: 'application/xml',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  }
  return mimeMap[ext] ?? 'application/octet-stream'
}

function isBinaryMimeType(mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return true
  if (mimeType === 'application/pdf') return true
  if (mimeType === 'application/octet-stream') return true
  return false
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/** Re-encode a Uint8Array as a `data:<mime>;base64,...` string for the worker. */
function uint8ToDataUrl(data: Uint8Array, mimeType: string): string {
  let binary = ''
  for (let i = 0; i < data.byteLength; i++) {
    binary += String.fromCharCode(data[i])
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export function useVirtualFS(
  onFileSync?: (path: string, content: string) => void,
): UseVirtualFSReturn {
  const vfsRef = useRef<VirtualFS>(new VirtualFS())
  const [files, setFiles] = useState<VFSFile[]>([])

  const refreshFiles = useCallback(() => {
    const vfs = vfsRef.current
    const paths = vfs.list()
    const updated: VFSFile[] = paths.map(p => {
      const entry = vfs.entry(p)!
      return { path: p, mimeType: entry.mimeType, size: entry.size }
    })
    setFiles(updated)
  }, [])

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const vfs = vfsRef.current
      const arr = Array.from(fileList)
      await Promise.all(
        arr.map(async (file) => {
          const mimeType = guessMimeType(file)
          if (isBinaryMimeType(mimeType)) {
            // Store binary files as raw bytes — size is accurate and we avoid
            // the ~33% overhead of keeping a base64 string in memory.
            const buffer = await readFileAsArrayBuffer(file)
            const bytes = new Uint8Array(buffer)
            vfs.write(file.name, bytes, mimeType)
            // Worker still receives a data URL string (backward-compatible)
            onFileSync?.(file.name, uint8ToDataUrl(bytes, mimeType))
          } else {
            const content = await readFileAsText(file)
            vfs.write(file.name, content, mimeType)
            onFileSync?.(file.name, content)
          }
        }),
      )
      refreshFiles()
    },
    [onFileSync, refreshFiles],
  )

  const removeFile = useCallback(
    (path: string) => {
      vfsRef.current.delete(path)
      refreshFiles()
    },
    [refreshFiles],
  )

  const readFile = useCallback((path: string): string | null => {
    return vfsRef.current.read(path)
  }, [])

  const clear = useCallback(() => {
    vfsRef.current.clear()
    setFiles([])
  }, [])

  const toSnapshot = useCallback(
    () => vfsRef.current.toSnapshot(),
    [],
  )

  const loadSnapshot = useCallback(
    (snapshot: Record<string, VFSSnapshotEntry> | undefined) => {
      vfsRef.current.clear()
      if (snapshot) {
        const vfs = VirtualFS.fromSnapshot(snapshot)
        // Replace the internal ref's instance with the restored one
        vfsRef.current = vfs
        // Re-sync each file to the worker (worker VFS must stay in sync)
        for (const path of vfs.list()) {
          const content = vfs.read(path)
          if (content !== null) onFileSync?.(path, content)
        }
      }
      refreshFiles()
    },
    [onFileSync, refreshFiles],
  )

  const syncFromWorker = useCallback(
    (path: string, content: string) => {
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      const mimeMap: Record<string, string> = {
        ts: 'text/typescript',
        tsx: 'text/typescript',
        js: 'text/javascript',
        json: 'application/json',
        md: 'text/markdown',
        txt: 'text/plain',
        html: 'text/html',
        css: 'text/css',
      }
      const mimeType = mimeMap[ext] ?? 'text/plain'
      vfsRef.current.write(path, content, mimeType)
      refreshFiles()
    },
    [refreshFiles],
  )

  return {
    files,
    uploadFiles,
    removeFile,
    readFile,
    clear,
    syncFromWorker,
    toSnapshot,
    loadSnapshot,
  }
}
