import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Library build for the published @sctg/cline-chatbot package: exports <Chatbot />
// for consumption by a host React 19 app, instead of the standalone SPA in
// vite.config.ts (which bundles everything, including @cline/* from raw source,
// into a single deployable dist/).
//
// Differences from vite.config.ts that matter here:
// - react/react-dom and @cline/agents|llms|shared are externalized (peer/regular
//   deps resolved from the consumer's own node_modules), not bundled from source.
// - No import.meta.env.KEYPOOL_VAULT_URL-style baked defaults: the <Chatbot> props
//   are the runtime source of truth (see src/hooks/useVault.tsx).
export default defineConfig(() =>   {
  let sdkVersion = '0.0.0'
  try {
    const sdkPackagePath = resolve(__dirname, '../../sdk/packages/sdk/package.json')
    sdkVersion = JSON.parse(readFileSync(sdkPackagePath, 'utf-8')).version
  } catch (error) {
    console.warn('Unable to read SDK version:', error)
  }

  return {
    define: {
      'import.meta.env.KEYPOOL_VAULT_URL': JSON.stringify(''),
      'import.meta.env.KEYPOOL_USAGE_DB': JSON.stringify(''),
      'import.meta.env.GITHUB_CLIENT_ID': JSON.stringify(''),
      'import.meta.env.___SDK_VERSION___': JSON.stringify(sdkVersion),
      // Polyfill Node.js `process` for browser/Worker builds — see vite.config.ts.
      'process.env': '{}',
      'process.pid': '0',
      'process.platform': JSON.stringify('browser'),
      'process.version': JSON.stringify('v0.0.0'),
      'process.cwd': "(() => '/')",
      'process.listeners': '(() => [])',
      'process.once': '(() => {})',
      'process.removeListener': '(() => {})',
      'process.exit': '(() => {})',
    },

    plugins: [
      react(),
      tailwindcss(),
      dts({
        entryRoot: 'src',
        include: ['src/index.ts', 'src/Chatbot.tsx', 'src/hooks/useVault.tsx'],
        rollupTypes: true,
        insertTypesEntry: true,
      }),
      viteStaticCopy({
        targets: [
          { src: 'node_modules/pyodide/pyodide.mjs', dest: 'pyodide', rename: { stripBase: true } },
          { src: 'node_modules/pyodide/pyodide.asm.mjs', dest: 'pyodide', rename: { stripBase: true } },
          { src: 'node_modules/pyodide/pyodide.asm.wasm', dest: 'pyodide', rename: { stripBase: true } },
          { src: 'node_modules/pyodide/python_stdlib.zip', dest: 'pyodide', rename: { stripBase: true } },
          { src: 'node_modules/pyodide/pyodide-lock.json', dest: 'pyodide', rename: { stripBase: true } },
        ],
      }),
    ],

    resolve: {
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        // Bundle @cline/* from TypeScript source rather than externalizing them.
        // Externalizing broke worker sub-builds: Vite's worker plugin runs an
        // independent bundle per worker entry that does NOT honor the main
        // build's rollupOptions.external, and falls back to resolving the
        // pre-built sdk dist/ output, which has a bare-specifier mismatch
        // between @cline/agents's dist and @cline/llms's browser dist
        // (MISSING_EXPORT createGateway). Aliasing to source — same trick
        // vite.config.ts uses for the app build — sidesteps that dist entirely.
        { find: '@cline/agents', replacement: fileURLToPath(new URL('../../sdk/packages/agents/src/index.ts', import.meta.url)) },
        { find: '@cline/llms', replacement: fileURLToPath(new URL('../../sdk/packages/llms/src/index.ts', import.meta.url)) },
        { find: '@cline/shared', replacement: fileURLToPath(new URL('../../sdk/packages/shared/src/index.browser.ts', import.meta.url)) },
        // Stub the Node.js-only debug capture module (uses node:crypto) — see vite.config.ts.
        {
          find: /^(.+\/)?provider-request-capture(\.ts)?$/,
          replacement: fileURLToPath(new URL('./src/stubs/provider-request-capture.stub.ts', import.meta.url)),
        },
      ],
    },

    // worker: {
    //   format: 'es',
    // },

    build: {
      outDir: 'dist-lib',
      emptyOutDir: true,
      // No sourcemaps in the published package — they roughly double dist-lib's
      // size (pyodide/mermaid/pdf deps are already heavy) for limited benefit
      // to a downstream consumer debugging their own app, not this library.
      sourcemap: false,
      minify: false,
      target: 'esnext',
      cssCodeSplit: false,
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rolldownOptions: {
        // @cline/agents|llms|shared are bundled from source (see resolve.alias
        // above), not externalized — only the host app's own React is external.
        external: [
          'react',
          'react/jsx-runtime',
          'react-dom',
          'react-dom/client',
        ],
        output: {
          // Force a single, predictable stylesheet name so package.json's
          // "./style.css" export always resolves regardless of Vite's default
          // asset-naming scheme.
          assetFileNames: 'style.css',
          format: 'es',
        },
      },
    },
  }
})
