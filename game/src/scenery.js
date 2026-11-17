// The country around the town, made to feel alive and varied without costing much:
// - Areas: five kinds of country in a ring (meadow, orchard, pond, woods, highlands),
//   each with its own colour and things growing in it.
// - Ground cover: flowers, reeds, mushrooms, logs, stumps, bushes, rocks, lily pads,
//   fallen fruit. One instanced mesh each, so about ten draw calls in all.
// - Life: a flock of birds and butterflies by day, cloud shadows.
// - The horizon bends away like a rolling log (Animal Crossing's "drum"), so the far
//   country drops out of view and there's never a flat, empty field to stare at.
// Everything here is decided by fixed seeds, so the country looks the same each visit.

import * as THREE from 'three';
import { rockGeometry, wind } from './nature.js';
import { fbm } from './tex.js';

// --- The rolling-log horizon ------------------------------------------------------------
// Bends everything down in view space past BEND.from metres.
export const BEND = { from: 30, upto: 90, k: 0.0007 };
// Straight down in the world, by horizontal distance from the camera (the drum), and only
// for the player's perspective camera: the sun's shadow camera is orthographic, so shadow
// maps stay flat and shadows keep their real shapes.
const BEND_GLSL = `
  if (projectionMatrix[3][3] < 0.5) {
    vec3 bendRel = transpose(mat3(viewMatrix)) * mvPosition.xyz;
    float bendD = clamp(length(bendRel.xz) - ${BEND.from.toFixed(1)}, 0.0, ${BEND.upto.toFixed(1)});
    mvPosition.xyz -= mat3(viewMatrix)[1] * (bendD * bendD * ${BEND.k.toFixed(5)});
  }
`;
let bent = false;
export function installHorizonBend() {
  // Off by default: with Epoch's ring of mountains the bend made the peaks look like they
  // were tipping over (Animal Crossing has open sea instead). Add ?bend to the URL to try it.
  if (bent || typeof location === 'undefined' || !/[?&]bend\b/.test(location.search)) return;
  bent = true;
  THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace('gl_Position = projectionMatrix * mvPosition;', `${BEND_GLSL}\ngl_Position = projectionMatrix * mvPosition;`);
}
/** The same bend for a custom shader that computes mvPosition itself (e.g. water). */
export const bendGlsl = BEND_GLSL;
/** Projects a world position the way the bent world draws it (for labels and markers). Modifies v. */
export function projectBent(v, camera) {
  if (bent) {
    const d = Math.min(Math.max(Math.hypot(v.x - camera.position.x, v.z - camera.position.z) - BEND.from, 0), BEND.upto);
    v.y -= d * d * BEND.k;
  }
  return v.project(camera);
}

// --- Areas ---------------------------------------------------------------------------------
const rad = (d) => (d * Math.PI) / 180;
export const ZONES = [
  { name: 'meadow', at: 90, color: 0xa6d35e },
  { name: 'orchard', at: 160, color: 0x93c85a },
  { name: 'pond', at: 228, color: 0x6fc069 },
  { name: 'woods', at: 296, color: 0x4f8b45 },
  { name: 'highlands', at: 8, color: 0xa0a56e },
];
/** The pond (and the stream that feeds it) on the green land. */
export const POND = { x: Math.cos(rad(228)) * 88, z: Math.sin(rad(228)) * 88, r: 11 };
export const STREAM = { a: { x: Math.cos(rad(231)) * 97, z: Math.sin(rad(231)) * 97 }, b: { x: Math.cos(rad(236)) * 132, z: Math.sin(rad(236)) * 132 }, w: 2.2 };

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}
/** How much of each area a spot is, as weights that add to 1 (wobbly edges, never straight lines). */
export function zoneWeights(x, z) {
  const a = (Math.atan2(z, x) * 180) / Math.PI + (vnoise(x * 0.03 + 5, z * 0.03 - 2) - 0.5) * 50;
  const w = ZONES.map((zone) => {
    let d = Math.abs(((a - zone.at) % 360 + 540) % 360 - 180);
    return Math.max(0, 1 - d / 52) ** 2;
  });
  const sum = w.reduce((s, v) => s + v, 0) || 1;
  return w.map((v) => v / sum);
}
export function zoneAt(x, z) {
  const w = zoneWeights(x, z);
  return ZONES[w.indexOf(Math.max(...w))].name;
}
/** How strongly the area colours show at a distance r from the town centre (0 in town). */
export const zoneFade = (r, townR, riseR) => Math.max(0, Math.min(1, (r - townR + 3) / 6)) * Math.max(0, Math.min(1, (riseR + 24 - r) / 16));
const tintColor = new THREE.Color();
const zc = ZONES.map((z) => new THREE.Color(z.color));
/** Tints a colour toward its area's colour. amount: 0..1. Modifies c. */
export function tintByZone(c, x, z, amount) {
  if (amount <= 0) return c;
  const w = zoneWeights(x, z);
  tintColor.setRGB(0, 0, 0);
  for (let i = 0; i < w.length; i++) tintColor.r += zc[i].r * w[i], tintColor.g += zc[i].g * w[i], tintColor.b += zc[i].b * w[i];
  return c.lerp(tintColor, amount);
}

// --- Cloud shadows ---------------------------------------------------------------------------
export const clouds = { tex: { value: null }, t: { value: 0 }, amt: { value: 0.18 } };
function cloudTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fbm(x / size, y / size, 3, 3, 77);
    const c = Math.max(0, Math.min(255, (v - 0.48) * 6 * 255));
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** Soft cloud shadows drifting over a ground material (chains its own onBeforeCompile). */
export function addCloudShadows(material, key) {
  if (!clouds.tex.value) clouds.tex.value = cloudTexture();
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.uCloudTex = clouds.tex;
    shader.uniforms.uCloudT = clouds.t;
    shader.uniforms.uCloudAmt = clouds.amt;
    shader.vertexShader = `varying vec2 vCloudXZ;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloudXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = `uniform sampler2D uCloudTex;\nuniform float uCloudT;\nuniform float uCloudAmt;\nvarying vec2 vCloudXZ;\n${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb *= 1.0 - uCloudAmt * texture2D(uCloudTex, vCloudXZ * 0.0045 + vec2(uCloudT * 0.006, uCloudT * 0.0025)).r;`);
  };
  material.customProgramCacheKey = () => `clouds-${key}`;
  return material;
}

// --- Ground cover ----------------------------------------------------------------------------
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Gives a geometry one flat vertex colour (so several can be merged with their own colours). */
function painted(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}
function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const at = (g, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => { g.scale(s, s, s); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };

// A clump of five flowers: green stems (vertex colour), white heads tinted per clump.
function flowerClump() {
  const parts = [];
  const r = seeded(5);
  for (let i = 0; i < 5; i++) {
    const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.7, h = 0.22 + r() * 0.2;
    parts.push(painted(at(new THREE.CylinderGeometry(0.012, 0.016, h, 4, 1, true), x, h / 2, z), 0x4f8f3a));
    const head = painted(at(new THREE.OctahedronGeometry(0.08, 0), x, h + 0.03, z, 0, 0, 0), 0xffffff);
    head.scale(1, 0.55, 1);
    parts.push(head);
    parts.push(painted(at(new THREE.OctahedronGeometry(0.032, 0), x, h + 0.06, z), 0xffe27a));
  }
  return merge(parts);
}
function reedClump(color = 0x6fa64a) {
  const parts = [];
  const r = seeded(9);
  for (let i = 0; i < 7; i++) {
    const h = 0.5 + r() * 0.55;
    parts.push(painted(at(new THREE.ConeGeometry(0.04, h, 3, 1, true), (r() - 0.5) * 0.5, h / 2, (r() - 0.5) * 0.5, (r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3), color));
  }
  parts.push(painted(at(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 5), 0.06, 0.9, 0.02), 0x6b4a2b));
  return merge(parts);
}
function mushroomClump() {
  const parts = [];
  const r = seeded(13);
  for (let i = 0; i < 3; i++) {
    const x = (r() - 0.5) * 0.45, z = (r() - 0.5) * 0.45, s = 0.6 + r() * 0.6;
    parts.push(painted(at(new THREE.CylinderGeometry(0.035 * s, 0.045 * s, 0.14 * s, 6), x, 0.07 * s, z), 0xf3ead8));
    parts.push(painted(at(new THREE.SphereGeometry(0.1 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), x, 0.13 * s, z), i === 1 ? 0xc9a066 : 0xd8463a));
  }
  return merge(parts);
}
function logGeo() {
  return merge([
    painted(at(new THREE.CylinderGeometry(0.28, 0.32, 2.4, 9, 1, true), 0, 0.26, 0, 0, 0, Math.PI / 2), 0x7a5232),
    painted(at(new THREE.CircleGeometry(0.28, 9), 1.2, 0.26, 0, 0, Math.PI / 2, 0), 0xc9a06a),
    painted(at(new THREE.CircleGeometry(0.32, 9), -1.2, 0.26, 0, 0, -Math.PI / 2, 0), 0xc9a06a),
    painted(at(new THREE.SphereGeometry(0.16, 6, 4), 0.4, 0.5, 0.1), 0x5f9a3e),
  ]);
}
function stumpGeo() {
  return merge([
    painted(at(new THREE.CylinderGeometry(0.3, 0.42, 0.45, 9), 0, 0.22, 0), 0x75502f),
    painted(at(new THREE.CircleGeometry(0.3, 9), 0, 0.452, 0, -Math.PI / 2), 0xd2a96e),
  ]);
}
function bushGeo() {
  const g = new THREE.IcosahedronGeometry(0.75, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash(x * 3, z * 3 + y) - 0.5) * 0.25;
    p.setXYZ(i, x * k * 1.15, Math.max(-0.1, y * k * 0.8) + 0.45, z * k * 1.15);
  }
  g.computeVertexNormals();
  return painted(g, 0xffffff);
}
function padGeo() {
  return merge([
    painted(at(new THREE.CircleGeometry(0.45, 9, 0.3, Math.PI * 1.8), 0, 0.02, 0, -Math.PI / 2), 0x5fa44a),
  ]);
}
function fruitGeo() { return painted(new THREE.IcosahedronGeometry(0.09, 1), 0xffffff); }

const vcMat = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...opts });
// Leaves and stalks bend in the wind, more the higher they are.
function windy(material, strength, key) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = `uniform float uWind;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      float wph = uWind * 1.7 + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29;
      float lift = max(position.y, 0.0);
      transformed.x += sin(wph) * ${strength.toFixed(3)} * lift;
      transformed.z += cos(wph * 0.8) * ${(strength * 0.6).toFixed(3)} * lift;`);
  };
  material.customProgramCacheKey = () => `windy-${key}`;
  return material;
}

/**
 * Ground cover for the country. opts: { height(x,z), free(x,z) -> bool (not road/field/site),
 * townR, riseR, green (true on grassy lands), pond (bool) }. Returns { object, setLevel(q) }.
 */
export function createCover({ height, free, townR, riseR, green = true, pond = false, seed = 1 }) {
  const group = new THREE.Group();
  group.name = 'cover';
  const r = seeded(4400 + seed * 17);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const kinds = [];
  // density per area: [meadow, orchard, pond, woods, highlands]
  const add = (name, geometry, material, count, density, { scale = [0.8, 1.3], minH = 0.15, maxH = 12, near = null, colors = null, shadow = false, sink = 0, minR = townR - 1, maxR = riseR + 6, tiltMax = 0 } = {}) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // spread over the whole country; one draw call either way
    let n = 0;
    for (let tries = 0; tries < count * 40 && n < count; tries++) {
      let x, z;
      if (near) { const a = r() * 6.28, d = near.r0 + r() * (near.r1 - near.r0); x = near.x + Math.cos(a) * d; z = near.z + Math.sin(a) * d; }
      else { const a = r() * 6.28, d = minR + Math.sqrt(r()) * (maxR - minR); x = Math.cos(a) * d; z = Math.sin(a) * d; }
      const w = zoneWeights(x, z);
      let p = 0;
      for (let i = 0; i < 5; i++) p += w[i] * density[i];
      if (r() > p) continue;
      const y = height(x, z);
      if (y < minH || y > maxH || !free(x, z)) continue;
      const s = scale[0] + r() * (scale[1] - scale[0]);
      dummy.position.set(x, y - sink * s, z);
      dummy.rotation.set((r() - 0.5) * tiltMax, r() * 6.28, (r() - 0.5) * tiltMax);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      if (colors) { color.set(colors[Math.floor(r() * colors.length)]); mesh.setColorAt(n, color); }
      n += 1;
    }
    mesh.count = n;
    mesh.userData.full = n;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    kinds.push(mesh);
    return mesh;
  };

  const flowers = green ? [0xffffff, 0xffd34d, 0xff8fb1, 0xb69cff, 0xff7a59, 0x7fc8ff] : [0xffd34d, 0xff7a59, 0xffffff];
  add('flowers', flowerClump(), windy(vcMat(), 0.12, 'flowers'), 1100, [green ? 1 : 0.25, 0.5, 0.35, 0.08, 0.15], { colors: flowers, scale: [2.0, 3.2] });
  add('reeds', reedClump(green ? 0x6fa64a : 0xa8a058), windy(vcMat(), 0.16, 'reeds'), 520, [0.18, 0.15, 0.3, 0.35, 0.25], { scale: [0.8, 1.4] });
  add('mushrooms', mushroomClump(), vcMat({ roughness: 0.7 }), 300, [0.02, 0.06, 0.12, 0.9, 0.05], { scale: [1.2, 2.2] });
  add('logs', logGeo(), vcMat(), 46, [0.03, 0.08, 0.1, 0.7, 0.4], { scale: [0.7, 1.2], shadow: true, maxH: 9 });
  add('stumps', stumpGeo(), vcMat(), 70, [0.05, 0.15, 0.15, 0.8, 0.3], { scale: [0.7, 1.3], shadow: true });
  add('bushes', bushGeo(), vcMat({ roughness: 1, flatShading: true }), 220, [0.25, 0.5, 0.45, 0.6, 0.3], { colors: green ? [0x5e9e44, 0x6aaa4c, 0x4f8c3c, 0x76b257] : [0x9a9a58, 0x8a8c4e], scale: [0.6, 1.4], sink: 0.12 });
  add('rocks', painted(rockGeometry(false).clone(), 0xffffff), vcMat({ roughness: 1 }), 320, [0.05, 0.05, 0.1, 0.12, 1], { colors: [0x9a9c9e, 0x8a8c8e, 0xa8a49a], scale: [0.3, 2.4], sink: 0.25, maxH: 30, tiltMax: 0.6, shadow: true });
  if (green) add('fruit', fruitGeo(), vcMat({ roughness: 0.5 }), 160, [0, 1, 0.02, 0, 0], { colors: [0xd8402e, 0xe8642c, 0xf2b631], scale: [0.9, 1.3] });
  if (pond) {
    add('lilies', padGeo(), vcMat({ roughness: 0.6 }), 42, [1, 1, 1, 1, 1], { near: { x: POND.x, z: POND.z, r0: 1, r1: POND.r - 1 }, minH: -9, maxH: -0.3, scale: [0.7, 1.4] })
      .position.y = 0; // pads float: placed at the water line below
    const lilies = group.getObjectByName('lilies');
    for (let i = 0; i < lilies.count; i++) { lilies.getMatrixAt(i, dummy.matrix); dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale); dummy.position.y = -0.42; dummy.updateMatrix(); lilies.setMatrixAt(i, dummy.matrix); }
    add('pondReeds', reedClump(0x5f9a44), windy(vcMat(), 0.16, 'pondReeds'), 120, [1, 1, 1, 1, 1], { near: { x: POND.x, z: POND.z, r0: POND.r - 1, r1: POND.r + 5 }, minH: -0.4, maxH: 0.8, scale: [0.9, 1.5] });
  }
  return {
    object: group,
    /** 0 full, 1 fewer, 2 fewest (slow machines). */
    setLevel(level) { for (const m of kinds) m.count = Math.floor(m.userData.full * [1, 0.6, 0.3][level]); },
  };
}

// --- Life: birds and butterflies ------------------------------------------------------------
/**
 * opts: { height(x,z), townR }. update(dt, time, focus, light) with light 0 (night) .. 1 (day).
 */
export function createLife({ height, townR }) {
  const group = new THREE.Group();
  group.name = 'life';
  const dummy = new THREE.Object3D();

  // A flock of birds wheeling high over the country by day.
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, -0.7, 0.12, -0.12, 0, 0, -0.1, 0, 0, 0.18, 0, 0, -0.1, 0.7, 0.12, -0.12], 3));
  birdGeo.computeVertexNormals();
  const birds = new THREE.InstancedMesh(birdGeo, new THREE.MeshBasicMaterial({ color: 0x2e3440, side: THREE.DoubleSide, fog: true }), 9);
  birds.frustumCulled = false;
  const flock = Array.from({ length: 9 }, (_, i) => ({ ox: (i % 3) * 1.6 - 1.6 + Math.random(), oz: Math.floor(i / 3) * 1.4 + Math.random(), oy: Math.random() * 1.2, ph: Math.random() * 6 }));
  group.add(birds);

  // Butterflies near you by day, in the open country.
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.16, 0.02, 0.1, -0.13, 0.01, -0.1, 0, 0, 0, 0.16, 0.02, 0.1, 0.13, 0.01, -0.1], 3));
  wing.computeVertexNormals();
  const flyCount = 18;
  const butterflies = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), flyCount);
  butterflies.frustumCulled = false;
  const flyColors = [0xffffff, 0xffd34d, 0xff9a5a, 0x8fd0ff, 0xd9a8ff, 0xfff2a8];
  const flies = Array.from({ length: flyCount }, (_, i) => {
    butterflies.setColorAt(i, new THREE.Color(flyColors[i % flyColors.length]));
    return { x: 0, z: 0, hx: 9999, hz: 9999, ph: Math.random() * 6, sp: 0.6 + Math.random() * 0.6 };
  });
  butterflies.instanceColor.needsUpdate = true;
  group.add(butterflies);

  // (Fireflies were here: removed Nov 17, Ted found the flickering lights confusing.)

  let birdA = 0;
  const outside = (x, z) => Math.hypot(x, z) > townR - 18;
  return {
    object: group,
    update(dt, time, focus, light) {
      // Birds: a loose V circling a wide ring, out of the way of the camera.
      const day = light > 0.35;
      birds.visible = day;
      if (day) {
        birdA += dt * 0.045;
        const cx = Math.cos(birdA) * 70, cz = Math.sin(birdA * 0.8) * 70, cy = 30 + Math.sin(birdA * 3) * 3;
        const head = Math.atan2(-Math.sin(birdA) * 70 * 0.045, Math.cos(birdA * 0.8) * 70 * 0.8 * 0.045);
        flock.forEach((b, i) => {
          dummy.position.set(cx + Math.cos(head) * b.ox - Math.sin(head) * b.oz, cy + b.oy, cz - Math.sin(head) * b.ox - Math.cos(head) * b.oz);
          dummy.rotation.set(0, head + Math.PI / 2, 0);
          const flap = Math.sin(time * 9 + b.ph);
          dummy.scale.set(1.4, 1.4 * (0.4 + Math.abs(flap) * 1.2), 1.4);
          dummy.updateMatrix();
          birds.setMatrixAt(i, dummy.matrix);
        });
        birds.instanceMatrix.needsUpdate = true;
      }
      // Butterflies: each keeps a home spot near you and loops around it.
      butterflies.visible = day;
      if (day) {
        flies.forEach((f, i) => {
          if (Math.hypot(f.hx - focus.x, f.hz - focus.z) > 34) {
            for (let k = 0; k < 6; k++) {
              const a = Math.random() * 6.28, d = 6 + Math.random() * 22;
              const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
              if (!outside(x, z)) continue;
              const w = zoneWeights(x, z);
              if (Math.random() > 0.25 + w[0] * 0.9 + w[1] * 0.5) continue;
              f.hx = x; f.hz = z; f.hy = height(x, z); break;
            }
          }
          const t = time * f.sp + f.ph;
          f.x = f.hx + Math.sin(t) * 1.6 + Math.sin(t * 2.3) * 0.5;
          f.z = f.hz + Math.sin(t * 2) * 1.1;
          const y = (f.hy ?? 0) + 0.7 + Math.sin(t * 3.1) * 0.35;
          dummy.position.set(f.x, y, f.z);
          dummy.rotation.set(0, Math.atan2(Math.cos(t) * 1.6, Math.cos(t * 2) * 2.2), 0);
          const flap = Math.sin(time * 22 + f.ph * 5);
          dummy.scale.set(1, 1 + flap * 3, 1);
          dummy.updateMatrix();
          butterflies.setMatrixAt(i, dummy.matrix);
        });
        butterflies.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// --- Land behind the fog -----------------------------------------------------------------
// Which area of the country a spot is in, by clean angle (no wobble, so walls and
// collision agree). Each area runs halfway to its neighbours.
const SECTORS = (() => {
  const list = ZONES.map((z) => ({ name: z.name, at: z.at })).sort((a, b) => a.at - b.at);
  return list.map((z, i) => {
    const prev = list[(i + list.length - 1) % list.length], next = list[(i + 1) % list.length];
    const gapPrev = ((z.at - prev.at) + 360) % 360, gapNext = ((next.at - z.at) + 360) % 360;
    return { name: z.name, from: z.at - gapPrev / 2, to: z.at + gapNext / 2 };
  });
})();
/** The areas' angular ranges (degrees; from may be negative), for creeks and bridges. */
export const AREA_SECTORS = SECTORS;
export function sectorOf(x, z) {
  const a = ((Math.atan2(z, x) * 180) / Math.PI + 360) % 360;
  for (const s of SECTORS) {
    const from = (s.from + 360) % 360, span = s.to - s.from;
    if (((a - from + 360) % 360) < span) return s.name;
  }
  return 'meadow';
}

const FOG_VERT = `
  varying vec2 vUv; varying vec3 vWorld;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FOG_FRAG = `
  uniform float uTime; uniform float uFade; uniform vec3 uColor;
  varying vec2 vUv; varying vec3 vWorld;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 q = vec2(vWorld.x + vWorld.z, vWorld.y) * 0.08;
    float drift = n(q + vec2(uTime * 0.05, 0.0)) * 0.6 + n(q * 2.3 - vec2(0.0, uTime * 0.03)) * 0.4;
    float top = 1.0 - smoothstep(0.45, 1.0, vUv.y);
    float a = top * (0.78 + 0.22 * drift) * uFade;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), drift * 0.25), a);
  }`;

/**
 * Fog walls around the areas still locked. opts: { height(x,z), townR, outerR }.
 * Returns { object, setOpen(names, animate), update(dt, time) }.
 */
export function createFogWalls({ height, townR, outerR }) {
  const group = new THREE.Group();
  group.name = 'fogWalls';
  const walls = new Map();
  const inner = townR + 1.5, tall = 30;
  const strip = (pts) => {
    const pos = [], uv = [], idx = [];
    pts.forEach((p, i) => {
      const y = height(p.x, p.z) - 1.5;
      pos.push(p.x, y, p.z, p.x, y + tall, p.z);
      uv.push(i / (pts.length - 1), 0, i / (pts.length - 1), 1);
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  };
  for (const s of SECTORS) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FOG_VERT, fragmentShader: FOG_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color(0xdfe9f2) } },
    });
    const w = new THREE.Group();
    const arc = [];
    for (let d = s.from; d <= s.to + 0.01; d += 2) arc.push({ x: Math.cos((d * Math.PI) / 180) * inner, z: Math.sin((d * Math.PI) / 180) * inner });
    w.add(new THREE.Mesh(strip(arc), mat));
    // The two sides, from the town edge out to the mountains.
    for (const d of [s.from, s.to]) {
      const side = [];
      for (let r = inner; r <= outerR; r += 3) side.push({ x: Math.cos((d * Math.PI) / 180) * r, z: Math.sin((d * Math.PI) / 180) * r });
      w.add(new THREE.Mesh(strip(side), mat));
    }
    w.children.forEach((m) => { m.renderOrder = 3; m.frustumCulled = false; });
    // Where the label sits: the middle of the arc.
    const mid = ((s.from + s.to) / 2) * (Math.PI / 180);
    w.userData = { mat, fading: 0, anchor: new THREE.Object3D() };
    w.userData.anchor.position.set(Math.cos(mid) * (inner + 0.5), height(Math.cos(mid) * inner, Math.sin(mid) * inner) + 4.5, Math.sin(mid) * (inner + 0.5));
    w.add(w.userData.anchor);
    walls.set(s.name, w);
    group.add(w);
  }
  return {
    object: group,
    walls,
    /** names: areas that are open. animate: fade the newly opened ones out instead of popping. */
    setOpen(names, animate = false) {
      const open = new Set(names);
      for (const [name, w] of walls) {
        if (open.has(name)) {
          if (animate && w.visible) w.userData.fading = 1;
          else { w.visible = false; w.userData.fading = 0; }
        } else { w.visible = true; w.userData.fading = 0; w.userData.mat.uniforms.uFade.value = 1; }
      }
    },
    update(dt, time) {
      for (const w of walls.values()) {
        if (!w.visible) continue;
        w.userData.mat.uniforms.uTime.value = time;
        if (w.userData.fading > 0) {
          w.userData.fading = Math.max(0, w.userData.fading - dt / 2.5);
          w.userData.mat.uniforms.uFade.value = w.userData.fading;
          if (!w.userData.fading) w.visible = false;
        }
      }
    },
  };
}

// --- Locked land, out of focus ----------------------------------------------------------
// A screen pass that blurs whatever stands on land that hasn't opened yet, like looking
// through frosted glass. It rebuilds each pixel's place in the world from the depth
// buffer, so the land itself goes soft (no wall, no fog). Pixels on open land cost one
// depth read; only locked pixels are blurred.
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
export class LockedBlurPass extends Pass {
  constructor(camera, townR) {
    super();
    this.camera = camera;
    this.needsSwap = true;
    const from = SECTORS.map((s) => s.from), span = SECTORS.map((s) => s.to - s.from);
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1, 1) }, uTownR: { value: townR },
      uFrom: { value: from }, uSpan: { value: span }, uLocked: { value: SECTORS.map(() => 0) },
    };
    this.names = SECTORS.map((s) => s.name);
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth;
        uniform mat4 uProjInv; uniform mat4 uViewInv; uniform vec2 uTexel; uniform float uTownR;
        uniform float uFrom[${SECTORS.length}]; uniform float uSpan[${SECTORS.length}]; uniform float uLocked[${SECTORS.length}];
        varying vec2 vUv;
        // How locked a spot is, 0..1, with soft edges: about 7 degrees of fade at an area's
        // sides and 10 metres at the town's edge, so there's never a hard line on screen.
        float lockedAt(vec3 w) {
          float r = length(w.xz);
          if (r < uTownR - 1.0) return 0.0;
          float a = mod(degrees(atan(w.z, w.x)) + 360.0, 360.0);
          float on = 0.0;
          for (int i = 0; i < ${SECTORS.length}; i++) {
            float into = mod(a - mod(uFrom[i] + 360.0, 360.0) + 360.0, 360.0);
            if (into > uSpan[i] + 7.0 && into < 353.0) continue;
            if (into >= 353.0) into -= 360.0;
            float edge = smoothstep(-7.0, 7.0, into) * smoothstep(-7.0, 7.0, uSpan[i] - into);
            on = max(on, uLocked[i] * edge);
          }
          return on * smoothstep(uTownR - 1.0, uTownR + 10.0, r);
        }
        vec3 worldAt(vec2 uv, float d) {
          vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return (uViewInv * vec4(v.xyz / v.w, 1.0)).xyz;
        }
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float d = texture2D(tDepth, vUv).x;
          float m = 0.0;
          if (d < 0.99999) m = lockedAt(worldAt(vUv, d));
          else {
            // The sky: blurred where it sits behind locked land (just above the horizon).
            float below = texture2D(tDepth, vUv - vec2(0.0, 0.03)).x;
            if (below < 0.99999) m = lockedAt(worldAt(vUv - vec2(0.0, 0.03), below)) * 0.6;
          }
          if (m <= 0.001) { gl_FragColor = c; return; }
          // A smooth, round blur: 24 taps on a golden-angle spiral, weighted toward the
          // middle, so there are no rings or streaks. Stronger the more locked it is.
          vec3 acc = c.rgb; float wsum = 1.0;
          float radius = 14.0 * m;
          for (int i = 1; i <= 24; i++) {
            float fi = float(i);
            float rr = sqrt(fi / 24.0);
            float ang = fi * 2.39996;
            float wt = 1.0 - rr * 0.6;
            acc += texture2D(tDiffuse, vUv + vec2(cos(ang), sin(ang)) * rr * radius * uTexel).rgb * wt;
            wsum += wt;
          }
          vec3 blur = acc / wsum;
          // Natural colours, just softer: a touch less saturated and a hair cooler.
          float l = dot(blur, vec3(0.2126, 0.7152, 0.0722));
          blur = mix(blur, vec3(l), 0.15) * vec3(0.98, 1.0, 1.03);
          gl_FragColor = vec4(mix(c.rgb, blur, m), c.a);
        }`,
    }));
  }
  /** names: areas that are open; everything else blurs. */
  setOpen(names) {
    const open = new Set(names);
    this.uniforms.uLocked.value = this.names.map((n) => (open.has(n) ? 0 : 1));
    this.enabled = this.uniforms.uLocked.value.some((v) => v > 0);
  }
  setSize(w, h) { this.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h)); }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    this.uniforms.uViewInv.value.copy(this.camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.quad.material.dispose(); this.quad.dispose(); }
}
