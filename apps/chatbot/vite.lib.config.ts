import { defineConfig, type LibraryFormats } from 'vite'
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
// - react/react-dom and @sctg/cline-agents|llms|shared are externalized (peer/regular
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
      'import.meta.env.___SDK_VERSION_DATETIME___': JSON.stringify(process.env.SDK_VERSION_DATETIME ?? `${sdkVersion}-1974-05-26T13:00:00Z`),
      'import.meta.env.___BUILD_DATETIME___': new Date(process.env.DATETIME ?? '1974-05-26T13:00:00Z'),
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
        include: ['src/index.ts', 'src/Chatbot.tsx', 'src/hooks/useVault.tsx', 'src/vitePlugin/index.ts'],
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
        // between @sctg/cline-agents's dist and @sctg/cline-llms's browser dist
        // (MISSING_EXPORT createGateway). Aliasing to source — same trick
        // vite.config.ts uses for the app build — sidesteps that dist entirely.
        { find: '@sctg/cline-agents', replacement: fileURLToPath(new URL('../../sdk/packages/agents/src/index.ts', import.meta.url)) },
        { find: '@sctg/cline-llms', replacement: fileURLToPath(new URL('../../sdk/packages/llms/src/index.ts', import.meta.url)) },
        { find: '@sctg/cline-shared', replacement: fileURLToPath(new URL('../../sdk/packages/shared/src/index.browser.ts', import.meta.url)) },
        // Stub the Node.js-only debug capture module (uses node:crypto) — see vite.config.ts.
        {
          find: /^(.+\/)?provider-request-capture(\.ts)?$/,
          replacement: fileURLToPath(new URL('./src/stubs/provider-request-capture.stub.ts', import.meta.url)),
        },
      ],
    },

    worker: {
      format: 'es' as const,
    },

    experimental: {
      // Vite's `?worker` transform bakes the agent worker's URL as a
      // domain-root-absolute string (e.g. "/assets/agent.worker-<hash>.js")
      // in library mode, since it has no host `base` to anchor to at this
      // package's own build time. That breaks once a host app deploys under
      // a non-root base (e.g. GitHub Pages project sites): the browser
      // resolves the leading "/" against the origin, not the host's base,
      // 404ing the worker script.
      // Rewriting it to `new URL(relativePath, import.meta.url)` instead
      // defers URL resolution to the host's own build: Vite's static-asset
      // analysis recognizes that pattern in ANY module it processes
      // (including this package's compiled dist-lib/index.js inside the
      // host's node_modules), copies dist-lib/assets/agent.worker-*.js into
      // the host's own output with the correct base prefix, and rewrites the
      // reference accordingly — exactly like the host's own first-party
      // assets already work.
      renderBuiltUrl(filename, { type }) {
        if (type === 'asset' && filename.endsWith('.js')) {
          return { runtime: `new URL(${JSON.stringify(`./${filename}`)}, import.meta.url).href` }
        }
      },
    },

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
        // Two independent entries: the browser-facing <Chatbot /> component
        // (index) and the Node-only Vite plugin (vite-plugin) that host
        // apps need in their own vite.config.ts to copy the agent Web
        // Worker's sibling chunk files into their own build output (see
        // src/vitePlugin/index.ts for why). They share this one rolldown
        // build for convenience, but there is no import between them —
        // src/index.ts never references src/vitePlugin — so the Node-only
        // plugin code (node:fs/node:path/node:url, externalized below) never
        // reaches the browser output chunk.
        //
        // The vite-plugin entry key is deliberately flat (no subdirectory)
        // rather than 'vitePlugin/index': vite-plugin-dts's rollupTypes
        // step derives each entry's rolled-up .d.ts output path from
        // `basename(path)`, which drops any subdirectory — with a nested
        // entry key that collapses to the same "index.d.ts" basename as
        // the main entry, so both rollup passes race to write
        // dist-lib/index.d.ts and whichever finishes last silently
        // clobbers the other (this is how Chatbot disappeared from
        // dist-lib/index.d.ts). A flat key keeps the two output filenames
        // distinct and sidesteps the collision.
        entry: {
          index: resolve(__dirname, 'src/index.ts'),
          'vite-plugin': resolve(__dirname, 'src/vitePlugin/index.ts'),
        },
        formats: ['es'] as LibraryFormats[],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rolldownOptions: {
        // @sctg/cline-agents|llms|shared are bundled from source (see resolve.alias
        // above), not externalized — only the host app's own React (and its
        // transitive `use-sync-external-store` shim, see below) is external.
        external: [
          'react',
          'react/jsx-runtime',
          'react-dom',
          'react-dom/client',
          // react-aria/react-stately (HeroUI's foundation) pull in this CJS-only
          // package. When it's bundled into the lib output, rolldown wraps its
          // `require("react")` call as a synthetic `__require("react")` runtime
          // call instead of hoisting it to the external ESM `react` import —
          // there is no global `require` in a browser, so this throws at
          // runtime ("Calling `require` for react in an environment that
          // doesn't expose the `require` function"). Externalizing the whole
          // package sidesteps rolldown's CJS interop for it entirely: the
          // specifier is resolved from the host app's own node_modules
          // instead, where its bundler's standard dependency pre-bundling
          // converts it to ESM correctly. Every consumer of react-aria (i.e.
          // any HeroUI/React Aria/React Spectrum host, which this package
          // requires) already has it installed transitively.
          /^use-sync-external-store(\/.*)?$/,
          // vitePlugin/index.ts only runs inside the host's `vite` process
          // (Node), never in the browser bundle — externalize its Node/Vite
          // imports instead of bundling them.
          'vite',
          'node:fs',
          'node:path',
          'node:url',
        ],
        output: {
          // Force a single, predictable stylesheet name so package.json's
          // "./style.css" export always resolves regardless of Vite's default
          // asset-naming scheme.
          assetFileNames: 'style.css',
          format: 'es' as const,
        },
      },
    },
  }
})
