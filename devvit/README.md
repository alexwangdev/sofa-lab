# Moving to Devvit (later)

The game currently ships as a plain React + TypeScript web app. The "server" routes (`src/server/app.ts`) run inside the page through `src/client/backend.ts`, with an in-memory Redis that is saved to localStorage. Every route, Redis key, request body, and response is the same one Devvit will use, so moving over means changing the plumbing, not the game.

This folder holds the parts that only make sense on Devvit:

- `devvit.json`: app config (post entry, server entry, Redis + `SUBMIT_COMMENT` permissions, the 00:00 UTC daily-post scheduler, the moderator menu item, the install trigger, and the dev subreddit `gridexpedition_dev`).
- `server-index.ts`: the production server entry. It binds `createApp()` to Devvit's real `redis`, `reddit`, and `context` and serves it with Hono.

## Steps

1. `npm i @devvit/web@0.15.4 @devvit/start@0.15.4 devvit@0.15.4 @hono/node-server@2.1.6` (the versions Sofa Lab uses).
2. Move `devvit/devvit.json` to the repo root and `devvit/server-index.ts` to `src/server/index.ts`, then fix its imports: `../shared/rng.ts`, `./app.ts`, `./ports.ts`. Add `"types": ["node"]` to `tools/tsconfig.server.json`.
3. Replace `vite.config.ts` with the Devvit one:
   ```ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import tailwind from '@tailwindcss/vite';
   import { devvit } from '@devvit/start/vite';
   export default defineConfig({ plugins: [react(), tailwind(), devvit()] });
   ```
4. In `src/client/api.ts`, replace `localFetch` with `fetch`. Delete `src/client/backend.ts`, and remove `<DevToolbar />` from `App.tsx` (or keep it for local testing only).
5. Scripts: `"dev": "devvit playtest"`, `"login": "devvit login"`, `"build": "tsc --build && vite build"`.
6. `npm run login`, create the private subreddit `gridexpedition_dev`, run `npm run dev`, then run the spec §17 test 10 checklist. Keep the app private and playtest-only; do not submit it for publishing.

Tests (`npm test`) already exercise the routes with the in-memory Redis, so they keep passing unchanged.
