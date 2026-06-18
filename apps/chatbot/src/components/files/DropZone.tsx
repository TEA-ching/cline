import React, { useState, DragEvent } from 'react'
import { Upload } from 'lucide-react'

interface Props {
  onDrop: (files: FileList) => void
  children: React.ReactNode
}

export const DropZone: React.FC<Props> = ({ onDrop, children }) => {
  const [dragging, setDragging] = useState(false)

  const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }

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
