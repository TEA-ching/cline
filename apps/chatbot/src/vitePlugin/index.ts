// @sctg/cline-chatbot bundles its agent Web Worker as a standalone file with a
// hardcoded absolute URL (e.g. `/assets/agent.worker-<hash>.js`) that it expects
// the host app to serve as-is. This plugin copies that file from the package's
// dist-lib/assets into this app's dev server and build output so the hash always
// matches whatever version of the package is installed.
import {type Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url';
const dirname = path.dirname(fileURLToPath(import.meta.url));

export function sctgChatbotWorkerAssets(): Plugin {
  const assetsDir = path.resolve(dirname, 'node_modules/@sctg/cline-chatbot/dist-lib/assets');
  let outDir = 'dist';
  return {
    name: 'sctg-chatbot-worker-assets',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url.startsWith('/assets/')) {
          const filePath = path.join(assetsDir, path.basename(url));
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'text/javascript');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      if (!fs.existsSync(assetsDir)) return;
      const destDir = path.resolve(outDir, 'assets');
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(assetsDir)) {
        fs.copyFileSync(path.join(assetsDir, file), path.join(destDir, file));
      }
    },
  };
}
