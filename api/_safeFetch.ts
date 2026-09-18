/// <reference types="node" />
import * as dns from 'node:dns/promises';
import * as net from 'node:net';

/**
 * Fetch a user-supplied URL without letting it reach anything internal.
 *
 * The server fetches pages on a student's behalf, so the URL is untrusted. The
 * checks: HTTPS on the default port only; every hostname must resolve to public
 * addresses only; redirects are followed by hand (at most three) and each hop is
 * re-checked, so a public URL cannot bounce the request to a private one; the
 * body is capped and read with a timeout; and only the expected content types
 * are accepted.
 *
 * Residual risk: DNS can change between the check and the connection (DNS
 * rebinding). Closing that fully needs connecting to a pinned IP.
 */

export class SafeFetchError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export function isPrivateIp(address: string): boolean {
  let ip = address.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 address it is.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||                 // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||                   // 192.0.0.0/24, 192.0.2.0/24
      (a === 100 && b >= 64 && b <= 127) ||       // carrier-grade NAT
      (a === 198 && (b === 18 || b === 19)) ||    // benchmarking
      a >= 224;                                   // multicast, reserved
  }
  if (type === 6) {
    return ip === '::1' || ip === '::' || ip.startsWith('::ffff:') ||
      /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff');
  }
  return true; // not an IP at all: refuse rather than guess
}

async function assertPublic(url: URL, lookup: typeof dns.lookup) {
  if (url.protocol !== 'https:') throw new SafeFetchError('https_required');
  if (url.port && url.port !== '443') throw new SafeFetchError('port_not_allowed');
  if (url.username || url.password) throw new SafeFetchError('credentials_in_url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SafeFetchError('private_address');
    return;
  }
  let records: { address: string }[];
  try { records = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new SafeFetchError('host_not_found'); }
  if (!records.length || records.some(r => isPrivateIp(r.address))) throw new SafeFetchError('private_address');
}

export async function safeFetch(rawUrl: string, opts: {
  accept: RegExp;                 // allowed content types
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  lookup?: typeof dns.lookup;
}): Promise<{ url: string; contentType: string; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup ?? dns.lookup;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new SafeFetchError('invalid_url'); }

  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublic(url, lookup);
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        redirect: 'manual', signal: deadline,
        headers: { 'User-Agent': 'Soma/1.0 course-schedule-import', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
      });
    } catch (error) {
      const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw new SafeFetchError(timedOut ? 'fetch_timeout' : 'fetch_failed', 502);
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) throw new SafeFetchError('bad_redirect', 502);
      url = new URL(next, url);                  // re-checked at the top of the loop
      continue;
    }
    if (!response.ok) throw new SafeFetchError(`upstream_${response.status}`, 502);
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!opts.accept.test(contentType)) throw new SafeFetchError('unsupported_content_type', 415);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new SafeFetchError('too_large', 413);

    // Read with a hard cap; a missing or lying content-length cannot exceed it.
    const reader = response.body?.getReader();
    if (!reader) return { url: url.toString(), contentType, body: '' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new SafeFetchError('too_large', 413); }
      chunks.push(value);
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks));
    return { url: url.toString(), contentType, body };
  }
  throw new SafeFetchError('too_many_redirects', 502);
}
