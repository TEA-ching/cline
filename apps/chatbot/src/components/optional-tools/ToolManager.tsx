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
import { Button } from '@heroui/react'
import { X, Info } from 'lucide-react'
import { BUILTIN_OPTONAL_TOOLS } from '@/tools/builtin'

interface Props {
  enabledSkills: string[]
  onToggle: (skillId: string) => void
  onClose: () => void
}

export const ToolManager: React.FC<Props> = ({ enabledSkills, onToggle, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative h-full w-72 bg-background border-l border-default-200 flex flex-col shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-default-200 px-3 py-2 shrink-0">
          <span className="text-sm font-medium">Tool Manager</span>
          <Button isIconOnly variant="ghost" size="sm" onPress={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Info */}
        <div className="flex items-start gap-2 px-3 py-2 border-b border-default-100 bg-default-50 shrink-0">
          <Info className="h-3.5 w-3.5 text-default-400 mt-0.5 shrink-0" />
          <p className="text-xs text-default-400">
            Add extra tools to the AI agent. Toggle a tool and start a new conversation
            (or use <span className="font-mono">/new</span>) to activate it.
          </p>
        </div>

        {/* Tool list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {BUILTIN_OPTONAL_TOOLS.map(tool => {
            const enabled = enabledSkills.includes(tool.id)
            return (
              <button
                key={tool.id}
                type="button"
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                  enabled
                    ? 'border-primary-300 bg-primary-50 shadow-sm'
                    : 'border-default-200 bg-default-50 hover:border-default-300 hover:bg-default-100'
                }`}
                onClick={() => onToggle(tool.id)}
              >
                <span className="text-xl leading-none mt-0.5">{tool.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${enabled ? 'text-primary-700' : 'text-default-700'}`}>
                    {tool.name}
                  </p>
                  <p className="text-xs text-default-400 mt-0.5 leading-snug">{tool.description}</p>
                  <p className="text-xs text-default-300 mt-1 font-mono">
                    Tool: {tool.tools.join(', ')}
                  </p>
                </div>
                <div className={`shrink-0 w-4 h-4 rounded-full mt-0.5 transition-colors flex items-center justify-center ${
                  enabled ? 'bg-primary-600 border-2 border-primary-600' : 'bg-transparent'
                }`}>
                  {enabled && <span className="text-gray-300 text-xs font-bold">●</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* Active count */}
        <div className="border-t border-default-200 px-3 py-2 shrink-0">
          <p className="text-xs text-default-400 text-center">
            {enabledSkills.length === 0
              ? 'No tools enabled, builtin tools are always available for web browsing, file management, and user interaction.'
              : `${enabledSkills.length} tool${enabledSkills.length !== 1 ? 's' : ''} enabled`}
          </p>
        </div>
      </div>
    </div>
  )
}
