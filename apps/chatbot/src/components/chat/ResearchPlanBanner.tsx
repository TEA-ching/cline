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
import { Button, Disclosure, DisclosureGroup } from '@heroui/react'
import { ChevronDown, ChevronRight, Check, Circle, ArrowRight, Microscope, Wrench, Loader } from 'lucide-react'
import type { ResearchPlan, ChatMessage } from '@/hooks/useAgent'

interface Props {
  plan: ResearchPlan
  isRunning: boolean
  toolMessages: ChatMessage[]
}

export const ResearchPlanBanner: React.FC<Props> = ({ plan, isRunning, toolMessages }) => {
  const [open, setOpen] = useState(true)
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set())

  const completed = plan.steps.filter(s => s.completed).length
  const total = plan.steps.length
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0
  const currentIdx = isRunning ? plan.steps.findIndex(s => !s.completed) : -1

  return (
    <div className="mx-3 mb-2 rounded-md border border-default-200 bg-default-50 text-sm">
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-default-100"
      >
        <Microscope className="h-3.5 w-3.5 shrink-0 text-primary-500" />
        <span className="flex-1 truncate font-medium text-default-700 text-xs">{plan.question}</span>
        <span className="shrink-0 text-xs text-default-400">{completed}/{total}</span>
        {open ? <ChevronDown className="h-3 w-3 shrink-0 text-default-400" /> : <ChevronRight className="h-3 w-3 shrink-0 text-default-400" />}
      </button>

      {/* Progress bar */}
      <div className="h-1 bg-default-200">
        <div
          className="h-full bg-primary-500 transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {open && (
        <div className="px-3 py-2 space-y-3">
          {/* Step checklist */}
          <ul className="space-y-1">
            {plan.steps.map((step) => {
              const isCurrent = step.index === currentIdx
              return (
                <li key={step.index} className="flex items-center gap-2 text-xs">
                  {step.completed ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-success-500" />
                  ) : isCurrent ? (
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary-500" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-default-300" />
                  )}
                  <span className={
                    step.completed
                      ? 'text-default-400 line-through'
                      : isCurrent
                        ? 'font-medium text-primary-600'
                        : 'text-default-600'
                  }>
                    {step.title}
                  </span>
                </li>
              )
            })}
          </ul>

          {/* Tool calls accordion */}
          {toolMessages.length > 0 && (
            <div className="border-t border-default-200 pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-default-400">Tool calls</p>
              <DisclosureGroup
                allowsMultipleExpanded
                expandedKeys={expandedKeys}
                onExpandedChange={setExpandedKeys}
                className="space-y-0.5"
              >
                {toolMessages.map((msg) => {
                  const running = msg.toolResult === undefined
                  return (
                    <Disclosure key={msg.id} id={msg.id} className="rounded border border-default-200 bg-white dark:bg-default-100 overflow-hidden">
                      <Disclosure.Heading>
                        <Button
                          slot="trigger"
                          variant="tertiary"
                          className="w-full justify-start gap-2 rounded-none border-none bg-transparent px-2 py-1.5 text-xs font-normal text-default-600 hover:bg-default-100"
                        >
                          {running
                            ? <Loader className="h-3 w-3 shrink-0 animate-spin text-primary-500" />
                            : <Wrench className="h-3 w-3 shrink-0 text-default-400" />}
                          <span className="flex-1 text-left font-mono text-[0.7rem] ">{msg.toolName}</span>
                          <Disclosure.Indicator className="h-3 w-3 text-default-400" />
                        </Button>
                      </Disclosure.Heading>
                      <Disclosure.Content>
                        <Disclosure.Body className="space-y-2 border-t border-default-200 p-2">
                          <div>
                            <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-default-400">Input</p>
                            <pre className="overflow-auto rounded bg-default-100 p-2 text-[0.6rem]  max-h-32">
                              {JSON.stringify(msg.toolInput, null, 2)}
                            </pre>
                          </div>
                          {msg.toolResult !== undefined && (
                            <div>
                              <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-default-400">Result</p>
                              <pre className="overflow-auto rounded bg-success-50 p-2 text-[0.6rem] max-h-32">
                                {typeof msg.toolResult === 'string' ? msg.toolResult : JSON.stringify(msg.toolResult, null, 2)}
                              </pre>
                            </div>
                          )}
                        </Disclosure.Body>
                      </Disclosure.Content>
                    </Disclosure>
                  )
                })}
              </DisclosureGroup>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
