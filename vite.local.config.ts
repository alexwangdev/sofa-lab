// Local mode: the client with Vite + the real server routes (src/server/app.ts) on in-memory Redis/Reddit fakes.
// No Devvit, no Reddit. Server code is reloaded on every request, so server edits apply without a restart.
import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { getRequestListener } from '@hono/node-server';
import { fileURLToPath } from 'node:url';

const SERVER_ENTRY = fileURLToPath(new URL('./src/server/local.ts', import.meta.url));

function localServer(): Plugin {
  return {
    name: 'sofa-lab-local-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/') && !req.url?.startsWith('/internal/')) return next();
        server
          .ssrLoadModule(SERVER_ENTRY)
          .then((mod) => {
            const app = mod.getLocalApp();
            return getRequestListener(app.fetch)(req, res);
          })
          .catch((err: unknown) => {
            server.config.logger.error(String(err));
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          });
      });
    },
  };
}

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwind(), localServer()],
  server: { port: 5199, strictPort: true },
});
