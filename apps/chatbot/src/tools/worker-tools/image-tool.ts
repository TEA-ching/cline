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
import { createTool } from '@sctg/cline-agents'
import { z } from 'zod'
import type { AgentTool } from '@sctg/cline-agents'
import type { VirtualFS } from '@/vfs/virtual-fs'

interface ImageToolContext {
  apiKey?: string
  providerId?: string
  vfs?: VirtualFS
  vaultToken?: string
  corsProxyUrl?: string
  onImageGenerated?: (url: string, vfsPath: string) => void
}

export function createImageTool(ctx?: ImageToolContext): AgentTool<any, any> {
  return createTool({
    name: 'generate_image',
    description:
      'Generate an image from a text description using Mistral image generation. ' +
      'The generated image is automatically displayed in the chat interface — do NOT write a markdown image ' +
      'tag (![...](...)) or any file path in your response. Simply confirm to the user that the image ' +
      'has been generated and describe it briefly. ' +
      'Only works with Mistral models that have image generation capability.',
    inputSchema: z.object({
      description: z.string().describe('Detailed text description of the image to generate'),
    }),
    timeoutMs: 60_000,
    execute: async ({ description }) => {
      if (!ctx?.apiKey) return { success: false, error: 'No API key configured.' }

      const response = await fetch('https://api.mistral.ai/v1/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({
          model: ctx.providerId === 'mistral' ? 'mistral-medium-latest' : 'mistral-medium-latest',
          inputs: [{ role: 'user', content: description }],
          tools: [{ type: 'image_generation' }],
          completion_args: { temperature: 0.7, max_tokens: 2048 },
        }),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        return { success: false, error: `Mistral API error ${response.status}: ${errText}` }
      }

      // biome-ignore lint/suspicious/noExplicitAny: Mistral API response shape
      const data: any = await response.json()
      // biome-ignore lint/suspicious/noExplicitAny: Mistral API response shape
      const output = data.outputs?.find((o: any) => o.info?.result != null)
      if (!output) return { success: false, error: 'No image generated in the response.' }

      const { url } = JSON.parse(output.info.result) as { url: string }

      const vfsPath = `generated_images/img_${Date.now()}.jpg`

      // Vault mode: download the actual image binary via the CORS proxy so the
      // file stored in VFS is a real JPEG (not just a signed URL that expires).
      if (ctx.vaultToken && ctx.corsProxyUrl) {
        try {
          const proxyResponse = await fetch(
            `${ctx.corsProxyUrl}?url=${encodeURIComponent(url)}`,
            { headers: { Authorization: `Bearer ${ctx.vaultToken}` } },
          )
          if (proxyResponse.ok) {
            const arrayBuffer = await proxyResponse.arrayBuffer()
            const bytes = new Uint8Array(arrayBuffer)
            let binary = ''
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
            const base64 = btoa(binary)
            const dataUrl = `data:image/jpeg;base64,${base64}`
            ctx.onImageGenerated?.(dataUrl, vfsPath)
            return {
              success: true,
              vfsPath,
              message: 'Image displayed in chat. Do NOT write a markdown image or file path — just confirm to the user.',
            }
          }
        } catch {
          // proxy failed — fall through to signed-URL mode
        }
      }

      // BYOK mode (or proxy unavailable): use the signed URL directly.
      // The browser can render it via <img> without CORS restrictions.
      ctx.onImageGenerated?.(url, vfsPath)
      return {
        success: true,
        vfsPath,
        message: 'Image displayed in chat. Do NOT write a markdown image or file path — just confirm to the user.',
      }
    },
  })
}
