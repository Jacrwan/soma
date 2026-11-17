import type { Plugin } from 'vite';
/** Dev-only POST /api/practice for the Epoch Study Hall (server-side key, localhost only). */
export function epochPractice(): Plugin;
export function cleanRequest(body: unknown): { system: string; content: string } | null;
