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
import type { VirtualFS } from '@/vfs/virtual-fs'
import type * as TypeScript from 'typescript'

// Import all individual tool creators
import { createCalculatorTool } from './calculator-tool'
import { createDatetimeTool } from './datetime-tool'
import { createEncodingTool } from './encoding-tool'
import { createUuidTool } from './uuid-tool'
import { createColorTool } from './color-tool'
import { createJavascriptTool } from './javascript-tool'
import { createWikipediaTool } from './wikipedia-tool'
import { createTypescriptTool } from './typescript-tool'
import { createImageTool } from './image-tool'
import { createDocxTool } from './docx-tool'
import { createPdfTool } from './pdf-tool'
import { createChartTool } from './chart-tool'
import { createSearchLocationTool, createWeatherForecastTool } from './weather-tools'
import { createPythonTool } from './python-tool'

interface WorkerToolsContext {
  vfs?: VirtualFS
  onFileCreated?: (path: string, content: string) => void
  apiKey?: string
  providerId?: string
  onImageGenerated?: (url: string, vfsPath: string) => void
  onAskQuestion?: (question: string, options: string[]) => Promise<string>
  vaultToken?: string
  corsProxyUrl?: string
  weatherApiKeys?: Array<{ key: string; sharedSecret?: string; signatureType?: string }>
  weatherApiEndpoint?: string
  renderMermaid?: (src: string) => Promise<string>
}

// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary
export function createOptionalTools(
  toolId: string[],
  ctx?: WorkerToolsContext
): AgentTool<any, any>[] {
  const tools: AgentTool<any, any>[] = []

  if (toolId.includes('calculator')) {
    tools.push(createCalculatorTool())
  }

  if (toolId.includes('datetime')) {
    tools.push(createDatetimeTool())
  }

  if (toolId.includes('encoding')) {
    tools.push(createEncodingTool())
  }

  if (toolId.includes('uuid')) {
    tools.push(createUuidTool())
  }

  if (toolId.includes('color')) {
    tools.push(createColorTool())
  }

  if (toolId.includes('execute_js')) {
    tools.push(createJavascriptTool({
      vfs: ctx?.vfs,
      onFileCreated: ctx?.onFileCreated
    }))
  }

  if (toolId.includes('search_wikipedia')) {
    tools.push(createWikipediaTool())
  }

  if (toolId.includes('validate_typescript')) {
    tools.push(createTypescriptTool())
  }

  if (toolId.includes('generate_image')) {
    tools.push(createImageTool({
      apiKey: ctx?.apiKey,
      providerId: ctx?.providerId,
      vfs: ctx?.vfs,
      vaultToken: ctx?.vaultToken,
      corsProxyUrl: ctx?.corsProxyUrl,
      onImageGenerated: ctx?.onImageGenerated
    }))
  }

  if (toolId.includes('create_docx')) {
    tools.push(createDocxTool({
      vfs: ctx?.vfs,
      onFileCreated: ctx?.onFileCreated
    }))
  }

  if (toolId.includes('pdf_tool')) {
    tools.push(createPdfTool({
      vfs: ctx?.vfs,
      onFileCreated: ctx?.onFileCreated,
      renderMermaid: ctx?.renderMermaid
    }))
  }

  if (toolId.includes('create_chart')) {
    tools.push(createChartTool({
      vfs: ctx?.vfs,
      onFileCreated: ctx?.onFileCreated
    }))
  }

  if (toolId.includes('weather')) {
    tools.push(createSearchLocationTool({
      weatherApiKeys: ctx?.weatherApiKeys,
      weatherApiEndpoint: ctx?.weatherApiEndpoint
    }))
    tools.push(createWeatherForecastTool({
      weatherApiKeys: ctx?.weatherApiKeys,
      weatherApiEndpoint: ctx?.weatherApiEndpoint
    }))
  }

  if (toolId.includes('execute_python_code')) {
    tools.push(createPythonTool({
      vfs: ctx?.vfs,
      onFileCreated: ctx?.onFileCreated,
      onAskQuestion: ctx?.onAskQuestion
    }))
  }

  return tools
}

// Re-export all individual tool creators for direct usage
export {
  createCalculatorTool,
  createDatetimeTool,
  createEncodingTool,
  createUuidTool,
  createColorTool,
  createJavascriptTool,
  createWikipediaTool,
  createTypescriptTool,
  createImageTool,
  createDocxTool,
  createPdfTool,
  createChartTool,
  createSearchLocationTool,
  createWeatherForecastTool,
  createPythonTool
}
