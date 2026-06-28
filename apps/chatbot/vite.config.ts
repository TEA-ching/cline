import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  // Lire la version du SDK depuis le package.json
  let sdkVersion = '0.0.0';
  try {
    const sdkPackagePath = resolve(__dirname, '../../sdk/packages/sdk/package.json');
    const packageJson = JSON.parse(readFileSync(sdkPackagePath, 'utf-8'));
    sdkVersion = packageJson.version;
  } catch (error) {
    console.warn('Impossible de lire la version du SDK:', error);
  }

  return {
    define: {
      "import.meta.env.KEYPOOL_VAULT_URL": JSON.stringify(process.env.KEYPOOL_VAULT_URL ?? 'https://vault.exemple.com'),
      "import.meta.env.KEYPOOL_USAGE_DB": JSON.stringify(process.env.KEYPOOL_USAGE_DB_DIR ?? 'https://usage-db.exemple.com/v1/keypool/usage'),
      "import.meta.env.GITHUB_CLIENT_ID": JSON.stringify(process.env.GITHUB_CLIENT_ID ?? (process.env._GITHUB_CLIENT_ID ?? '')),
      // La version du SDK exposée globalement
      "import.meta.env.___SDK_VERSION___": JSON.stringify(sdkVersion),
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
        // Point workspace packages to TypeScript sources (bypass pre-built dist bundles
        // that have bare specifiers not resolvable in Worker context).
        { find: '@cline/agents', replacement: fileURLToPath(new URL('../../sdk/packages/agents/src/index.ts', import.meta.url)) },
        { find: '@cline/llms', replacement: fileURLToPath(new URL('../../sdk/packages/llms/src/index.ts', import.meta.url)) },
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
      headers: {
        // Required for SharedArrayBuffer (used by pyodide-http for synchronous fetch in Workers).
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      proxy: {
        // Forward GitHub OAuth endpoints server-side to bypass browser CORS restrictions.
        // Maps /api/github/* → https://github.com/login/*
        // Production uses the vault CORS proxy instead (see useGitHubAuth.ts).
        '/api/github': {
          target: 'https://github.com/login',
          changeOrigin: true,
          rewrite: (path: string) => path.replace('/api/github', ''),
        },
      },
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
