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
import { createTool } from '@cline/agents'
import { z } from 'zod'
import type { AgentTool } from '@cline/agents'

// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary
export function createResearchPlanTool(): AgentTool<any, any> {
  return createTool({
    name: 'plan_research',
    description:
      'Declare a structured execution plan before processing a complex multi-step request. ' +
      'Call this tool FIRST to show the user the planned steps with a visual progress tracker. ' +
      'Then execute each step using the available tools, calling complete_research_step after each one, ' +
      'and finally synthesize a final report in your text response. ' +
      'Example for "weather in major French cities": ' +
      'steps: ["List cities with population > 200k", "Geocode each city", "Fetch weather forecast", "Synthesize report"]',
    inputSchema: z.object({
      question: z.string().describe('The research question or task being addressed'),
      steps: z.array(z.string()).min(2).max(15).describe('Ordered list of step titles to execute'),
    }),
    timeoutMs: 5_000,
    execute: async ({ question, steps }) => ({
      question,
      steps: steps.map((title, index) => ({ index, title, completed: false })),
      total: steps.length,
    }),
  })
}

// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary
export function createCompleteResearchStepTool(): AgentTool<any, any> {
  return createTool({
    name: 'complete_research_step',
    description:
      'Mark a research step as completed after executing it with other tools. ' +
      'Call this after each step in your plan_research plan to update the visual progress tracker.',
    inputSchema: z.object({
      step_index: z.number().int().min(0).describe('0-based index of the completed step'),
    }),
    timeoutMs: 2_000,
    execute: async ({ step_index }) => ({ step_index, completed: true }),
  })
}
