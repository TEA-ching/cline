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
import {MarkdownDocx, Packer, type MarkdownDocxOptions } from 'markdown-docx'

interface DocxToolContext {
  vfs?: VirtualFS
  onFileCreated?: (path: string, content: string) => void
}

export function createDocxTool(ctx?: DocxToolContext): AgentTool<any, any> {
  return createTool({
    name: 'create_docx',
    description:
      'Create a DOCX document from Markdown content. Converts Markdown to Word document format (DOCX). ' +
      'The generated DOCX file is saved to the virtual filesystem and can be downloaded by the user. ' +
      'Supports standard Markdown syntax including headings, lists, tables, links, and images.' +
      'DOCX documents cannot be edited after creation, so you need to create a new one if you want to make changes.',
    inputSchema: z.object({
      markdown: z.string().describe('Markdown content to convert to DOCX'),
      filename: z.string().optional().default('document.docx').describe(
        'Output filename for the DOCX file (e.g., "report.docx")'
      ),
    }),
    timeoutMs: 30_000,
    execute: async ({ markdown, filename }) => {
      try {
        // Convert Markdown to DOCX
        const converter = new MarkdownDocx(markdown)

        const config: MarkdownDocxOptions = { }

        const doc = await converter.toDocument()

        // Generate DOCX blob
        const blob = await Packer.toBlob(doc)

        // Convert blob to base64 for storage in VFS (browser-safe, no Buffer)
        const arrayBuffer = await blob.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const base64Content = btoa(binary)
        const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        const dataUrl = `data:${mimeType};base64,${base64Content}`

        // Save to virtual filesystem
        const vfsPath = filename
        if (ctx?.vfs) {
          ctx.vfs.write(vfsPath, base64Content, mimeType)
          ctx.onFileCreated?.(vfsPath, dataUrl)
        }

        return {
          success: true,
          vfsPath,
          filename,
          size: blob.size,
          message: 'DOCX document created successfully and saved to virtual filesystem'
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create DOCX document',
          message: 'DOCX creation error'
        }
      }
    },
  })
}
