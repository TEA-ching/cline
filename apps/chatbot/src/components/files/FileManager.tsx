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
import React from 'react'
import { Trash2, FileText } from 'lucide-react'
import { DownloadItem } from './DownloadItem'
import type { VFSFile } from '@/hooks/useVirtualFS'
import type { GeneratedFile } from '@/hooks/useAgent'

interface Props {
  files: VFSFile[]
  generatedFiles: GeneratedFile[]
  onRemove: (path: string) => void
  onViewFile?: (path: string) => void
  onViewGeneratedFile?: (file: GeneratedFile) => void
}

export const FileManager: React.FC<Props> = ({ files, generatedFiles, onRemove, onViewFile, onViewGeneratedFile }) => (
  <div className="flex h-full flex-col overflow-hidden">
    {/* Uploaded files */}
    <div className="flex-1 overflow-y-auto">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-default-400">
        Workspace ({files.length})
      </p>
      {files.length === 0
        ? <p className="px-3 text-xs text-default-300 italic">Drop files here or use 📎</p>
        : files.map(f => {
          const name = f.path.split('/').pop() ?? f.path
          const kb = (f.size / 1024).toFixed(1)
          return (
            <div key={f.path} className="group flex items-center gap-2 px-3 py-1 hover:bg-default-100 rounded-md mx-1">
              <button
                type="button"
                onClick={() => onViewFile?.(f.path)}
                className="flex flex-1 items-center gap-2 min-w-0 text-left"
                title={onViewFile ? `Visualiser ${f.path}` : f.path}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-default-400" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-mono text-default-700">{name}</p>
                  <p className="text-[10px] text-default-400">{kb} KB</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onRemove(f.path)}
                className="opacity-0 group-hover:opacity-100 text-danger-400 hover:text-danger-600"
                title="Remove file"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )
        })}
    </div>

    {/* Generated files */}
    {generatedFiles.length > 0 && (
      <div className="border-t border-default-200">
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-default-400">
          Generated ({generatedFiles.length})
        </p>
        <div className="overflow-y-auto max-h-40 px-1">
          {generatedFiles.map(f => (
            <DownloadItem
              key={f.path + f.timestamp}
              file={f}
              onView={onViewGeneratedFile ? () => onViewGeneratedFile(f) : undefined}
            />
          ))}
        </div>
      </div>
    )}
  </div>
)
