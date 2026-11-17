// What a student brings to a study kit, turned into plain text on the dev server.
// - Files: PDF (text layer, or read by Claude when it's a scan), Word .docx,
//   PowerPoint .pptx, plain text / Markdown, and photos of notes (read by Claude).
// - Video: a YouTube link, using the video's own captions.
// Nothing here logs file contents.
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import JSZip from 'jszip';

export const SOURCE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file
export const TEXT_MAX = 60000; // characters kept for a kit
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

const tidy = (text) => String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const baseName = (name) => String(name || 'Notes').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Notes';
const done = (title, text, kind) => {
  const clean = tidy(text);
  if (clean.length < 40) return { error: 'empty_source' };
  return { title, text: clean.slice(0, TEXT_MAX), kind, cut: clean.length > TEXT_MAX };
};

/** YouTube video id from a link, or null. */
export function youtubeId(url) {
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host !== 'youtube.com') return null;
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch { return null; }
}

async function youtube(url) {
  const id = youtubeId(url);
  if (!id || !/^[\w-]{11}$/.test(id)) return { error: 'bad_video_link' };
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)' },
    body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } }, videoId: id }),
  });
  if (!res.ok) return { error: 'video_unavailable' };
  const data = await res.json();
  if (data.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') return { error: 'video_unavailable' };
  const title = String(data.videoDetails?.title || 'Video').slice(0, 80);
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  // Prefer English made by a person, then English auto captions, then anything.
  const track = tracks.find((t) => /^en/.test(t.languageCode) && t.kind !== 'asr') || tracks.find((t) => /^en/.test(t.languageCode)) || tracks[0];
  if (!track?.baseUrl) return { error: 'no_captions' };
  const capUrl = new URL(track.baseUrl);
  if (!/(^|\.)youtube\.com$/.test(capUrl.hostname)) return { error: 'no_captions' };
  capUrl.searchParams.set('fmt', 'json3');
  const cap = await fetch(capUrl);
  if (!cap.ok) return { error: 'no_captions' };
  const json = await cap.json().catch(() => null);
  // A [m:ss] marker about every 30 seconds, so cards and questions can say where in the video they come from.
  const stamp = (ms) => { const t = Math.floor(ms / 1000); return `[${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}]`; };
  let next = 0;
  const parts = [];
  for (const e of json?.events || []) {
    const t = (e.segs || []).map((x) => x.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if ((e.tStartMs || 0) >= next) { parts.push(`\n${stamp(e.tStartMs || 0)} `); next = (e.tStartMs || 0) + 30000; }
    parts.push(`${t} `);
  }
  const text = parts.join('').trim();
  const desc = String(data.videoDetails?.shortDescription || '').slice(0, 1500);
  return done(title, `Video: ${title}\n${desc ? `Description: ${desc}\n` : ''}\nTranscript:\n${text}`, 'video');
}

async function pptx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const out = [];
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
 * transcribe(block) asks Claude to read an image or PDF block: { text } or { error }.
 * Returns { title, text, kind, cut } or { error }.
 */
export async function readSource(body, transcribe) {
  if (body?.kind === 'video') return youtube(body.url);
  if (body?.kind !== 'file' || typeof body.data !== 'string' || typeof body.name !== 'string') return { error: 'invalid_request' };
  const name = body.name.slice(0, 200);
  if (VIDEO_EXT.test(name)) return { error: 'video_file' };
  const buf = Buffer.from(body.data, 'base64');
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
      if (buf.length > 30 * 1024 * 1024) return { error: 'file_too_large' };
      const read = await transcribe({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.data } });
      return read.error ? read : done(title, read.text, 'pdf');
    }
    return done(title, joined, 'pdf');
  }
  if (ext === 'docx') return done(title, (await mammoth.extractRawText({ buffer: buf })).value, 'doc');
  if (ext === 'pptx') return done(title, await pptx(buf), 'slides');
  if (['txt', 'md', 'markdown', 'csv', 'rtf', 'tex', 'html', 'htm'].includes(ext)) {
    let text = buf.toString('utf8');
    if (ext === 'html' || ext === 'htm') text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return done(title, text, 'text');
  }
  if (IMAGE_TYPES[ext]) {
    if (buf.length > 5 * 1024 * 1024) return { error: 'image_too_large' };
    const read = await transcribe({ type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext], data: body.data } });
    return read.error ? read : done(title, read.text, 'image');
  }
  if (['doc', 'ppt', 'key', 'pages'].includes(ext)) return { error: 'old_format' };
  return { error: 'unsupported_file' };
}
