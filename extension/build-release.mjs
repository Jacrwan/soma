// The Chrome Web Store build of Soma for Canvas: `npm run build:extension`.
//
// Copies the extension into dist-extension/soma-for-canvas/, takes the
// development addresses out of the bridge (localhost and PR previews: in a
// published extension they would hand a student's coursework to whatever runs
// there), checks what the store checks before review, and zips it to
// dist-extension/soma-for-canvas-<version>.zip for upload.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const outDir = path.join(root, 'dist-extension');
const build = path.join(outDir, 'soma-for-canvas');

// Only these addresses may receive a student's data from a published build.
const PRODUCTION_BRIDGE = ['https://somastudy.app/*', 'https://www.somastudy.app/*'];
// Source files that are not part of the extension.
const NOT_SHIPPED = new Set(['README.md', 'STORE_LISTING.md', 'build-release.mjs', 'store']);

const fail = msg => { console.error(`✗ ${msg}`); process.exit(1); };

const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));

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
  cpSync(path.join(here, name), path.join(build, name), { recursive: true });
}
writeFileSync(path.join(build, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

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

const zip = path.join(outDir, `soma-for-canvas-${manifest.version}.zip`);
execFileSync('zip', ['-qrX', zip, '.', '-x', '.*'], { cwd: build });

console.log(`✓ ${path.relative(root, zip)}`);
console.log(`  version ${manifest.version}; bridge limited to ${PRODUCTION_BRIDGE.join(', ')}`);
if (dropped.length) console.log(`  removed development addresses: ${dropped.join(', ')}`);
