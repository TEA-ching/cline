// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// @sctg/cline-chatbot's agent runs in a Web Worker (agent.worker.ts) that
// dynamically imports several of its own modules (@cline/agents, vfs,
// rag-index, tool implementations for PDF/DOCX/weather/TS-validation/etc).
// Vite code-splits those into ~90 sibling chunk files next to
// dist-lib/assets/agent.worker-<hash>.js.
//
// The worker script's OWN URL is discovered automatically by any Vite host
// build via a `new URL('./assets/agent.worker-<hash>.js', import.meta.url)`
// reference baked into dist-lib/index.js (see vite.lib.config.ts's
// `experimental.renderBuiltUrl`) — no plugin needed for that part, and it's
// correctly base-prefixed for any deployment path.
//
// But the sibling chunks are only ever referenced by the worker script's own
// (already pre-built) `import()` calls, which Vite treats as opaque asset
// bytes it never re-parses — so it has no way to discover and copy them on
// its own. This plugin's only job is to copy the whole dist-lib/assets/
// folder into the host's own build output so those sibling chunks are
// present alongside the worker script when it's deployed.
import { type Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// This module is compiled to dist-lib/vite-plugin.js inside the installed
// package (a flat filename, not nested — see the entry key comment in
// vite.lib.config.ts for why), so dist-lib/assets/ is its sibling directory —
// NOT reachable through another node_modules/@sctg/cline-chatbot hop (that
// path only made sense when this logic lived directly in a host's
// vite.config.ts).
const dirname = path.dirname(fileURLToPath(import.meta.url))

export function sctgChatbotWorkerAssets(): Plugin {
  const assetsDir = path.resolve(dirname, 'assets')
  let outDir = 'dist'
  return {
    name: 'sctg-chatbot-worker-assets',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      if (!fs.existsSync(assetsDir)) return
      const destDir = path.resolve(outDir, 'assets')
      fs.mkdirSync(destDir, { recursive: true })
      for (const file of fs.readdirSync(assetsDir)) {
        fs.copyFileSync(path.join(assetsDir, file), path.join(destDir, file))
      }
    },
  }
}
