import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  return {
    define: {
      "import.meta.env.KEYPOOL_VAULT_URL": JSON.stringify(process.env.KEYPOOL_VAULT_URL ?? 'https://vault.exemple.com'),
      "import.meta.env.KEYPOOL_USAGE_DB": JSON.stringify(process.env.KEYPOOL_USAGE_DB_DIR ?? 'https://usage-db.exemple.com/v1/keypool/usage'),
      // Polyfill Node.js `process` for browser/Worker builds.
      // isBrowserEnvironment() checks window.document — false in a Worker —
      // so vendor files fall through to process.env / process.listeners etc.
      "process.env": "{}",
      "process.pid": "0",
      "process.platform": JSON.stringify("browser"),
      "process.version": JSON.stringify("v0.0.0"),
      "process.cwd": "(() => '/')",
      "process.listeners": "(() => [])",
      "process.once": "(() => {})",
      "process.removeListener": "(() => {})",
      "process.exit": "(() => {})",
    },
    plugins: [
      react(),
      tailwindcss(),
      viteStaticCopy({
        targets: [
          { src: 'node_modules/pyodide/pyodide.mjs',       dest: 'pyodide' },
          { src: 'node_modules/pyodide/pyodide.asm.mjs',    dest: 'pyodide' },
          { src: 'node_modules/pyodide/pyodide.asm.wasm',  dest: 'pyodide' },
          { src: 'node_modules/pyodide/python_stdlib.zip', dest: 'pyodide' },
          { src: 'node_modules/pyodide/pyodide-lock.json', dest: 'pyodide' },
        ],
      }),
    ],

    resolve: {
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        // Point workspace packages to TypeScript sources (bypass pre-built dist bundles
        // that have bare specifiers not resolvable in Worker context).
        { find: '@cline/agents', replacement: fileURLToPath(new URL('../../sdk/packages/agents/src/index.ts', import.meta.url)) },
        { find: '@cline/llms',   replacement: fileURLToPath(new URL('../../sdk/packages/llms/src/index.ts', import.meta.url)) },
        { find: '@cline/shared', replacement: fileURLToPath(new URL('../../sdk/packages/shared/src/index.browser.ts', import.meta.url)) },
        // Stub the Node.js-only debug capture module (uses node:crypto).
        // Regex matches both "./provider-request-capture" and any prefixed variant.
        {
          find: /^(.+\/)?provider-request-capture(\.ts)?$/,
          replacement: fileURLToPath(new URL('./src/stubs/provider-request-capture.stub.ts', import.meta.url)),
        },
      ],
    },

    worker: {
      format: 'es',
    },

    server: {
      port: 3001,
      open: true,
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      minify: 'terser',
      target: 'esnext',
    },

    mode,
  }
})
