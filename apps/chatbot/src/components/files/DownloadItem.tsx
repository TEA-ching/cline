import React from 'react'
import { Download, FileText } from 'lucide-react'
import type { GeneratedFile } from '@/hooks/useAgent'

interface Props { file: GeneratedFile }

export const DownloadItem: React.FC<Props> = ({ file }) => {
  const name = file.path.split('/').pop() ?? file.path
  return (
    <a
      href={file.blobUrl}
      download={name}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-default-600 hover:bg-default-100 group"
    >
      <FileText className="h-3.5 w-3.5 text-success-500 flex-shrink-0" />
      <span className="flex-1 truncate font-mono" title={file.path}>{name}</span>
      <Download className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 flex-shrink-0" />
    </a>
  )
}
