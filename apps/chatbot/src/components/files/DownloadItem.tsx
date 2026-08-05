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
import { Download, FileText } from 'lucide-react'
import type { GeneratedFile } from '@/hooks/useAgent'

interface Props {
  file: GeneratedFile
  onView?: () => void
}

export const DownloadItem: React.FC<Props> = ({ file, onView }) => {
  const name = file.path.split('/').pop() ?? file.path
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-default-600 hover:bg-default-100">
      <button
        type="button"
        onClick={onView}
        className="flex flex-1 items-center gap-2 min-w-0 text-left"
        title={onView ? `Visualiser ${file.path}` : file.path}
      >
        <FileText className="h-3.5 w-3.5 text-success-500 shrink-0" />
        <span className="flex-1 truncate font-mono">{name}</span>
      </button>
      <a
        href={file.blobUrl}
        download={name}
        className="opacity-0 group-hover:opacity-100 shrink-0 text-default-400 hover:text-default-700"
        title="Télécharger"
        onClick={e => e.stopPropagation()}
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  )
}
