import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { githubPagesSpa } from "@sctg/vite-plugin-github-pages-spa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Use environment variable for base URL, default to './' for local development
  const baseUrl = process.env.BASE_URL || './';

  return {
    plugins: [react(), tailwindcss(), githubPagesSpa()],

    // Base path for deployment
    base: baseUrl,

    // Resolve aliases
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    // Build configuration
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      minify: 'terser',
    },

    // Server configuration
    server: {
      port: 3000,
      open: true,
    },
  };
});
