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
import React, { useState, useEffect, DragEvent } from 'react'
import { Upload } from 'lucide-react'

interface Props {
  onDrop: (files: FileList) => void
  children: React.ReactNode
}

export const DropZone: React.FC<Props> = ({ onDrop, children }) => {
  const [dragging, setDragging] = useState(false)

  const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }

  // Prevent browser from opening files dropped outside the drop target
  useEffect(() => {
    const block = (e: Event) => e.preventDefault()
    document.addEventListener('dragover', block)
    document.addEventListener('drop', block)
    return () => {
      document.removeEventListener('dragover', block)
      document.removeEventListener('drop', block)
    }
  }, [])

  return (
    <div
      className="relative h-full"
      onDragEnter={e => { prevent(e); setDragging(true) }}
      onDragOver={prevent}
      onDragLeave={e => { prevent(e); setDragging(false) }}
      onDrop={e => {
        prevent(e)
        setDragging(false)
        if (e.dataTransfer.files.length > 0) onDrop(e.dataTransfer.files)
      }}
    >
      {children}
      {dragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary-400 bg-primary-50/90">
          <div className="flex flex-col items-center gap-2 text-primary-600">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">Drop files to add to workspace</p>
          </div>
        </div>
      )}
    </div>
  )
}
