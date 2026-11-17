/// <reference types="node" />
// Crash reports from the Epoch game (/game). No sign-in: the game posts
// { message, stack, url, ua, build } when it hits an uncaught error, and the
// report goes to the function logs only, on one line starting "epoch_game_error".
// Nothing is stored. Sizes are capped, query strings and fragments are cut from
// the page URL, and each IP may send a few reports a minute.
import { isRateLimited } from './_rateLimit';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const pageUrl = (value: unknown) => text(value, 500).replace(/[?#].*$/, '');

/** The report as logged: capped strings only, never anything else from the body. */
export function cleanReport(body: unknown) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return {
    message: text(b.message, 500),
    stack: text(b.stack, 4000),
    url: pageUrl(b.url),
    ua: text(b.ua, 300),
    build: text(b.build, 64),
  };
}

export default function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (isRateLimited(req, 'game-error', { windowMs: 60_000, max: 10 })) return res.status(204).end();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const report = cleanReport(body);
  if (report.message || report.stack) console.error(`epoch_game_error ${JSON.stringify(report)}`);
  return res.status(204).end();
}
