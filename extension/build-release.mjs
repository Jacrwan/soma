// The Chrome Web Store build of Soma for Canvas: `npm run build:extension`.
//
// Copies the extension into dist-extension/soma-for-canvas/, takes the
// development addresses out of the bridge (localhost and PR previews: in a
// published extension they would hand a student's coursework to whatever runs
// there), checks what the store checks before review, and zips it to
// dist-extension/soma-for-canvas-<version>.zip for upload.
//
// The store build reads Canvas only. Gradescope's terms forbid scraping and
// Cengage's (WebAssign) forbid scripts and scrapers, so those readers, their
// permissions and the words about them stay out of what is published. The
// source keeps them: `npm run build:extension -- --all` builds all three, for
// loading unpacked.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'dist-extension');
const build = path.join(outDir, 'soma-for-canvas');

// Only these addresses may receive a student's data from a published build.
const PRODUCTION_BRIDGE = ['https://somastudy.app/*', 'https://www.somastudy.app/*'];
// Source files that are not part of the extension.
const NOT_SHIPPED = new Set(['README.md', 'STORE_LISTING.md', 'build-release.mjs', 'store']);

const ALL = process.argv.includes('--all');
const fail = msg => { console.error(`✗ ${msg}`); process.exit(1); };

const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));

// Canvas only, for the store.
const OTHER_SITES = ['www.gradescope.com', 'www.webassign.net'];
const OTHER_READERS = ['gradescope.js', 'webassign.js'];
if (!ALL) {
  manifest.description = "Keeps Soma up to date with your Canvas work: what's due, what's handed in, and what changed.";
  manifest.host_permissions = manifest.host_permissions.filter(h => !OTHER_SITES.some(d => h.includes(d)));
  manifest.content_scripts = manifest.content_scripts.filter(c => !c.js.some(f => OTHER_READERS.includes(f)));
}

// The bridge: production Soma only.
const bridge = manifest.content_scripts.find(c => c.js.includes('bridge.js'));
if (!bridge) fail('no bridge content script in manifest.json');
const dropped = bridge.matches.filter(m => !PRODUCTION_BRIDGE.includes(m));
bridge.matches = PRODUCTION_BRIDGE;

// What the store rejects outright.
if (manifest.name.length > 75) fail(`name is ${manifest.name.length} characters; the store allows 75`);
if (manifest.description.length > 132) fail(`description is ${manifest.description.length} characters; the store allows 132`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`version "${manifest.version}" isn't 1–4 dot-separated numbers`);
for (const m of manifest.content_scripts.flatMap(c => c.matches)) {
  if (!m.startsWith('https://')) fail(`content script match ${m} isn't https`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
for (const name of readdirSync(here)) {
  if (NOT_SHIPPED.has(name) || name.startsWith('.')) continue;
  if (!ALL && OTHER_READERS.includes(name)) continue;
  cpSync(path.join(here, name), path.join(build, name), { recursive: true });
}
writeFileSync(path.join(build, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// The words and script tags that name the other sites. Each must be found, so
// a change to those files can't leave a mention behind unnoticed.
function rewrite(file, from, to) {
  const f = path.join(build, file);
  const text = readFileSync(f, 'utf8');
  if (!text.includes(from)) fail(`${file}: expected text not found, update build-release.mjs: ${from.slice(0, 60)}`);
  writeFileSync(f, text.replace(from, to));
}
if (!ALL) {
  rewrite('offscreen.html', '<script src="gradescope.js"></script>\n<script src="webassign.js"></script>\n', '');
  rewrite('offscreen.html', "(for reading Gradescope's pages)", '(for reading Canvas pages)');
  rewrite('popup.html', 'Open Canvas, Gradescope or WebAssign once', 'Open Canvas once');
  rewrite('popup.html', 'Canvas, Gradescope and WebAssign are read in this browser', 'Canvas is read in this browser');
  rewrite('background.js', 'Read the Canvas and Gradescope pages the student', 'Read the Canvas pages the student');
  rewrite('background.js', 'them visiting Canvas or Gradescope.', 'them visiting Canvas.');
  rewrite('background.js', " && o !== 'https://www.gradescope.com/*' && o !== 'https://www.webassign.net/*'", '');
  rewrite('background.js', "const GRADESCOPE_HOST = 'www.gradescope.com';\nconst WEBASSIGN_HOST = 'www.webassign.net';\n", '');
  rewrite('background.js', "    if (host === GRADESCOPE_HOST) return [{ host, kind: 'gradescope', origin }];\n    if (host === WEBASSIGN_HOST) return [{ host, kind: 'webassign', origin }];\n", '');
  rewrite('background.js', "${{ gradescope: 'Gradescope', webassign: 'WebAssign' }[s.kind] || 'Canvas'}", 'Canvas');
}

// Every file the extension names has to be in the build.
const named = new Set([
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon ?? {}),
  ...manifest.content_scripts.flatMap(c => c.js),
]);
for (const page of ['popup.html', 'offscreen.html']) {
  for (const m of readFileSync(path.join(build, page), 'utf8').matchAll(/(?:src|href)="([^"]+)"/g)) named.add(m[1]);
}
for (const m of readFileSync(path.join(build, 'background.js'), 'utf8').matchAll(/importScripts\(([^)]*)\)/g)) {
  for (const f of m[1].matchAll(/'([^']+)'/g)) named.add(f[1]);
}
for (const m of readFileSync(path.join(build, 'background.js'), 'utf8').matchAll(/(?:url|iconUrl): '([^']+\.(?:html|png))'/g)) named.add(m[1]);
const missing = [...named].filter(f => !existsSync(path.join(build, f)));
if (missing.length) fail(`missing from the build: ${missing.join(', ')}`);

// Nothing in a Canvas-only build may be able to reach the other sites.
if (!ALL) {
  const granted = JSON.stringify([manifest.host_permissions, manifest.content_scripts.map(c => c.matches)]);
  const left = OTHER_SITES.filter(d => granted.includes(d));
  if (left.length) fail(`the Canvas-only build still names ${left.join(', ')} in its manifest`);
  for (const f of [...OTHER_READERS, ...readdirSync(build)].filter((f, i, a) => a.indexOf(f) === i)) {
    if (OTHER_READERS.includes(f) && existsSync(path.join(build, f))) fail(`${f} is in the Canvas-only build`);
  }
  for (const page of ['popup.html', 'offscreen.html', 'background.js']) {
    if (/gradescope|webassign/i.test(readFileSync(path.join(build, page), 'utf8'))) fail(`${page} still mentions Gradescope or WebAssign`);
  }
}

const zip = path.join(outDir, `soma-for-canvas-${manifest.version}.zip`);
execFileSync('zip', ['-qrX', zip, '.', '-x', '.*'], { cwd: build });

console.log(`✓ ${path.relative(root, zip)}`);
console.log(ALL ? '  all three sites (not for the store)' : '  Canvas only');
console.log(`  version ${manifest.version}; bridge limited to ${PRODUCTION_BRIDGE.join(', ')}`);
if (dropped.length) console.log(`  removed development addresses: ${dropped.join(', ')}`);
