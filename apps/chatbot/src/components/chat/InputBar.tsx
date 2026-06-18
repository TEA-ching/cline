import React, { useState, useRef, KeyboardEvent } from 'react'
import { Button } from '@heroui/react'
import { Send, Paperclip, Square, ImagePlus } from 'lucide-react'

interface Props {
  onSend: (text: string, images?: string[]) => void
  onAbort: () => void
  isRunning: boolean
  supportsImages: boolean
  onUploadFiles?: (files: FileList) => void
}

export const InputBar: React.FC<Props> = ({ onSend, onAbort, isRunning, supportsImages, onUploadFiles }) => {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed && images.length === 0) return
    onSend(trimmed, images.length > 0 ? images : undefined)
    setText('')
    setImages([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isRunning) submit()
    }
  }

  const addImages = (files: FileList) => {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = e => {
        const url = e.target?.result as string
        setImages(prev => [...prev, url])
      }
      reader.readAsDataURL(file)
    })
  }

  return (
    <div className="border-t border-default-200 bg-background p-3">
      {/* Image preview strip */}
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="h-14 w-14 rounded object-cover border border-default-200" />
              <button
                onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger-500 text-white text-xs"
              >×</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* File upload (VFS) */}
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          onPress={() => fileInputRef.current?.click()}
          aria-label="Upload file to workspace"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => e.target.files && onUploadFiles?.(e.target.files)}
        />

        {/* Image attach (multimodal) */}
        {supportsImages && (
          <>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={() => imageInputRef.current?.click()}
              aria-label="Attach image to message"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={e => e.target.files && addImages(e.target.files)}
            />
          </>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-default-300 bg-default-50 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400 min-h-10 max-h-40"
          style={{ height: 'auto' }}
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`
          }}
        />

        {/* Send / Abort */}
        {isRunning
          ? (
            <Button isIconOnly size="sm" className="text-danger-500" onPress={onAbort} aria-label="Stop generation">
              <Square className="h-4 w-4" />
            </Button>
          )
          : (
            <Button isIconOnly size="sm"  onPress={submit} isDisabled={!text.trim() && images.length === 0}>
              <Send className="h-4 w-4" />
            </Button>
          )}
      </div>
    </div>
  )
}
