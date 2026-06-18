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
import React, { useState } from 'react'
import { Wrench, ChevronDown, ChevronRight, Loader } from 'lucide-react'

interface Props {
  toolName: string
  input: unknown
  result?: unknown
  isRunning?: boolean
}

export const ToolCallCard: React.FC<Props> = ({ toolName, input, result, isRunning }) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="my-1 rounded-md border border-default-200 bg-default-50 text-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-default-600 hover:bg-default-100"
      >
        {isRunning
          ? <Loader className="h-3.5 w-3.5 animate-spin text-primary-500" />
          : <Wrench className="h-3.5 w-3.5 text-default-400" />}
        <span className="font-mono text-xs font-medium">{toolName}</span>
        {open ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronRight className="ml-auto h-3 w-3" />}
      </button>

      {open && (
        <div className="border-t border-default-200 p-3 space-y-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-default-400 uppercase tracking-wide">Input</p>
            <pre className="overflow-auto rounded bg-default-100 p-2 text-xs">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <p className="mb-1 text-xs font-semibold text-default-400 uppercase tracking-wide">Result</p>
              <pre className="overflow-auto rounded bg-success-50 p-2 text-xs max-h-40">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
