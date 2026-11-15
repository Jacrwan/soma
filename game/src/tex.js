// Surface detail, painted at load time onto small canvases: wood grain, brick,
// stone, roof tiles and so on. No image files. Each texture is near-white so the
// material's own colour still decides the hue; the same canvas doubles as a
// bump map so surfaces catch the light.

import * as THREE from 'three';

// --- Noise ---------------------------------------------------------------------------

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise that repeats every `period` cells, so textures tile without a seam. */
export function tileNoise(x, y, period, seed = 1) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const w = (n) => ((n % period) + period) % period;
  const a = hash2(w(x0), w(y0), seed);
  const b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed);
  const d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Layered tiling noise in 0..1. u and v run 0..1 across the tile. */
export function fbm(u, v, cells = 4, octaves = 4, seed = 1) {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let period = cells;
  for (let o = 0; o < octaves; o++) {
    sum += tileNoise(u * period, v * period, period, seed + o * 17) * amp;
    total += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / total;
}

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Plain 3D value noise in 0..1, for bending shapes. */
export function noise3(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(x0, y0, z0), hash3(x0 + 1, y0, z0), fx), l(hash3(x0, y0 + 1, z0), hash3(x0 + 1, y0 + 1, z0), fx), fy),
    l(l(hash3(x0, y0, z0 + 1), hash3(x0 + 1, y0, z0 + 1), fx), l(hash3(x0, y0 + 1, z0 + 1), hash3(x0 + 1, y0 + 1, z0 + 1), fx), fy),
    fz,
  );
}

// --- Painting ------------------------------------------------------------------------

function paint(size, shade) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(1, shade(x / size, y / size, x, y)));
      const i = (y * size + x) * 4;
      const b = Math.round(v * 255);
      img.data[i] = b;
      img.data[i + 1] = b;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const frac = (n) => n - Math.floor(n);
const rnd = (a, b = 0) => hash2(a | 0, b | 0, 99);

// Each painter returns brightness 0..1 for a point (u, v) on the tile.
const PAINTERS = {
  planks(u, v) {
    const boards = 6;
    const b = Math.floor(u * boards);
    const edge = Math.min(frac(u * boards), 1 - frac(u * boards));
    const tone = 0.78 + rnd(b, 3) * 0.2;
    const grain = fbm(u * 3 + rnd(b) * 5, v * 0.35, 8, 4, 11 + b);
    const streak = fbm(u * 6, v * 0.12 + rnd(b), 16, 2, 5);
    const knot = Math.max(0, 1 - Math.hypot((frac(u * boards) - 0.5) * 0.9, frac(v * 2 + rnd(b, 7)) - 0.5) * 9) * (rnd(b, 9) > 0.55 ? 0.25 : 0);
    const gap = edge < 0.035 ? 0.45 : 1;
    return (tone - (grain - 0.5) * 0.3 - (streak - 0.5) * 0.14 - knot) * gap;
  },
  bark(u, v) {
    const ridges = fbm(u * 2.2, v * 0.4, 8, 4, 3);
    const fine = fbm(u * 4, v * 1.5, 16, 3, 8);
    return 0.5 + Math.abs(ridges - 0.5) * 1.5 + (fine - 0.5) * 0.25;
  },
  brick(u, v) {
    const rows = 8;
    const cols = 4;
    const row = Math.floor(v * rows);
    const uu = u * cols + (row % 2) * 0.5;
    const col = Math.floor(uu);
    const fx = frac(uu);
    const fy = frac(v * rows);
    const mortar = fx < 0.04 || fx > 0.96 || fy < 0.08 || fy > 0.92;
    if (mortar) return 0.6 + fbm(u, v, 32, 2, 4) * 0.12;
    return 0.74 + rnd(col % cols, row) * 0.24 + (fbm(u, v, 24, 3, 6) - 0.5) * 0.2;
  },
  blocks(u, v) {
    const rows = 4;
    const row = Math.floor(v * rows);
    const cols = 2 + (row % 2);
    const uu = u * cols + rnd(row, 1) * 0.5;
    const col = Math.floor(uu);
    const fx = frac(uu);
    const fy = frac(v * rows);
    const joint = Math.min(fx, 1 - fx) * (1 / cols) < 0.012 || Math.min(fy, 1 - fy) < 0.045;
    const rough = fbm(u, v, 10, 5, 21);
    if (joint) return 0.5 + rough * 0.15;
    return 0.74 + rnd(((col % cols) + cols) % cols, row + 5) * 0.2 + (rough - 0.5) * 0.3;
  },
  plaster(u, v) {
    return 0.86 + (fbm(u, v, 6, 5, 31) - 0.5) * 0.22 + (fbm(u, v, 40, 2, 2) - 0.5) * 0.08 - Math.max(0, fbm(u * 1, v * 0.5, 3, 2, 77) - 0.62) * 0.5;
  },
  thatch(u, v) {
    const strands = fbm(u * 6, v * 0.25, 32, 3, 41);
    const layers = frac(v * 5 + fbm(u, v, 8, 2, 3) * 0.3);
    return 0.62 + strands * 0.36 - (layers > 0.9 ? 0.22 : 0) - layers * 0.08;
  },
  tiles(u, v) {
    const rows = 7;
    const cols = 6;
    const row = Math.floor(v * rows);
    const uu = u * cols + (row % 2) * 0.5;
    const fx = frac(uu);
    const fy = frac(v * rows);
    const gap = fx < 0.05 || fx > 0.95 ? 0.6 : 1;
    // Each row is lit at its lower edge and shaded where the row above overlaps it.
    return (0.62 + fy * 0.3 + rnd(Math.floor(uu) % cols, row + 11) * 0.12 + (fbm(u, v, 24, 2, 9) - 0.5) * 0.1) * gap * (fy < 0.07 ? 0.65 : 1);
  },
  metal(u, v) {
    const brushed = fbm(u * 0.2, v * 6, 32, 2, 51);
    const seam = Math.min(frac(u * 2), 1 - frac(u * 2)) < 0.012 || Math.min(frac(v * 2), 1 - frac(v * 2)) < 0.012;
    return (0.86 + (brushed - 0.5) * 0.14 + (fbm(u, v, 5, 3, 7) - 0.5) * 0.1) * (seam ? 0.72 : 1);
  },
  concrete(u, v) {
    const speck = hash2((u * 256) | 0, (v * 256) | 0, 3) > 0.93 ? -0.1 : 0;
    return 0.82 + (fbm(u, v, 8, 5, 61) - 0.5) * 0.28 + speck;
  },
  foliage(u, v) {
    const clumps = fbm(u, v, 9, 3, 71);
    const leaves = fbm(u, v, 30, 2, 13);
    return 0.52 + clumps * 0.42 + (leaves - 0.5) * 0.36;
  },
  rock(u, v) {
    const big = fbm(u, v, 4, 5, 81);
    const crack = Math.abs(fbm(u, v, 7, 3, 15) - 0.5);
    return 0.66 + (big - 0.5) * 0.5 - (crack < 0.02 ? 0.25 : 0);
  },
  dust(u, v) {
    const speck = hash2((u * 256) | 0, (v * 256) | 0, 8) > 0.9 ? 0.08 : 0;
    return 0.8 + (fbm(u, v, 6, 5, 91) - 0.5) * 0.36 + speck - 0.04;
  },
  fabric(u, v) {
    const weave = (Math.sin(u * Math.PI * 80) * 0.5 + 0.5) * (Math.sin(v * Math.PI * 80) * 0.5 + 0.5);
    return 0.82 + weave * 0.12 + (fbm(u, v, 5, 3, 23) - 0.5) * 0.14;
  },
  fur(u, v) {
    const strands = fbm(u * 5, v * 0.5, 48, 3, 141);
    const clumps = fbm(u, v, 7, 3, 77);
    const fleck = fbm(u * 2, v * 2, 40, 2, 9);
    return 0.42 + strands * 0.5 + (clumps - 0.5) * 0.4 + (fleck - 0.5) * 0.2;
  },
  fine(u, v) {
    return 0.9 + (fbm(u, v, 12, 4, 37) - 0.5) * 0.14;
  },
};

// How each surface behaves: metres per tile, roughness, metalness, bump depth.
export const SURFACES = {
  planks: { tile: 1.6, rough: 0.82, bump: 0.9 },
  bark: { tile: 1.2, rough: 0.95, bump: 2.2 },
  brick: { tile: 1.5, rough: 0.9, bump: 1.4 },
  blocks: { tile: 2.2, rough: 0.92, bump: 1.6 },
  plaster: { tile: 2.4, rough: 0.94, bump: 0.5 },
  thatch: { tile: 1.6, rough: 1, bump: 2.0 },
  tiles: { tile: 1.5, rough: 0.8, bump: 2.0 },
  metal: { tile: 2.0, rough: 0.38, metal: 0.85, bump: 0.25 },
  concrete: { tile: 3.0, rough: 0.9, bump: 0.5 },
  foliage: { tile: 1.4, rough: 0.9, bump: 2.4 },
  rock: { tile: 2.4, rough: 0.95, bump: 2.6 },
  dust: { tile: 3.0, rough: 1, bump: 1.2 },
  fabric: { tile: 0.8, rough: 0.95, bump: 0.5 },
  fur: { tile: 0.35, rough: 1, bump: 3 },
  fine: { tile: 1.5, rough: 0.7, bump: 0.2 },
};

const cache = new Map();
/** The tiling detail texture for a surface. UVs are in metres; the repeat sets the tile size. */
export function surfaceTexture(kind) {
  if (!cache.has(kind)) {
    const t = new THREE.CanvasTexture(paint(256, PAINTERS[kind]));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.setScalar(1 / SURFACES[kind].tile);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(kind, t);
  }
  return cache.get(kind);
}

/** Plain tiling noise as a texture (repeat 1; scale the UVs yourself). */
export function noiseTexture(kind = 'dust', size = 256) {
  const t = new THREE.CanvasTexture(paint(size, PAINTERS[kind]));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A tiling normal map of soft ripples, for water. */
export function rippleNormals(size = 256) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fbm(x / size, y / size, 5, 5, 123);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 9;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 9;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A soft round blob, bright in the middle: contact shadows and glows. */
export function blobTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
