import { test, expect } from '@playwright/test';
import { safeFetch, isPrivateIp } from '../api/_safeFetch';
import { createImportHandler, htmlToText, validateItems } from '../api/import-schedule';

// ── safeFetch: a user-supplied URL must never reach anything internal ───────
const publicLookup = (async () => [{ address: '104.18.0.1', family: 4 }]) as never;
const lookupFor = (map: Record<string, string>) => (async (host: string) => [{ address: map[host] ?? '104.18.0.1', family: 4 }]) as never;
const page = (body: string, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }, status = 200) =>
  (async () => new Response(body, { status, headers })) as typeof fetch;
const html = { accept: /^text\/(html|plain)\b/ };

test('private, loopback, metadata and mapped addresses are all refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254'])
    expect(isPrivateIp(ip), ip).toBe(true);
  for (const ip of ['104.18.0.1', '8.8.8.8', '2606:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
});

test('only https on the default port, no credentials in the URL', async () => {
  for (const [url, code] of [['http://cs61a.org', 'https_required'], ['https://cs61a.org:8443/', 'port_not_allowed'], ['https://user:pw@cs61a.org/', 'credentials_in_url'], ['not a url', 'invalid_url']]) {
    await expect(safeFetch(url, { ...html, lookup: publicLookup, fetchImpl: page('x') })).rejects.toMatchObject({ code });
  }
});

test('a hostname that resolves to a private address is refused before any request', async () => {
  let requested = false;
  await expect(safeFetch('https://internal.example/', { ...html, lookup: lookupFor({ 'internal.example': '10.0.0.5' }), fetchImpl: (async () => { requested = true; return new Response('x'); }) as typeof fetch }))
    .rejects.toMatchObject({ code: 'private_address' });
  expect(requested).toBe(false);
});

test('a public page cannot redirect the server to a private address', async () => {
  const fetchImpl = (async (url: string) => url.startsWith('https://cs61a.org')
    ? new Response(null, { status: 302, headers: { location: 'https://metadata.internal/latest' } })
    : new Response('secret')) as typeof fetch;
  await expect(safeFetch('https://cs61a.org/', { ...html, fetchImpl, lookup: lookupFor({ 'metadata.internal': '169.254.169.254' }) }))
    .rejects.toMatchObject({ code: 'private_address' });
});

test('redirect loops, wrong content types and oversized pages are refused', async () => {
  const loop = (async () => new Response(null, { status: 301, headers: { location: 'https://cs61a.org/again' } })) as typeof fetch;
  await expect(safeFetch('https://cs61a.org/', { ...html, lookup: publicLookup, fetchImpl: loop })).rejects.toMatchObject({ code: 'too_many_redirects' });
  await expect(safeFetch('https://cs61a.org/x.pdf', { ...html, lookup: publicLookup, fetchImpl: page('%PDF', { 'content-type': 'application/pdf' }) })).rejects.toMatchObject({ code: 'unsupported_content_type' });
  await expect(safeFetch('https://cs61a.org/', { ...html, maxBytes: 100, lookup: publicLookup, fetchImpl: page('x'.repeat(500)) })).rejects.toMatchObject({ code: 'too_large' });
});

test('a normal page is returned with its final URL', async () => {
  const result = await safeFetch('https://cs61a.org/', { ...html, lookup: publicLookup, fetchImpl: page('<p>Homework 3</p>') });
  expect(result.body).toContain('Homework 3');
  expect(result.url).toBe('https://cs61a.org/');
});

// ── Page reading ────────────────────────────────────────────────────────────
test('html becomes readable text with schedule rows kept apart', () => {
  const text = htmlToText('<script>alert(1)</script><table><tr><td>Lab 3</td><td>Due Wed 9/23</td></tr><tr><td>Homework 3</td><td>Due Thu 9/24</td></tr></table>');
  expect(text).not.toContain('alert');
  expect(text.split('\n').filter(l => l.includes('Due'))).toHaveLength(2);
});

test('items are validated: real dates only, in range, de-duplicated, and unquoted ones flagged', () => {
  const pageText = 'Lab 3 | Due Wed 9/23\nHomework 3 | Due Thu 9/24';
  const items = validateItems([
    { title: 'Lab 3', type: 'lab', due: '2026-09-23', time: null, evidence: 'Due Wed 9/23' },
    { title: 'Lab 3', type: 'lab', due: '2026-09-23', time: null, evidence: 'Due Wed 9/23' },     // duplicate
    { title: 'Homework 3', type: 'homework', due: '2026-09-24', time: '23:59', evidence: 'Due Thu 9/24' },
    { title: 'Project Hog', type: 'project', due: '2026-10-01', time: null, evidence: 'Due Thu 10/1' }, // not on page
    { title: 'Bad date', type: 'homework', due: '2026-02-30', evidence: 'x' },
    { title: 'Far future', type: 'homework', due: '2031-01-01', evidence: 'x' },
    { title: 'x'.repeat(200), due: '2026-09-25', evidence: 'x' },
    { title: 'Weird type', type: 'party', due: '2026-09-25', time: '9pm', evidence: '' },
  ], '2026-09-18', pageText);
  expect(items.map(i => i.title)).toEqual(['Lab 3', 'Homework 3', 'Weird type', 'Project Hog']);
  expect(items.find(i => i.title === 'Project Hog')?.unverified).toBe(true);
  expect(items.find(i => i.title === 'Lab 3')?.unverified).toBeUndefined();
  expect(items.find(i => i.title === 'Weird type')).toMatchObject({ type: 'other', time: null, unverified: true });
});

// ── The endpoint ────────────────────────────────────────────────────────────
function response() { let status = 200, body: any; return { res: { setHeader: () => {}, status(s: number) { status = s; return this; }, json(v: unknown) { body = v; return this; } }, result: () => ({ status, body }) }; }
const ok = async () => ({ ok: true as const, userId: 'alice' });
const cs61a = '<h2>CS 61A Fall 2026</h2><table><tr><td>Lab 3</td><td>Due Wed 9/23</td></tr><tr><td>Homework 3</td><td>Due Thu 9/24</td></tr></table>';

async function call(body: unknown, deps: Parameters<typeof createImportHandler>[0] = {}, auth = 'Bearer t') {
  const r = response();
  let prompt = '';
  await createImportHandler({
    authorize: ok, apiKey: () => 'k', limited: () => false,
    fetchPage: async url => ({ url, contentType: 'text/html', body: cs61a }),
    model: async (_s, user) => { prompt = user; return { text: JSON.stringify({ course: 'CS 61A', items: [
      { title: 'Lab 3', type: 'lab', due: '2026-09-23', time: null, evidence: 'Due Wed 9/23' },
      { title: 'Homework 3', type: 'homework', due: '2026-09-24', time: '23:59', evidence: 'Due Thu 9/24' },
    ] }) }; },
    ...deps,
  })({ method: 'POST', headers: { authorization: auth }, body }, r.res);
  return { ...r.result(), prompt };
}

test('reads a course page and returns its deadlines without writing anything', async () => {
  const r = await call({ url: 'https://cs61a.org/fa26/', today: '2026-09-18' });
  expect(r.status).toBe(200);
  expect(r.body.course).toBe('CS 61A');
  expect(r.body.items.map((i: { title: string }) => i.title)).toEqual(['Lab 3', 'Homework 3']);
  expect(r.prompt).toContain('<page source="https://cs61a.org/fa26/">');
});

test('pasted text works when a site needs a login', async () => {
  const r = await call({ text: 'Lab 3 | Due Wed 9/23\nHomework 3 | Due Thu 9/24', today: '2026-09-18' });
  expect(r.status).toBe(200);
  expect(r.prompt).toContain('pasted text');
});

test('requests without sign-in, without a date, or with both url and text are refused', async () => {
  expect((await call({ url: 'https://cs61a.org/', today: '2026-09-18' }, {}, '')).status).toBe(401);
  expect((await call({ url: 'https://cs61a.org/' })).status).toBe(400);
  expect((await call({ url: 'https://cs61a.org/', text: 'x', today: '2026-09-18' })).status).toBe(400);
  expect((await call({ url: 'https://cs61a.org/', today: '2026-09-18' }, { authorize: async () => ({ ok: false, status: 402, error: 'subscription_required' }) })).status).toBe(402);
});

test('an unsafe URL is reported, and unreadable model output never becomes items', async () => {
  const { SafeFetchError } = await import('../api/_safeFetch');
  const unsafe = await call({ url: 'https://internal/', today: '2026-09-18' }, { fetchPage: async () => { throw new SafeFetchError('private_address'); } });
  expect(unsafe).toMatchObject({ status: 400, body: { error: 'private_address' } });
  const junk = await call({ url: 'https://cs61a.org/', today: '2026-09-18' }, { model: async () => ({ text: 'Sure! Here are the dates…' }) });
  expect(junk).toMatchObject({ status: 502, body: { error: 'unreadable_response' } });
  const cut = await call({ url: 'https://cs61a.org/', today: '2026-09-18' }, { model: async () => ({ text: '{"items":[', stopReason: 'max_tokens' }) });
  expect(cut).toMatchObject({ status: 502, body: { error: 'response_incomplete' } });
});

test('a meta-refresh stub (as cs61a.org serves) is followed to the real page', async () => {
  const { metaRefreshTarget } = await import('../api/import-schedule');
  const stub = '<!doctype html><meta http-equiv="refresh" content="0; url=/fa26/"><p>Redirecting…</p>';
  expect(metaRefreshTarget(stub, 'https://cs61a.org/')).toBe('https://cs61a.org/fa26/');
  expect(metaRefreshTarget('<p>no refresh</p>', 'https://cs61a.org/')).toBeNull();

  const fetched: string[] = [];
  const r = await call({ url: 'https://cs61a.org/', today: '2026-09-18' }, {
    fetchPage: async url => { fetched.push(url); return url.endsWith('/fa26/') ? { url, contentType: 'text/html', body: cs61a } : { url, contentType: 'text/html', body: stub }; },
  });
  expect(fetched).toEqual(['https://cs61a.org/', 'https://cs61a.org/fa26/']);
  expect(r.body.source).toBe('https://cs61a.org/fa26/');
});
