// Standalone web build for local testing (npm run web / npm run build:web): no Devvit, no Reddit. The "server" routes
// run in the page (src/client/backend.ts); platform.ts is swapped for platform.local.ts. The Reddit build is vite.config.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { atlasVersion } from './tools/vite-helpers.ts';

/**
 * Dev-only: POST a data URL to /__dev/shot?name=x and it is written to .shots/x.jpg, so automated playtests can save
 * full-resolution canvas frames. Not part of the build.
 */
function devShots(): Plugin {
  return {
    name: 'grid-expedition-dev-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^a-z0-9_-]/gi, '');
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          const dir = resolve(process.cwd(), '.shots');
          mkdirSync(dir, { recursive: true });
          const file = resolve(dir, `${name}.jpg`);
          writeFileSync(file, Buffer.from(b64, 'base64'));
          res.end(file);
        });
      });
    },
  };
}

/** Local platform: every import of './platform.ts' gets './platform.local.ts' (in-page server + TEST toolbar). */
function localPlatform(): Plugin {
  return {
    name: 'grid-expedition-local-platform',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== './platform.ts' || !importer) return null;
      return this.resolve('./platform.local.ts', importer, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig({
  define: { __ATLAS_VERSION__: JSON.stringify(atlasVersion()) },
  root: 'src/client',
  // relative asset paths: dist/ works from any static host or sub-folder
  base: './',
  plugins: [localPlatform(), react(), tailwind(), devShots()],
  server: { port: 5177, strictPort: true },
  preview: { port: 5178, strictPort: true },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
