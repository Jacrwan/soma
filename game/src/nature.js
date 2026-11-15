// Trees, rocks and grass. Each tree is two merged shapes (trunk and leaves) so a
// whole forest draws in a handful of calls, and the leaves and grass sway.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceTexture, noise3 } from './tex.js';

export const wind = { value: 0 };

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scaleUv(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
function move(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1)));
  return g;
}
/** Paint every vertex with shade(x, y, z) -> THREE.Color. */
function tint(g, shade) {
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    shade(p.getX(i), p.getY(i), p.getZ(i), c);
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A lumpy ball: a sphere pushed in and out by noise. */
function blob(r, seed, lump = 0.32, w = 12, h = 9) {
  const g = new THREE.SphereGeometry(r, w, h);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 1.7 / r + seed, v.y * 1.7 / r + seed * 1.3, v.z * 1.7 / r - seed);
    v.multiplyScalar(1 + (n - 0.5) * 2 * lump);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return scaleUv(g, r * 6.28, r * 3.14);
}

const GREENS = [
  [0x35602f, 0x6f9a3e], [0x2f5a33, 0x5f9040], [0x44662c, 0x86a246],
];
const PINES = [[0x1f4030, 0x3f6b45], [0x254632, 0x4a7548]];

function trunkGeo(height, r0, r1, bend, seedN) {
  const g = new THREE.CylinderGeometry(r1, r0, height, 9, 5);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const flare = y < 0.3 ? 1 + (0.3 - y) * 1.8 : 1;
    p.setXYZ(i, p.getX(i) * flare + Math.sin(y * 1.1 + seedN) * bend, y, p.getZ(i) * flare + Math.cos(y * 0.9 + seedN * 2) * bend);
  }
  g.computeVertexNormals();
  return scaleUv(g, 1.2, height);
}

function broadleaf(seedN) {
  const r = seeded(seedN * 977 + 3);
  const h = 1.7 + r() * 0.5;
  const trunk = [trunkGeo(h + 0.6, 0.24, 0.11, 0.07, seedN)];
  for (let i = 0; i < 3; i++) {
    const a = r() * 6.28;
    const b = scaleUv(new THREE.CylinderGeometry(0.04, 0.08, 1.1, 6), 0.5, 1.1);
    b.translate(0, 0.55, 0);
    trunk.push(move(b, 0, h - 0.5 + i * 0.25, 0, 0, a, 0.75 + r() * 0.3));
  }
  const [dark, light] = GREENS[seedN % GREENS.length];
  const leaves = [];
  const top = h + 1.0;
  const puffs = [[0, top, 0, 1.2]];
  const n = 6 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r() * 0.6;
    const d = 0.75 + r() * 0.35;
    puffs.push([Math.cos(a) * d, top - 0.55 + r() * 0.9, Math.sin(a) * d, 0.62 + r() * 0.3]);
  }
  for (const [x, y, z, rad] of puffs) leaves.push(move(blob(rad, seedN * 7 + x * 3 + z, 0.3), x, y, z, 0, r() * 6));
  const leaf = mergeGeometries(leaves);
  const cDark = new THREE.Color(dark);
  const cLight = new THREE.Color(light);
  tint(leaf, (x, y, z, c) => {
    const up = THREE.MathUtils.smoothstep(y, top - 1.3, top + 1.1);
    const out = Math.min(1, Math.hypot(x, z) / 1.7);
    const n3 = noise3(x * 1.4 + seedN, y * 1.4, z * 1.4);
    c.copy(cDark).lerp(cLight, Math.min(1, up * 0.75 + n3 * 0.35)).multiplyScalar(0.5 + 0.5 * Math.max(up, out * 0.8));
  });
  return { trunk: mergeGeometries(trunk), leaf };
}

function conifer(seedN) {
  const r = seeded(seedN * 613 + 11);
  const height = 3.6 + r() * 0.9;
  const trunk = trunkGeo(height * 0.9, 0.2, 0.05, 0.02, seedN);
  const [dark, light] = PINES[seedN % PINES.length];
  const layers = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const rad = 1.3 * (1 - t * 0.78);
    const h = 1.15 - t * 0.35;
    const g = new THREE.ConeGeometry(rad, h, 14, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const d = Math.hypot(x, z);
      if (d < 0.001) continue;
      const a = Math.atan2(z, x);
      const jag = 1 + Math.sin(a * 7 + i * 2 + seedN) * 0.1 + (noise3(x * 3 + seedN, i, z * 3) - 0.5) * 0.25;
      const low = 1 - (y + h / 2) / h; // 1 at the skirt, 0 at the tip
      p.setXYZ(k, x * jag, y - low * low * 0.22 * (0.6 + Math.sin(a * 5 + i) * 0.4), z * jag);
    }
    g.computeVertexNormals();
    scaleUv(g, rad * 5, h * 1.2);
    const y0 = 0.9 + t * (height - 1.5);
    const cD = new THREE.Color(dark), cL = new THREE.Color(light);
    tint(g, (x, y, z, c) => {
      const edge = Math.min(1, Math.hypot(x, z) / rad);
      const under = y < -h / 2 + 0.02 && edge < 0.9 ? 0.35 : 1;
      c.copy(cD).lerp(cL, edge * 0.8 + t * 0.2).multiplyScalar((0.55 + edge * 0.45) * under);
    });
    layers.push(move(g, 0, y0 + h / 2, 0, 0, r() * 6));
  }
  return { trunk, leaf: mergeGeometries(layers) };
}

function palm(seedN) {
  const r = seeded(seedN * 331 + 5);
  const lean = 0.5 + r() * 0.5;
  const dir = r() * 6.28;
  const trunk = [];
  const segs = 8;
  const height = 3.0 + r() * 0.8;
  const pos = (t) => new THREE.Vector3(Math.cos(dir) * lean * t * t, height * t, Math.sin(dir) * lean * t * t);
  for (let i = 0; i < segs; i++) {
    const a = pos(i / segs);
    const b = pos((i + 1) / segs);
    const len = a.distanceTo(b);
    const rad = 0.17 - (i / segs) * 0.07;
    const g = scaleUv(new THREE.CylinderGeometry(rad * 0.9, rad * 1.08, len * 1.04, 8), 1, len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    trunk.push(g);
  }
  const head = pos(1);
  for (let i = 0; i < 3; i++) trunk.push(move(scaleUv(new THREE.SphereGeometry(0.13, 8, 6), 0.4, 0.4), head.x + Math.cos(i * 2.1) * 0.16, head.y - 0.16, head.z + Math.sin(i * 2.1) * 0.16));
  const fronds = [];
  const cD = new THREE.Color(0x3a6b2c), cL = new THREE.Color(0x86a843);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const len = 1.9 + r() * 0.6;
    const g = new THREE.PlaneGeometry(len, 0.62, 7, 2);
    g.rotateX(-Math.PI / 2);
    g.translate(len / 2, 0, 0);
    const p = g.attributes.position;
    const droop = 0.75 + r() * 0.5;
    const lift = i % 2 ? 0.55 : 0.15;
    for (let k = 0; k < p.count; k++) {
      const t = p.getX(k) / len;
      const w = Math.sin(Math.PI * (0.12 + 0.88 * t)) * (0.6 + 0.4 * Math.abs(Math.sin(t * 40)));
      const z = p.getZ(k) * w;
      p.setXYZ(k, p.getX(k) * (1 - t * 0.12), lift * t * 1.4 - droop * t * t * 1.5 - Math.abs(z) * 0.55, z);
    }
    g.computeVertexNormals();
    scaleUv(g, len * 0.7, 0.5);
    tint(g, (x, y, z, c) => c.copy(cD).lerp(cL, Math.min(1, x / len + 0.15)).multiplyScalar(0.7 + Math.min(0.3, Math.abs(z))));
    fronds.push(move(g, head.x, head.y, head.z, 0, (i / n) * 6.28 + r() * 0.3));
  }
  return { trunk: mergeGeometries(trunk), leaf: mergeGeometries(fronds) };
}

let barkMat = null;
let leafMat = null;
/** Where the player is, in view space. Trees between the camera and here are cut away so the view stays clear. */
export const focusView = { value: new THREE.Vector3(0, 0, -20) };
const CUTAWAY = `
      {
        float fragDepth = vViewPosition.z;
        float focusDepth = -uFocusView.z;
        if (fragDepth < focusDepth - 0.8) {
          vec2 off = vViewPosition.xy / fragDepth + uFocusView.xy / focusDepth;
          off.y -= 0.035;
          float hole = length(off * vec2(1.0, 1.25));
          float grainDither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (hole < 0.2 + grainDither * 0.06) discard;
        }
      }`;
function sway(material, strength, from) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.uniforms.uFocusView = focusView;
    shader.fragmentShader = `uniform vec3 uFocusView;\n${shader.fragmentShader}`.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${CUTAWAY}`);
    shader.vertexShader = `uniform float uWind;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = uWind * 1.5 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
      #else
        float ph = uWind * 1.5;
      #endif
      float lift = max(position.y - ${from.toFixed(2)}, 0.0);
      transformed.x += (sin(ph + position.y * 0.7) + sin(ph * 2.7 + position.z * 2.0) * 0.35) * ${strength.toFixed(3)} * lift;
      transformed.z += cos(ph * 0.83 + position.x * 1.5) * ${(strength * 0.7).toFixed(3)} * lift;`);
  };
  return material;
}
export function treeMaterials() {
  if (!barkMat) {
    const bark = surfaceTexture('bark');
    barkMat = sway(new THREE.MeshStandardMaterial({ color: 0x6f5540, map: bark, bumpMap: bark, bumpScale: 2.2, roughness: 0.95 }), 0, 1.0);
    const fol = surfaceTexture('foliage');
    leafMat = sway(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: fol, bumpMap: fol, bumpScale: 2.6, roughness: 0.88, side: THREE.DoubleSide }), 0.028, 1.0);
  }
  return { barkMat, leafMat };
}

const variants = [];
/** Tree shapes by kind: 0 conifer, 1 broadleaf, 2 palm. Three of each. */
export function treeVariants() {
  if (!variants.length) {
    variants.push([conifer(1), conifer(2), conifer(3)], [broadleaf(1), broadleaf(2), broadleaf(3)], [palm(1), palm(2), palm(3)]);
  }
  return variants;
}

/** A forest that can be re-planted: place(list of { x, z, kind, scale, turn }). */
// Trees and clouds from the KayKit Medieval Hexagon pack by Kay Lousberg (CC0,
// public/models/nature). Same artist as the hero, so the world and the
// character read as one cartoon style.
const KIT_FILES = ['tree_single_A', 'tree_single_B', 'cloud_big', 'cloud_small'];
export const kit = {};
const kitLoader = new GLTFLoader();
export const natureReady = Promise.all(KIT_FILES.map((name) => kitLoader.loadAsync(`/game/models/nature/${name}.gltf`).then((gltf) => {
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || kit[name]) return;
    kit[name] = { geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), material: o.material };
  });
}))).then(() => true).catch((error) => {
  console.warn('Nature models did not load.', error);
  return false;
});

const TREE_SIZE = 4.6; // the pack's trees are about 1.1 units tall

/**
 * A round, leafy tree in the same low-poly style as the pack's pines (which
 * has no broadleaf trees): a tapered trunk and three faceted blobs of leaves,
 * lighter on top. About 1 unit tall, coloured per vertex.
 */
function roundTreeGeometry() {
  const parts = [];
  const paint = (g, fn) => {
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      fn(c, p.getX(i), p.getY(i), p.getZ(i));
      c.toArray(colors, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  };
  const trunk = new THREE.CylinderGeometry(0.055, 0.085, 0.52, 6).toNonIndexed();
  trunk.translate(0, 0.26, 0);
  parts.push(paint(trunk, (c, x, y) => c.set(0x7a4f33).lerp(new THREE.Color(0x9a6a44), y / 0.52)));
  const dark = new THREE.Color(0x4f9a38), light = new THREE.Color(0xa6d85c);
  for (const [x, y, z, r] of [[0, 0.68, 0, 0.3], [0.17, 0.53, 0.07, 0.22], [-0.15, 0.55, -0.08, 0.21], [0.02, 0.5, -0.17, 0.19]]) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const k = 1 + (noise3(px * 9 + x * 5, py * 9, pz * 9) - 0.5) * 0.22;
      p.setXYZ(i, px * k, py * k * 0.92, pz * k);
    }
    g.translate(x, y, z);
    parts.push(paint(g, (c, _x, py) => c.copy(dark).lerp(light, Math.max(0, Math.min(1, (py - 0.3) / 0.65)))));
  }
  for (const g of parts) {
    g.deleteAttribute('uv');
    g.computeVertexNormals();
  }
  return mergeGeometries(parts);
}
let roundTree = null;
const forests = new Set();
natureReady.then((ok) => { if (ok) for (const f of forests) f.flush(); });

/** Instanced cartoon trees. place(trees) takes { x, y?, z, kind, scale, turn }; kind 1 is a pine. */
export function createForest() {
  const object = new THREE.Group();
  let pending = null;
  let meshes = [];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  function build(trees) {
    for (const m of meshes) {
      object.remove(m);
      m.dispose();
    }
    meshes = [];
    // kind 0: round leafy tree; kind 1: one of the pack's two pines.
    const pine = (t) => (Math.abs(Math.sin(t.x * 3.1 + t.z * 1.7)) < 0.5 ? 1 : 2);
    if (!roundTree) {
      roundTree = {
        geometry: roundTreeGeometry(),
        material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
      };
    }
    [roundTree, kit.tree_single_A, kit.tree_single_B].forEach((src, kind) => {
      const list = trees.filter((t) => (t.kind === 1 ? pine(t) : 0) === kind);
      if (!list.length) return;
      const material = sway(src.material.clone(), 0.016, 0.35);
      const mesh = new THREE.InstancedMesh(src.geometry, material, list.length);
      list.forEach((t, i) => {
        dummy.position.set(t.x, t.y || 0, t.z);
        dummy.rotation.set(0, t.turn, 0);
        dummy.scale.setScalar(TREE_SIZE * t.scale * (kind === 0 ? 1.15 : 1));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // A little variety: some trees a touch lighter, warmer or deeper.
        const k = Math.sin(t.x * 12.9 + t.z * 78.2) * 0.5 + 0.5;
        tint.setRGB(0.9 + k * 0.18, 0.94 + k * 0.1, 0.9 + (1 - k) * 0.12);
        mesh.setColorAt(i, tint);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      object.add(mesh);
      meshes.push(mesh);
    });
  }
  const forest = {
    object,
    place(trees) {
      pending = trees;
      if (kit.tree_single_A) build(trees);
    },
    flush() {
      if (pending) build(pending);
    },
  };
  forests.add(forest);
  return forest;
}

/** Cartoon clouds drifting in a ring around the middle of the map. */
export function createClouds(count, seedN, inner, outer, low, high) {
  const group = new THREE.Group();
  natureReady.then((ok) => {
    if (!ok) return;
    const r = seeded(seedN);
    for (let i = 0; i < count; i++) {
      const src = kit[r() < 0.55 ? 'cloud_big' : 'cloud_small'];
      const cloud = new THREE.Mesh(src.geometry, src.material);
      const a = (i / count) * Math.PI * 2 + r() * 0.4;
      const d = inner + r() * (outer - inner);
      cloud.position.set(Math.cos(a) * d, low + r() * (high - low), Math.sin(a) * d);
      cloud.rotation.y = r() * 6.28;
      cloud.scale.setScalar(6 + r() * 6);
      group.add(cloud);
    }
  });
  return group;
}

/** One standalone tree (for previews). */
export function singleTree(kind, variant = 0) {
  const { barkMat: bark, leafMat: leaf } = treeMaterials();
  const v = treeVariants()[kind][variant % 3];
  const g = new THREE.Group();
  for (const m of [new THREE.Mesh(v.trunk, bark), new THREE.Mesh(v.leaf, leaf)]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

let rockSeed = 1;
/** A rock. Faceted and low-poly to suit the cartoon world; smooth for the realistic far planet. */
export function rockGeometry(smooth = false) {
  const seedN = rockSeed++ * 3.7;
  const g = smooth ? new THREE.SphereGeometry(0.75, 11, 8) : new THREE.IcosahedronGeometry(0.75, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 1.5 + seedN, v.y * 1.5 - seedN, v.z * 1.5 + seedN * 0.5);
    const n2 = noise3(v.x * 4 + seedN, v.y * 4, v.z * 4);
    v.multiplyScalar(0.72 + n * 0.6 + (smooth ? (n2 - 0.5) * 0.14 : 0));
    v.y = Math.max(v.y * 0.8, -0.22);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return scaleUv(g, 3.5, 2);
}

export function createGrass(count, radius, allowed, seedN = 21) {
  const r = seeded(seedN);
  const pos = [];
  const col = [];
  const nor = [];
  const idx = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = r() * 6.28;
    const d = r() * 0.3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 0.16 + r() * 0.16;
    const w = 0.03 + r() * 0.018;
    const face = r() * 6.28;
    const lx = Math.cos(face) * w, lz = Math.sin(face) * w;
    const tipX = x + (r() - 0.5) * 0.14, tipZ = z + (r() - 0.5) * 0.14;
    const base = pos.length / 3;
    pos.push(x - lx, 0, z - lz, x + lx, 0, z + lz, tipX, h, tipZ);
    col.push(0.82, 0.82, 0.82, 0.82, 0.82, 0.82, 1.12, 1.12, 1.12);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = `uniform float uWind;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = uWind * 1.9 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
        float bend = position.y * position.y;
        transformed.x += (sin(ph) + sin(ph * 2.3 + 1.0) * 0.4) * 1.1 * bend;
        transformed.z += cos(ph * 0.8) * 0.7 * bend;
      #endif`);
  };
  const mesh = new THREE.InstancedMesh(g, material, count);
  const dummy = new THREE.Object3D();
  const shades = [0x86c255, 0x8fc95d, 0x7dba4e, 0x94cd62].map((c) => new THREE.Color(c));
  const c = new THREE.Color();
  let placed = 0;
  for (let tries = 0; tries < count * 3 && placed < count; tries++) {
    const a = r() * 6.28;
    const d = Math.sqrt(r()) * radius;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!allowed(x, z)) continue;
    // Patchy: thicker where the noise is high.
    const patch = noise3(x * 0.12, 0, z * 0.12);
    if (r() > 0.35 + patch * 0.9) continue;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, r() * 6.28, 0);
    const s = 0.75 + r() * 0.6 + patch * 0.4;
    dummy.scale.set(s, s * (0.8 + r() * 0.5), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    c.copy(shades[Math.floor(r() * shades.length)]).multiplyScalar(0.95 + r() * 0.1);
    mesh.setColorAt(placed, c);
    placed += 1;
  }
  mesh.count = placed;
  mesh.userData.full = placed;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
