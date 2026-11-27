/**
 * Platform switch, standalone web version (vite.web.config.ts resolves './platform.ts' to this file): the real routes
 * run inside the page (backend.ts) and the TEST toolbar is available on the dev server.
 */
import type { ComponentType } from 'react';
import { localFetch } from './backend.ts';
import { DevToolbar as Toolbar } from './DevToolbar.tsx';
import type { DevToolbarProps } from './DevToolbar.tsx';

export const apiFetch = localFetch;
export const DevToolbar: ComponentType<DevToolbarProps> | null = Toolbar;
