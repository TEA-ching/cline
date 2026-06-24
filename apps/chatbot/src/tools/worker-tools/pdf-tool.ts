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
import { generatePdfFromMarkdown } from './pdf-helpers'

interface PdfToolContext {
  vfs?: VirtualFS
  onFileCreated?: (path: string, content: string) => void
  renderMermaid?: (src: string) => Promise<string>
}

export function createPdfTool(ctx?: PdfToolContext): AgentTool<any, any> {
  return createTool({
    name: 'pdf_tool',
    description: [
      'Generate a PDF from Markdown or extract text from an existing PDF in the VFS.',
      'Generation supports: headings (H1-H3), paragraphs with bold/italic/code inline, ordered and',
      'unordered nested lists, fenced code blocks (grey background), tables, horizontal rules,',
      'blockquotes, images (data URL / VFS path / HTTPS URL), and Mermaid diagrams (rendered as PNG).',
      'LIMITATION: the built-in PDF fonts (Helvetica / Courier) only cover Latin characters',
      '(WinAnsi encoding). Emoji and non-Latin Unicode characters (CJK, Arabic, etc.) are',
      'automatically stripped from the output. Use plain Latin text to avoid invisible content.',
    ].join(' '),
    inputSchema: z.discriminatedUnion('operation', [
      z.object({
        operation: z.literal('generate'),
        content: z.string().describe('Markdown or text content to convert to PDF'),
        filename: z.string().default('document.pdf'),
      }),
      z.object({
        operation: z.literal('extract'),
        path: z.string().describe('Path to the PDF file in the VFS'),
      }),
    ]),
    execute: async (input) => {
      if (input.operation === 'generate') {
        return await generatePdfFromMarkdown(input.content, ctx ?? {}, input.filename)
      } else {
        // Extract text from an existing PDF
        const { getDocument } = await import('pdfjs-dist');
        const content = ctx?.vfs?.read(input.path);
        if (!content) return { error: `File ${input.path} not found` };
        const binary = atob(content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const pdf = await getDocument({ data: bytes }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          fullText += `\n--- Page ${i} ---\n${pageText}`;
        }
        return { success: true, text: fullText, pages: pdf.numPages };
      }
    },
    timeoutMs: 30_000,
  })
}
