// Beta analytics: Vercel Web Analytics (the same project as Soma). Page views come
// for free; track() sends a few named moments so we can see where students get
// to and where they stop. No personal data, no assignment names, only counts.
import { inject, track as vercelTrack } from '@vercel/analytics';

let on = false;

export function startTelemetry() {
  if (import.meta.env?.DEV || on) return;
  try {
    inject({ mode: 'production', framework: 'epoch' });
    on = true;
  } catch { /* blocked: the game works the same */ }
}

/** name: short snake_case; props: a few numbers or short words. */
export function track(name, props = undefined) {
  if (!on) return;
  try { vercelTrack(name, props); } catch { /* ignore */ }
}
