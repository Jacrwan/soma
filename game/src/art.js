// Every model in the game, built from simple shapes with textured, lit surfaces
// and a small shared palette.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURFACES, surfaceTexture, blobTexture } from './tex.js';
import { singleTree, rockGeometry } from './nature.js';

export const C = {
  grass: 0x8cc06a, grassDark: 0x6ea556, sand: 0xead9a8, dirt: 0xb08a5e, rock: 0x9b9aa2, rockDark: 0x7d7c86,
  water: 0x4fb4c9, wood: 0x9c6b43, woodDark: 0x6d4a2e, thatch: 0xd9b55b, hide: 0xb98b5e, mud: 0xd9b98a,
  clay: 0xc97a5c, brick: 0xb65b46, stone: 0xcac4b6, stoneDark: 0xa39d90, slate: 0x5b6577, white: 0xf5f0e7,
  glass: 0x8fd3e8, metal: 0x8d99a6, iron: 0x4a4f5a, gold: 0xf2c14e, red: 0xd9534f, orange: 0xf08a3c,
  teal: 0x3fb8a8, blue: 0x4a78d0, purple: 0x7a56c2, plum: 0x4b2f6b, ink: 0x2a2633, leaf: 0x5fa052, leafDark: 0x3f7f48,
  asphalt: 0x4a4d57, moon: 0xb9b8bf, moonDark: 0x8e8d97, glow: 0x9fe8ff, cream: 0xfff3d6,
};

// Which surface each palette colour stands for.
const KIND = new Map([
  [C.wood, 'planks'], [C.woodDark, 'planks'], [C.thatch, 'thatch'], [C.hide, 'fabric'],
  [C.mud, 'plaster'], [C.white, 'plaster'], [C.cream, 'plaster'], [C.sand, 'plaster'], [C.clay, 'plaster'],
  [C.brick, 'brick'], [C.stone, 'blocks'], [C.stoneDark, 'blocks'], [C.slate, 'tiles'],
  [C.rock, 'rock'], [C.rockDark, 'rock'], [C.metal, 'metal'], [C.iron, 'metal'],
  [C.asphalt, 'concrete'], [C.leaf, 'foliage'], [C.leafDark, 'foliage'], [C.grass, 'foliage'], [C.grassDark, 'foliage'],
  [C.moon, 'dust'], [C.moonDark, 'dust'], [C.dirt, 'dust'],
]);
const GLASSY = new Set([C.glass, C.water]);

const materials = new Map();
export function mat(color, opts = {}) {
  const plain = opts.emissive || (opts.opacity ?? 1) < 1;
  const kind = plain ? 'glow' : opts.kind || (GLASSY.has(color) ? 'glass' : KIND.get(color) || 'fine');
  const key = `${color}|${kind}|${opts.metal ?? ''}|${opts.emissive || 0}|${opts.opacity ?? 1}|${opts.rough ?? ''}|${opts.glow ?? ''}`;
  if (!materials.has(key)) {
    const surface = SURFACES[kind];
    const params = {
      color,
      roughness: opts.rough ?? surface?.rough ?? (kind === 'glass' ? 0.08 : 0.6),
      metalness: opts.metal ?? surface?.metal ?? (kind === 'glass' ? 0.75 : 0),
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts.emissive ? (opts.glow ?? 0.9) * 1.15 : 0,
      transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
    };
    if (surface) {
      const t = surfaceTexture(kind);
      params.map = t;
      params.bumpMap = t;
      params.bumpScale = surface.bump;
    }
    if (kind === 'glass') params.envMapIntensity = 1.3;
    materials.set(key, new THREE.MeshStandardMaterial(params));
  }
  return materials.get(key);
}

function mesh(geometry, color, opts) {
  const m = new THREE.Mesh(geometry, typeof color === 'object' && color.isMaterial ? color : mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Textures are sized in metres, so every shape gets UVs measured in metres.
function uvWorld(g, only) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (only && !only(ax, ay, az)) continue;
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i), p.getZ(i));
    else if (ax >= az) uv.setXY(i, p.getZ(i), p.getY(i));
    else uv.setXY(i, p.getX(i), p.getY(i));
  }
  return g;
}
function uvRound(g, around, along) {
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) if (Math.abs(n.getY(i)) < 0.98) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * along);
  return uvWorld(g, (ax, ay) => ay >= 0.98);
}
// Few sides means the shape is meant to have corners; more means it is meant to be round.
function sided(seg) {
  return seg <= 6 ? seg : Math.max(18, seg * 2);
}
function faceted(g, seg) {
  if (seg > 6) return g;
  const flatG = g.toNonIndexed();
  flatG.computeVertexNormals();
  return flatG;
}

// Shapes sit on the ground: their base is at y = 0.
export function box(w, h, d, color, opts) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return mesh(uvWorld(g), color, opts);
}
export function cyl(rTop, rBottom, h, color, seg = 8, opts) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, sided(seg));
  g.translate(0, h / 2, 0);
  return mesh(faceted(uvRound(g, Math.max(rTop, rBottom) * 6.28, h), seg), color, opts);
}
export function cone(r, h, color, seg = 8, opts) {
  const g = new THREE.ConeGeometry(r, h, sided(seg));
  g.translate(0, h / 2, 0);
  const roof = color === C.brick ? { ...opts, kind: 'tiles' } : opts;
  return mesh(faceted(uvRound(g, r * 6.28, Math.hypot(r, h)), seg), color, roof);
}
export function ball(r, color, detail = 1, opts) {
  const g = detail > 0 ? new THREE.SphereGeometry(r, 24, 16) : new THREE.SphereGeometry(r, 14, 10);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 6.28, uv.getY(i) * r * 3.14);
  return mesh(g, color, opts);
}
export function dome(r, color, opts) {
  const g = new THREE.SphereGeometry(r, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 6.28, uv.getY(i) * r * 1.57);
  return mesh(g, color, opts);
}
/** A gable roof: a triangular prism w wide, h tall, d deep, ridge along z. */
export function prism(w, h, d, color, opts) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  // Roof slopes: rows of tiles run along the ridge and climb the slope.
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  const slope = Math.hypot(w / 2, h) / h;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getZ(i)) > 0.5) uv.setXY(i, p.getX(i), p.getY(i));
    else uv.setXY(i, p.getZ(i), p.getY(i) * slope);
  }
  const roof = color === C.brick ? { ...opts, kind: 'tiles' } : opts;
  return mesh(g, color, roof);
}
export function torus(r, tube, color, opts) {
  const g = new THREE.TorusGeometry(r, tube, 10, 36);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 6.28, uv.getY(i) * tube * 6.28);
  return mesh(g, color, opts);
}

/**
 * Fuse a finished model's still parts into one mesh per material, so a building
 * draws in a few calls. Anything named, tagged or see-through is left alone
 * because the game moves or fades those.
 */
export function bake(root) {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const visit = (node, ok) => {
    for (const child of [...node.children]) {
      const still = ok && !child.name && Object.keys(child.userData).length === 0 && child.visible;
      if (child.isMesh && still && child.children.length === 0 && !child.material.transparent && child.geometry.attributes.uv) {
        let g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld));
        const key = `${child.material.uuid}|${child.castShadow}`;
        if (!buckets.has(key)) buckets.set(key, { material: child.material, cast: child.castShadow, list: [] });
        buckets.get(key).list.push(g);
        node.remove(child);
      } else visit(child, still);
    }
  };
  visit(root, true);
  for (const { material, cast, list } of buckets.values()) {
    const merged = new THREE.Mesh(mergeGeometries(list), material);
    merged.castShadow = cast;
    merged.receiveShadow = true;
    root.add(merged);
  }
  return root;
}

let blobMat = null;
/** A soft dark patch under something, so it sits on the ground instead of floating. */
export function contactShadow(radius, strength = 0.42) {
  if (!blobMat) blobMat = new Map();
  if (!blobMat.has(strength)) blobMat.set(strength, new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x1a1c12, transparent: true, opacity: strength, depthWrite: false }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), blobMat.get(strength));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  m.name = 'contact';
  return m;
}

export function at(obj, x = 0, y = 0, z = 0, ry = 0) {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  return obj;
}
export function group(...children) {
  const g = new THREE.Group();
  for (const child of children) if (child) g.add(child);
  return g;
}
function tilt(obj, rx = 0, rz = 0) {
  obj.rotation.x = rx;
  obj.rotation.z = rz;
  return obj;
}

// --- Buildings ------------------------------------------------------------------

function windows(count, y, z, span, color = C.cream) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : -span / 2 + (span * i) / (count - 1);
    g.add(at(box(0.34, 0.42, 0.06, color, { emissive: 0xffd98a, glow: 0.35 }), x, y, z));
  }
  return g;
}
const door = (z, color = C.woodDark, h = 0.9) => at(box(0.5, h, 0.08, color), 0, 0, z);

function home(tier, lv) {
  const g = new THREE.Group();
  const s = 1 + (lv - 1) * 0.14;
  switch (tier) {
    case 0: {
      g.add(cyl(1.25 * s, 1.35 * s, 0.7, C.hide, 9));
      g.add(at(cone(1.6 * s, 1.7 * s, C.thatch, 9), 0, 0.65));
      g.add(at(box(0.5, 0.75, 0.2, C.ink), 0, 0, 1.28 * s));
      for (let i = 0; i < 5; i++) g.add(at(ball(0.16, C.rock, 0), 1.9 + Math.cos(i * 1.26) * 0.3, 0.1, 0.9 + Math.sin(i * 1.26) * 0.3));
      g.add(at(cone(0.16, 0.4, C.orange, 9, { emissive: 0xff6a10, glow: 1.5 }), 1.9, 0.1, 0.9));
      if (lv > 1) g.add(at(cone(0.9, 1.1, C.thatch, 7), -1.5, 0.5, 0.6), at(cyl(0.7, 0.75, 0.55, C.hide, 7), -1.5, 0, 0.6));
      if (lv > 2) g.add(at(box(0.1, 1.5, 0.1, C.woodDark), 1.5, 0, -1.1), at(box(1.0, 0.5, 0.05, C.clay), 1.5, 1.0, -1.1));
      break;
    }
    case 1: {
      g.add(box(2.4 * s, 1.5, 2.2 * s, C.mud));
      g.add(at(box(2.6 * s, 0.22, 2.4 * s, C.sand), 0, 1.5));
      g.add(at(door(1.11 * s), 0, 0, 0), at(windows(2, 0.95, 1.11 * s, 1.5 * s, C.ink), 0, 0, 0));
      g.add(at(box(1.4, 0.08, 0.8, C.clay), 0, 1.15, 1.5 * s));
      g.add(at(box(0.08, 1.15, 0.08, C.wood), -0.6, 0, 1.85 * s), at(box(0.08, 1.15, 0.08, C.wood), 0.6, 0, 1.85 * s));
      if (lv > 1) g.add(at(box(1.3 * s, 1.0, 1.3 * s, C.mud), -0.4, 1.7, -0.3), at(box(1.45 * s, 0.18, 1.45 * s, C.sand), -0.4, 2.7, -0.3));
      if (lv > 2) g.add(at(cyl(0.22, 0.3, 0.6, C.clay, 7), 1.5 * s, 0, 1.3), at(cone(0.5, 1.5, C.leaf, 6), -1.7 * s, 0.3, 1.0), at(cyl(0.08, 0.1, 0.5, C.woodDark, 5), -1.7 * s, 0, 1.0));
      break;
    }
    case 2: {
      g.add(box(2.4 * s, 1.5, 2.0 * s, C.white));
      for (const x of [-1.2, 1.2]) for (const z of [-1, 1]) g.add(at(box(0.16, 1.5, 0.16, C.woodDark), x * s, 0, z * s));
      g.add(at(box(2.45 * s, 0.14, 0.1, C.woodDark), 0, 0.8, 1.0 * s));
      g.add(at(tilt(prism(2.9 * s, 1.5, 2.4 * s, C.brick), 0, 0), 0, 1.5, 0));
      g.add(at(box(0.4, 1.3, 0.4, C.stone), 0.7 * s, 1.7, -0.4));
      g.add(door(1.02 * s), windows(2, 0.95, 1.02 * s, 1.5 * s));
      if (lv > 1) g.add(at(box(1.2, 1.0, 1.3, C.white), 1.7 * s, 0, 0), at(prism(1.5, 0.8, 1.5, C.brick), 1.7 * s, 1.0, 0));
      if (lv > 2) g.add(at(box(2.2, 0.5, 0.08, C.wood), 0, 0, 2.0 * s), at(ball(0.45, C.leaf, 0), -1.6 * s, 0.4, 1.6), at(ball(0.35, C.leafDark, 0), -1.2 * s, 0.3, 1.9));
      break;
    }
    case 3: {
      const floors = 1 + lv;
      g.add(box(2.4, floors * 1.1, 2.0, C.brick));
      for (let f = 0; f < floors; f++) g.add(windows(3, 0.65 + f * 1.1, 1.01, 1.6));
      g.add(at(box(2.5, 0.12, 2.1, C.stone), 0, floors * 1.1));
      g.add(at(prism(2.6, 0.9, 2.2, C.slate), 0, floors * 1.1 + 0.1));
      g.add(at(box(0.36, 1.0, 0.36, C.brick), -0.7, floors * 1.1 + 0.3, 0.2), at(box(0.36, 1.0, 0.36, C.brick), 0.7, floors * 1.1 + 0.3, -0.3));
      g.add(at(box(0.7, 0.2, 0.5, C.stone), 0, 0, 1.2), door(1.02, C.ink, 0.85));
      break;
    }
    case 4: {
      const floors = 3 + lv;
      g.add(box(2.6, floors * 0.95, 2.2, C.white));
      for (let f = 0; f < floors; f++) {
        g.add(at(box(2.62, 0.4, 0.06, C.glass, { rough: 0.3 }), 0, 0.35 + f * 0.95, 1.1));
        g.add(at(box(0.06, 0.4, 2.22, C.glass, { rough: 0.3 }), 1.3, 0.35 + f * 0.95, 0));
        if (f > 0) g.add(at(box(0.9, 0.08, 0.4, C.stone), -0.7, f * 0.95, 1.3));
      }
      g.add(at(box(2.7, 0.14, 2.3, C.slate), 0, floors * 0.95));
      g.add(at(box(0.7, 0.4, 0.6, C.metal), 0.5, floors * 0.95 + 0.14, -0.3), at(cyl(0.03, 0.03, 1.2, C.iron, 4), -0.8, floors * 0.95 + 0.14, 0.5));
      break;
    }
    case 5: {
      const h = 2.2 + lv * 0.9;
      g.add(cyl(1.2, 1.35, h, C.white, 12, { rough: 0.5 }));
      for (let y = 0.7; y < h - 0.3; y += 0.9) g.add(at(cyl(1.26, 1.3, 0.34, C.glass, 12, { rough: 0.25 }), 0, y));
      g.add(at(cyl(1.5, 1.2, 0.22, C.white, 12), 0, h), at(cyl(1.35, 1.35, 0.18, C.leaf, 12), 0, h + 0.2));
      g.add(at(ball(0.45, C.leafDark, 0), 0.4, h + 0.55, 0.2), at(ball(0.35, C.leaf, 0), -0.5, h + 0.5, -0.3));
      g.add(at(tilt(box(1.1, 0.06, 0.7, C.blue, { rough: 0.3, metal: 0.3 }), -0.5), 1.9, 0.5, 0), at(cyl(0.05, 0.05, 0.6, C.metal, 5), 1.9, 0, 0));
      break;
    }
    default: {
      const r = 1.5 + lv * 0.18;
      g.add(dome(r, C.white, { rough: 0.5 }));
      g.add(at(cyl(r * 1.01, r * 1.02, 0.28, C.blue, 12, { emissive: 0x4aa8ff, glow: 0.6 }), 0, r * 0.32));
      g.add(at(tilt(cyl(0.5, 0.5, 1.4, C.metal, 8), Math.PI / 2), 0, 0.5, r + 0.5), at(box(0.7, 0.9, 0.1, C.ink), 0, 0.05, r + 1.22));
      if (lv > 1) g.add(at(dome(0.8, C.white), -r - 0.5, 0, 0.3), at(tilt(cyl(0.25, 0.25, 0.9, C.metal, 6), 0, Math.PI / 2), -r + 0.1, 0.35, 0.3));
      if (lv > 2) g.add(at(cyl(0.04, 0.04, 1.6, C.metal, 4), r * 0.5, r * 0.8, -r * 0.4), at(ball(0.14, C.red, 0, { emissive: 0xff3030 }), r * 0.5, r * 0.8 + 1.6, -r * 0.4));
    }
  }
  return g;
}

function work(tier, lv) {
  const g = new THREE.Group();
  switch (tier) {
    case 0: {
      for (let i = 0; i < 7 + lv * 2; i++) {
        const a = i * 0.9;
        g.add(at(ball(0.35 + (i % 3) * 0.14, i % 2 ? C.rock : C.rockDark, 0), Math.cos(a) * 1.5, 0.15, Math.sin(a) * 1.5, a));
      }
      g.add(at(cyl(0.9, 1.1, 0.15, C.dirt, 8), 0, 0, 0));
      g.add(at(box(0.1, 1.3, 0.1, C.wood), -0.7, 0, 0), at(box(0.1, 1.3, 0.1, C.wood), 0.7, 0, 0), at(box(1.6, 0.1, 0.1, C.wood), 0, 1.25, 0));
      for (let i = 0; i < 3; i++) g.add(at(box(0.3, 0.5, 0.04, C.hide), -0.45 + i * 0.45, 0.72, 0));
      if (lv > 1) g.add(at(cone(0.5, 0.7, C.rockDark, 5), 1.9, 0, -0.6), at(cone(0.35, 0.5, C.rock, 5), 2.2, 0, 0.1));
      if (lv > 2) g.add(at(box(0.9, 0.5, 0.6, C.wood), -2.0, 0, 0.6), at(ball(0.25, C.rock, 0), -2.0, 0.6, 0.6));
      break;
    }
    case 1: {
      g.add(box(2.2, 1.3, 1.9, C.mud));
      g.add(at(box(2.35, 0.18, 2.05, C.sand), 0, 1.3));
      g.add(at(cyl(0.45, 0.75, 2.2 + lv * 0.4, C.clay, 8), 0.5, 1.3, -0.3));
      g.add(at(cyl(0.38, 0.4, 0.12, C.orange, 8, { emissive: 0xff7a1a }), 0.5, 3.5 + lv * 0.4, -0.3));
      g.add(at(box(0.6, 0.35, 0.3, C.iron), -1.7, 0.35, 0.8), at(box(0.25, 0.35, 0.25, C.woodDark), -1.7, 0, 0.8));
      g.add(door(0.97, C.ink, 0.8));
      if (lv > 1) g.add(at(cyl(0.3, 0.36, 0.7, C.clay, 7), 1.7, 0, 0.9), at(cyl(0.3, 0.36, 0.7, C.clay, 7), 1.9, 0, 0.2));
      if (lv > 2) g.add(at(box(1.0, 0.9, 1.2, C.mud), -1.6, 0, -0.5), at(box(1.1, 0.14, 1.3, C.sand), -1.6, 0.9, -0.5));
      break;
    }
    case 2: {
      g.add(box(2.4, 0.9, 2.0, C.stone));
      for (const x of [-1.1, 1.1]) for (const z of [-0.9, 0.9]) g.add(at(box(0.18, 1.2, 0.18, C.woodDark), x, 0.9, z));
      g.add(at(prism(2.9, 1.1, 2.5, C.woodDark), 0, 2.1));
      g.add(at(box(0.6, 2.4 + lv * 0.3, 0.6, C.stoneDark), -0.7, 0.9, -0.5));
      g.add(at(box(0.5, 0.3, 0.3, C.iron), 0.5, 0.9, 0.4), at(cyl(0.3, 0.3, 0.6, C.wood, 8), 1.8, 0, 0.9));
      g.add(at(box(0.3, 0.3, 0.06, C.orange, { emissive: 0xff7a1a }), -0.7, 1.2, -0.18));
      if (lv > 1) g.add(at(box(1.0, 0.7, 0.5, C.wood), -1.9, 0, 0.7), at(cyl(0.28, 0.28, 0.55, C.wood, 8), 1.9, 0, 0.2));
      if (lv > 2) g.add(at(box(0.1, 2.0, 0.1, C.woodDark), 1.6, 0, -1.2), at(box(0.7, 0.5, 0.05, C.red), 1.95, 1.4, -1.2));
      break;
    }
    case 3: {
      const len = 3.0 + lv * 0.3;
      g.add(box(len, 1.6, 2.2, C.brick));
      for (let i = 0; i < 3; i++) g.add(at(prism(len / 3, 0.7, 2.2, C.slate), -len / 3 + (i * len) / 3, 1.6, 0, 0));
      g.add(windows(4, 0.9, 1.11, len - 0.8, C.glass));
      for (let i = 0; i < 1 + (lv > 1 ? 1 : 0); i++) {
        g.add(at(cyl(0.28, 0.4, 3.6 + lv * 0.4, C.brick, 8), len / 2 - 0.5 - i * 0.9, 0, -0.7));
        g.add(at(ball(0.42, C.white, 0, { opacity: 0.85 }), len / 2 - 0.4 - i * 0.9, 4.2 + lv * 0.4, -0.7));
        g.add(at(ball(0.3, C.white, 0, { opacity: 0.7 }), len / 2 - 0.1 - i * 0.9, 4.8 + lv * 0.4, -0.6));
      }
      if (lv > 2) g.add(at(cyl(0.6, 0.6, 1.2, C.metal, 10), -len / 2 - 0.8, 0, 0.3));
      break;
    }
    case 4: {
      const h = 4.5 + lv * 1.5;
      g.add(box(2.1, h, 2.1, C.glass, { rough: 0.2, metal: 0.2 }));
      for (let y = 0; y <= h; y += 1.0) g.add(at(box(2.16, 0.1, 2.16, C.white), 0, Math.min(y, h - 0.1)));
      for (const x of [-1.05, 1.05]) for (const z of [-1.05, 1.05]) g.add(at(box(0.14, h, 0.14, C.white), x, 0, z));
      g.add(at(box(1.2, 0.5, 1.2, C.slate), 0, h), at(cyl(0.03, 0.05, 1.6, C.iron, 4), 0.2, h + 0.5, 0.2));
      g.add(at(box(2.6, 0.3, 2.6, C.stone), 0, 0, 0));
      break;
    }
    case 5: {
      g.add(box(3.0, 1.1, 2.2, C.white, { rough: 0.5 }));
      g.add(at(box(3.02, 0.3, 0.06, C.glass, { rough: 0.2 }), 0, 0.5, 1.1));
      g.add(at(dome(0.9 + lv * 0.1, C.glass, { rough: 0.15, opacity: 0.75 }), -0.7, 1.1, 0));
      const arm = group(at(cyl(0.2, 0.26, 0.4, C.iron, 8), 0, 0, 0), at(tilt(box(0.16, 1.1, 0.16, C.orange), 0, 0.5), 0.25, 0.3, 0), at(tilt(box(0.14, 0.9, 0.14, C.orange), 0, -0.9), 0.85, 0.9, 0), at(ball(0.14, C.iron, 0), 1.25, 0.85, 0));
      g.add(at(arm, 0.8, 1.1, 0));
      if (lv > 1) g.add(at(cyl(0.05, 0.05, 1.0, C.metal, 5), -1.3, 1.1, -0.8), at(tilt(cyl(0.5, 0.05, 0.25, C.white, 8), 0.6), -1.3, 2.1, -0.8));
      if (lv > 2) g.add(at(box(0.9, 0.7, 0.9, C.white), 2.1, 0, 0.4), at(box(0.7, 0.06, 0.7, C.blue, { metal: 0.3, rough: 0.3 }), 2.1, 0.72, 0.4));
      break;
    }
    default: {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = box(0.14, 3.2 + lv * 0.3, 0.14, C.metal);
        leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
        g.add(at(leg, Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1));
      }
      g.add(at(cyl(0.3, 0.3, 2.6, C.iron, 8), 0, 0, 0), at(cone(0.3, 0.5, C.orange, 8), 0, -0.1, 0));
      g.add(at(cyl(0.8, 0.8, 1.2, C.white, 10), 1.9, 0, 0.3), at(dome(0.8, C.white), 1.9, 1.2, 0.3));
      g.add(at(ball(0.2, C.glow, 0, { emissive: 0x7fe8ff }), 0, 3.3 + lv * 0.3, 0));
      if (lv > 1) g.add(at(cyl(0.6, 0.6, 0.9, C.white, 10), -1.8, 0, -0.5), at(dome(0.6, C.white), -1.8, 0.9, -0.5));
      if (lv > 2) g.add(at(tilt(cyl(0.7, 0.08, 0.3, C.white, 10), 0.7), -1.4, 1.2, 1.2), at(cyl(0.05, 0.05, 1.2, C.metal, 5), -1.4, 0, 1.2));
    }
  }
  return g;
}

function awning(w, d, color, y, z = 0) {
  return at(tilt(box(w, 0.08, d, color), 0.22), 0, y, z);
}

function trade(tier, lv) {
  const g = new THREE.Group();
  switch (tier) {
    case 0: {
      for (const x of [-1.2, 1.2]) for (const z of [-0.8, 0.8]) g.add(at(box(0.12, 1.7, 0.12, C.wood), x, 0, z));
      g.add(at(tilt(box(2.9, 0.1, 2.1, C.hide), 0.12), 0, 1.7));
      g.add(at(box(2.2, 0.6, 0.7, C.wood), 0, 0, 0.5));
      for (let i = 0; i < 3 + lv; i++) g.add(at(cyl(0.22, 0.18, 0.3, i % 2 ? C.thatch : C.clay, 7), -0.9 + i * 0.5, 0.6, 0.5));
      if (lv > 1) g.add(at(cyl(0.35, 0.3, 0.45, C.thatch, 8), 1.9, 0, 0.9), at(ball(0.2, C.red, 0), 1.9, 0.5, 0.9));
      if (lv > 2) g.add(at(box(0.1, 2.2, 0.1, C.woodDark), -1.9, 0, 0.9), at(cone(0.25, 0.5, C.red, 4), -1.9, 2.2, 0.9));
      break;
    }
    case 1: {
      const colors = [C.red, C.teal, C.gold, C.purple];
      for (let s = 0; s < 1 + lv; s++) {
        const x = (s - lv / 2) * 1.5;
        g.add(at(box(0.1, 1.6, 0.1, C.wood), x - 0.6, 0, 0.6), at(box(0.1, 1.9, 0.1, C.wood), x - 0.6, 0, -0.6), at(box(0.1, 1.6, 0.1, C.wood), x + 0.6, 0, 0.6), at(box(0.1, 1.9, 0.1, C.wood), x + 0.6, 0, -0.6));
        g.add(at(awning(1.4, 1.5, colors[s % 4], 1.75), x, 0, 0));
        g.add(at(box(1.1, 0.5, 0.6, C.mud), x, 0, 0.2), at(cyl(0.16, 0.2, 0.4, C.clay, 7), x - 0.25, 0.5, 0.2), at(ball(0.16, C.orange, 0), x + 0.25, 0.62, 0.2));
      }
      g.add(at(cyl(0.3, 0.2, 0.8, C.clay, 8), 2.6, 0, 0.8));
      break;
    }
    case 2: {
      g.add(box(3.2, 0.3, 2.4, C.stone));
      for (const x of [-1.4, 0, 1.4]) for (const z of [-1, 1]) g.add(at(box(0.22, 1.7, 0.22, C.woodDark), x, 0.3, z));
      g.add(at(box(3.2, 0.2, 2.4, C.woodDark), 0, 2.0));
      g.add(at(prism(3.6, 1.4 + lv * 0.2, 2.8, C.brick), 0, 2.2));
      g.add(at(box(0.9, 0.5, 0.6, C.wood), -0.8, 0.3, 0), at(box(0.9, 0.5, 0.6, C.wood), 0.8, 0.3, 0));
      g.add(at(ball(0.18, C.red, 0), -0.9, 0.9, 0), at(ball(0.18, C.gold, 0), -0.6, 0.9, 0.1), at(ball(0.2, C.leaf, 0), 0.8, 0.9, 0));
      if (lv > 1) g.add(at(box(0.08, 1.2, 0.08, C.woodDark), 0, 3.4 + lv * 0.2, 0), at(box(0.6, 0.4, 0.05, C.blue), 0.3, 4.2 + lv * 0.2, 0));
      if (lv > 2) g.add(at(cyl(0.3, 0.3, 0.6, C.wood, 8), 2.1, 0, 1.0), at(cyl(0.3, 0.3, 0.6, C.wood, 8), 2.3, 0, 0.3));
      break;
    }
    case 3: {
      g.add(box(2.8, 1.6, 1.6, C.brick), at(prism(3.1, 0.8, 1.9, C.slate), 0, 1.6, 0));
      g.add(windows(3, 0.9, 0.81, 1.8, C.glass), at(box(0.5, 0.5, 0.5, C.white), 0, 2.2, 0), at(cyl(0.2, 0.2, 0.04, C.ink, 10), 0, 2.45, 0.27));
      g.add(at(box(4.2, 0.25, 1.0, C.stone), 0, 0, 1.5));
      g.add(at(box(4.6, 0.06, 0.1, C.iron), 0, 0, 2.3), at(box(4.6, 0.06, 0.1, C.iron), 0, 0, 2.9));
      const loco = group(at(tilt(cyl(0.38, 0.38, 1.4, C.ink, 10), 0, Math.PI / 2), 0, 0.55, 0), at(box(0.7, 0.9, 0.8, C.red), -0.9, 0.2, 0), at(cyl(0.12, 0.16, 0.5, C.ink, 6), 0.45, 0.9, 0));
      for (const x of [-0.9, -0.2, 0.5]) loco.add(at(tilt(cyl(0.2, 0.2, 0.9, C.iron, 8), Math.PI / 2), x, 0.2, 0));
      g.add(at(loco, lv > 1 ? 0.6 : 0, 0.05, 2.6));
      if (lv > 2) g.add(at(box(1.2, 0.8, 0.8, C.wood), -1.4, 0.25, 2.6));
      break;
    }
    case 4: {
      g.add(box(3.6, 1.4 + lv * 0.3, 2.4, C.white));
      g.add(at(box(3.62, 0.7, 0.06, C.glass, { rough: 0.2 }), 0, 0.25, 1.2));
      g.add(at(box(3.7, 0.36, 2.5, [C.red, C.teal, C.purple][lv - 1]), 0, 1.4 + lv * 0.3));
      g.add(at(box(1.2, 0.5, 0.1, C.white, { emissive: 0xfff2c0, glow: 0.5 }), 0, 1.4 + lv * 0.3, 1.26));
      g.add(at(box(0.08, 1.6, 0.08, C.iron), 2.4, 0, 1.6), at(box(0.5, 0.5, 0.06, C.blue), 2.4, 1.6, 1.6));
      g.add(at(box(0.9, 0.35, 0.5, C.red), -2.3, 0.1, 1.9), at(box(0.5, 0.25, 0.45, C.glass), -2.3, 0.45, 1.9));
      break;
    }
    case 5: {
      const stack = [[C.red, -1, 0, 0], [C.blue, 0.1, 0, 0], [C.teal, -0.4, 0.62, 0], [C.orange, 1.2, 0, 0], [C.gold, 0.6, 0.62, 0]];
      stack.slice(0, 3 + lv - 1).forEach(([c, x, y, z]) => g.add(at(box(1.0, 0.6, 1.9, c), x, y, z)));
      g.add(at(box(0.2, 3.4, 0.2, C.iron), -2.1, 0, -0.8), at(box(0.2, 3.4, 0.2, C.iron), 2.1, 0, -0.8), at(box(4.6, 0.25, 0.25, C.orange), 0, 3.3, -0.8));
      g.add(at(box(0.5, 0.4, 0.5, C.orange), 0.6, 2.9, -0.8), at(box(0.04, 1.2, 0.04, C.ink), 0.6, 1.7, -0.8));
      g.add(at(cyl(1.0, 1.0, 0.1, C.slate, 12), 0.2, 0, 1.9), at(torus(0.7, 0.05, C.white), 0.2, 0.12, 1.9));
      g.children[g.children.length - 1].rotation.x = Math.PI / 2;
      break;
    }
    default: {
      g.add(cyl(0.35, 0.55, 2.4, C.metal, 8), at(ball(0.6, C.white, 1), 0, 2.4, 0));
      const ring = torus(1.5 + lv * 0.2, 0.16, C.white);
      ring.rotation.x = Math.PI / 2 - 0.3;
      g.add(at(ring, 0, 2.5, 0));
      const band = torus(1.5 + lv * 0.2, 0.06, C.blue, { emissive: 0x4aa8ff, glow: 0.8 });
      band.rotation.x = Math.PI / 2 - 0.3;
      g.add(at(band, 0, 2.62, 0));
      g.add(at(tilt(cyl(0.6, 0.08, 0.25, C.white, 10), 0.6), 1.8, 0.9, 0.8), at(cyl(0.05, 0.05, 0.9, C.metal, 5), 1.8, 0, 0.8));
      if (lv > 1) g.add(at(box(0.9, 0.6, 0.9, C.white), -1.8, 0, 0.6), at(box(0.9, 0.6, 0.9, C.blue), -1.8, 0.6, 0.6));
    }
  }
  return g;
}

/** A finished building for a pad. Golden buildings get gold caps and a floating star. */
export function makeBuilding(type, tier, level, golden) {
  const g = { home, work, trade }[type](tier, level);
  dressBuilding(g, type, tier, level);
  if (golden) {
    g.traverse((o) => {
      if (o.isMesh && [C.thatch, C.brick, C.slate, C.sand, C.woodDark].includes(o.material.color.getHex()) && o.position.y > 1) {
        o.material = mat(C.gold, { metal: 0.6, rough: 0.35 });
      }
    });
    const star = ball(0.32, C.gold, 0, { emissive: 0xffc94a, glow: 0.8 });
    star.name = 'spin';
    const box3 = new THREE.Box3().setFromObject(g);
    g.add(at(star, 0, box3.max.y + 0.8, 0));
  }
  bake(g);
  g.add(contactShadow(4.4));
  return g;
}

/** The slab a building stands on. Empty pads show a marker. */
export function makePad(tier) {
  const color = [C.dirt, C.sand, C.stone, C.stoneDark, C.asphalt, C.white, C.moonDark][tier] ?? C.stone;
  const g = group(cyl(3.5, 3.6, 0.12, color, 16));
  g.children[0].castShadow = false;
  return g;
}
export function makePadMarker() {
  const ring = torus(1.1, 0.08, C.gold, { emissive: 0xffc94a, glow: 0.7 });
  ring.rotation.x = Math.PI / 2;
  const plus = group(box(0.9, 0.14, 0.2, C.gold, { emissive: 0xffc94a, glow: 0.7 }), box(0.2, 0.14, 0.9, C.gold, { emissive: 0xffc94a, glow: 0.7 }));
  const g = group(at(ring, 0, 0.2, 0), at(plus, 0, 0.16, 0));
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

// --- Wonders ----------------------------------------------------------------------

export function makeWonder(index) {
  const g = new THREE.Group();
  switch (index) {
    case 0: {
      g.add(cyl(4.6, 4.8, 0.2, C.grassDark, 16));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(at(box(0.9, 3.0 + (i % 2) * 0.4, 0.6, i % 3 ? C.rock : C.rockDark), Math.cos(a) * 3.6, 0.1, Math.sin(a) * 3.6, -a));
        if (i % 2 === 0) {
          const b = ((i + 0.5) / 8) * Math.PI * 2;
          g.add(at(box(3.0, 0.5, 0.7, C.rock), Math.cos(b) * 3.5, 3.2, Math.sin(b) * 3.5, -b + Math.PI / 2));
        }
      }
      g.add(at(box(1.4, 0.6, 0.9, C.rockDark), 0, 0.2, 0), at(cone(0.3, 0.8, C.orange, 9, { emissive: 0xff6a10, glow: 1.5 }), 0, 0.8, 0));
      break;
    }
    case 1: {
      for (let i = 0; i < 6; i++) g.add(at(box(8 - i * 1.25, 1.0, 8 - i * 1.25, i % 2 ? C.sand : C.mud), 0, i * 1.0, 0));
      g.add(at(cone(1.1, 1.3, C.gold, 4, { metal: 0.6, rough: 0.3 }), 0, 6.0, 0, Math.PI / 4));
      g.add(at(box(1.0, 1.4, 0.3, C.ink), 0, 0, 4.0));
      for (const x of [-5.2, 5.2]) g.add(at(box(0.6, 3.0, 0.6, C.sand), x, 0, 4.4), at(cone(0.5, 0.7, C.gold, 4), x, 3.0, 4.4, Math.PI / 4));
      break;
    }
    case 2: {
      g.add(box(4.2, 5.0, 8.0, C.stone), at(prism(4.6, 2.4, 8.4, C.slate), 0, 5.0, 0));
      for (const x of [-2.6, 2.6]) {
        g.add(at(box(2.0, 9.0, 2.0, C.stone), x, 0, 3.4), at(cone(1.5, 3.4, C.slate, 4), x, 9.0, 3.4, Math.PI / 4));
        g.add(at(box(0.5, 1.4, 0.1, C.ink), x, 6.6, 4.42));
      }
      const rose = cyl(1.1, 1.1, 0.12, C.purple, 10, { emissive: 0x9a6bff, glow: 0.5 });
      rose.rotation.x = Math.PI / 2;
      g.add(at(rose, 0, 4.2, 4.05), at(box(1.3, 2.4, 0.2, C.woodDark), 0, 0, 4.05));
      for (let i = 0; i < 4; i++) g.add(at(box(0.5, 3.4, 1.0, C.stoneDark), 2.4, 0, -3 + i * 1.7), at(box(0.5, 3.4, 1.0, C.stoneDark), -2.4, 0, -3 + i * 1.7));
      break;
    }
    case 3: {
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = box(0.5, 7.4, 0.5, C.iron);
        leg.rotation.set(-z * 0.33, 0, x * 0.33);
        g.add(at(leg, x * 3.2, 0, z * 3.2));
      }
      g.add(at(box(4.6, 0.4, 4.6, C.iron), 0, 3.4, 0), at(box(2.6, 0.4, 2.6, C.iron), 0, 6.8, 0));
      g.add(at(cyl(0.5, 1.3, 6.0, C.iron, 4), 0, 7.0, 0, Math.PI / 4), at(box(1.3, 0.5, 1.3, C.iron), 0, 12.6, 0), at(cyl(0.04, 0.2, 3.0, C.iron, 4), 0, 13.1, 0));
      g.add(at(ball(0.22, C.red, 0, { emissive: 0xff3030 }), 0, 16.1, 0));
      break;
    }
    case 4: {
      let y = 0;
      for (let i = 0; i < 7; i++) {
        const w = 4.2 - i * 0.5;
        g.add(at(box(w, 2.4, w, i % 2 ? C.glass : C.blue, { rough: 0.2, metal: 0.25 }), 0, y, 0, i * 0.2));
        g.add(at(box(w + 0.1, 0.12, w + 0.1, C.white), 0, y + 2.3, 0, i * 0.2));
        y += 2.4;
      }
      g.add(at(cyl(0.05, 0.4, 5.0, C.white, 6), 0, y, 0), at(ball(0.25, C.glow, 0, { emissive: 0x7fe8ff }), 0, y + 5.0, 0));
      break;
    }
    case 5: {
      g.add(cyl(5.0, 5.4, 0.5, C.stoneDark, 16), at(cyl(2.6, 2.8, 0.4, C.slate, 12), 0, 0.5, 0));
      const rocket = group(
        at(cyl(1.0, 1.1, 7.0, C.white, 12, { rough: 0.45 }), 0, 0.6, 0), at(cone(1.0, 2.4, C.red, 12), 0, 7.6, 0),
        at(cyl(1.02, 1.02, 0.5, C.red, 12), 0, 4.6, 0), at(cyl(0.8, 0.55, 0.6, C.iron, 10), 0, 0, 0),
        at(ball(0.34, C.glass, 0, { rough: 0.15 }), 0, 6.2, 0.95),
      );
      for (let i = 0; i < 4; i++) {
        const fin = box(0.14, 2.0, 1.3, C.red);
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        rocket.add(at(fin, Math.cos(a) * 1.3, 0.3, Math.sin(a) * 1.3, -a + Math.PI / 2));
      }
      rocket.name = 'rocket';
      g.add(at(rocket, 0, 0.9, 0));
      g.add(at(box(0.5, 9.0, 0.5, C.iron), 3.0, 0.5, 0), at(box(2.0, 0.3, 0.5, C.iron), 2.0, 7.0, 0), at(box(2.0, 0.3, 0.5, C.iron), 2.0, 4.0, 0));
      break;
    }
    default: {
      g.add(cyl(4.4, 5.0, 0.6, C.moonDark, 16), at(box(7.0, 0.5, 2.0, C.metal), 0, 0.6, 0));
      const ring = mesh(new THREE.TorusGeometry(4.6, 0.6, 8, 24), C.white, { rough: 0.4 });
      g.add(at(ring, 0, 5.6, 0));
      const band = mesh(new THREE.TorusGeometry(4.6, 0.2, 6, 24), C.blue, { emissive: 0x4aa8ff, glow: 1 });
      g.add(at(band, 0, 5.6, 0.5));
      const portal = mesh(new THREE.CircleGeometry(4.1, 24), C.glow, { emissive: 0x6fd8ff, glow: 0.9, opacity: 0.7 });
      portal.material.side = THREE.DoubleSide;
      portal.castShadow = false;
      portal.name = 'portal';
      g.add(at(portal, 0, 5.6, 0));
    }
  }
  return bake(g);
}

/** What marks a wonder that hasn't been built yet. */
export function makeWonderSite() {
  const g = group(cyl(4.4, 4.6, 0.1, C.dirt, 14));
  g.children[0].castShadow = false;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(at(box(0.14, 1.2, 0.14, C.wood), Math.cos(a) * 4.0, 0, Math.sin(a) * 4.0));
  }
  g.add(at(box(1.6, 0.7, 1.0, C.stone), -1.0, 0.1, 0.5), at(box(1.0, 0.5, 0.8, C.stoneDark), 0.8, 0.1, -0.6), at(box(0.1, 2.4, 0.1, C.woodDark), 0, 0, 0), at(box(1.2, 0.7, 0.06, C.gold), 0.62, 1.65, 0));
  return bake(g);
}

// --- Town centre and gate, by era ---------------------------------------------------

export function makeTownCenter(era) {
  const g = new THREE.Group();
  if (era === 0) {
    g.add(makeCampfire());
  } else if (era === 1) {
    g.add(box(2.6, 0.5, 2.6, C.sand), at(box(1.0, 5.0, 1.0, C.sand), 0, 0.5, 0), at(cone(0.72, 1.0, C.gold, 4, { metal: 0.6, rough: 0.3 }), 0, 5.5, 0, Math.PI / 4));
  } else if (era === 2) {
    g.add(cyl(2.4, 2.6, 0.6, C.stone, 10), at(cyl(2.1, 2.1, 0.12, C.water, 10, { rough: 0.2 }), 0, 0.55, 0), at(cyl(0.4, 0.5, 1.8, C.stoneDark, 8), 0, 0.6, 0), at(cyl(1.0, 0.3, 0.3, C.stone, 8), 0, 2.4, 0), at(ball(0.3, C.water, 0), 0, 2.8, 0));
  } else if (era === 3) {
    g.add(box(1.8, 6.0, 1.8, C.brick), at(box(2.0, 0.3, 2.0, C.stone), 0, 6.0, 0), at(cone(1.5, 1.8, C.slate, 4), 0, 6.3, 0, Math.PI / 4));
    for (let i = 0; i < 4; i++) {
      const face = cyl(0.6, 0.6, 0.08, C.cream, 12, { emissive: 0xfff2c0, glow: 0.4 });
      face.rotation.x = Math.PI / 2;
      const a = (i / 4) * Math.PI * 2;
      g.add(at(face, Math.sin(a) * 0.92, 4.9, Math.cos(a) * 0.92, a));
    }
  } else if (era === 4) {
    g.add(cyl(2.6, 2.8, 0.4, C.stone, 12), at(box(1.0, 1.6, 1.0, C.white), 0, 0.4, 0));
    const fig = group(cyl(0.3, 0.4, 1.3, C.metal, 8, { metal: 0.6, rough: 0.4 }), at(ball(0.3, C.metal, 1, { metal: 0.6, rough: 0.4 }), 0, 1.6, 0), at(tilt(box(0.14, 1.0, 0.14, C.metal, { metal: 0.6, rough: 0.4 }), 0, -0.9), 0.5, 1.2, 0));
    g.add(at(fig, 0, 2.0, 0));
  } else {
    g.add(cyl(2.4, 2.6, 0.4, C.white, 12));
    const holo = ball(1.2, C.glow, 1, { emissive: 0x6fd8ff, glow: 0.9, opacity: 0.55 });
    holo.name = 'spin';
    holo.castShadow = false;
    g.add(at(holo, 0, 2.4, 0), at(cyl(0.2, 0.5, 0.9, C.metal, 8), 0, 0.4, 0));
    const ring = torus(1.7, 0.05, C.glow, { emissive: 0x6fd8ff, glow: 0.9 });
    ring.rotation.x = Math.PI / 2;
    ring.name = 'spin';
    g.add(at(ring, 0, 2.4, 0));
  }
  return bake(g);
}

export function makeGate(era) {
  const g = new THREE.Group();
  const wall = [C.wood, C.mud, C.stone, C.brick, C.white, C.white, C.metal][Math.min(era, 6)];
  const cap = [C.woodDark, C.sand, C.slate, C.slate, C.blue, C.glow, C.blue][Math.min(era, 6)];
  for (const x of [-3.2, 3.2]) {
    if (era === 0) {
      for (let i = 0; i < 4; i++) g.add(at(cone(0.3, 3.2 + (i % 2) * 0.5, wall, 6), x + (i - 1.5) * 0.5, 0, 0));
    } else {
      g.add(at(box(1.8, 4.2, 1.8, wall), x, 0, 0), at(era >= 4 ? box(2.0, 0.3, 2.0, cap, era >= 5 ? { emissive: 0x6fd8ff, glow: 0.6 } : undefined) : cone(1.5, 1.6, cap, 4), x, 4.2, 0, Math.PI / 4));
    }
  }
  if (era > 0) g.add(at(box(4.8, 0.8, 1.0, wall), 0, 3.4, 0));
  else g.add(at(box(6.6, 0.3, 0.3, C.woodDark), 0, 2.8, 0));
  const flag = box(1.0, 0.7, 0.06, C.red);
  flag.name = 'flag';
  g.add(at(box(0.1, 2.2, 0.1, C.woodDark), 3.2, era === 0 ? 3.2 : 5.4, 0), at(flag, 3.75, era === 0 ? 4.6 : 6.8, 0));
  return bake(g);
}

// --- Nature -------------------------------------------------------------------------

export function makeTree(kind = 0, scale = 1) {
  const g = singleTree(kind, Math.floor(scale * 10));
  g.scale.setScalar(scale);
  return g;
}
export function makeRock(scale = 1) {
  const g = group(mesh(rockGeometry(), C.rock), at(mesh(rockGeometry(), C.rockDark), 0.75, -0.05, 0.35));
  g.children[1].scale.setScalar(0.6);
  g.scale.set(scale, scale * 0.8, scale);
  return g;
}
export function makeCloud() {
  return new THREE.Group(); // clouds live in the sky shader now
}

// --- Characters -----------------------------------------------------------------------

export const SKIN_COLORS = {
  'color:clay': 0xd9785a, 'color:moss': 0x6fa457, 'color:ocean': 0x3f8fd0, 'color:plum': 0x8a5bc4,
  'color:ember': 0xe85d3a, 'color:snow': 0xf2f0ea, 'color:gold': 0xf2c14e,
};
export const COSMETIC_NAMES = {
  'hat:none': 'No hat', 'hat:straw': 'Straw Hat', 'hat:crown': 'Crown', 'hat:helm': 'Knight Helm', 'hat:top': 'Top Hat', 'hat:cap': 'Cap', 'hat:astro': 'Star Helmet',
  'hat:leaf': 'Leaf crown', 'hat:gradcap': 'Graduation cap', 'hat:wizard': 'Wizard hat', 'hat:deans': 'Dean’s List crown', 'hat:halo': 'Scholar’s halo',
  'color:clay': 'Clay', 'color:moss': 'Moss', 'color:ocean': 'Ocean', 'color:plum': 'Plum', 'color:ember': 'Ember', 'color:snow': 'Snow', 'color:gold': 'Gold',
};

export const makeHat = (id) => hat(id);
/** The club the player swings. Handle at the origin, pointing up. */
export function makeClub() {
  return group(cyl(0.035, 0.03, 0.95, C.woodDark, 8), at(cyl(0.11, 0.06, 0.38, C.wood, 8), 0, 0.72, 0), at(cyl(0.115, 0.115, 0.05, C.iron, 8), 0, 0.88, 0));
}
/** What the player swings in each age. Grip at the origin, pointing up. */
export function makeWeapon(era = 0) {
  if (era <= 0) return makeClub();
  const steel = { metal: 0.9, rough: 0.22 };
  if (era >= 5) {
    const glow = era >= 6 ? 0x8cf6ff : 0x7dffb0;
    return group(cyl(0.035, 0.035, 0.3, C.iron, 8, steel), at(cyl(0.07, 0.07, 0.05, C.metal, 10, steel), 0, 0.28, 0),
      at(cyl(0.03, 0.04, 1.15, C.white, 8, { emissive: glow, glow: 2.4 }), 0, 0.33, 0));
  }
  const blade = [0, C.thatch, C.metal, C.metal, C.slate][era];
  const length = [0, 0.78, 1.05, 1.0, 0.72][era];
  const g = group(cyl(0.032, 0.032, 0.26, C.woodDark, 8), at(ball(0.05, era === 1 ? C.thatch : C.iron, 0, steel), 0, -0.03, 0),
    at(box(era === 3 ? 0.1 : 0.34, 0.05, 0.07, era === 1 ? C.thatch : C.iron, steel), 0, 0.26, 0),
    at(box(era === 3 ? 0.07 : 0.1, length, 0.025, blade, steel), 0, 0.31, 0));
  const tip = cone(0.05, 0.16, blade, 4, steel);
  tip.scale.z = 0.3;
  g.add(at(tip, 0, 0.31 + length, 0));
  return g;
}

/** The trailhead where the path leaves the valley for the Wilds. The trail runs toward +X. */
export function makeDock() {
  const g = group();
  for (const z of [-2.1, 2.1]) {
    g.add(at(cyl(0.2, 0.26, 4.4, C.woodDark, 8), 0, 0, z), at(box(0.7, 0.3, 0.7, C.stone), 0, 0, z));
    g.add(at(cyl(0.05, 0.05, 0.5, C.iron, 6), 0.3, 3.1, z), at(ball(0.2, C.glow, 0, { emissive: 0xffc36a, glow: 1.8 }), 0.3, 2.95, z));
  }
  const beam = at(cyl(0.16, 0.16, 5.2, C.wood, 8), 0, 4.2, 0);
  beam.rotation.x = Math.PI / 2;
  g.add(beam, at(box(0.1, 0.8, 2.4, C.wood), 0, 3.5, 0), at(box(0.12, 0.12, 2.6, C.woodDark), 0, 3.95, 0));
  // A signpost and a few supplies left by the last travellers.
  g.add(at(cyl(0.07, 0.07, 2.3, C.woodDark, 6), -1.6, 0, 3.4), at(box(1.2, 0.34, 0.08, C.wood), -1.3, 1.9, 3.4, 0.3), at(box(1.0, 0.3, 0.08, C.wood), -1.9, 1.45, 3.4, -0.35));
  g.add(at(box(0.9, 0.7, 0.9, C.wood), -1.2, 0, -3.5, 0.3), at(box(0.7, 0.55, 0.7, C.woodDark), -2.1, 0, -3.1, -0.2), at(cyl(0.38, 0.38, 0.9, C.woodDark, 10), -0.6, 0, -4.3));
  return bake(g);
}

function hat(id) {
  switch (id) {
    case 'hat:straw': return group(cyl(0.3, 0.75, 0.1, C.thatch, 10), at(cone(0.36, 0.35, C.thatch, 10), 0, 0.08, 0));
    case 'hat:crown': {
      const g = group(cyl(0.36, 0.34, 0.22, C.gold, 8, { metal: 0.6, rough: 0.3 }));
      for (let i = 0; i < 5; i++) g.add(at(cone(0.08, 0.2, C.gold, 4, { metal: 0.6, rough: 0.3 }), Math.cos(i * 1.257) * 0.3, 0.2, Math.sin(i * 1.257) * 0.3));
      return g;
    }
    case 'hat:helm': return group(dome(0.44, C.metal, { metal: 0.5, rough: 0.4 }), at(box(0.06, 0.3, 0.5, C.red), 0, 0.36, -0.05));
    case 'hat:top': return group(cyl(0.52, 0.52, 0.06, C.ink, 10), at(cyl(0.32, 0.34, 0.5, C.ink, 10), 0, 0.05, 0), at(cyl(0.345, 0.345, 0.1, C.red, 10), 0, 0.08, 0));
    case 'hat:cap': return group(dome(0.42, C.blue), at(box(0.5, 0.05, 0.4, C.blue), 0, 0.02, 0.4));
    case 'hat:astro': return group(at(ball(0.62, C.glass, 1, { opacity: 0.35, rough: 0.1 }), 0, -0.2, 0), at(torus(0.42, 0.06, C.white), 0, -0.55, 0));
    case 'hat:leaf': {
      const g = group(at(tilt(torus(0.34, 0.035, 0x6a8a3a), Math.PI / 2, 0), 0, 0.05, 0));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const l = at(squash(ball(0.09, i % 2 ? 0x6fae4f : 0x8cc85a, 0), 0.5, 0.25, 1.4), Math.cos(a) * 0.34, 0.08, Math.sin(a) * 0.34); l.rotation.y = -a; l.rotation.x = 0.4; g.add(l); }
      return g;
    }
    case 'hat:gradcap': {
      const g = group(cyl(0.34, 0.36, 0.22, C.ink, 10, { kind: 'fabric' }), at(box(0.95, 0.05, 0.95, C.ink, { kind: 'fabric' }), 0, 0.22, 0, Math.PI / 4), at(cyl(0.05, 0.05, 0.04, C.gold, 8, { metal: 0.6 }), 0, 0.27, 0));
      g.add(at(box(0.02, 0.02, 0.4, C.gold), 0.2, 0.28, 0.2, Math.PI / 4), at(box(0.03, 0.32, 0.03, C.gold), 0.33, 0.12, 0.33), at(cone(0.06, 0.15, C.gold, 8, { metal: 0.5 }), 0.33, -0.02, 0.33));
      return g;
    }
    case 'hat:wizard': {
      const blue = 0x2a3a8a;
      const tip = at(tilt(cone(0.24, 0.55, blue, 10, { kind: 'fabric' }), 0.35, 0), 0.05, 0.58, 0);
      const g = group(cyl(0.62, 0.62, 0.05, blue, 14, { kind: 'fabric' }), at(cone(0.38, 0.65, blue, 10, { kind: 'fabric' }), 0, 0.03, 0), tip, at(cyl(0.385, 0.385, 0.09, C.gold, 12, { metal: 0.5 }), 0, 0.05, 0));
      for (let i = 0; i < 6; i++) g.add(at(ball(0.035, 0xfff2a0, 0, { emissive: 0xffe08a, glow: 1.5 }), Math.cos(i * 1.7) * 0.25, 0.2 + (i % 3) * 0.17, Math.sin(i * 1.7) * 0.25));
      return g;
    }
    case 'hat:deans': {
      const metal = { metal: 0.85, rough: 0.2 };
      const g = group(cyl(0.37, 0.35, 0.18, C.gold, 12, metal));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; g.add(at(cone(0.07, 0.24, C.gold, 4, metal), Math.cos(a) * 0.33, 0.18, Math.sin(a) * 0.33), at(ball(0.04, 0xfff3c0, 0, { emissive: 0xffe08a, glow: 1 }), Math.cos(a) * 0.33, 0.43, Math.sin(a) * 0.33)); }
      for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { const l = at(squash(ball(0.07, 0x9fd06a, 0, metal), 0.4, 0.3, 1.3), sx * 0.36, 0.05 + k * 0.05, 0.25 - k * 0.15); l.rotation.y = sx * 0.6; g.add(l); }
      g.add(at(squash(ball(0.08, 0xd81e3a, 0, { emissive: 0xa00020, glow: 0.8, rough: 0.1 }), 1, 1.2, 0.6), 0, 0.1, 0.37));
      return g;
    }
    case 'hat:halo': {
      const ring = at(tilt(torus(0.36, 0.045, 0xfff6c8, { emissive: 0xffe6a0, glow: 2.4 }), Math.PI / 2, 0), 0, 0.45, 0);
      ring.name = 'halo';
      const g = group(ring);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(at(ball(0.035, 0xffffff, 0, { emissive: 0xfff2c0, glow: 2 }), Math.cos(a) * 0.36, 0.45, Math.sin(a) * 0.36)); }
      return g;
    }
    default: return null;
  }
}

function capsule(r, len, color, opts) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 16);
  g.translate(0, len / 2 + r, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 6.28, uv.getY(i) * (len + r * 2));
  return mesh(g, color, opts);
}
function squash(obj, x, y, z) {
  obj.scale.set(x, y, z);
  return obj;
}

/**
 * The player: a small, big-headed student in an oversized hoodie, with messy
 * hair, headphones round the neck and a backpack stuffed with a rolled-up plan
 * for the next age. Clean, smooth surfaces so the face reads from far away.
 * parts lets the game move things: limbs, head, eyes (blink), tuft, charm.
 */
export function makeCharacter(colorId = 'color:clay', hatId = 'hat:none') {
  const hoodie = SKIN_COLORS[colorId] ?? SKIN_COLORS['color:clay'];
  const shade = new THREE.Color(hoodie).multiplyScalar(0.72).getHex();
  const soft = { kind: 'smooth', rough: 0.75 };
  const skinMat = { kind: 'smooth', rough: 0.55 };
  const skin = 0xf3c7a2;
  const hair = 0x4a2f22;
  const gloss = { kind: 'smooth', rough: 0.25 };

  const body = new THREE.Group();
  // Hoodie: roomy, wider at the hem, with a front pocket, a hood and drawstrings.
  body.add(at(squash(capsule(0.3, 0.3, hoodie, soft), 1.12, 1, 0.92), 0, 0.46, 0));
  body.add(at(squash(cyl(0.36, 0.38, 0.12, shade, 12, soft), 1.08, 1, 0.9), 0, 0.46, 0));
  body.add(at(squash(ball(0.2, shade, 1, soft), 1.25, 0.6, 0.5), 0, 0.72, 0.24));
  const hood = squash(ball(0.3, hoodie, 1, soft), 1.15, 0.7, 0.85);
  body.add(at(hood, 0, 1.2, -0.2));
  for (const x of [-0.09, 0.09]) body.add(at(cyl(0.014, 0.014, 0.24, C.cream, 6, soft), x, 0.9, 0.275), at(ball(0.026, C.cream, 0, soft), x, 0.9, 0.275));
  // Headphones resting on the collar.
  const band = torus(0.27, 0.035, C.ink, gloss);
  band.rotation.x = Math.PI / 2 - 0.25;
  body.add(at(band, 0, 1.2, 0.02));
  for (const x of [-0.27, 0.27]) {
    const cup = cyl(0.1, 0.1, 0.09, C.ink, 10, gloss);
    cup.rotation.z = Math.PI / 2;
    body.add(at(cup, x + Math.sign(x) * 0.045, 1.2, 0.06), at(squash(ball(0.07, C.gold, 0, { kind: 'smooth', rough: 0.3, metal: 0.6 }), 0.4, 1, 1), x * 1.36, 1.2, 0.06));
  }
  // Backpack: too big for its owner, with the plan for the next age sticking out and a lucky star.
  const pack = group(
    squash(capsule(0.24, 0.26, C.teal, soft), 1.15, 1, 0.75),
    at(squash(ball(0.17, 0x2f8f84, 1, soft), 1.2, 0.8, 0.5), 0, 0.3, -0.17),
    at(squash(cyl(0.25, 0.25, 0.06, 0x2f8f84, 12, soft), 1.15, 1, 0.75), 0, 0.62, 0),
  );
  const plan = group(cyl(0.065, 0.065, 0.7, C.cream, 10, soft), at(cyl(0.07, 0.07, 0.07, C.blue, 10, soft), 0, 0.32, 0));
  plan.rotation.set(0.12, 0, -0.38);
  pack.add(at(plan, 0.12, 0.42, 0.02));
  const charm = group(at(cyl(0.008, 0.008, 0.14, C.ink, 4), 0, -0.14, 0), at(squash(ball(0.06, C.gold, 0, { emissive: 0xffc94a, glow: 0.5 }), 1, 1, 0.5), 0, -0.19, 0));
  pack.add(at(charm, -0.29, 0.36, -0.02));
  body.add(at(pack, 0, 0.5, -0.36));
  for (const x of [-0.2, 0.2]) body.add(at(squash(capsule(0.035, 0.42, C.ink, soft), 1.3, 1, 0.5), x, 0.62, 0.02), at(squash(capsule(0.035, 0.3, C.ink, soft), 1.3, 1, 1), x, 1.06, -0.2));

  // Head: big, with large eyes, brows, a small grin and warm cheeks.
  const head = new THREE.Group();
  head.add(squash(ball(0.42, skin, 1, skinMat), 1.04, 0.96, 0.98));
  for (const x of [-0.42, 0.42]) head.add(at(squash(ball(0.085, skin, 0, skinMat), 0.55, 1, 0.85), x, -0.03, 0));
  const eyes = new THREE.Group();
  const brows = [];
  for (const x of [-0.165, 0.165]) {
    eyes.add(at(squash(ball(0.085, 0x2a1d1a, 1, gloss), 0.86, 1.18, 0.5), x, 0, 0));
    eyes.add(at(ball(0.03, C.white, 0, { emissive: 0xffffff, glow: 0.4 }), x + 0.028, 0.045, 0.036));
    eyes.add(at(ball(0.014, C.white, 0, { emissive: 0xffffff, glow: 0.4 }), x - 0.03, -0.035, 0.038));
    const brow = at(tilt(squash(capsule(0.022, 0.1, hair, soft), 1, 1, 0.7), 0, Math.PI / 2 + (x < 0 ? 0.2 : -0.2)), x + (x < 0 ? 0.07 : -0.07), 0.2, 0.37);
    brows.push(brow);
    head.add(brow);
    head.add(at(squash(ball(0.075, 0xf29a8e, 0, { kind: 'smooth', rough: 0.9, opacity: 0.55 }), 1.1, 0.7, 0.25), x * 1.55, -0.13, 0.33));
  }
  head.add(at(eyes, 0, 0.0, 0.375));
  head.add(at(squash(ball(0.035, 0xe6ad88, 0, skinMat), 1, 0.8, 0.9), 0, -0.07, 0.41));
  const grin = mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 16, Math.PI), 0x7a3a2c, soft);
  grin.rotation.set(-0.15, 0, Math.PI + 0.12);
  head.add(at(grin, 0.015, -0.15, 0.385));
  // Hair: a rough cap, side sweeps, and a cowlick that never lies flat.
  const hairSoft = { kind: 'smooth', rough: 0.6 };
  const cap = squash(dome(0.445, hair, hairSoft), 1.06, 0.95, 1.04);
  cap.rotation.x = 0.42; // tipped back, so the forehead and eyes stay clear
  head.add(at(cap, 0, 0.06, -0.05));
  head.add(at(squash(ball(0.37, hair, 1, hairSoft), 1.1, 1.0, 0.72), 0, -0.02, -0.17));
  // Chunky, rounded locks: a swept fringe, sideburns, and a ruffled crown.
  const locks = new THREE.Group();
  const lock = (x, y, z, sx, sy, sz, rz = 0, rx = 0) => locks.add(at(tilt(squash(ball(0.13, hair, 1, hairSoft), sx, sy, sz), rx, rz), x, y, z));
  lock(-0.2, 0.3, 0.27, 1.25, 0.62, 0.9, 0.5, 0.3);
  lock(0.03, 0.34, 0.3, 1.35, 0.66, 0.9, 0.12, 0.3);
  lock(0.24, 0.29, 0.25, 1.15, 0.6, 0.9, -0.45, 0.3);
  lock(-0.4, 0.08, 0.1, 0.5, 1.15, 0.8, 0.12);
  lock(0.4, 0.08, 0.1, 0.5, 1.15, 0.8, -0.12);
  lock(-0.24, 0.4, -0.05, 1.0, 0.7, 1.0, 0.5);
  lock(0.22, 0.42, -0.1, 1.05, 0.7, 1.0, -0.4);
  lock(0, 0.4, -0.26, 1.2, 0.8, 1.0);
  head.add(locks);
  // The cowlick: two soft curls that never lie flat.
  const tuft = group(at(tilt(squash(ball(0.085, hair, 1, hairSoft), 0.7, 1.5, 0.7), -0.3, 0.35), 0, 0.07, 0), at(tilt(squash(ball(0.06, hair, 0, hairSoft), 0.7, 1.4, 0.7), -0.5, -0.6), 0.07, 0.07, -0.02));
  head.add(at(tuft, 0.03, 0.44, -0.02));
  const hatMesh = hat(hatId);
  if (hatMesh) {
    const open = hatId === 'hat:astro';
    tuft.visible = open;
    locks.children[1].visible = open || hatId === 'hat:crown';
    head.add(at(hatMesh, 0, open ? 0.28 : 0.3, 0));
    hatMesh.scale.setScalar(open ? 1.05 : 1.12);
  }
  body.add(at(head, 0, 1.56, 0));

  // Limbs hang from a pivot at the shoulder or hip, so the game can swing them.
  const arm = (side) => {
    const pivot = new THREE.Group();
    const sleeve = squash(capsule(0.105, 0.26, hoodie, soft), 1, 1, 1);
    sleeve.position.y = -0.47;
    const cuff = at(cyl(0.1, 0.11, 0.06, shade, 10, soft), 0, -0.5, 0);
    const hand = at(squash(ball(0.105, skin, 1, skinMat), 0.9, 1, 1), 0, -0.57, 0);
    pivot.add(sleeve, cuff, hand);
    pivot.rotation.z = side * 0.16;
    return pivot;
  };
  const leg = () => {
    const pivot = new THREE.Group();
    const trouser = capsule(0.12, 0.2, 0x39435c, soft);
    trouser.position.y = -0.42;
    // Chunky sneakers: a white sole, a coloured upper, a toe cap.
    const sole = at(squash(capsule(0.12, 0.14, C.white, soft), 1.05, 0.32, 1), 0, -0.5, 0.06);
    sole.rotation.x = Math.PI / 2;
    const upper = at(squash(ball(0.135, 0xf2c14e, 1, soft), 1, 0.78, 1.5), 0, -0.4, 0.07);
    const toe = at(squash(ball(0.1, C.white, 0, soft), 1.05, 0.7, 0.9), 0, -0.44, 0.21);
    pivot.add(trouser, sole, upper, toe);
    return pivot;
  };
  const armL = at(arm(-1), -0.4, 1.12, 0);
  const armR = at(arm(1), 0.4, 1.12, 0);
  const club = group(at(cyl(0.035, 0.03, 0.95, C.woodDark, 8), 0, 0, 0), at(cyl(0.11, 0.06, 0.38, C.wood, 8), 0, 0.72, 0), at(cyl(0.115, 0.115, 0.05, C.iron, 8), 0, 0.88, 0));
  club.rotation.x = Math.PI / 2;
  club.name = 'weapon';
  armR.add(at(club, 0, -0.57, 0.02));
  const legL = at(leg(), -0.17, 0.52, 0);
  const legR = at(leg(), 0.17, 0.52, 0);
  const g = group(body, armL, armR, legL, legR);
  g.userData.parts = { armL, armR, legL, legR, body, head, eyes, brows, tuft, charm, pack };
  return g;
}

/**
 * What comes for you. Assignments are angry walking books; a test is a huge
 * tome in a graduation cap; raiders are hooded thieves with a sack.
 * variant: 'invader' | 'raider' | 'boss'.
 */
export function makeCreature(variant = 'invader', size = 1) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  let footL, footR;
  if (variant === 'raider') {
    const cloak = 0x2c4a47;
    body.add(at(squash(capsule(0.42, 0.3, cloak, { kind: 'fabric' }), 1, 1, 0.9), 0, -0.6, 0));
    body.add(at(cone(0.5, 0.75, cloak, 10, { kind: 'fabric' }), 0, 0.28, -0.04));
    body.add(at(squash(ball(0.3, 0x1d1b22, 1, { rough: 0.9 }), 1, 0.9, 0.7), 0, 0.3, 0.2));
    for (const x of [-0.11, 0.11]) body.add(at(ball(0.05, C.gold, 0, { emissive: 0xffd24a, glow: 1.2 }), x, 0.32, 0.4));
    body.add(at(squash(torus(0.4, 0.05, C.woodDark, { kind: 'fabric' }), 1, 1, 0.9), 0, -0.25, 0));
    body.children[body.children.length - 1].rotation.x = Math.PI / 2;
    const sack = group(squash(ball(0.4, C.thatch, 1, { kind: 'fabric' }), 1, 1.1, 0.9), at(cyl(0.1, 0.16, 0.16, C.thatch, 8, { kind: 'fabric' }), 0, 0.4, 0), at(torus(0.12, 0.025, C.woodDark), 0, 0.42, 0));
    sack.children[2].rotation.x = Math.PI / 2;
    body.add(at(sack, 0.1, -0.05, -0.55));
    for (const x of [-0.5, 0.5]) body.add(at(capsule(0.09, 0.3, cloak, { kind: 'fabric' }), x, -0.35, 0.05));
    footL = at(squash(ball(0.17, 0x1d1b22, 0), 1, 0.6, 1.5), -0.2, 0.1, 0.08);
    footR = at(squash(ball(0.17, 0x1d1b22, 0), 1, 0.6, 1.5), 0.2, 0.1, 0.08);
  } else {
    const boss = variant === 'boss';
    const cover = boss ? 0x7a1f2b : [0x5b3fa0, 0x2f6f9e, 0x8a3f6b, 0x3f7f5a][Math.floor(size * 7) % 4];
    const w = boss ? 1.25 : 0.95, h = boss ? 1.5 : 1.15, d = boss ? 0.62 : 0.4;
    const leather = { kind: 'fabric', rough: 0.75 };
    const trim = { metal: 0.8, rough: 0.3 };
    // A thick book standing on end: two covers, a spine, and the pages between.
    body.add(at(box(w, h, 0.06, cover, leather), 0, -h / 2, d / 2), at(box(w, h, 0.06, cover, leather), 0, -h / 2, -d / 2));
    body.add(at(box(0.07, h, d + 0.06, cover, leather), -w / 2, -h / 2, 0));
    body.add(at(box(w - 0.1, h - 0.1, d - 0.04, C.cream, { kind: 'planks', rough: 0.9 }), 0.03, -h / 2 + 0.05, 0));
    for (const y of [-h / 2 + 0.16, h / 2 - 0.22]) body.add(at(box(0.09, 0.06, d + 0.08, C.gold, trim), -w / 2, y, 0));
    if (boss) {
      for (const x of [-1, 1]) for (const y of [-1, 1]) body.add(at(box(0.24, 0.24, 0.03, C.gold, trim), x * (w / 2 - 0.12), y * (h / 2 - 0.12) - 0.12, d / 2 + 0.035));
      body.add(at(box(0.16, 0.3, d + 0.12, C.gold, trim), w / 2, -0.15, 0));
    }
    // A face on the front cover.
    const eyeY = h * 0.16, eyeX = w * 0.22, z = d / 2 + 0.04;
    for (const x of [-eyeX, eyeX]) {
      body.add(at(squash(ball(boss ? 0.16 : 0.13, boss ? 0xffd24a : C.white, 0, boss ? { emissive: 0xffb020, glow: 1.4 } : { rough: 0.3 }), 1, 1.1, 0.5), x, eyeY, z));
      body.add(at(ball(boss ? 0.06 : 0.055, C.ink, 0, { rough: 0.2 }), x * 0.92, eyeY - 0.01, z + 0.06));
      body.add(at(tilt(box(boss ? 0.36 : 0.28, 0.06, 0.05, C.ink), 0, x < 0 ? -0.45 : 0.45), x, eyeY + (boss ? 0.2 : 0.17), z + 0.02));
    }
    body.add(at(box(w * 0.5, boss ? 0.16 : 0.1, 0.04, 0x1a1420), 0, -h * 0.26, z));
    const teeth = boss ? 5 : 3;
    for (let i = 0; i < teeth; i++) body.add(at(cone(0.045, 0.1, C.cream, 4), -w * 0.2 + (w * 0.4 * i) / (teeth - 1), -h * 0.26 + (boss ? 0.06 : 0.02), z + 0.02));
    // A bookmark ribbon, and a red mark from the grader.
    body.add(at(box(0.1, 0.42, 0.02, C.red, { kind: 'fabric' }), w * 0.25, -h / 2 - 0.3, 0));
    if (boss) {
      // Graduation cap with a tassel.
      const cap = group(cyl(0.34, 0.38, 0.2, C.ink, 10, { kind: 'fabric' }), at(box(1.05, 0.05, 1.05, C.ink, { kind: 'fabric' }), 0, 0.2, 0, 0.5), at(cyl(0.05, 0.05, 0.04, C.gold, 8, trim), 0, 0.25, 0), at(box(0.03, 0.34, 0.03, C.gold, trim), 0.42, -0.08, 0.3), at(cone(0.06, 0.14, C.gold, 8, trim), 0.42, -0.2, 0.3));
      body.add(at(cap, 0, h / 2 - 0.02, 0));
      // Steel armor bolted on. Studying for the exam knocks it off piece by piece.
      const steel = { metal: 0.85, rough: 0.35 };
      const plate = (pw, ph, pd, x, y, z, rz = 0) => {
        const m = at(group(box(pw, ph, pd, 0x8e99a8, steel), at(box(pw * 0.86, 0.05, pd + 0.02, 0x5d6774, steel), 0, ph * 0.3, 0)), x, y, z);
        m.rotation.z = rz;
        return m;
      };
      const armor = [
        plate(0.5, 0.42, 0.12, -w / 2 - 0.02, h / 2 - 0.2, 0, 0.5), // shoulders
        plate(0.5, 0.42, 0.12, w / 2 + 0.02, h / 2 - 0.2, 0, -0.5),
        plate(w * 0.82, 0.3, 0.06, 0, -h / 2 + 0.1, d / 2 + 0.06), // belly plate under the mouth
        plate(0.1, h * 0.7, d * 0.8, -w / 2 - 0.08, -0.1, 0), // sides
        plate(0.1, h * 0.7, d * 0.8, w / 2 + 0.08, -0.1, 0),
        plate(w * 0.9, h * 0.8, 0.08, 0, -0.05, -d / 2 - 0.07), // back
      ];
      for (const piece of armor) body.add(piece);
      g.userData.armor = armor;
      // Weak points: one glowing crystal per exam topic (shown by the game).
      const crystalSpots = [[-w / 2 + 0.05, h / 2 - 0.05, d / 2 + 0.12, -0.5], [w / 2 - 0.05, h / 2 - 0.05, d / 2 + 0.12, 0.5], [-w / 2 - 0.18, -0.25, 0.1, -1.2], [w / 2 + 0.18, -0.25, 0.1, 1.2], [-0.35, h / 2 + 0.25, -0.15, -0.3], [0.35, h / 2 + 0.25, -0.15, 0.3]];
      const crystals = crystalSpots.map(([x, y, z, tiltZ]) => {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x4fc8ff, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.1, flatShading: true }));
        c.scale.set(0.7, 1.5, 0.7);
        c.position.set(x, y, z);
        c.rotation.z = tiltZ;
        c.visible = false;
        body.add(c);
        return c;
      });
      g.userData.crystals = crystals;
    } else {
      // Assignments carry a pencil like a spear.
      const pencil = group(cyl(0.045, 0.045, 1.1, C.gold, 6, { kind: 'fine' }), at(cone(0.045, 0.14, C.cream, 6), 0, 1.1, 0), at(cone(0.018, 0.05, C.ink, 6), 0, 1.2, 0), at(cyl(0.048, 0.048, 0.09, C.red, 6), 0, -0.08, 0));
      pencil.rotation.z = -0.25;
      body.add(at(pencil, w / 2 + 0.2, -h / 2 - 0.15, 0.1));
      for (const x of [-1, 1]) body.add(at(capsule(0.055, 0.2, C.ink), x * (w / 2 + 0.08), -0.32, 0.05));
    }
    footL = at(squash(ball(0.16, C.ink, 0), 1, 0.62, 1.5), -w * 0.24, 0.1, 0.08);
    footR = at(squash(ball(0.16, C.ink, 0), 1, 0.62, 1.5), w * 0.24, 0.1, 0.08);
    for (const x of [-1, 1]) g.add(at(cyl(0.05, 0.05, 0.3, C.ink, 6), x * w * 0.24, 0.05, 0));
    if (boss) {
      // Fists the fight raises and slams.
      const fist = (x) => group(squash(ball(0.3, 0x5a1620, 1, leather), 1, 0.9, 1), at(squash(ball(0.12, C.gold, 0, trim), 1, 0.6, 1), 0, 0.2, 0.12));
      const armL = at(fist(-1), -0.95, 0.8, 0.2);
      const armR = at(fist(1), 0.95, 0.8, 0.2);
      const pen = group(cyl(0.05, 0.05, 1.0, C.red, 8, { rough: 0.35 }), at(cone(0.05, 0.16, C.ink, 8), 0, 1.0, 0));
      pen.rotation.x = Math.PI / 2.4;
      armR.add(at(pen, 0, 0, 0.1));
      g.add(armL, armR);
      g.userData.arms = [armL, armR];
    }
  }
  body.position.y = 0.75;
  g.add(body, footL, footR);
  g.userData.feet = [footL, footR];
  g.userData.body = body;
  g.scale.setScalar(variant === 'boss' ? 3.2 : 0.8 + size * 0.35);
  return g;
}

/** The board by the gate where your Canvas work is pinned. */
export function makeBoard() {
  const g = group(
    at(box(0.16, 2.5, 0.16, C.woodDark), -1.25, 0, 0), at(box(0.16, 2.5, 0.16, C.woodDark), 1.25, 0, 0),
    at(box(2.7, 1.5, 0.1, C.wood), 0, 0.85, 0), at(box(2.9, 0.12, 0.2, C.woodDark), 0, 0.78, 0), at(box(2.9, 0.12, 0.2, C.woodDark), 0, 2.3, 0),
    at(prism(1.0, 0.4, 3.2, C.brick), 0, 2.5, 0, Math.PI / 2),
  );
  const notes = [[-0.85, 1.75, 0.08, C.cream], [-0.25, 1.85, -0.05, C.white], [0.4, 1.7, 0.1, C.cream], [0.95, 1.85, -0.08, 0xffe9a8], [-0.6, 1.22, -0.06, 0xffe9a8], [0.1, 1.2, 0.05, C.white], [0.75, 1.2, -0.04, C.cream]];
  for (const [x, y, turn, color] of notes) {
    const note = at(box(0.44, 0.52, 0.02, color, { kind: 'fine', rough: 0.9 }), x, y - 0.26, 0.07);
    note.rotation.z = turn;
    g.add(note, at(ball(0.035, C.red, 0, { rough: 0.3 }), x, y + 0.2, 0.09));
    for (let i = 0; i < 3; i++) g.add(at(box(0.3, 0.02, 0.005, C.ink), x, y - 0.02 - i * 0.1, 0.085));
  }
  bake(g);
  g.add(contactShadow(2.2, 0.3));
  return g;
}

export const RARITY_COLORS = { common: 0x9aa0a8, rare: 0x4a90e2, epic: 0xa35be0, legendary: 0xf2c14e, mythic: 0xff4fd8 };

// A treasure chest. Chunky and rounded, like a premium game chest: a plank
// body on a thick base, a domed lid with a heavy rim, solid metal corners and
// straps, and a big lock plate with a gem. Rarity is in the materials, not in
// extra parts: worn iron, polished silver, dark wood with gold, black wood with
// bright gold, deep violet with pearl-white metal. userData.lid hinges open;
// 'beam' is the light column over it (removed where it isn't wanted).
const CHEST_LOOK = {
  common: { wood: 0xa8743f, wood2: 0x8d5f33, metal: 0x6b7078, shine: 0.45, rough: 0.5, gem: 0xe9edf2, gemGlow: 0.2 },
  rare: { wood: 0x3b6ea8, wood2: 0x2c5482, metal: 0xd6dee8, shine: 0.9, rough: 0.22, gem: 0x58b4ff, gemGlow: 0.8 },
  epic: { wood: 0x5b2f52, wood2: 0x472440, metal: 0xe3b64e, shine: 0.95, rough: 0.2, gem: 0xc77dff, gemGlow: 1.1 },
  legendary: { wood: 0x3b2416, wood2: 0x2c1a10, metal: 0xffcc4d, shine: 1, rough: 0.14, gem: 0xff7a1f, gemGlow: 1.5 },
  mythic: { wood: 0x24164a, wood2: 0x1a0f38, metal: 0xf2ecff, shine: 1, rough: 0.1, gem: 0xff4fd8, gemGlow: 1.9 },
};
function rbox(w, h, d, r, color, opts) {
  const geo = new RoundedBoxGeometry(w, h, d, 3, r);
  geo.translate(0, h / 2, 0);
  return mesh(uvWorld(geo), color, opts);
}
function makeChestAura(rarity, trim) {
  // Just a soft glow on the ground, stronger the rarer the chest.
  const aura = new THREE.Group();
  aura.name = 'aura';
  const strength = { common: 0, rare: 0.28, epic: 0.42, legendary: 0.55, mythic: 0.7 }[rarity] ?? 0;
  const parts = { halo: null, hue: rarity === 'mythic' };
  if (strength) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: trim, transparent: true, opacity: strength, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.03;
    aura.add(halo);
    parts.halo = halo;
  }
  aura.userData.parts = parts;
  return aura;
}
/** The ground glow breathes; a mythic chest's glow drifts through colours. */
export function animateChest(chest, time) {
  const p = chest?.userData?.aura?.userData.parts;
  if (!p?.halo) return;
  const m = p.halo.material;
  if (m.userData.base === undefined) m.userData.base = m.opacity;
  m.opacity = m.userData.base * (0.8 + Math.sin(time * 2.2) * 0.2);
  if (p.hue) m.color.setHSL((time * 0.06) % 1, 0.8, 0.62);
}
export function makeChest(rarity) {
  const look = CHEST_LOOK[rarity] || CHEST_LOOK.common;
  const trim = RARITY_COLORS[rarity] ?? look.gem;
  const metal = { metal: look.shine, rough: look.rough };
  const W = 1.24, H = 0.56, D = 0.86, R = D / 2;
  const g = new THREE.Group();
  // Base, body and planks.
  g.add(rbox(W + 0.08, 0.1, D + 0.08, 0.04, look.wood2, { kind: 'planks' }));
  g.add(at(rbox(W, H - 0.06, D, 0.05, look.wood, { kind: 'planks' }), 0, 0.06, 0));
  for (const x of [-0.3, 0, 0.3]) g.add(at(box(0.025, H - 0.14, 0.01, look.wood2), x, 0.1, D / 2 + 0.002));
  // Metal: a rim at the top of the body, corner guards and two straps.
  g.add(at(rbox(W + 0.06, 0.08, D + 0.06, 0.03, look.metal, metal), 0, H - 0.07, 0));
  g.add(at(rbox(W + 0.1, 0.06, D + 0.1, 0.025, look.metal, metal), 0, 0.02, 0));
  for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(at(rbox(0.16, H - 0.02, 0.16, 0.04, look.metal, metal), x * (W / 2 - 0.04), 0.02, z * (D / 2 - 0.04)));
  for (const x of [-0.36, 0.36]) {
    g.add(at(rbox(0.13, H - 0.08, D + 0.05, 0.03, look.metal, metal), x, 0.04, 0));
    for (const y of [0.17, 0.39]) g.add(at(ball(0.03, look.metal, 0, metal), x, y, D / 2 + 0.03));
  }
  // The lock: a big plate with a keyhole and a gem.
  g.add(at(rbox(0.32, 0.3, 0.07, 0.04, look.metal, metal), 0, H - 0.4, D / 2 + 0.01));
  g.add(at(cyl(0.035, 0.035, 0.02, 0x15101c, 10), 0, H - 0.31, D / 2 + 0.05).rotateX(Math.PI / 2));
  g.add(at(box(0.03, 0.07, 0.02, 0x15101c), 0, H - 0.4, D / 2 + 0.055));
  const gem = ball(0.055, look.gem, 0, { emissive: look.gem, glow: look.gemGlow, metal: 0.2, rough: 0.1 });
  gem.scale.set(1, 1, 0.55);
  gem.name = 'glow';
  g.add(at(gem, 0, H - 0.2, D / 2 + 0.06));
  // The lid: a dome with a heavy rim, straps over the top and end caps.
  const lid = new THREE.Group();
  const dome = (radius, length, color, opts) => {
    const geo = new THREE.CylinderGeometry(radius, radius, length, 32, 1, false, 0, Math.PI);
    geo.rotateZ(Math.PI / 2);
    return mesh(uvRound(geo, radius * 3.14, length), color, opts);
  };
  lid.add(at(dome(R, W - 0.02, look.wood, { kind: 'planks' }), 0, 0, R));
  for (const x of [-(W / 2 - 0.05), W / 2 - 0.05]) lid.add(at(dome(R + 0.035, 0.1, look.metal, metal), x, 0, R));
  for (const x of [-0.36, 0.36]) lid.add(at(dome(R + 0.025, 0.13, look.metal, metal), x, 0, R));
  lid.add(at(rbox(W + 0.06, 0.07, 0.1, 0.03, look.metal, metal), 0, -0.01, D - 0.02));
  lid.add(at(rbox(0.2, 0.16, 0.06, 0.03, look.metal, metal), 0, -0.04, D + 0.01));
  if (rarity !== 'common') {
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), mat(look.gem, { emissive: look.gem, glow: look.gemGlow * 0.8 }));
    top.scale.set(1, 0.8, 1);
    top.name = 'glow';
    lid.add(at(rbox(0.2, 0.06, 0.2, 0.025, look.metal, metal), 0, R - 0.02, R), at(top, 0, R + 0.08, R));
  }
  // Light leaking out under the lid.
  const seam = box(W - 0.08, 0.016, D - 0.08, trim, { emissive: trim, glow: 0.4 + look.gemGlow * 0.5 });
  seam.name = 'glow';
  seam.castShadow = false;
  g.add(at(seam, 0, H - 0.006, 0));
  g.add(at(lid, 0, H, -R));
  const aura = makeChestAura(rarity, trim);
  g.add(aura);
  g.userData.aura = aura;
  const beam = mesh(new THREE.CylinderGeometry(0.5, 0.3, 4.5, 20, 1, true), trim, { emissive: trim, glow: 0.7, opacity: { common: 0.07, rare: 0.11, epic: 0.14, legendary: 0.17, mythic: 0.2 }[rarity] ?? 0.12 });
  beam.material.side = THREE.DoubleSide;
  beam.castShadow = false;
  beam.position.y = 2.8;
  beam.material.depthWrite = false;
  beam.name = 'beam';
  g.add(beam);
  g.userData.lid = lid;
  return g;
}

export function makeCoin() {
  const coin = cyl(0.22, 0.22, 0.06, C.gold, 10, { metal: 0.7, rough: 0.3, emissive: 0xffb300, glow: 0.25 });
  coin.rotation.x = Math.PI / 2;
  coin.castShadow = false;
  return coin;
}

/** Floats over a building that has coins waiting. */
export function makeCoinBubble() {
  const g = group(makeCoin());
  g.children[0].scale.setScalar(2.2);
  return g;
}

export function makeLander() {
  const g = group(at(cyl(0.9, 1.3, 1.4, C.white, 8, { rough: 0.5 }), 0, 1.0, 0), at(cone(0.9, 1.0, C.red, 8), 0, 2.4, 0), at(cyl(0.5, 0.3, 0.4, C.iron, 8), 0, 0.6, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.785;
    const leg = box(0.1, 1.5, 0.1, C.metal);
    leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    g.add(at(leg, Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5), at(cyl(0.25, 0.25, 0.06, C.metal, 8), Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5));
  }
  return g;
}

// --- Build mode decorations ---------------------------------------------------------
/** A decoration from the build menu (DECOR in sim.js). Built in metres, centred on its base. */
export function makeDecor(type) {
  if (['torii', 'toro', 'bamboo', 'koi', 'bridge', 'sakura'].includes(type)) return makeGardenPiece(type);
  if (['mushrooms', 'owlstatue', 'crystallamp', 'obelisk'].includes(type)) return makeVaultDecor(type);
  const g = new THREE.Group();
  const leaf = 0x6fae4f, leafDark = 0x4f8a3c;
  switch (type) {
    case 'fence':
      for (const x of [-1, 1]) g.add(at(box(0.18, 1.0, 0.18, C.woodDark), x, 0, 0), at(cone(0.13, 0.18, C.woodDark, 4), x, 1.0, 0));
      g.add(at(box(2.2, 0.14, 0.1, C.wood), 0, 0.35, 0), at(box(2.2, 0.14, 0.1, C.wood), 0, 0.72, 0));
      break;
    case 'path':
      [[-0.5, -0.4, 0.55], [0.45, -0.2, 0.5], [-0.1, 0.5, 0.6], [0.6, 0.65, 0.4]].forEach(([x, z, r], i) => g.add(at(cyl(r, r * 1.08, 0.08, i % 2 ? C.stone : C.stoneDark, 6), x, 0, z, i)));
      break;
    case 'flowers': {
      g.add(at(cyl(0.95, 1.05, 0.22, C.woodDark, 8), 0, 0, 0), at(cyl(0.88, 0.88, 0.05, C.dirt, 8), 0, 0.2, 0));
      const petals = [0xf26b6b, 0xffd24a, 0xf5f0e7, 0xc77dff, 0xff9f43];
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, r = 0.25 + (i % 3) * 0.22;
        g.add(at(cyl(0.025, 0.025, 0.3, leafDark, 4), Math.cos(a) * r, 0.22, Math.sin(a) * r), at(ball(0.11, petals[i % petals.length], 0), Math.cos(a) * r, 0.55, Math.sin(a) * r));
      }
      break;
    }
    case 'bush':
      g.add(at(ball(0.7, leaf, 0), 0, 0.5, 0), at(ball(0.5, leafDark, 0), 0.5, 0.4, 0.2), at(ball(0.45, leaf, 0), -0.45, 0.35, -0.15));
      break;
    case 'tree':
      g.add(at(cyl(0.18, 0.26, 1.6, C.woodDark, 6), 0, 0, 0), at(cone(1.2, 1.8, leafDark, 6), 0, 1.3, 0), at(cone(0.9, 1.5, leaf, 6), 0, 2.3, 0), at(cone(0.55, 1.1, leaf, 6), 0, 3.2, 0));
      break;
    case 'rocks':
      g.add(at(squash(ball(0.6, C.rock, 0), 1.2, 0.8, 1), 0, 0.3, 0), at(squash(ball(0.4, C.rockDark, 0), 1, 0.8, 1.1), 0.6, 0.2, 0.3), at(ball(0.28, C.stoneDark, 0), -0.55, 0.15, 0.25));
      break;
    case 'lamp': {
      g.add(at(cyl(0.22, 0.28, 0.25, C.slate, 6), 0, 0, 0), at(cyl(0.07, 0.09, 2.4, C.slate, 6), 0, 0.2, 0), at(box(0.5, 0.06, 0.06, C.slate), 0.2, 2.45, 0));
      const glow = at(ball(0.2, 0xffe08a, 0, { emissive: 0xffc04a, glow: 1.6 }), 0.42, 2.18, 0);
      glow.name = 'glow';
      g.add(glow, at(cone(0.24, 0.22, C.slate, 6), 0.42, 2.38, 0));
      break;
    }
    case 'bench':
      g.add(at(box(1.8, 0.1, 0.5, C.wood, { kind: 'planks' }), 0, 0.45, 0), at(box(1.8, 0.45, 0.08, C.wood, { kind: 'planks' }), 0, 0.55, -0.22));
      for (const x of [-0.75, 0.75]) g.add(at(box(0.1, 0.45, 0.45, C.woodDark), x, 0, 0));
      break;
    case 'banner': {
      g.add(at(cyl(0.06, 0.08, 3.2, C.woodDark, 6), 0, 0, 0), at(ball(0.11, C.gold, 0, { metal: 0.8, rough: 0.3 }), 0, 3.25, 0), at(box(0.9, 0.06, 0.06, C.woodDark), 0.4, 2.95, 0));
      const cloth = at(box(0.75, 1.3, 0.04, C.red, { kind: 'fabric' }), 0.42, 1.65, 0);
      cloth.name = 'cloth';
      g.add(cloth, at(box(0.3, 0.3, 0.05, C.gold, { metal: 0.6 }), 0.42, 2.25, 0));
      break;
    }
    case 'crates':
      g.add(at(box(0.8, 0.8, 0.8, C.wood, { kind: 'planks' }), 0, 0, 0, 0.2), at(box(0.65, 0.65, 0.65, C.wood, { kind: 'planks' }), 0.75, 0, 0.25, -0.3), at(box(0.55, 0.55, 0.55, C.woodDark, { kind: 'planks' }), 0.2, 0.8, 0.05, 0.5));
      break;
    case 'well':
      g.add(at(cyl(0.9, 1.0, 0.8, C.stone, 10), 0, 0, 0), at(cyl(0.72, 0.72, 0.05, 0x3f8fb0, 10, { rough: 0.2 }), 0, 0.72, 0));
      for (const x of [-0.8, 0.8]) g.add(at(box(0.12, 1.5, 0.12, C.woodDark), x, 0.7, 0));
      g.add(at(prism(2.0, 0.6, 1.3, C.brick), 0, 2.15, 0, Math.PI / 2), at(cyl(0.06, 0.06, 1.7, C.woodDark, 6), 0, 1.75, 0));
      g.children[g.children.length - 1].rotation.z = Math.PI / 2;
      break;
    case 'statue':
    case 'gold': {
      const c = type === 'gold' ? C.gold : C.stone;
      const o = type === 'gold' ? { metal: 0.85, rough: 0.25 } : { rough: 0.9 };
      g.add(at(box(1.1, 0.5, 1.1, C.stoneDark), 0, 0, 0), at(box(0.9, 0.12, 0.9, C.stone), 0, 0.5, 0));
      g.add(at(cyl(0.28, 0.36, 0.9, c, 8, o), 0, 0.62, 0), at(ball(0.26, c, 1, o), 0, 1.75, 0), at(cone(0.3, 0.25, c, 8, o), 0, 1.95, 0));
      g.add(at(capsule(0.09, 0.5, c, o), -0.36, 1.25, 0), at(capsule(0.09, 0.5, c, o), 0.36, 1.25, 0), at(box(0.07, 1.2, 0.07, c, o), 0.45, 1.1, 0.12));
      break;
    }
    case 'fountain': {
      g.add(at(cyl(1.9, 2.0, 0.5, C.stone, 12), 0, 0, 0), at(cyl(1.65, 1.65, 0.06, 0x4fb4c9, 12, { rough: 0.15 }), 0, 0.42, 0));
      g.add(at(cyl(0.25, 0.35, 1.3, C.stone, 8), 0, 0.4, 0), at(cyl(0.8, 0.5, 0.25, C.stone, 10), 0, 1.6, 0), at(cyl(0.6, 0.6, 0.04, 0x4fb4c9, 10, { rough: 0.15 }), 0, 1.8, 0));
      const jet = at(cone(0.16, 0.7, 0xbfe9f5, 8, { emissive: 0x7fd3ea, glow: 0.4 }), 0, 1.85, 0);
      jet.name = 'jet';
      g.add(jet);
      break;
    }
    case 'totem': {
      const faces = [C.red, 0x2f6f9e, C.gold];
      faces.forEach((c, i) => {
        g.add(at(cyl(0.38, 0.42, 0.7, i % 2 ? C.wood : C.woodDark, 8, { kind: 'planks' }), 0, i * 0.7, 0));
        for (const x of [-0.14, 0.14]) g.add(at(ball(0.07, c, 0), x, i * 0.7 + 0.42, 0.36));
        g.add(at(box(0.3, 0.07, 0.05, c), 0, i * 0.7 + 0.2, 0.38));
      });
      g.add(at(box(1.5, 0.12, 0.25, C.red), 0, 1.75, 0), at(cone(0.3, 0.4, C.gold, 6), 0, 2.1, 0));
      break;
    }
    case 'tent': {
      g.add(at(prism(2.6, 2.0, 2.8, 0xe8d6a8, { kind: 'fabric' }), 0, 0, 0));
      g.add(at(prism(1.0, 1.0, 0.04, 0x5a3b26, { kind: 'fabric' }), 0, 0, 1.42));
      g.add(at(cyl(0.05, 0.05, 2.3, C.woodDark, 6), 0, 0, 1.45), at(box(0.5, 0.35, 0.02, C.red, { kind: 'fabric' }), 0.25, 1.9, 1.45));
      break;
    }
    case 'hedge':
      for (const x of [-0.75, 0, 0.75]) g.add(at(squash(ball(0.55, x === 0 ? 0x5a9a42 : 0x4f8c3a, 0), 1, 0.9, 0.75), x, 0.45, 0));
      g.add(at(box(2.2, 0.5, 0.75, 0x4f8c3a), 0, 0, 0));
      break;
    case 'wall':
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.add(at(box(0.72, 0.42, 0.5, (i + j) % 2 ? C.stone : C.stoneDark, { rough: 0.9 }), -0.75 + i * 0.75 + (j % 2) * 0.18, j * 0.42, 0));
      g.add(at(box(2.3, 0.16, 0.62, C.stone), 0, 0.84, 0));
      break;
    case 'arch': {
      for (const x of [-1, 1]) g.add(at(box(0.5, 2.6, 0.6, C.stone, { rough: 0.9 }), x * 1.1, 0, 0), at(box(0.62, 0.2, 0.72, C.stoneDark), x * 1.1, 0, 0));
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI;
        const stone = at(box(0.45, 0.32, 0.6, i % 2 ? C.stone : C.stoneDark), -Math.cos(a) * 1.1, 2.6 + Math.sin(a) * 0.75, 0);
        stone.rotation.z = a - Math.PI / 2;
        g.add(stone);
      }
      g.add(at(box(0.5, 0.36, 0.05, C.gold, { metal: 0.6 }), 0, 3.1, 0.33));
      break;
    }
    case 'pond': {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.add(at(squash(ball(0.32, i % 2 ? C.rock : C.rockDark, 0), 1.2, 0.6, 1), Math.cos(a) * 1.9, 0.08, Math.sin(a) * 1.5));
      }
      const water = squash(cyl(1.85, 1.85, 0.05, 0x4fb4c9, 16, { rough: 0.15 }), 1, 1, 0.8);
      g.add(at(water, 0, 0.06, 0));
      for (const [x, z] of [[0.6, 0.3], [-0.5, -0.4]]) g.add(at(squash(cyl(0.28, 0.28, 0.03, 0x5aa83e, 8), 1, 1, 1), x, 0.12, z), at(ball(0.07, 0xf5a0c8, 0), x + 0.08, 0.18, z));
      g.add(at(cyl(0.03, 0.03, 0.7, 0x5a8a3a, 4), -1.3, 0, 0.6), at(cyl(0.05, 0.05, 0.2, 0x7a4a2a, 5), -1.3, 0.7, 0.6), at(cyl(0.03, 0.03, 0.8, 0x5a8a3a, 4), -1.45, 0, 0.45));
      break;
    }
    case 'tower': {
      for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) g.add(at(tilt(box(0.16, 3.8, 0.16, C.woodDark), x * 0.04, -z * 0.04), x, 0, z));
      for (const y of [1.2, 2.4]) for (const r of [0, Math.PI / 2]) { const brace = at(box(1.8, 0.1, 0.1, C.wood), 0, y, 0); const h = new THREE.Group(); h.add(brace); h.rotation.y = r; g.add(h); }
      g.add(at(box(2.2, 0.16, 2.2, C.wood, { kind: 'planks' }), 0, 3.7, 0));
      for (const [x, z, w, d] of [[0, 1.05, 2.2, 0.1], [0, -1.05, 2.2, 0.1], [1.05, 0, 0.1, 2.2], [-1.05, 0, 0.1, 2.2]]) g.add(at(box(w, 0.6, d, C.wood, { kind: 'planks' }), x, 3.86, z));
      g.add(at(cone(1.7, 1.3, C.brick, 4), 0, 4.9, 0, Math.PI / 4));
      for (const [x, z] of [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]]) g.add(at(box(0.12, 1.2, 0.12, C.woodDark), x, 3.86, z));
      g.add(at(cyl(0.03, 0.03, 0.8, C.woodDark, 4), 0, 6.1, 0), at(box(0.5, 0.3, 0.02, C.red, { kind: 'fabric' }), 0.26, 6.7, 0));
      break;
    }
    case 'windmill': {
      g.add(at(cyl(0.9, 1.3, 3.6, C.white, 8, { rough: 0.85 }), 0, 0, 0), at(cone(1.1, 1.3, C.brick, 8), 0, 3.6, 0));
      g.add(at(box(0.6, 1.0, 0.08, C.woodDark), 0, 0, 1.25), at(box(0.4, 0.4, 0.06, 0x2a3550), 0, 2.0, 1.04));
      const sails = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.add(at(box(0.08, 2.3, 0.06, C.woodDark), 0, 1.15, 0), at(box(0.55, 1.8, 0.03, C.cream, { kind: 'fabric' }), 0.32, 1.35, 0));
        arm.rotation.z = (i * Math.PI) / 2;
        sails.add(arm);
      }
      sails.position.set(0, 3.3, 1.35);
      sails.rotation.x = 0;
      sails.name = 'sails';
      sails.userData.axis = 'z';
      g.add(sails, at(tilt(cyl(0.1, 0.1, 0.5, C.woodDark, 6), Math.PI / 2, 0), 0, 3.3, 1.1));
      break;
    }
    default:
      g.add(box(0.6, 0.6, 0.6, C.wood));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// --- Class halls: one per course, a floor per mastery level -----------------------
/** A tower for a course. floors 0 is a foundation with scaffolding; each level adds a storey. */
export function makeHall(floors, color) {
  const g = new THREE.Group();
  g.add(at(box(4.4, 0.5, 4.4, C.stoneDark), 0, 0, 0), at(box(3.4, 0.3, 0.8, C.stone), 0, 0, 2.6));
  const shown = Math.min(floors, 8);
  if (shown === 0) {
    // Only a foundation and scaffolding: nobody has studied this class yet.
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) g.add(at(box(0.15, 2.4, 0.15, C.wood), x, 0.5, z));
    g.add(at(box(3.4, 0.1, 0.4, C.wood, { kind: 'planks' }), 0, 1.6, 1.6), at(box(1.6, 0.6, 1.0, C.stone), -0.7, 0.5, -0.6), at(box(0.8, 0.5, 0.8, C.stone), 0.9, 0.5, 0.4));
    return g;
  }
  let y = 0.5;
  for (let i = 0; i < shown; i++) {
    const w = 3.4 - i * 0.22;
    const h = 1.7;
    g.add(at(box(w, h, w, i % 2 ? C.stone : 0xe8e0cf, { kind: 'planks', rough: 0.9 }), 0, y, 0));
    g.add(at(box(w + 0.2, 0.18, w + 0.2, color), 0, y + h - 0.05, 0));
    for (const side of [0, 1, 2, 3]) {
      const win = at(box(0.5, 0.7, 0.06, 0x2a3550, { emissive: 0xffd27a, glow: i === shown - 1 ? 0.5 : 0.15 }), 0, y + 0.55, w / 2 + 0.02);
      win.name = 'window';
      const holder = new THREE.Group();
      holder.add(win);
      holder.rotation.y = (side * Math.PI) / 2;
      holder.position.y = 0;
      g.add(holder);
    }
    y += h + 0.13;
  }
  const top = 3.4 - shown * 0.22;
  g.add(at(cone(top * 0.78, 1.6 + shown * 0.12, color, 6), 0, y, 0), at(cyl(0.04, 0.04, 1.2, C.woodDark, 4), 0, y + 1.5 + shown * 0.12, 0));
  const flag = at(box(0.7, 0.4, 0.03, color, { kind: 'fabric' }), 0.36, y + 2.3 + shown * 0.12, 0);
  flag.name = 'flag';
  g.add(flag, at(box(0.9, 0.9, 0.12, 0x4a3524), 0, 0.5, top / 2 + 0.95));
  g.userData.height = y + 2.8;
  return g;
}

// --- The market stall ---------------------------------------------------------------
export function makeMarket() {
  const g = new THREE.Group();
  g.add(at(box(4.6, 0.25, 2.8, C.woodDark, { kind: 'planks' }), 0, 0, 0));
  for (const [x, z] of [[-2.1, -1.2], [2.1, -1.2], [-2.1, 1.2], [2.1, 1.2]]) g.add(at(box(0.18, 2.9, 0.18, C.wood), x, 0.2, z));
  // Striped awning.
  for (let i = 0; i < 6; i++) {
    const stripe = at(box(0.78, 0.08, 3.3, i % 2 ? 0xf5f0e7 : C.red, { kind: 'fabric' }), -1.95 + i * 0.78, 3.2, 0.1);
    stripe.rotation.x = -0.18;
    g.add(stripe);
  }
  for (let i = 0; i < 6; i++) g.add(at(cone(0.22, 0.32, i % 2 ? 0xf5f0e7 : C.red, 3, { kind: 'fabric' }), -1.95 + i * 0.78, 2.72, 1.75, Math.PI));
  // Counter with goods.
  g.add(at(box(4.0, 1.0, 0.9, C.wood, { kind: 'planks' }), 0, 0.25, 0.9));
  const goods = [[0xf26b6b, ball], [0xffd24a, ball], [0x6fae4f, ball], [C.gold, null], [0x7a4bc2, null]];
  goods.forEach(([c, kind], i) => {
    const x = -1.6 + i * 0.8;
    g.add(at(cyl(0.32, 0.26, 0.2, C.woodDark, 8), x, 1.25, 0.9));
    if (kind) for (let k = 0; k < 3; k++) g.add(at(ball(0.12, c, 0), x + (k - 1) * 0.12, 1.5, 0.9 + (k % 2) * 0.08));
    else g.add(at(box(0.32, 0.3, 0.32, c, { metal: c === C.gold ? 0.7 : 0 }), x, 1.45, 0.9));
  });
  g.add(at(box(0.7, 0.7, 0.7, C.wood, { kind: 'planks' }), -2.7, 0, 1.6, 0.3), at(cyl(0.38, 0.38, 0.9, C.woodDark, 8, { kind: 'planks' }), 2.7, 0, 1.4));
  // Sign.
  g.add(at(box(2.0, 0.6, 0.08, C.wood, { kind: 'planks' }), 0, 3.55, 1.6), at(box(1.6, 0.32, 0.02, C.gold), 0, 3.69, 1.65));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// --- Campfire -----------------------------------------------------------------------
// See-through glowing flame shells (not lit, added together so they glow),
// layered orange to white, each flickering on its own (world.js), over a bed of
// coals and crossed logs inside a ring of stones, with embers drifting up.
function flameGeometry(r, h) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // A teardrop: full near the base, pinched to a point at the top.
    const w = r * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8 * (1 - t * 0.55);
    pts.push(new THREE.Vector2(Math.max(0.001, w), t * h));
  }
  return new THREE.LatheGeometry(pts, 10);
}
export function makeCampfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    g.add(at(squash(ball(0.36, i % 2 ? C.rock : C.rockDark, 0), 1.15, 0.75, 1), Math.cos(a) * 1.35, 0.16, Math.sin(a) * 1.35));
  }
  // Logs lying crossed, ends charred.
  // Logs leaning in to a point, a low teepee, tips charred.
  for (let i = 0; i < 5; i++) {
    const log = group(cyl(0.11, 0.14, 1.35, C.woodDark, 7), at(cyl(0.115, 0.115, 0.2, 0x2a1a12, 7), 0, 1.2, 0));
    log.rotation.z = 0.95;
    const holder = new THREE.Group();
    holder.add(at(log, 0.95, 0.05, 0));
    holder.rotation.y = (i / 5) * Math.PI * 2 + 0.4;
    g.add(holder);
  }
  // Glowing coals.
  const coalMat = { emissive: 0xff3a0a, glow: 1.1, rough: 0.9 };
  for (let i = 0; i < 9; i++) {
    const a = i * 2.3, r = 0.15 + (i % 3) * 0.17;
    g.add(at(squash(ball(0.13, 0x3a1208, 0, coalMat), 1, 0.6, 1), Math.cos(a) * r, 0.1, Math.sin(a) * r));
  }
  const fire = new THREE.Group();
  fire.name = 'fire';
  const layer = (color, r, h, opacity, x, z, phase) => {
    // Unlit and kept out of tone mapping so the colours stay hot in daylight; bloom adds the glow.
    const m = new THREE.Mesh(flameGeometry(r, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
    m.position.set(x, 0.12, z);
    m.name = 'flame';
    m.userData.phase = phase;
    m.userData.base = { x, z };
    m.renderOrder = 2;
    fire.add(m);
  };
  layer(0xe8380c, 0.58, 1.75, 0.92, 0, 0, 0);
  layer(0xf2500e, 0.36, 1.3, 0.95, 0.24, 0.1, 1.7);
  layer(0xf2500e, 0.33, 1.15, 0.95, -0.25, -0.08, 3.1);
  layer(0xff8a1c, 0.4, 1.3, 0.97, 0.02, 0.05, 4.4);
  layer(0xffc23a, 0.26, 0.95, 1, 0, 0.03, 5.6);
  layer(0xfff0b0, 0.13, 0.55, 1, 0, 0.02, 2.2);
  // Embers that drift up and fade (moved in world.js).
  for (let i = 0; i < 10; i++) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xffa02a, transparent: true, depthWrite: false, toneMapped: false }));
    e.name = 'ember';
    e.userData.seed = i * 0.73;
    fire.add(e);
  }
  g.add(fire);
  const light = new THREE.PointLight(0xff8a3a, 16, 15, 1.6);
  light.position.y = 1.3;
  light.name = 'firelight';
  g.add(light);
  return g;
}

// --- Creatures to catch in the Wilds ------------------------------------------------
/** A small animal. userData.body bobs or hops; userData.wings flap (owl, moth). */
export function makeCritter(species) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const eye = (x, y, z, r = 0.045) => at(ball(r, C.ink, 0, { rough: 0.2 }), x, y, z);
  const glowing = (c, glow = 1.4) => ({ emissive: c, glow });
  switch (species) {
    case 'bunny': {
      const fur = 0xf2ebe0;
      body.add(at(squash(ball(0.32, fur, 0), 1, 0.85, 1.15), 0, 0.3, 0), at(ball(0.22, fur, 0), 0, 0.55, 0.28));
      for (const x of [-0.08, 0.08]) body.add(at(tilt(squash(ball(0.07, fur, 0), 1, 3.2, 0.6), 0, x < 0 ? 0.15 : -0.15), x, 0.86, 0.22), eye(x * 1.3, 0.6, 0.47));
      body.add(at(ball(0.035, 0xf29aa8, 0), 0, 0.54, 0.5), at(ball(0.09, 0xffffff, 0), 0, 0.32, -0.36));
      break;
    }
    case 'frog': {
      const skin = 0x6cc04a;
      body.add(at(squash(ball(0.3, skin, 0), 1.15, 0.7, 1), 0, 0.22, 0), at(squash(ball(0.24, 0xd9f2a8, 0), 1, 0.5, 1), 0, 0.14, 0.08));
      for (const x of [-0.14, 0.14]) body.add(at(ball(0.1, skin, 0), x, 0.42, 0.12), at(ball(0.06, 0xffffff, 0), x, 0.46, 0.18), eye(x, 0.47, 0.23, 0.035));
      for (const x of [-0.26, 0.26]) body.add(at(squash(ball(0.11, skin, 0), 1.4, 0.5, 1.6), x, 0.06, 0.12));
      break;
    }
    case 'hedgehog': {
      body.add(at(squash(ball(0.3, 0x7a5a40, 0), 1, 0.8, 1.2), 0, 0.26, -0.03));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const spike = at(cone(0.06, 0.2, 0x4a3426, 4), Math.cos(a) * 0.22, 0.33 + Math.sin(a * 2) * 0.05, Math.sin(a) * 0.2 - 0.06);
        spike.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
        body.add(spike);
      }
      body.add(at(squash(ball(0.15, 0xe8c9a0, 0), 1, 0.9, 1.3), 0, 0.2, 0.28), at(ball(0.04, C.ink, 0), 0, 0.22, 0.47), eye(-0.07, 0.29, 0.38, 0.03), eye(0.07, 0.29, 0.38, 0.03));
      break;
    }
    case 'goldfox': {
      const gold = { metal: 0.9, rough: 0.2, emissive: 0xffb02a, glow: 0.25 };
      const coat = 0xf2c14e;
      body.add(at(squash(ball(0.3, coat, 0, gold), 0.9, 0.85, 1.4), 0, 0.42, 0), at(squash(ball(0.24, coat, 0, gold), 1, 0.95, 1.05), 0, 0.62, 0.38));
      body.add(at(squash(ball(0.13, 0xfff3c0, 0, gold), 1, 0.8, 1.2), 0, 0.55, 0.55), at(ball(0.035, C.ink, 0), 0, 0.57, 0.68));
      for (const x of [-0.12, 0.12]) body.add(at(cone(0.08, 0.2, coat, 4, gold), x, 0.8, 0.36), eye(x * 0.9, 0.67, 0.56, 0.035));
      for (const [x, z] of [[-0.12, 0.25], [0.12, 0.25], [-0.12, -0.25], [0.12, -0.25]]) body.add(at(cyl(0.05, 0.05, 0.3, 0xc9a24a, 5, gold), x, 0.05, z));
      const tail = at(squash(ball(0.17, coat, 0, gold), 0.8, 0.8, 1.8), 0, 0.5, -0.5);
      tail.rotation.x = -0.6;
      body.add(tail, at(ball(0.09, 0xfff3c0, 0, { emissive: 0xffe08a, glow: 1.5 }), 0, 0.6, -0.78));
      for (let i = 0; i < 6; i++) body.add(at(ball(0.025, 0xffffff, 0, { emissive: 0xfff2c0, glow: 2.4 }), Math.sin(i * 2.3) * 0.32, 0.4 + (i % 3) * 0.18, Math.cos(i * 1.7) * 0.4));
      break;
    }
    case 'phoenix': {
      const fire = (c, glow = 1.6) => ({ emissive: c, glow });
      body.add(at(squash(ball(0.26, 0xff5a1a, 0, fire(0xff4a10, 1.2)), 0.9, 1.1, 1.3), 0, 0.7, 0), at(ball(0.18, 0xffa03a, 0, fire(0xff8a1a, 1.4)), 0, 0.98, 0.22));
      body.add(at(tilt(cone(0.05, 0.16, 0xffd24a, 4, fire(0xffc030)), Math.PI / 2, 0), 0, 0.96, 0.42), at(ball(0.035, C.ink, 0), -0.08, 1.02, 0.36), at(ball(0.035, C.ink, 0), 0.08, 1.02, 0.36));
      for (let i = 0; i < 3; i++) { const c = at(cone(0.05, 0.28, [0xffd24a, 0xff8a1a, 0xff4a12][i], 4, fire([0xffc030, 0xff7a10, 0xff3a0a][i])), (i - 1) * 0.08, 1.12, 0.1); c.rotation.x = -0.4; body.add(c); }
      const wings = [-1, 1].map((sx) => {
        const w = new THREE.Group();
        for (let k = 0; k < 4; k++) { const f = at(squash(ball(0.16, [0xff5a1a, 0xff8a1a, 0xffb03a, 0xffd24a][k], 0, fire([0xff4a10, 0xff7a10, 0xffa02a, 0xffc040][k])), 0.25, 0.5, 1.6), sx * (0.18 + k * 0.17), 0.08 - k * 0.04, -0.05 - k * 0.04); f.rotation.y = sx * 0.3; w.add(f); }
        w.position.set(sx * 0.15, 0.78, 0);
        body.add(w);
        return w;
      });
      for (let k = 0; k < 5; k++) { const t = at(squash(ball(0.1, [0xff4a12, 0xff8a1a, 0xffd24a][k % 3], 0, fire(0xff6a10)), 0.4, 0.3, 1.8), (k - 2) * 0.07, 0.55 - k * 0.04, -0.45 - k * 0.08); t.rotation.x = 0.4; body.add(t); }
      g.userData.wings = wings;
      g.userData.flies = true;
      break;
    }
    case 'fox':
    case 'starfox': {
      const star = species === 'starfox';
      const coat = star ? 0x4a6fd8 : 0xe0753a;
      const o = star ? glowing(0x3a5cff, 0.6) : {};
      body.add(at(squash(ball(0.3, coat, 0, o), 0.9, 0.85, 1.4), 0, 0.42, 0), at(squash(ball(0.24, coat, 0, o), 1, 0.95, 1.05), 0, 0.62, 0.38));
      body.add(at(squash(ball(0.13, 0xfff4e6, 0), 1, 0.8, 1.2), 0, 0.55, 0.55), at(ball(0.035, C.ink, 0), 0, 0.57, 0.68));
      for (const x of [-0.12, 0.12]) body.add(at(cone(0.08, 0.2, coat, 4, o), x, 0.8, 0.36), eye(x * 0.9, 0.67, 0.56, 0.035));
      for (const [x, z] of [[-0.12, 0.25], [0.12, 0.25], [-0.12, -0.25], [0.12, -0.25]]) body.add(at(cyl(0.05, 0.05, 0.3, star ? 0x22306a : 0x3a2418, 5), x, 0.05, z));
      const tail = at(squash(ball(0.17, coat, 0, o), 0.8, 0.8, 1.8), 0, 0.5, -0.5);
      tail.rotation.x = -0.6;
      body.add(tail, at(ball(0.09, star ? 0xe8f0ff : 0xfff4e6, 0, star ? glowing(0xbfd4ff, 1.6) : {}), 0, 0.6, -0.78));
      if (star) for (let i = 0; i < 5; i++) body.add(at(ball(0.03, 0xffffff, 0, glowing(0xffffff, 2)), Math.sin(i * 2.3) * 0.25, 0.5 + (i % 3) * 0.15, Math.cos(i * 1.7) * 0.35));
      break;
    }
    case 'ghostowl': {
      // A pale owl made of light, trailing wisps.
      const ghost = { emissive: 0x7fd8ff, glow: 0.9 };
      const shell = (r, x, y, z, sx = 1, sy = 1, sz = 1) => {
        const m = at(squash(ball(r, 0xdff4ff, 0, ghost), sx, sy, sz), x, y, z);
        m.material = m.material.clone();
        m.material.transparent = true;
        m.material.opacity = 0.72;
        return m;
      };
      body.add(shell(0.3, 0, 0.42, 0, 1, 1.2, 0.95), shell(0.22, 0, 0.38, 0.17, 1, 1.1, 0.5));
      for (const x of [-0.11, 0.11]) body.add(at(ball(0.09, 0x9fe8ff, 0, { emissive: 0x9fe8ff, glow: 2 }), x, 0.6, 0.24), at(ball(0.045, 0x1a3a6a, 0), x, 0.6, 0.32), at(cone(0.06, 0.14, 0xdff4ff, 4, ghost), x * 1.5, 0.82, 0));
      const wings = [-1, 1].map((sx) => { const w = shell(0.17, sx * 0.29, 0.42, -0.02, 0.4, 1.1, 0.9); body.add(w); return w; });
      for (let i = 0; i < 5; i++) { const wisp = at(ball(0.05 - i * 0.006, 0xbfeaff, 0, { emissive: 0x9fe8ff, glow: 1.6 }), Math.sin(i) * 0.1, 0.25 - i * 0.08, -0.25 - i * 0.12); body.add(wisp); }
      g.userData.wings = wings;
      g.userData.flies = true;
      break;
    }
    case 'owl': {
      const feather = 0x8a6a4e;
      body.add(at(squash(ball(0.3, feather, 0), 1, 1.2, 0.95), 0, 0.42, 0), at(squash(ball(0.22, 0xe8d6b8, 0), 1, 1.1, 0.5), 0, 0.38, 0.17));
      for (const x of [-0.11, 0.11]) body.add(at(ball(0.1, 0xfff4c8, 0, glowing(0xffd24a, 0.9)), x, 0.6, 0.22), eye(x, 0.6, 0.31, 0.05), at(cone(0.06, 0.14, feather, 4), x * 1.5, 0.82, 0));
      body.add(at(tilt(cone(0.04, 0.09, 0xf2b84a, 4), Math.PI, 0), 0, 0.56, 0.31));
      const wings = [-1, 1].map((sx) => { const w = at(squash(ball(0.17, 0x6e5238, 0), 0.4, 1.1, 0.9), sx * 0.29, 0.42, -0.02); body.add(w); return w; });
      g.userData.wings = wings;
      break;
    }
    case 'moth': {
      const glow = glowing(0x9fe8ff, 1.8);
      body.add(at(squash(ball(0.08, 0xd8f4ff, 0, glow), 1, 1, 2.6), 0, 0.9, 0));
      const wings = [-1, 1].map((sx) => {
        const w = new THREE.Group();
        w.add(at(squash(ball(0.22, 0xbfeaff, 0, { emissive: 0x7fd3ff, glow: 1.2 }), 1.4, 0.12, 1), sx * 0.24, 0, 0.02));
        w.position.set(0, 0.92, 0);
        body.add(w);
        return w;
      });
      for (const x of [-0.05, 0.05]) body.add(at(tilt(box(0.012, 0.22, 0.012, 0xd8f4ff), 0.5, x * 8), x, 1.02, 0.18));
      g.userData.wings = wings;
      g.userData.flies = true;
      break;
    }
    case 'stag': {
      const coat = 0xf5f2ea;
      body.add(at(squash(ball(0.42, coat, 0), 0.75, 0.75, 1.5), 0, 0.95, 0), at(cyl(0.12, 0.16, 0.5, coat, 6), 0, 1.15, 0.45), at(squash(ball(0.2, coat, 0), 0.9, 0.9, 1.4), 0, 1.6, 0.62));
      body.children[1].rotation.x = 0.5;
      for (const [x, z] of [[-0.18, 0.35], [0.18, 0.35], [-0.18, -0.35], [0.18, -0.35]]) body.add(at(cyl(0.06, 0.05, 0.75, coat, 5), x, 0.15, z));
      for (const x of [-1, 1]) {
        const antler = new THREE.Group();
        antler.add(at(tilt(cyl(0.025, 0.035, 0.55, C.gold, 5, { metal: 0.6, rough: 0.35 }), 0, x * 0.4), 0, 0, 0), at(tilt(cyl(0.02, 0.025, 0.28, C.gold, 5, { metal: 0.6 }), 0.5, x * 0.9), x * 0.12, 0.25, 0.05));
        antler.position.set(x * 0.1, 1.72, 0.55);
        body.add(antler);
      }
      body.add(eye(-0.1, 1.66, 0.82, 0.035), eye(0.1, 1.66, 0.82, 0.035), at(ball(0.04, C.ink, 0), 0, 1.58, 0.9));
      break;
    }
    default:
      body.add(ball(0.3, C.white, 0));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.body = body;
  return g;
}

// --- Yards: the small things around a building that make it look lived in ---------
// Props fit the age and the kind of building, and more appear as it levels up.
// They stand around the sides and back (the door faces +z), on the pad.
function dressBuilding(g, type, tier, lv) {
  const seed = [...`${type}${tier}${lv}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 9);
  let n = seed;
  const rnd = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  const spots = [110, 150, 200, 245, 75, 285].map((d) => (d * Math.PI) / 180);
  let k = 0;
  const put = (obj, r = 2.75) => {
    const a = spots[k % spots.length] + (rnd() - 0.5) * 0.25;
    k += 1;
    obj.position.set(Math.sin(a) * r, obj.position.y, Math.cos(a) * r);
    obj.rotation.y = rnd() * 6.28;
    g.add(obj);
  };
  const props = YARD[Math.min(tier, YARD.length - 1)];
  const want = 1 + lv; // 2, 3 or 4 props
  const pool = [...props.common, ...(props[type] || [])];
  for (let i = 0; i < want; i++) put(pool[(seed + i * 3) % pool.length]());
  // A fence or low wall along the back from level 2.
  if (lv >= 2 && props.fence) { const f = props.fence(); f.position.set(0, 0, -3.15); g.add(f); }
  // A light by the door at level 3.
  if (lv >= 3 && props.light) { const l = props.light(); l.position.set(1.6, 0, 2.6); g.add(l); }
}

const yardWoodpile = () => { const p = new THREE.Group(); for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) { const log = at(cyl(0.12, 0.12, 0.9, j % 2 ? C.wood : C.woodDark, 6), -0.26 + j * 0.26 + i * 0.13, 0.12 + i * 0.22, 0); log.rotation.x = Math.PI / 2; p.add(log); } return p; };
const yardPots = (c = C.clay) => () => group(at(squash(ball(0.22, c, 0), 1, 1.2, 1), 0, 0.24, 0), at(cyl(0.1, 0.14, 0.12, c, 8), 0, 0.48, 0), at(squash(ball(0.16, C.mud, 0), 1, 1.1, 1), 0.38, 0.17, 0.12), at(squash(ball(0.13, c, 0), 1, 1.3, 1), -0.32, 0.16, 0.18));
const yardRack = () => group(at(box(0.08, 1.1, 0.08, C.woodDark), -0.5, 0, 0), at(box(0.08, 1.1, 0.08, C.woodDark), 0.5, 0, 0), at(box(1.1, 0.06, 0.06, C.woodDark), 0, 1.05, 0), at(box(0.8, 0.6, 0.03, C.hide, { kind: 'fabric' }), 0, 0.68, 0));
const yardStoneRing = () => { const p = new THREE.Group(); for (let i = 0; i < 6; i++) p.add(at(ball(0.14, C.rockDark, 0), Math.cos(i) * 0.35, 0.08, Math.sin(i) * 0.35)); p.add(at(cone(0.12, 0.3, C.orange, 6, { emissive: 0xff6a10, glow: 1.2 }), 0, 0.05, 0)); return p; };
const yardSpears = () => group(...[-0.2, 0, 0.2].map((x) => at(tilt(cyl(0.025, 0.025, 1.4, C.wood, 4), 0, x * 0.4), x, 0, 0)), ...[-0.2, 0, 0.2].map((x) => at(cone(0.05, 0.16, C.rock, 4), x + x * 0.56, 1.38, 0)));
const yardWattle = () => { const p = new THREE.Group(); for (let i = 0; i < 6; i++) p.add(at(box(0.07, 0.75, 0.07, C.woodDark), -1.5 + i * 0.6, 0, 0)); p.add(at(box(3.1, 0.12, 0.05, C.wood), 0, 0.3, 0), at(box(3.1, 0.12, 0.05, C.wood), 0, 0.58, 0)); return p; };
const yardCrate = (c = C.wood) => () => group(at(box(0.55, 0.55, 0.55, c, { kind: 'planks' }), 0, 0, 0), at(box(0.42, 0.42, 0.42, c, { kind: 'planks' }), 0.5, 0, 0.1), at(box(0.38, 0.38, 0.38, C.woodDark, { kind: 'planks' }), 0.15, 0.55, 0.05));
const yardAwning = () => group(...[[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]].map(([x, z]) => at(box(0.07, 1.4, 0.07, C.wood), x, 0, z)), at(box(1.5, 0.08, 1.1, 0x9aa24a, { kind: 'fabric' }), 0, 1.4, 0), at(box(0.9, 0.3, 0.5, C.sand), 0, 0, 0));
const yardBaskets = () => group(at(cyl(0.22, 0.18, 0.3, C.thatch, 8, { kind: 'fabric' }), 0, 0, 0), at(cyl(0.18, 0.15, 0.24, C.thatch, 8, { kind: 'fabric' }), 0.42, 0, 0.1), ...[[0, 0.3], [0.05, 0.36]].map(([x, y]) => at(ball(0.07, C.red, 0), x, y, 0)));
const yardMudwall = () => group(at(box(3.0, 0.6, 0.35, C.mud), 0, 0, 0), at(box(3.1, 0.08, 0.42, C.sand), 0, 0.6, 0));
const yardBarrel = (c = C.wood) => () => group(at(cyl(0.26, 0.26, 0.6, c, 10, { kind: 'planks' }), 0, 0, 0), at(torus(0.27, 0.025, C.iron), 0, 0.12, 0), at(torus(0.27, 0.025, C.iron), 0, 0.48, 0), at(cyl(0.22, 0.22, 0.5, c, 10, { kind: 'planks' }), 0.5, 0, 0.1));
const yardHay = () => group(at(box(0.8, 0.45, 0.5, C.thatch, { kind: 'fabric' }), 0, 0, 0), at(box(0.8, 0.45, 0.5, C.thatch, { kind: 'fabric' }), 0.1, 0.45, 0, 0.3));
const yardFlowerBox = () => group(at(box(1.0, 0.3, 0.35, C.woodDark), 0, 0, 0), ...[-0.35, -0.12, 0.12, 0.35].map((x, i) => at(ball(0.11, [0xf26b6b, 0xffd24a, 0xf5f0e7, 0xc77dff][i], 0), x, 0.35, 0)));
const yardCart = () => { const p = group(at(box(1.2, 0.18, 0.7, C.wood, { kind: 'planks' }), 0, 0.42, 0), at(box(1.2, 0.3, 0.05, C.wood), 0, 0.6, 0.33), at(box(1.2, 0.3, 0.05, C.wood), 0, 0.6, -0.33), at(box(0.9, 0.05, 0.05, C.woodDark), 1.0, 0.45, 0)); for (const z of [-0.4, 0.4]) { const w = at(cyl(0.3, 0.3, 0.07, C.woodDark, 10), 0, 0.3, z); w.rotation.x = Math.PI / 2; p.add(w); } return p; };
const yardPicket = () => { const p = new THREE.Group(); for (let i = 0; i < 9; i++) p.add(at(box(0.09, 0.7, 0.05, C.white), -1.6 + i * 0.4, 0, 0), at(cone(0.065, 0.12, C.white, 4), -1.6 + i * 0.4, 0.7, 0)); p.add(at(box(3.4, 0.07, 0.04, C.white), 0, 0.45, -0.03)); return p; };
const yardLantern = () => group(at(box(0.08, 1.7, 0.08, C.woodDark), 0, 0, 0), at(box(0.35, 0.06, 0.06, C.woodDark), 0.14, 1.65, 0), at(box(0.16, 0.22, 0.16, 0xffd27a, { emissive: 0xffb84a, glow: 1.3 }), 0.28, 1.4, 0));
const yardCoal = () => group(at(squash(ball(0.5, 0x2a2a30, 0, { rough: 1 }), 1.2, 0.6, 1), 0, 0.2, 0), at(cyl(0.05, 0.05, 0.9, C.woodDark, 4), 0.55, 0, 0.2), at(box(0.25, 0.04, 0.2, C.iron), 0.55, 0.9, 0.2));
const yardOilDrums = () => group(at(cyl(0.22, 0.22, 0.6, 0x3a5a7a, 10, { metal: 0.4 }), 0, 0, 0), at(cyl(0.22, 0.22, 0.6, 0xa0442a, 10, { metal: 0.4 }), 0.46, 0, 0.1), at(cyl(0.22, 0.22, 0.6, 0x3a5a7a, 10, { metal: 0.4 }), 0.22, 0.6, 0.05));
const yardStreetLamp = () => group(at(cyl(0.05, 0.07, 2.2, C.iron, 6), 0, 0, 0), at(box(0.3, 0.3, 0.3, C.iron), 0, 2.2, 0), at(box(0.22, 0.22, 0.22, 0xfff0b0, { emissive: 0xffd27a, glow: 1.4 }), 0, 2.22, 0));
const yardIronFence = () => { const p = new THREE.Group(); for (let i = 0; i < 12; i++) p.add(at(cyl(0.02, 0.02, 0.8, C.iron, 4), -1.65 + i * 0.3, 0, 0)); p.add(at(box(3.4, 0.05, 0.05, C.iron), 0, 0.7, 0), at(box(3.4, 0.05, 0.05, C.iron), 0, 0.25, 0)); return p; };
const yardBush = () => group(at(ball(0.42, C.leaf, 0), 0, 0.35, 0), at(ball(0.3, C.leafDark, 0), 0.35, 0.25, 0.1));
const yardBench = () => group(at(box(1.2, 0.08, 0.4, C.wood, { kind: 'planks' }), 0, 0.42, 0), at(box(1.2, 0.35, 0.06, C.wood, { kind: 'planks' }), 0, 0.5, -0.18), ...[-0.5, 0.5].map((x) => at(box(0.06, 0.42, 0.36, C.iron), x, 0, 0)));
const yardMailbox = () => group(at(box(0.06, 0.9, 0.06, C.iron), 0, 0, 0), at(box(0.22, 0.24, 0.4, C.blue), 0, 0.9, 0), at(box(0.04, 0.16, 0.08, C.red), 0.13, 1.0, 0.1));
const yardCarModel = () => { const c = [C.red, C.blue, 0xf2c14e, C.white][Math.floor(Math.random() * 4)]; const p = group(at(box(1.6, 0.45, 0.8, c, { metal: 0.3, rough: 0.4 }), 0, 0.18, 0), at(box(0.9, 0.38, 0.72, c, { metal: 0.3, rough: 0.4 }), -0.1, 0.63, 0), at(box(0.92, 0.3, 0.74, C.glass, { rough: 0.2 }), -0.1, 0.66, 0)); for (const [x, z] of [[-0.5, 0.4], [0.5, 0.4], [-0.5, -0.4], [0.5, -0.4]]) { const w = at(cyl(0.18, 0.18, 0.12, C.ink, 10), x, 0.18, z); w.rotation.x = Math.PI / 2; p.add(w); } return p; };
const yardAcUnit = () => group(at(box(0.6, 0.5, 0.4, C.metal, { metal: 0.4 }), 0, 0, 0), at(cyl(0.16, 0.16, 0.02, C.iron, 10), 0, 0.25, 0.21));
const yardHedgeRow = () => { const p = new THREE.Group(); for (let i = 0; i < 6; i++) p.add(at(ball(0.36, i % 2 ? C.leaf : C.leafDark, 0), -1.5 + i * 0.6, 0.3, 0)); return p; };
const yardSolar = () => { const p = group(at(box(0.08, 0.6, 0.08, C.metal), 0, 0, 0)); const panel = at(box(1.2, 0.05, 0.8, 0x23396b, { metal: 0.5, rough: 0.2 }), 0, 0.65, 0); panel.rotation.x = -0.5; p.add(panel); return p; };
const yardPlanter = () => group(at(cyl(0.4, 0.35, 0.4, C.white, 12), 0, 0, 0), at(ball(0.33, C.leaf, 0), 0, 0.55, 0), at(ball(0.07, 0xffd24a, 0, { emissive: 0xffb02a, glow: 0.6 }), 0.2, 0.75, 0.1));
const yardDronePad = () => group(at(cyl(0.6, 0.6, 0.06, C.slate, 16), 0, 0, 0), at(torus(0.5, 0.03, 0x6fd8ff, { emissive: 0x6fd8ff, glow: 1 }), 0, 0.07, 0), at(box(0.3, 0.1, 0.3, C.white), 0, 0.12, 0));
const yardPathLights = () => group(...[-0.6, 0, 0.6].map((x) => at(cyl(0.05, 0.06, 0.35, 0x6fd8ff, 8, { emissive: 0x6fd8ff, glow: 1.2 }), x, 0, 0)));
const yardAntenna = () => group(at(cyl(0.04, 0.06, 1.8, C.metal, 6), 0, 0, 0), at(tilt(dome(0.4, C.white), Math.PI * 0.75), 0, 1.6, 0), at(ball(0.06, C.red, 0, { emissive: 0xff3030, glow: 1.2 }), 0, 1.85, 0));
const yardRover = () => { const p = group(at(box(0.9, 0.3, 0.6, C.white), 0, 0.3, 0), at(box(0.3, 0.3, 0.3, C.metal), 0.2, 0.6, 0)); for (const [x, z] of [[-0.35, 0.33], [0.35, 0.33], [-0.35, -0.33], [0.35, -0.33]]) { const w = at(cyl(0.14, 0.14, 0.1, C.iron, 8), x, 0.14, z); w.rotation.x = Math.PI / 2; p.add(w); } return p; };

const YARD = [
  { common: [yardWoodpile, yardPots(C.clay), yardStoneRing], home: [yardRack], work: [yardSpears, yardWoodpile], trade: [yardPots(C.mud), yardRack], fence: yardWattle, light: yardStoneRing },
  { common: [yardPots(C.clay), yardBaskets, yardCrate(C.wood)], home: [yardAwning], work: [yardPots(0xb87a48)], trade: [yardAwning, yardBaskets], fence: yardMudwall, light: yardLantern },
  { common: [yardBarrel(C.wood), yardHay, yardCrate(C.wood)], home: [yardFlowerBox, yardCart], work: [yardCart, yardBarrel(C.woodDark)], trade: [yardCart, yardBarrel(C.wood)], fence: yardPicket, light: yardLantern },
  { common: [yardCrate(C.wood), yardOilDrums, yardBarrel(C.woodDark)], home: [yardFlowerBox], work: [yardCoal, yardOilDrums], trade: [yardCrate(C.woodDark), yardCoal], fence: yardIronFence, light: yardStreetLamp },
  { common: [yardBush, yardBench, yardAcUnit], home: [yardMailbox, yardCarModel], work: [yardAcUnit, yardCarModel], trade: [yardCarModel, yardBench], fence: yardHedgeRow, light: yardStreetLamp },
  { common: [yardSolar, yardPlanter, yardPathLights], home: [yardPlanter], work: [yardDronePad, yardSolar], trade: [yardDronePad, yardPlanter], fence: yardHedgeRow, light: yardPathLights },
  { common: [yardAntenna, yardCrate(C.white), yardRover], home: [yardAntenna], work: [yardRover], trade: [yardCrate(C.metal)], fence: null, light: yardPathLights },
];

// --- The Watchtower: where Soma shows what Canvas doesn't -------------------------
/** A tall stone tower with a lit lens at the top that sweeps the land. userData.beam turns. */
export function makeWatchtower() {
  const g = new THREE.Group();
  g.add(cyl(2.3, 2.6, 0.5, C.stoneDark, 12));
  for (let i = 0; i < 4; i++) {
    const r = 1.75 - i * 0.18;
    g.add(at(cyl(r - 0.06, r, 2.1, i % 2 ? C.stone : 0xe8e0cf, 12, { rough: 0.9 }), 0, 0.5 + i * 2.1, 0));
    g.add(at(cyl(r + 0.08, r + 0.08, 0.18, C.stoneDark, 12), 0, 0.5 + i * 2.1 + 2.0, 0));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i;
      const win = at(box(0.36, 0.6, 0.08, 0x2a3550, { emissive: 0xffd27a, glow: 0.4 }), Math.sin(a) * (r + 0.01), 1.3 + i * 2.1, Math.cos(a) * (r + 0.01));
      win.rotation.y = a;
      win.name = 'window';
      g.add(win);
    }
  }
  g.add(at(box(0.9, 1.4, 0.12, C.woodDark), 0, 0.5, 1.78), at(cyl(0.48, 0.48, 0.12, C.woodDark, 10, {}), 0, 1.9, 1.78));
  // The lantern room: a glass drum with a bright lens, a copper roof and a flag.
  const top = 0.5 + 4 * 2.1;
  g.add(at(cyl(1.35, 1.35, 0.2, C.stoneDark, 12), 0, top, 0));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.add(at(box(0.08, 1.3, 0.08, C.iron), Math.sin(a) * 1.05, top + 0.2, Math.cos(a) * 1.05)); }
  g.add(at(cyl(1.0, 1.0, 1.3, 0xbfe8f5, 12, { emissive: 0x9fe8ff, glow: 0.25 }), 0, top + 0.2, 0));
  const beam = new THREE.Group();
  const lens = at(ball(0.42, 0xfff3c0, 1, { emissive: 0xffe08a, glow: 2.2 }), 0, 0, 0);
  const cone2 = new THREE.Mesh(new THREE.ConeGeometry(2.6, 16, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  cone2.rotation.z = Math.PI / 2;
  cone2.position.x = 8;
  beam.add(lens, cone2);
  beam.position.y = top + 0.85;
  beam.name = 'beam';
  g.add(beam, at(cone(1.55, 1.5, 0x3f9a86, 12, { metal: 0.6, rough: 0.35 }), 0, top + 1.5, 0), at(cyl(0.04, 0.04, 1.4, C.iron, 4), 0, top + 3, 0), at(box(0.7, 0.4, 0.02, 0x7a56c2, { kind: 'fabric' }), 0.36, top + 3.9, 0));
  g.userData.beam = beam;
  g.userData.height = top + 4.4;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** A syllabus reading Canvas doesn't show: a dark, half-seen book trailing wisps. */
export function makeShadowBook(revealed) {
  const g = makeCreature('invader', 1);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = revealed ? 0.82 : 0.42;
    o.material.color.lerp(new THREE.Color(0x2a2140), revealed ? 0.55 : 0.85);
    if (o.material.emissive) o.material.emissive.setHex(revealed ? 0x5a3a9a : 0x1a1030);
    o.castShadow = false;
  });
  const wisps = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.09 + (i % 3) * 0.03, 8, 6), new THREE.MeshBasicMaterial({ color: revealed ? 0xb48cff : 0x6a5a8a, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
    w.userData.seed = i * 1.3;
    wisps.add(w);
  }
  wisps.name = 'wisps';
  g.add(wisps);
  g.userData.wisps = wisps;
  return g;
}

// --- Lantern Festival (a town theme) -------------------------------------------------
/** Strings of paper lanterns over the roads and sky lanterns that rise after dark. */
export function makeLanternFestival() {
  const g = new THREE.Group();
  const colors = [0xe8432e, 0xf2a03a, 0xf6d04d, 0xe8432e, 0xd85a8a];
  const lanternMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.6, name: 'lantern' }));
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.8 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5a3a28, roughness: 0.9 });
  const lanternGeo = new THREE.SphereGeometry(0.32, 12, 8);
  lanternGeo.scale(1, 1.25, 1);
  const capGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8);
  const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.4, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a2a1e, roughness: 0.7 });
  const lanterns = [];
  const span = (a, b) => {
    // A rope sagging between two posts, with a lantern every 1.6 m.
    const n = Math.max(2, Math.round(a.distanceTo(b) / 1.6));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(Math.PI * t) * 0.8;
      pts.push(p);
    }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 4, 0.025, 4), ropeMat);
    g.add(rope);
    for (let i = 1; i < n; i++) {
      const m = new THREE.Mesh(lanternGeo, lanternMats[(((i + Math.round(a.x)) % lanternMats.length) + lanternMats.length) % lanternMats.length]);
      m.position.copy(pts[i]).add(new THREE.Vector3(0, -0.42, 0));
      const top = new THREE.Mesh(capGeo, capMat);
      top.position.y = 0.42;
      const bottom = new THREE.Mesh(capGeo, capMat);
      bottom.position.y = -0.42;
      m.add(top, bottom);
      m.userData.phase = i * 0.7 + a.x;
      m.name = 'lantern';
      g.add(m);
      lanterns.push(m);
    }
  };
  const post = (p) => { const m = new THREE.Mesh(postGeo, postMat); m.position.set(p.x, 2.2, p.z); m.castShadow = true; g.add(m); return new THREE.Vector3(p.x, 4.3, p.z); };
  for (const r of [10.6, 20.4]) {
    const count = r < 15 ? 8 : 14;
    const tops = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.2;
      tops.push(post(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)));
    }
    for (let i = 0; i < count; i++) span(tops[i], tops[(i + 1) % count]);
  }
  // Along the avenue to the gate, zigzagging across the road.
  const left = [], right = [];
  for (let z = 22; z <= 42; z += 5) { left.push(post(new THREE.Vector3(-2.6, 0, z))); right.push(post(new THREE.Vector3(2.6, 0, z))); }
  for (let i = 0; i < left.length; i++) span(left[i], right[i]);
  // Sky lanterns, released after dark.
  const sky = [];
  const skyGeo = new THREE.CylinderGeometry(0.26, 0.2, 0.5, 8, 1, true);
  const skyMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, toneMapped: false });
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(skyGeo, skyMat.clone());
    m.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff1c0, toneMapped: false })));
    m.userData = { seed: i * 0.37, x: (Math.sin(i * 12.9) * 0.5 + 0.5) * 70 - 35, z: (Math.sin(i * 78.2) * 0.5 + 0.5) * 70 - 35 };
    m.visible = false;
    g.add(m);
    sky.push(m);
  }
  g.userData = { lanterns, sky, mats: lanternMats };
  return g;
}

// --- The Japanese garden set (decorations) ---------------------------------------
export function makeGardenPiece(type) {
  const g = new THREE.Group();
  const vermilion = 0xd8452e, stone = 0xb9b4a6;
  switch (type) {
    case 'torii': {
      for (const x of [-1.3, 1.3]) g.add(at(cyl(0.16, 0.19, 3.4, vermilion, 10, { rough: 0.6 }), x, 0, 0), at(cyl(0.22, 0.22, 0.3, 0x2a1a12, 10), x, 0, 0));
      const kasagi = at(box(3.9, 0.22, 0.42, 0x2a1a12), 0, 3.5, 0);
      g.add(kasagi, at(box(3.7, 0.22, 0.36, vermilion), 0, 3.3, 0), at(box(3.1, 0.18, 0.26, vermilion), 0, 2.75, 0), at(box(0.18, 0.55, 0.2, vermilion), 0, 2.93, 0));
      for (const x of [-1.95, 1.95]) { const tip = at(box(0.4, 0.18, 0.42, 0x2a1a12), x, 3.6, 0); tip.rotation.z = x < 0 ? 0.25 : -0.25; g.add(tip); }
      g.add(at(box(0.5, 0.4, 0.05, 0x2a1a12), 0, 2.85, 0.15));
      break;
    }
    case 'toro': {
      g.add(at(box(0.7, 0.2, 0.7, stone), 0, 0, 0), at(cyl(0.15, 0.18, 0.8, stone, 6), 0, 0.2, 0), at(box(0.6, 0.12, 0.6, stone), 0, 1.0, 0));
      const light = at(box(0.42, 0.42, 0.42, 0xfff0c0, { emissive: 0xffc860, glow: 1.4 }), 0, 1.12, 0);
      light.name = 'glow';
      g.add(light);
      for (const [x, z] of [[-0.2, 0.22], [0.2, 0.22], [-0.22, -0.2], [0.22, -0.2]]) g.add(at(box(0.08, 0.44, 0.08, stone), x, 1.12, z));
      g.add(at(cone(0.62, 0.42, stone, 4), 0, 1.56, 0, Math.PI / 4), at(ball(0.1, stone, 0), 0, 1.98, 0));
      break;
    }
    case 'bamboo': {
      for (let i = 0; i < 9; i++) {
        const x = Math.sin(i * 2.4) * 0.55, z = Math.cos(i * 1.7) * 0.5, h = 2.4 + (i % 4) * 0.6;
        for (let k = 0; k < Math.round(h / 0.55); k++) g.add(at(cyl(0.06, 0.065, 0.52, k % 2 ? 0x7cb04a : 0x6aa040, 6), x, k * 0.55, z), at(cyl(0.075, 0.075, 0.04, 0x4f8a32, 6), x, k * 0.55 + 0.5, z));
        for (let k = 0; k < 3; k++) { const leaf = at(squash(ball(0.18, 0x5fa83e, 0), 2.2, 0.25, 0.7), x + 0.15, h - 0.3 - k * 0.5, z); leaf.rotation.y = i + k; g.add(leaf); }
      }
      break;
    }
    case 'koi': {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        g.add(at(squash(ball(0.36, i % 3 ? stone : 0x8f8a7c, 0), 1.2, 0.55, 1), Math.cos(a) * 2.3, 0.1, Math.sin(a) * 1.8));
      }
      g.add(at(squash(cyl(2.2, 2.2, 0.05, 0x2f7f8f, 20, { rough: 0.1 }), 1, 1, 0.8), 0, 0.08, 0));
      const fish = new THREE.Group();
      [[0xf28a2e, 0.9], [0xf5f0e7, 1.4], [0xe8432e, 0.6]].forEach(([c, r], i) => {
        const f = group(squash(ball(0.16, c, 0), 0.55, 0.4, 1.4), at(cone(0.1, 0.18, c, 4), 0, 0, -0.27));
        f.children[1].rotation.x = -Math.PI / 2;
        f.position.set(Math.cos(i * 2.1) * r, 0.1, Math.sin(i * 2.1) * r * 0.8);
        f.rotation.y = i * 2.1 + Math.PI / 2;
        f.userData.r = r;
        f.userData.a = i * 2.1;
        fish.add(f);
      });
      fish.name = 'koifish';
      g.add(fish);
      for (const [x, z] of [[0.9, -0.4], [-1.1, 0.5]]) g.add(at(squash(cyl(0.3, 0.3, 0.03, 0x4f9a38, 10), 1, 1, 1), x, 0.12, z), at(ball(0.08, 0xf7b8d2, 0), x + 0.1, 0.18, z));
      break;
    }
    case 'bridge': {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), x = (t - 0.5) * 3.6, y = Math.sin(Math.PI * t) * 0.9;
        const plank = at(box(0.42, 0.1, 1.3, 0x8a5a3a, { kind: 'planks' }), x, y, 0);
        plank.rotation.z = Math.cos(Math.PI * t) * -0.45;
        g.add(plank);
        if (i % 2 === 0) for (const z of [-0.62, 0.62]) g.add(at(box(0.08, 0.7, 0.08, vermilion), x, y, z));
      }
      for (const z of [-0.62, 0.62]) {
        const pts = Array.from({ length: 13 }, (_, i) => { const t = i / 12; return new THREE.Vector3((t - 0.5) * 3.6, Math.sin(Math.PI * t) * 0.9 + 0.7, z); });
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05, 6), mat(vermilion, { rough: 0.6 })));
      }
      break;
    }
    case 'sakura': {
      g.add(at(tilt(cyl(0.14, 0.24, 1.6, 0x4a3226, 7), 0.15, 0), 0, 0, 0), at(tilt(cyl(0.08, 0.12, 1.0, 0x4a3226, 6), -0.6, 0.3), 0.2, 1.3, 0.1));
      const pinks = [0xf7b8d2, 0xf5a3c3, 0xfcd2e2, 0xf09ab8];
      for (const [x, y, z, r] of [[0, 2.1, 0, 0.95], [0.75, 1.9, 0.25, 0.7], [-0.7, 1.95, -0.2, 0.72], [0.15, 2.65, -0.3, 0.6], [-0.3, 1.7, 0.6, 0.55]]) g.add(at(ball(r, pinks[Math.round(x * 10 + y) & 3], 0), x, y, z));
      const petals = new THREE.Group();
      for (let i = 0; i < 10; i++) { const p = at(squash(ball(0.05, 0xf7b8d2, 0), 1, 0.3, 1), 0, 0, 0); p.userData.seed = i * 0.61; petals.add(p); }
      petals.name = 'petals';
      g.add(petals);
      break;
    }
    default:
      g.add(box(0.5, 0.5, 0.5, C.wood));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** A small scene for the Lantern Festival's picture: two posts and a string of lanterns. */
export function makeLanternScene() {
  const g = new THREE.Group();
  const post = (x) => at(cyl(0.08, 0.1, 2.6, 0x8a2a1e, 6), x, 0, 0);
  g.add(post(-1.8), post(1.8), at(box(4.4, 0.08, 1.4, 0x84bd52), 0, -0.05, 0));
  const pts = Array.from({ length: 11 }, (_, i) => { const t = i / 10; return new THREE.Vector3(-1.8 + 3.6 * t, 2.55 - Math.sin(Math.PI * t) * 0.6, 0); });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.025, 4), mat(0x5a3a28)));
  [0xe8432e, 0xf6d04d, 0xf2a03a, 0xe8432e].forEach((c, i) => {
    const p = pts[2 + i * 2];
    const l = at(squash(ball(0.3, c, 0, { emissive: c, glow: 1.6 }), 1, 1.25, 1), p.x, p.y - 0.75, 0);
    g.add(l, at(cyl(0.15, 0.15, 0.07, 0x2a1a12, 8), p.x, p.y - 0.4, 0), at(cyl(0.15, 0.15, 0.07, 0x2a1a12, 8), p.x, p.y - 1.15, 0));
  });
  return g;
}

// --- A course's lair: where that class's work comes from --------------------------
/** A rocky arch around a glowing rift in the course's colour, with its banner. userData.rift pulses. */
export function makeLair(color) {
  const g = new THREE.Group();
  g.add(at(squash(cyl(4.2, 4.6, 0.25, 0x6a5f58, 12), 1, 1, 0.8), 0, 0, 0));
  // The arch: stacked boulders.
  const rocks = [[-2.2, 0, 0.9], [-2.4, 1.1, 0.8], [-2.1, 2.2, 0.7], [-1.4, 3.1, 0.65], [-0.45, 3.5, 0.6], [0.5, 3.5, 0.6], [1.45, 3.1, 0.65], [2.1, 2.2, 0.7], [2.4, 1.1, 0.8], [2.2, 0, 0.9]];
  rocks.forEach(([x, y, r], i) => g.add(at(squash(ball(r, i % 2 ? C.rockDark : 0x6f6a72, 0), 1, 0.85, 0.9), x, y + 0.3, 0)));
  // The rift, in the course's colour.
  const rift = new THREE.Mesh(new THREE.CircleGeometry(1.75, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }));
  rift.position.set(0, 1.9, 0);
  rift.scale.set(1, 1.15, 1);
  const swirl = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.6, 32, 1, 0, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false }));
  swirl.position.set(0, 1.9, 0.02);
  swirl.name = 'swirl';
  g.add(rift, swirl);
  // Loose pages blown out of the rift.
  for (let i = 0; i < 9; i++) {
    const page = at(box(0.32, 0.01, 0.42, i % 3 ? C.cream : 0xfff8e8), Math.sin(i * 2.3) * 2.8, 0.14, 1.2 + Math.cos(i * 1.7) * 1.4);
    page.rotation.y = i;
    g.add(page);
  }
  // A banner in the course's colour, and a pile of books.
  g.add(at(cyl(0.07, 0.09, 3.4, C.woodDark, 6), 3.2, 0, 1.0), at(box(0.9, 1.3, 0.04, color, { kind: 'fabric' }), 3.67, 2.3, 1.0), at(box(0.5, 0.3, 0.05, C.white), 3.67, 2.6, 1.03));
  [[C.red, 0], [0x2f6f9e, 0.24], [0x5b3fa0, 0.48]].forEach(([c, y], i) => g.add(at(box(0.7, 0.22, 0.5, c), -3.1 + i * 0.08, y + 0.12, 1.1, i * 0.4)));
  g.userData.rift = rift;
  g.userData.swirl = swirl;
  g.traverse((o) => { if (o.isMesh && o !== rift && o !== swirl) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// --- Auras: an effect that circles the hero (animated by the game) ------------------
export function makeAura(id) {
  const g = new THREE.Group();
  g.name = 'aura';
  g.userData.kind = id;
  const glow = (color, size, opacity = 0.9) => new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
  const motes = [];
  if (id === 'sparkle') for (let i = 0; i < 16; i++) { const m = glow(i % 3 ? 0xfff2c0 : 0xffffff, 0.04 + (i % 3) * 0.015); m.userData.seed = i * 0.39; motes.push(m); g.add(m); }
  if (id === 'ember') for (let i = 0; i < 20; i++) { const m = glow([0xff7a1a, 0xffb03a, 0xff4a12][i % 3], 0.05); m.userData.seed = i * 0.31; motes.push(m); g.add(m); }
  if (id === 'aurora') {
    const colors = [0x5fffc8, 0x5fb8ff, 0xb48cff];
    colors.forEach((c, i) => {
      const ribbon = new THREE.Mesh(new THREE.TorusGeometry(1.15 + i * 0.18, 0.06, 6, 48, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
      ribbon.rotation.x = Math.PI / 2 + (i - 1) * 0.25;
      ribbon.position.y = 0.6 + i * 0.45;
      ribbon.userData.speed = 0.6 + i * 0.35;
      ribbon.name = 'ribbon';
      g.add(ribbon);
    });
  }
  if (id === 'galaxy') {
    const disk = new THREE.Group();
    disk.name = 'disk';
    for (let i = 0; i < 90; i++) {
      const arm = i % 3, t = (i / 90) * 3.2;
      const r = 0.55 + t * 0.45, a = t * 2.4 + arm * ((Math.PI * 2) / 3);
      const m = glow([0xffffff, 0xb48cff, 0x7fc8ff, 0xff8ad8][i % 4], 0.03 + (i % 5 === 0 ? 0.03 : 0));
      m.position.set(Math.cos(a) * r, (Math.sin(i) * 0.06), Math.sin(a) * r);
      disk.add(m);
    }
    const core = glow(0xffe6ff, 0.12, 0.85);
    disk.add(core);
    disk.position.y = 0.15;
    g.add(disk);
    const nebula = new THREE.Mesh(new THREE.RingGeometry(0.6, 2.0, 48), new THREE.MeshBasicMaterial({ color: 0x7a3ad8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    nebula.rotation.x = -Math.PI / 2;
    nebula.position.y = 0.14;
    nebula.name = 'nebula';
    g.add(nebula);
  }
  g.userData.motes = motes;
  return g;
}

// --- Trophies: shown on pedestals in front of the Vault ------------------------------
export function makeTrophy(id) {
  const g = new THREE.Group();
  const brass = { metal: 0.8, rough: 0.3 };
  switch (id) {
    case 'crane': {
      g.add(at(squash(prism(0.5, 0.25, 0.7, 0xf5f0e7), 1, 1, 1), 0, 0.15, 0));
      for (const sx of [-1, 1]) { const w = at(box(0.55, 0.02, 0.3, 0xe8d6b8), sx * 0.3, 0.32, 0); w.rotation.z = sx * 0.4; g.add(w); }
      const neck = at(box(0.05, 0.4, 0.05, 0xf5f0e7), 0, 0.35, 0.35); neck.rotation.x = 0.6; g.add(neck, at(cone(0.04, 0.12, 0xf5f0e7, 4), 0, 0.52, 0.5));
      break;
    }
    case 'quill': {
      g.add(at(cyl(0.16, 0.2, 0.28, 0x2a2238, 10, { rough: 0.2 }), 0, 0, 0), at(cyl(0.12, 0.12, 0.04, C.ink, 10), 0, 0.28, 0));
      const feather = group(at(squash(ball(0.14, 0xf5f0e7, 0), 0.25, 1.9, 0.6), 0, 0.45, 0), at(cyl(0.012, 0.012, 0.75, 0x8a7a6a, 4), 0, 0.1, 0));
      feather.rotation.z = -0.35;
      feather.position.set(0.05, 0.2, 0);
      g.add(feather);
      break;
    }
    case 'telescope': {
      for (const a of [0, 2.1, 4.2]) { const leg = at(cyl(0.02, 0.025, 0.7, C.woodDark, 5), Math.sin(a) * 0.18, 0, Math.cos(a) * 0.18); leg.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25); g.add(leg); }
      const tube = group(cyl(0.09, 0.07, 0.9, 0xc9a24a, 12, brass), at(cyl(0.1, 0.1, 0.08, 0x8a6a2a, 12, brass), 0, 0.85, 0), at(cyl(0.11, 0.11, 0.05, 0x8a6a2a, 12, brass), 0, 0.3, 0));
      tube.rotation.z = -1.0;
      tube.position.set(-0.3, 0.65, 0);
      g.add(tube);
      break;
    }
    case 'goldbook': {
      const gold = { metal: 0.9, rough: 0.2, emissive: 0xffc04a, glow: 0.25 };
      for (const sx of [-1, 1]) { const page = at(box(0.42, 0.04, 0.55, C.gold, gold), sx * 0.22, 0.12, 0); page.rotation.z = sx * -0.18; g.add(page); }
      g.add(at(box(0.06, 0.08, 0.55, 0xc9a24a, gold), 0, 0.06, 0), at(box(0.7, 0.06, 0.46, 0xfff3d6), 0, 0.14, 0));
      for (let i = 0; i < 6; i++) g.add(at(ball(0.03, 0xfff2c0, 0, { emissive: 0xffe08a, glow: 2 }), Math.sin(i * 1.3) * 0.25, 0.35 + (i % 3) * 0.12, Math.cos(i * 1.7) * 0.15));
      break;
    }
    case 'globe': {
      const orb = at(ball(0.3, 0x2a3a8a, 1, { emissive: 0x3a5aff, glow: 0.35, rough: 0.2 }), 0, 0.62, 0);
      g.add(at(cyl(0.18, 0.24, 0.12, 0xc9a24a, 12, brass), 0, 0, 0), at(cyl(0.03, 0.03, 0.3, 0xc9a24a, 6, brass), 0, 0.12, 0), orb);
      for (const [rx, rz] of [[Math.PI / 2, 0], [Math.PI / 2, 0.8], [1.1, -0.6]]) { const r = at(tilt(torus(0.4, 0.015, 0xc9a24a, brass), rx, rz), 0, 0.62, 0); g.add(r); }
      for (let i = 0; i < 8; i++) g.add(at(ball(0.025, 0xffffff, 0, { emissive: 0xffffff, glow: 2 }), Math.cos(i) * 0.22, 0.62 + Math.sin(i * 2) * 0.18, Math.sin(i) * 0.22));
      break;
    }
    default: g.add(box(0.3, 0.3, 0.3, C.gold));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// --- The Vault: a small marble treasury, with lit pedestals out front ---------------
export function makeVault() {
  const g = new THREE.Group();
  const marble = 0xf2eee6, trim = 0xd9c48a;
  g.add(at(box(6.6, 0.4, 5.2, C.stoneDark), 0, 0, 0), at(box(6.2, 0.25, 4.8, marble), 0, 0.4, 0));
  for (let i = 0; i < 3; i++) g.add(at(box(2.4 - i * 0.2, 0.18, 0.5, marble), 0, i * 0.18, 2.75 + (2 - i) * 0.25));
  g.add(at(box(5.4, 3.4, 3.6, marble, { rough: 0.6 }), 0, 0.65, -0.3));
  for (const x of [-2.2, -1.1, 1.1, 2.2]) g.add(at(cyl(0.22, 0.26, 3.2, marble, 12, { rough: 0.5 }), x, 0.65, 1.95), at(box(0.62, 0.18, 0.62, trim), x, 3.85, 1.95), at(box(0.62, 0.15, 0.62, trim), x, 0.65, 1.95));
  g.add(at(box(5.8, 0.35, 4.6, trim, { metal: 0.3 }), 0, 4.0, 0), at(prism(5.8, 1.2, 0.6, marble), 0, 4.35, 2.0, Math.PI / 2));
  g.add(at(dome(1.7, 0xd9c48a, { metal: 0.6, rough: 0.3 }), 0, 4.35, -0.4), at(cone(0.25, 0.7, 0xd9c48a, 8, { metal: 0.6 }), 0, 6.0, -0.4));
  // A heavy gold door with a round lock.
  g.add(at(box(1.5, 2.3, 0.12, 0xc9a24a, { metal: 0.85, rough: 0.25 }), 0, 0.65, 1.52), at(cyl(0.38, 0.38, 0.1, 0xa8842a, 16, { metal: 0.9, rough: 0.2 }), 0, 1.8, 1.6));
  const lockSpin = at(tilt(box(0.6, 0.06, 0.06, 0x6a5420, { metal: 0.9 }), Math.PI / 2, 0), 0, 1.8, 1.67);
  lockSpin.name = 'spin';
  g.add(lockSpin);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
/** A pedestal lit in a rarity colour; the trophy sits on top. */
export function makePedestal(color) {
  const g = new THREE.Group();
  g.add(at(cyl(0.48, 0.55, 0.2, C.stoneDark, 12), 0, 0, 0), at(cyl(0.34, 0.38, 0.9, 0xf2eee6, 12, { rough: 0.5 }), 0, 0.2, 0), at(cyl(0.46, 0.42, 0.14, 0xf2eee6, 12), 0, 1.1, 0));
  const ring = at(cyl(0.47, 0.47, 0.05, color, 16, { emissive: color, glow: 1.2 }), 0, 1.22, 0);
  ring.name = 'glow';
  g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.2, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  beam.position.y = 2.85;
  g.add(beam);
  g.traverse((o) => { if (o.isMesh && o !== beam) o.castShadow = true; });
  return g;
}

/** Decorations found in chests. */
export function makeVaultDecor(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'mushrooms':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, r = 0.9 + (i % 2) * 0.15, h = 0.18 + (i % 3) * 0.08;
        g.add(at(cyl(0.05, 0.06, h, 0xf5f0e7, 6), Math.cos(a) * r, 0, Math.sin(a) * r), at(squash(ball(0.14 + (i % 3) * 0.03, i % 2 ? 0xe8432e : 0xf28a3c, 0, { emissive: i % 2 ? 0x601010 : 0x6a3a10, glow: 0.4 }), 1, 0.55, 1), Math.cos(a) * r, h, Math.sin(a) * r));
      }
      break;
    case 'owlstatue':
      g.add(at(box(0.9, 0.5, 0.9, C.stoneDark), 0, 0, 0), at(squash(ball(0.5, C.stone, 0), 1, 1.25, 0.95), 0, 1.05, 0), at(squash(ball(0.36, 0xd9d4c6, 0), 1, 1.1, 0.5), 0, 1.0, 0.24));
      for (const x of [-0.18, 0.18]) g.add(at(ball(0.13, 0xe8e4d8, 0), x, 1.45, 0.34), at(ball(0.06, 0xf2c14e, 0, { emissive: 0xffc04a, glow: 1.5 }), x, 1.45, 0.45), at(cone(0.08, 0.2, C.stone, 4), x * 1.4, 1.75, 0));
      g.add(at(tilt(cone(0.06, 0.14, 0xb8b2a4, 4), Math.PI, 0), 0, 1.36, 0.46));
      break;
    case 'crystallamp': {
      g.add(at(cyl(0.35, 0.45, 0.25, C.stoneDark, 8), 0, 0, 0), at(cyl(0.12, 0.16, 1.1, C.stone, 8), 0, 0.25, 0), at(cyl(0.32, 0.2, 0.15, C.stone, 8), 0, 1.35, 0));
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: 0xc9a6ff, emissive: 0x8a5aff, emissiveIntensity: 1.6, roughness: 0.15, flatShading: true }));
      crystal.scale.set(0.8, 1.4, 0.8);
      crystal.position.y = 2.0;
      crystal.name = 'spin';
      g.add(crystal);
      break;
    }
    case 'obelisk': {
      g.add(at(box(1.6, 0.4, 1.6, 0x2a2238), 0, 0, 0), at(box(1.2, 0.3, 1.2, 0x3a3048), 0, 0.4, 0));
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 4.2, 4), new THREE.MeshStandardMaterial({ color: 0x1a1428, roughness: 0.25, metalness: 0.4, flatShading: true }));
      shaft.position.y = 2.8;
      shaft.rotation.y = Math.PI / 4;
      g.add(shaft, at(cone(0.3, 0.6, 0x1a1428, 4, { metal: 0.4, rough: 0.25 }), 0, 4.9, 0, Math.PI / 4));
      for (let i = 0; i < 4; i++) g.add(at(box(0.04, 3.4, 0.02, 0xff4fd8, { emissive: 0xff4fd8, glow: 1.5 }), Math.cos(i * Math.PI / 2 + Math.PI / 4) * 0.3, 1.0, Math.sin(i * Math.PI / 2 + Math.PI / 4) * 0.3));
      const stars = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: [0xffffff, 0xff9ae8, 0x9fe8ff][i % 3], toneMapped: false }));
        st.userData.a = (i / 7) * Math.PI * 2;
        stars.add(st);
      }
      stars.position.y = 5.3;
      stars.name = 'orbit';
      g.add(stars);
      break;
    }
    default: g.add(box(0.5, 0.5, 0.5, C.wood));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// --- Market pictures: armour, charms, tea and colours ---------------------------------
const RARITY_TRIM = { common: 0x9aa0a8, rare: 0x4a90e2, epic: 0xa35be0, legendary: 0xf2c14e };
/** A breastplate with pauldrons, trimmed in the rarity colour. */
export function makeArmorPiece(rarity = 'rare') {
  const steel = { metal: 0.8, rough: 0.3 };
  const trim = RARITY_TRIM[rarity] || C.gold;
  const g = new THREE.Group();
  g.add(at(squash(ball(0.5, C.metal, 1, steel), 1, 1.15, 0.6), 0, 0.6, 0), at(box(0.85, 0.12, 0.5, trim, { metal: 0.7, rough: 0.3 }), 0, 0.12, 0));
  for (const sx of [-1, 1]) g.add(at(squash(ball(0.26, C.metal, 1, steel), 1.1, 0.7, 1), sx * 0.55, 0.95, 0), at(squash(ball(0.27, trim, 0, { metal: 0.7 }), 1.1, 0.25, 1.05), sx * 0.55, 0.98, 0));
  g.add(at(box(0.08, 0.6, 0.06, trim, { metal: 0.7 }), 0, 0.35, 0.3), at(box(0.32, 0.06, 0.06, trim, { metal: 0.7 }), 0, 0.72, 0.3));
  if (rarity === 'legendary' || rarity === 'epic') g.add(at(ball(0.09, trim, 0, { emissive: trim, glow: 1.4 }), 0, 0.75, 0.33));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
/** A pendant on a chain, its gem in the rarity colour. */
export function makeCharmPiece(rarity = 'rare') {
  const trim = RARITY_TRIM[rarity] || C.gold;
  const g = new THREE.Group();
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 6, 32, Math.PI * 1.1), mat(C.gold, { metal: 0.9, rough: 0.2 }));
  chain.rotation.z = Math.PI + 1.15;
  chain.position.y = 0.75;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: trim, emissive: trim, emissiveIntensity: 0.9, roughness: 0.1, flatShading: true }));
  gem.scale.set(0.8, 1.2, 0.5);
  gem.position.y = 0.2;
  g.add(chain, at(torus(0.24, 0.04, C.gold, { metal: 0.9, rough: 0.2 }), 0, 0.2, 0), gem);
  return g;
}
export function makeTeaCup() {
  const g = new THREE.Group();
  g.add(at(cyl(0.5, 0.42, 0.06, 0xf5f0e7, 20), 0, 0, 0), at(cyl(0.34, 0.24, 0.42, 0xf5f0e7, 20), 0, 0.06, 0), at(cyl(0.31, 0.31, 0.02, 0x9a6a2a, 20), 0, 0.42, 0));
  g.add(at(tilt(torus(0.12, 0.035, 0xf5f0e7), 0, Math.PI / 2), 0.36, 0.28, 0));
  for (let i = 0; i < 3; i++) { const puff = at(ball(0.07 + i * 0.02, 0xffffff, 0, { opacity: 0.6 }), Math.sin(i * 2) * 0.08, 0.55 + i * 0.16, 0); g.add(puff); }
  g.add(at(squash(ball(0.08, 0x5fa83e, 0), 1, 0.3, 1.6), 0.12, 0.44, 0.05));
  return g;
}
/** A paint pot of an outfit colour. */
export function makePaintPot(color) {
  const g = new THREE.Group();
  g.add(cyl(0.38, 0.34, 0.55, 0xb8b4a8, 16, { metal: 0.5, rough: 0.35 }), at(cyl(0.36, 0.36, 0.04, color, 16), 0, 0.55, 0));
  g.add(at(squash(ball(0.12, color, 0), 1, 1.6, 1), 0.38, 0.4, 0), at(tilt(box(0.08, 0.7, 0.02, C.woodDark), 0, -0.4), 0.15, 0.55, -0.05));
  return g;
}

// --- Baking: fewer draw calls -------------------------------------------------------
// A model built from dozens of little boxes costs a draw call per box (twice
// with shadows). bakeModel() merges the plain parts into one mesh per material.
// Parts the game moves or looks up stay as they are: anything named (except
// 'window' and 'glow', which only matter for their shared material), anything
// under a named group, and anything a userData field points at.
const MERGE_NAMES = new Set(['', 'window', 'glow']);
export function bakeModel(root) {
  root.updateMatrixWorld(true);
  const keep = new Set();
  root.traverse((o) => {
    for (const v of Object.values(o.userData || {})) for (const x of Array.isArray(v) ? v : [v]) if (x && x.isObject3D) x.traverse((c) => keep.add(c));
    if (o !== root && o.name && !MERGE_NAMES.has(o.name) && !o.isMesh) o.traverse((c) => keep.add(c));
  });
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const buckets = new Map();
  const taken = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || keep.has(o) || !MERGE_NAMES.has(o.name) || Array.isArray(o.material) || !o.visible) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.clearGroups();
    for (const name of Object.keys(geo.morphAttributes)) delete geo.morphAttributes[name];
    local.multiplyMatrices(inv, o.matrixWorld);
    geo.applyMatrix4(local);
    const attrs = Object.keys(geo.attributes).sort().join(',');
    const key = `${o.material.uuid}|${o.name}|${attrs}|${o.castShadow}|${o.receiveShadow}`;
    if (!buckets.has(key)) buckets.set(key, { material: o.material, name: o.name, cast: o.castShadow, receive: o.receiveShadow, geos: [] });
    buckets.get(key).geos.push(geo);
    taken.push(o);
  });
  if (taken.length < 3) return root;
  for (const o of taken) o.parent.remove(o);
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, b.material);
    m.name = b.name;
    m.castShadow = b.cast;
    m.receiveShadow = b.receive;
    root.add(m);
  }
  return root;
}

// Every static model comes out baked. (Exported function bindings can be re-pointed from inside the module.)
{ const raw = makeDecor; makeDecor = (...args) => bakeModel(raw(...args)); }
{ const raw = makeHall; makeHall = (...args) => bakeModel(raw(...args)); }
{ const raw = makeMarket; makeMarket = (...args) => bakeModel(raw(...args)); }
{ const raw = makeVault; makeVault = (...args) => bakeModel(raw(...args)); }
{ const raw = makeLair; makeLair = (...args) => bakeModel(raw(...args)); }
{ const raw = makeWatchtower; makeWatchtower = (...args) => bakeModel(raw(...args)); }
{ const raw = makeChest; makeChest = (...args) => bakeModel(raw(...args)); }
{ const raw = makeCreature; makeCreature = (...args) => bakeModel(raw(...args)); }
{ const raw = makePedestal; makePedestal = (...args) => bakeModel(raw(...args)); }
{ const raw = makeTrophy; makeTrophy = (...args) => bakeModel(raw(...args)); }
