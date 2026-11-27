// Devvit build (the game on Reddit): client → dist/client, server (src/server/index.ts) → dist/server/index.cjs.
// The standalone web build for local testing is vite.web.config.ts (npm run web).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { devvit } from '@devvit/start/vite';
import { atlasVersion } from './tools/vite-helpers.ts';

export default defineConfig({
  define: { __ATLAS_VERSION__: JSON.stringify(atlasVersion()) },
  plugins: [react(), tailwind(), devvit()],
});
