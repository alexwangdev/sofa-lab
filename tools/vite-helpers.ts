/** Pieces shared by vite.config.ts (Devvit build) and vite.web.config.ts (standalone web build). */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Atlas version: a hash of the baked atlas files (npm run atlas runs before every build and dev start). The client adds
 * it to every atlas URL, so a redeploy with new atlases never mixes a cached old page with a new index.
 */
export function atlasVersion(): string {
  const dir = resolve(process.cwd(), 'src/client/public/atlas');
  if (!existsSync(dir)) return 'none';
  const h = createHash('sha256');
  for (const f of readdirSync(dir).sort()) h.update(f).update(readFileSync(resolve(dir, f)));
  return h.digest('hex').slice(0, 12);
}
