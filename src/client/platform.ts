/**
 * Platform switch, Devvit version (the default). On Reddit the routes are served by the Devvit server
 * (src/server/index.ts), so the client uses plain fetch and has no test toolbar.
 *
 * The standalone web build (vite.web.config.ts) swaps this file for platform.local.ts, which answers requests in the
 * page and adds the TEST toolbar. Keeping the switch in one file keeps all server code out of the Reddit bundle.
 */
import type { ComponentType } from 'react';
import type { DevToolbarProps } from './DevToolbar.tsx';

export const apiFetch = (path: string, init?: RequestInit): Promise<Response> => fetch(path, init);
export const DevToolbar: ComponentType<DevToolbarProps> | null = null;
