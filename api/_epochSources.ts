/// <reference types="node" />
// What a student brings to an Epoch study kit, turned into plain text on the
// server (ported from the game's dev server, game/server/sources.js).
// - Files: PDF (text layer, or read by Claude when it's a scan), Word .docx,
//   PowerPoint .pptx, plain text / Markdown, and photos of notes (read by Claude).
// - Video: a YouTube link, using the video's own captions.
// Nothing here logs file contents.
import { extractText, getDocumentProxy } from 'unpdf';
import { extractRawText } from 'mammoth';
import JSZip = require('jszip');

/**
 * Vercel refuses request bodies over about 4.5 MB, and base64 adds a third,
 * so a file is capped at 3 MB here (the dev server allows 20 MB).
 */
export const SOURCE_MAX_BYTES = 3 * 1024 * 1024;
export const TEXT_MAX = 60_000; // characters kept for a kit
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

export type SourceResult = { title: string; text: string; kind: string; cut: boolean } | { error: string };
export type TranscribeBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };
export type Transcribe = (block: TranscribeBlock) => Promise<{ text: string } | { error: string }>;

const tidy = (text: unknown) => String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const baseName = (name: string) => String(name || 'Notes').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Notes';
const done = (title: string, text: string, kind: string): SourceResult => {
  const clean = tidy(text);
  if (clean.length < 40) return { error: 'empty_source' };
  return { title, text: clean.slice(0, TEXT_MAX), kind, cut: clean.length > TEXT_MAX };
};

/** YouTube video id from a link, or null. */
export function youtubeId(url: unknown): string | null {
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host !== 'youtube.com') return null;
    const v = u.searchParams.get('v');
    if (v) return v.slice(0, 11);
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch { return null; }
}

async function youtube(url: unknown): Promise<SourceResult> {
  const id = youtubeId(url);
  if (!id || !/^[\w-]{11}$/.test(id)) return { error: 'bad_video_link' };
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)' },
    body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } }, videoId: id }),
  });
  if (!res.ok) return { error: 'video_unavailable' };
  const data = await res.json().catch(() => null) as any;
  if (!data) return { error: 'video_unavailable' };
  if (data.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') return { error: 'video_unavailable' };
  const title = String(data.videoDetails?.title || 'Video').slice(0, 80);
  const tracks: any[] = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  // Prefer English made by a person, then English auto captions, then anything.
  const track = tracks.find((t) => /^en/.test(t.languageCode) && t.kind !== 'asr') || tracks.find((t) => /^en/.test(t.languageCode)) || tracks[0];
  if (!track?.baseUrl) return { error: 'no_captions' };
  let capUrl: URL;
  try { capUrl = new URL(track.baseUrl); } catch { return { error: 'no_captions' }; }
  if (capUrl.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(capUrl.hostname)) return { error: 'no_captions' };
  capUrl.searchParams.set('fmt', 'json3');
  const cap = await fetch(capUrl, { signal: AbortSignal.timeout(15_000) });
  if (!cap.ok) return { error: 'no_captions' };
  const json = await cap.json().catch(() => null) as any;
  // A [m:ss] marker about every 30 seconds, so cards and questions can say where in the video they come from.
  const stamp = (ms: number) => { const t = Math.floor(ms / 1000); return `[${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}]`; };
  let next = 0;
  const parts: string[] = [];
  for (const e of json?.events || []) {
    const t = (e.segs || []).map((x: any) => x.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if ((e.tStartMs || 0) >= next) { parts.push(`\n${stamp(e.tStartMs || 0)} `); next = (e.tStartMs || 0) + 30000; }
    parts.push(`${t} `);
  }
  const text = parts.join('').trim();
  const desc = String(data.videoDetails?.shortDescription || '').slice(0, 1500);
  return done(title, `Video: ${title}\n${desc ? `Description: ${desc}\n` : ''}\nTranscript:\n${text}`, 'video');
}

async function pptx(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const num = (n: string) => Number(n.match(/\d+/)?.[0] ?? 0);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out: string[] = [];
  for (const [i, name] of slides.entries()) {
    const xml = await zip.files[name].async('string');
    const words = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    const notesName = name.replace('slides/slide', 'notesSlides/notesSlide');
    const notes = zip.files[notesName] ? [...(await zip.files[notesName].async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ') : '';
    out.push(`Slide ${i + 1}: ${words.join(' ')}${notes.trim() ? `\nSpeaker notes: ${notes}` : ''}`);
  }
  return out.join('\n\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'');
}

/**
 * body: { kind: 'file', name, data (base64) } or { kind: 'video', url }.
 * transcribe(block) asks Claude to read an image or PDF block.
 * Returns { title, text, kind, cut } or { error }.
 */
export async function readSource(body: unknown, transcribe: Transcribe): Promise<SourceResult> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.kind === 'video') return youtube(b.url);
  if (b.kind !== 'file' || typeof b.data !== 'string' || typeof b.name !== 'string') return { error: 'invalid_request' };
  const name = b.name.slice(0, 200);
  if (VIDEO_EXT.test(name)) return { error: 'video_file' };
  // Checked before decoding: base64 is 4 characters per 3 bytes.
  if (b.data.length > Math.ceil(SOURCE_MAX_BYTES / 3) * 4 + 4) return { error: 'file_too_large' };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data)) return { error: 'invalid_request' };
  const data = b.data;
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) return { error: 'empty_source' };
  if (buf.length > SOURCE_MAX_BYTES) return { error: 'file_too_large' };
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const title = baseName(name);

  if (ext === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t, i) => `[Page ${i + 1}]\n${t}`);
    const joined = pages.join('\n\n');
    // A scan has (almost) no text layer: Claude reads the pages instead.
    if (tidy(joined).replace(/\[Page \d+\]/g, '').trim().length < 80 * Math.min(pdf.numPages, 5)) {
      const read = await transcribe({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
      return 'error' in read ? read : done(title, read.text, 'pdf');
    }
    return done(title, joined, 'pdf');
  }
  if (ext === 'docx') return done(title, (await extractRawText({ buffer: buf })).value, 'doc');
  if (ext === 'pptx') return done(title, await pptx(buf), 'slides');
  if (['txt', 'md', 'markdown', 'csv', 'rtf', 'tex', 'html', 'htm'].includes(ext)) {
    let text = buf.toString('utf8');
    if (ext === 'html' || ext === 'htm') text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return done(title, text, 'text');
  }
  if (IMAGE_TYPES[ext]) {
    const read = await transcribe({ type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext], data } });
    return 'error' in read ? read : done(title, read.text, 'image');
  }
  if (['doc', 'ppt', 'key', 'pages'].includes(ext)) return { error: 'old_format' };
  return { error: 'unsupported_file' };
}
