// The two places you can stand: the island and the moon. Builds the ground,
// water, sky, light, roads and scenery, and knows where everything goes.

import * as THREE from 'three';
import { layoutCountry } from './country.js';
import { C, mat, at, makeRock, makeTownCenter, makeGate, makeLander } from './art.js';
import { noiseTexture, rippleNormals, fbm, noise3 } from './tex.js';
import { createForest, createGrass, createClouds, wind } from './nature.js';
import { EARTH_PADS, MOON_PADS } from './sim.js';

export const TOWN_R = 62; // the flat town circle in every land
export const RISE_R = TOWN_R + 56; // where the mountains start; between town and here is open country
export const ISLAND_RADIUS = RISE_R - 5; // how far you can walk: the foot of the mountains
export const BUILD_R = TOWN_R - 2; // building stays inside the town
export const MOON_RADIUS = 33;
export const GATE = new THREE.Vector3(0, 0, 44);
export const PATH_START_Z = 60.5; // where invaders land
export const PATH_END_Z = 47; // where they stop, in front of the gate
export const ARENA = { x: 0, z: 53, r: 8.5 };
export const BOSS_SPOT = new THREE.Vector3(-6.5, 0, 53);
export const MOON_SPAWN = new THREE.Vector3(0, 0, 18);
export const LANDER_POS = new THREE.Vector3(0, 0, 23);
export const STARGATE_POS = new THREE.Vector3(0, 0, -23);
export const DOCK_POS = new THREE.Vector3(40.2, 0, 8.5); // the boat to the Wilds

const rad = (deg) => (deg * Math.PI) / 180;
const polar = (r, deg) => new THREE.Vector3(Math.cos(rad(deg)) * r, 0, Math.sin(rad(deg)) * r);

const EARTH_PAD_POS = [
  ...Array.from({ length: 6 }, (_, i) => polar(13, i * 60)),
  ...Array.from({ length: 10 }, (_, i) => polar(23, i * 36)),
];
const MOON_PAD_POS = Array.from({ length: MOON_PADS }, (_, i) => polar(13, i * 45 + 22.5));
const WONDER_POS = [198, 228, 258, 282, 312, 342].map((deg) => polar(35, deg));
// The market and one hall per class (game.js): the forest keeps clear of them.
export const MARKET_POS = polar(16, 30);
export const WATCHTOWER_POS = new THREE.Vector3(-9, 0, 34); // Soma's Watchtower, by the gate road
export const VAULT_POS = polar(15.5, 150); // the Vault, across the plaza from the market
// Each course's front: a lair at the town's edge, between the wonder sites,
// and the straight path its work marches in on, toward the plaza.
export const FRONT_ANGLES = [213, 243, 297, 327, 180, 0];
export const FRONT_R = 54; // where the lair stands
export const FRONT_STOP = 26; // how close its work gets before it's due
export const FRONT_POS = FRONT_ANGLES.map((deg) => polar(FRONT_R, deg));
export const HALL_SLOTS = [30, 58, 122, 150, 8, 172].map((deg) => polar(44, deg));
WONDER_POS.push(STARGATE_POS);

export function padPosition(scene, i) {
  return (scene === 'moon' ? MOON_PAD_POS : EARTH_PAD_POS)[i];
}
export function wonderPosition(index) {
  return WONDER_POS[index];
}
/** Where chests land around the plaza. */
export function chestPosition(i, scene = 'earth') {
  const p = polar(scene === 'moon' ? 5 : 4.4, 30 + i * 47);
  return p;
}

// A small deterministic random, so the island looks the same every visit.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noise2(x, z) {
  return Math.sin(x * 0.31 + Math.sin(z * 0.17) * 1.7) * 0.5 + Math.sin(z * 0.27 + Math.sin(x * 0.21) * 1.3) * 0.5;
}

// The town sits in a valley. Past the meadow the ground climbs into forested
// hills and then mountains, with two passes left open: the road south that the
// schoolwork marches in on, and the trail east to the Wilds.
const PASSES = [Math.PI / 2, Math.atan2(DOCK_POS.z, DOCK_POS.x)];
function passOpen(x, z, r) {
  const a = Math.atan2(z, x);
  let open = 1;
  for (const p of PASSES) {
    const across = Math.abs(Math.atan2(Math.sin(a - p), Math.cos(a - p))) * r;
    open = Math.min(open, Math.max(0, Math.min(1, (across - 6) / 20)));
  }
  return open;
}
// --- Lands: every age is a new landscape ------------------------------------------
// The town circle (r < TOWN_R) is always flat. Around it lies open country you
// can walk through (gentle hills, groves, water, hidden caches) out to RISE_R,
// where the mountains begin. What the country looks like changes with the age.
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const rise = (r) => Math.max(0, r - RISE_R);
/** Gentle rolling country between the town and the mountains, flatter along the passes. */
function meadow(x, z, r, amp = 1) {
  if (r < TOWN_R) return 0;
  const n = noise2(x * 0.045 + 11, z * 0.045 - 5) * 0.6 + noise2(x * 0.11, z * 0.11) * 0.4;
  return smooth((r - TOWN_R) / 16) * amp * (2.2 + 2 * n) * (0.35 + 0.65 * passOpen(x, z, r));
}
function valleyHeight(x, z, r) {
  if (r < TOWN_R) return 0;
  const open = passOpen(x, z, r);
  const up = (rise(r) / 12) ** 1.55 * 4.4 * (0.75 + 0.45 * noise2(x * 0.35, z * 0.35));
  return meadow(x, z, r) + Math.min(74, up * (0.05 + 0.95 * open * open));
}
// Bronze Age: low dunes, sandstone mesas far out, and a river behind the town.
function duneHeight(x, z, r) {
  if (r < TOWN_R) return 0;
  const open = passOpen(x, z, r);
  let h = (rise(r) / 14) ** 1.3 * 2.4 * (0.5 + 0.9 * noise2(x * 0.12, z * 0.12));
  h = Math.min(14, h);
  const mesa = noise2(x * 0.035 + 7, z * 0.035);
  if (r > RISE_R + 10 && mesa > 0.62) h = Math.max(h, 18 + Math.round(mesa * 10) * 2);
  h = h * (0.15 + 0.85 * open) + meadow(x, z, r, 0.8);
  // The river: a wide band north of town, its banks sloping down.
  const bank = smooth((Math.abs(z + 78) - 6) / 6);
  return h * bank + (1 - bank) * -1.4;
}
// Medieval: green rolling hills, mountains beyond, and a lake to the west.
function rollingHeight(x, z, r) {
  if (r < TOWN_R) return 0;
  const open = passOpen(x, z, r);
  let h = (rise(r) / 16) ** 1.2 * 3.2 * (0.7 + 0.6 * noise2(x * 0.08, z * 0.08)) + Math.sin(x * 0.07) * Math.cos(z * 0.06) * 2 * smooth((r - TOWN_R - 5) / 10);
  if (r > RISE_R + 50) h += ((r - RISE_R - 50) / 10) ** 1.6 * 5;
  h = Math.min(70, Math.max(0, h)) * (0.1 + 0.9 * open * open) + meadow(x, z, r, 1.1);
  const lake = smooth((Math.hypot(x + 86, z - 6) - 13) / 7);
  return h * lake + (1 - lake) * -1.6;
}
// Industrial: a rocky gorge, steep stepped cliffs.
function gorgeHeight(x, z, r) {
  if (r < TOWN_R - 1) return 0;
  const open = passOpen(x, z, r);
  let h = (rise(r) / 8) ** 1.35 * 6 * (0.6 + 0.7 * noise2(x * 0.2, z * 0.2));
  h = Math.round(Math.min(64, h) / 3.5) * 3.5;
  return h * (0.04 + 0.96 * open * open) + meadow(x, z, r, 0.8);
}
// Modern: the sea to the west with a beach; gentle green hills inland.
function coastHeight(x, z, r) {
  if (r < TOWN_R && x > -57) return 0;
  const shore = smooth((-x - 57) / 10);
  const open = passOpen(x, z, r);
  let land = r < TOWN_R ? 0 : Math.min(22, (rise(r) / 16) ** 1.3 * 3 * (0.6 + 0.8 * noise2(x * 0.1, z * 0.1))) * (0.1 + 0.9 * open * open) + meadow(x, z, r, 0.9);
  return land * (1 - shore) + shore * -Math.min(6, (-x - 57) * 0.25 + 0.6);
}
// Space Age: a red canyon of stepped buttes.
function canyonHeight(x, z, r) {
  if (r < TOWN_R) return 0;
  const open = passOpen(x, z, r);
  const n = noise2(x * 0.06, z * 0.06);
  let h = (rise(r) / 10) ** 1.4 * 5 * (0.4 + n);
  h = Math.round(Math.min(48, h) / 5) * 5 + (n > 0.7 && r > RISE_R + 5 ? 10 : 0);
  return h * (0.05 + 0.95 * open * open) + meadow(x, z, r, 0.7);
}

/** How each age's land looks. Indexed by era (0..5); the Moon is its own place. */
const LANDS = [
  { name: 'Green valley', height: valleyHeight,
    stops: [[0, 0x84bd52], [7, 0x72b048], [22, 0x5c9a40], [32, 0x8f949a], [48, 0xa9aeb4], [58, 0xf4f6f8]],
    paint: { base: 0x84bd52, patches: [0x7db54c, 0x8ac459, 0x8fc95e, 0x79b04a], shade: 0x5f9640, worn: 0xc9a46e },
    grass: [0x86c255, 0x8fc95d, 0x7dba4e, 0x94cd62], grassCount: 52000,
    slope: { kinds: [[0, 0.5], [1, 0.5]], count: 780, maxY: 34 }, town: { kinds: [[0, 0.55], [1, 0.45]], count: 58 },
    far: { low: 0x5c9a40, high: 0x9aa0a6, snow: 0xf4f6f8, tall: 1 } },
  { name: 'Desert river', height: duneHeight,
    stops: [[-1.5, 0x8fa46a], [0, 0xe2c98f], [3, 0xd9b77a], [10, 0xcf9f62], [18, 0xc98652], [26, 0xb9784a]],
    paint: { base: 0xe3cb8e, patches: [0xd9bd7e, 0xead39c, 0xdcc285, 0xd2b676], shade: 0xc9a86c, worn: 0xc79a5e },
    grass: [0xa9b45a, 0xb7bd66, 0x9aa850, 0xc2c27a], grassCount: 9000,
    slope: { kinds: [[2, 0.75], [3, 0.25]], count: 220, maxY: 7, nearWater: true }, town: { kinds: [[2, 0.85], [0, 0.15]], count: 20 },
    far: { low: 0xd9a066, high: 0xb8714a, snow: null, tall: 0.55 }, water: { kind: 'river' } },
  { name: 'Lake hills', height: rollingHeight,
    stops: [[-1.5, 0x5f8a4a], [0, 0x6fb04a], [8, 0x5ea643], [20, 0x4c8f3a], [32, 0x7d8a8c], [48, 0x9aa3ad], [60, 0xf4f6f8]],
    paint: { base: 0x72b549, patches: [0x6aad43, 0x7cbe52, 0x66a842, 0x84c45a], shade: 0x528a38, worn: 0xb8955f },
    grass: [0x6fb84a, 0x7dc354, 0x66ad44, 0x86c95c], grassCount: 60000,
    slope: { kinds: [[1, 0.8], [0, 0.2]], count: 1000, maxY: 32 }, town: { kinds: [[1, 0.55], [0, 0.45]], count: 50 },
    far: { low: 0x4c7a5a, high: 0x7d8ca6, snow: 0xf4f6f8, tall: 1.15 }, water: { kind: 'lake' } },
  { name: 'Rocky gorge', height: gorgeHeight,
    stops: [[0, 0x9aa05a], [4, 0x8a8f55], [10, 0x8a7558], [22, 0x75624f], [40, 0x625a52], [56, 0x8a8580]],
    paint: { base: 0x97a35c, patches: [0x8c9655, 0xa3a865, 0x8a8a5a, 0xa8986a], shade: 0x7a7f4c, worn: 0xa08a64 },
    grass: [0x8f9d55, 0x9aa75e, 0x86914f, 0xa3a565], grassCount: 28000,
    slope: { kinds: [[4, 0.75], [1, 0.25]], count: 300, maxY: 26 }, town: { kinds: [[4, 0.5], [0, 0.3], [1, 0.2]], count: 30 },
    far: { low: 0x6e6458, high: 0x8a8580, snow: null, tall: 1.25 } },
  { name: 'Seaside', height: coastHeight,
    stops: [[-3, 0xd8c690], [-0.2, 0xead9a8], [1, 0x8cc06a], [8, 0x7ab35a], [18, 0x6aa24e], [28, 0x8f949a]],
    paint: { base: 0x8cc85a, patches: [0x84c052, 0x96cf64, 0x80bb50, 0x9bd46a], shade: 0x669a44, worn: 0xd8c08a, beach: true },
    grass: [0x8cc85a, 0x96cf64, 0x84c052, 0x9bd46a], grassCount: 40000,
    slope: { kinds: [[2, 0.5], [0, 0.5]], count: 380, maxY: 20 }, town: { kinds: [[2, 0.5], [0, 0.5]], count: 30 },
    far: { low: 0x5c9a40, high: 0x8f949a, snow: null, tall: 0.45 }, water: { kind: 'sea' } },
  { name: 'Red canyon', height: canyonHeight,
    stops: [[0, 0xd9a066], [4, 0xcf8a52], [10, 0xc06a3e], [20, 0xa9532f], [34, 0xc77a4a], [50, 0xe0a070]],
    paint: { base: 0xd8a46a, patches: [0xcf9a60, 0xe0ae74, 0xc98f58, 0xd4a86e], shade: 0xb98552, worn: 0xc08050 },
    grass: [0xb8a05a, 0xc4a866, 0xa8944e, 0xccb070], grassCount: 6000,
    slope: { kinds: [[3, 1]], count: 110, maxY: 6 }, town: { kinds: [[3, 0.8], [4, 0.2]], count: 14 },
    far: { low: 0xc06a3e, high: 0x8f4528, snow: null, tall: 0.75 } },
];
let land = LANDS[0];
export const landName = () => land.name;
export function hillHeight(x, z, r = Math.hypot(x, z)) {
  return land.height(x, z, r);
}

// --- Ground --------------------------------------------------------------------------

/** Smooth ground. heightAt(x, z, r). `span` is how many metres the painted map covers. */
export function ground(size, segments, heightAt, material, span) {
  const g = new THREE.PlaneGeometry(size, size, segments, segments);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, heightAt(x, z, Math.hypot(x, z)));
    uv.setXY(i, x / span + 0.5, z / span + 0.5);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

/** A ground material: one big painted map, with fine grain multiplied in up close. */
export function groundMaterial(map, grain, grainRepeat, bumpScale, amount = 1) {
  const bump = grain.clone();
  bump.repeat.setScalar(grainRepeat);
  bump.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale, roughness: 0.96, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = { value: grain };
    shader.fragmentShader = `uniform sampler2D uGrain;\n${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>
      float grainNear = texture2D(uGrain, vMapUv * ${grainRepeat.toFixed(1)}).r;
      float grainFar = texture2D(uGrain, vMapUv * ${(grainRepeat / 7).toFixed(1)}).r;
      diffuseColor.rgb *= mix(${(1 - 0.3 * amount).toFixed(3)}, ${(1 + 0.2 * amount).toFixed(3)}, grainNear) * mix(${(1 - 0.15 * amount).toFixed(3)}, ${(1 + 0.12 * amount).toFixed(3)}, grainFar);`);
  };
  return material;
}

const css = (hex, alpha = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${alpha})`;

/** A soft dot of one colour, drawn once and stamped many times. */
function stamp(hex) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, css(hex, 1));
  g.addColorStop(0.5, css(hex, 0.55));
  g.addColorStop(1, css(hex, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

const MAP_SPAN = 140; // metres the painted ground map covers
const MAP_SIZE = 2048;
const ROADS = [
  { base: 0xd6b07a, edge: 0xc09862, speck: [0xcca673, 0xe0bf8c], kind: 'dirt' },
  { base: 0xe2c591, edge: 0xc9aa72, speck: [0xd8b984, 0xecd3a4], kind: 'dirt' },
  { base: 0x9d978a, edge: 0x777a5c, speck: [0x8a8478, 0xb5afa2, 0x74706a, 0xa39a88], kind: 'cobble' },
  { base: 0x7f7a72, edge: 0x66664f, speck: [0x6c6861, 0x928d84, 0x5d5a55, 0x85807a], kind: 'cobble' },
  { base: 0x3f4249, edge: 0xb9b6ad, speck: [0x383b41, 0x4a4d55, 0x45484e], kind: 'asphalt' },
  { base: 0xcfd6de, edge: 0x8fd3e8, speck: [0xc2c9d2, 0xdde3ea, 0xb8c0ca], kind: 'asphalt' },
];
const SKIES = [
  { zenith: 0x2f8cf0, horizon: 0xbfe4ff, cover: 0.14, haze: 0.0034, sun: 0xfff3dc },
  { zenith: 0x2f8cf0, horizon: 0xd8ecff, cover: 0.12, haze: 0.0034, sun: 0xffefcf },
  { zenith: 0x3a8ae6, horizon: 0xc6e4fb, cover: 0.2, haze: 0.0038, sun: 0xfff3dc },
  { zenith: 0x6f8aa3, horizon: 0xd6cdbd, cover: 0.68, haze: 0.0092, sun: 0xffe2b8 },
  { zenith: 0x2a79de, horizon: 0xc8e0f4, cover: 0.42, haze: 0.006, sun: 0xfff4e0 },
  { zenith: 0x2c48bd, horizon: 0xd3c8ee, cover: 0.36, haze: 0.006, sun: 0xffeedd },
];
const TREES = [58, 50, 42, 30, 24, 28];

const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;
const SKY_FRAG = `
  varying vec3 vDir;
  uniform vec3 zenith, horizon, sunDir, sunColor, groundColor;
  uniform float time, cover;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(horizon, zenith, pow(h, 0.5));
    float sd = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(sd, 5.0) * 0.14 + pow(sd, 48.0) * 0.45);
    col += sunColor * smoothstep(0.9992, 0.9997, sd) * 14.0;
    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.14) * 1.25 + time * vec2(0.007, 0.0025);
      float big = fbm(uv);
      float fine = fbm(uv * 2.9 + 5.0);
      float c = smoothstep(1.0 - cover, 1.0 - cover + 0.3, big * 0.72 + fine * 0.28);
      float towardSun = fbm(uv + sunDir.xz * 0.22);
      float shade = clamp(0.62 + (big - towardSun) * 2.2 + fine * 0.3, 0.45, 1.25);
      vec3 cloud = mix(horizon * 0.8, vec3(1.0), 0.75) * shade + sunColor * pow(sd, 10.0) * 0.3;
      col = mix(col, cloud, c * smoothstep(0.0, 0.2, d.y) * 0.92);
    } else {
      col = mix(horizon, groundColor, smoothstep(0.0, -0.25, d.y));
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const WATER_VERT = `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const WATER_FRAG = `
  varying vec3 vWorld;
  uniform sampler2D ripples;
  uniform vec3 zenith, horizon, sunDir, sunColor, deep, shallow;
  uniform float time, haze;
  void main() {
    vec2 p = vWorld.xz;
    float r = length(p);
    vec3 n1 = texture2D(ripples, p * 0.085 + time * vec2(0.014, 0.009)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(ripples, p * 0.031 - time * vec2(0.008, 0.012)).xyz * 2.0 - 1.0;
    vec3 n3 = texture2D(ripples, p * 0.31 + time * vec2(-0.02, 0.016)).xyz * 2.0 - 1.0;
    vec3 n = normalize(vec3(n1.x + n2.x + n3.x * 0.5, 2.6, n1.y + n2.y + n3.y * 0.5));
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 v = toEye / dist;
    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 refl = reflect(-v, n);
    vec3 sky = mix(horizon, zenith, pow(max(refl.y, 0.0), 0.5));
    float depth = smoothstep(44.5, 66.0, r);
    vec3 col = mix(mix(shallow, deep, depth), sky, fres);
    float sd = max(dot(refl, sunDir), 0.0);
    col += sunColor * (pow(sd, 260.0) * 5.0 + pow(sd, 24.0) * 0.12);
    // Foam where the sea meets the sand, in bands that roll in.
    float chop = texture2D(ripples, p * 0.12 + time * 0.01).b * 0.5 + n1.x * 0.5;
    float edge = r - 62.6 - sin(time * 0.7 + atan(p.y, p.x) * 5.0) * 0.35;
    float wash = (1.0 - smoothstep(0.0, 1.6, edge)) * smoothstep(-1.8, 0.2, edge);
    float bands = smoothstep(0.72, 0.98, sin(edge * 1.9 - time * 1.1 + chop * 2.5) * 0.5 + 0.5) * (1.0 - smoothstep(1.0, 7.0, edge)) * step(0.0, edge);
    float foam = clamp(wash * (0.55 + chop) + bands * 0.55, 0.0, 1.0);
    col = mix(col, vec3(1.0), foam * 0.85);
    float alpha = clamp(mix(0.45, 0.97, smoothstep(61.5, 71.0, r)) + fres * 0.4 + foam, 0.0, 1.0);
    float fog = 1.0 - exp(-haze * haze * dist * dist);
    gl_FragColor = vec4(mix(col, horizon, fog), mix(alpha, 1.0, fog));
  }`;

export function createWorld(scene, renderer) {
  const earth = new THREE.Group();
  const moon = new THREE.Group();
  scene.add(earth, moon);

  // --- Light ---
  const sunDir = new THREE.Vector3(34, 46, 26).normalize();
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x6f7d54, 0.35);
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target);

  // --- Sky: a dome that follows the camera, with drifting clouds, and the same sky as reflections ---
  const skyUniforms = {
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, groundColor: { value: new THREE.Color(0x5d6b4a) },
    sunDir: { value: sunDir }, sunColor: { value: new THREE.Color() }, time: { value: 0 }, cover: { value: 0.45 },
  };
  const skyMaterial = new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);
  const pmrem = renderer ? new THREE.PMREMGenerator(renderer) : null;
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(dome.geometry, skyMaterial));
  let envTarget = null;
  function bakeEnvironment() {
    if (!pmrem) return;
    const next = pmrem.fromScene(envScene, 0, 0.1, 200);
    scene.environment = next.texture;
    if (envTarget) envTarget.dispose();
    envTarget = next;
  }

  // --- Island ---
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = mapCanvas.height = MAP_SIZE;
  const mapTexture = new THREE.CanvasTexture(mapCanvas);
  mapTexture.colorSpace = THREE.SRGBColorSpace;
  mapTexture.flipY = false;
  mapTexture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  const grain = noiseTexture('dust', 256);
  const groundMat = groundMaterial(mapTexture, grain, 70, 0.25, 0.18);
  const waterUniforms = {
    ripples: { value: rippleNormals(256) }, time: skyUniforms.time, haze: { value: 0.006 },
    zenith: skyUniforms.zenith, horizon: skyUniforms.horizon, sunDir: skyUniforms.sunDir, sunColor: skyUniforms.sunColor,
    deep: { value: new THREE.Color(0x0d4f6e) }, shallow: { value: new THREE.Color(0x3fc4c0) },
  };
  const water = new THREE.Mesh(new THREE.CircleGeometry(900, 72), new THREE.ShaderMaterial({ uniforms: waterUniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.5;
  water.renderOrder = 2;
  water.visible = false; // only the seaside age has a sea
  earth.add(water);

  earth.add(createClouds(16, 404, 60, 190, 34, 62));


  // Everything that belongs to one age's land, rebuilt when a new age starts.
  const landParts = new THREE.Group();
  earth.add(landParts);
  let landIndex = -1;
  let grass = null;
  let wildGrass = null; // grass out in the country
  let countryTrees = null; // the forest past the walls
  let countrySlopes = null, countryList = [];
  let caches = []; // [{ x, y, z }] hidden caches in this land
  let treeSolids = []; // trees and landmarks you can bump into, out in the country
  let country = { landmarks: [], roads: [], fields: [], spin: [], mask: () => 0 };
  let grassLevel = 0;
  const dispose = (root) => root.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.geometry?.dispose(); } });
  function buildLand(index) {
    landIndex = index;
    land = LANDS[index];
    dispose(landParts);
    landParts.clear();

    landParts.add(ground(MAP_SPAN, 140, hillHeight, groundMat, MAP_SPAN));

    // Hidden caches out in the country: dry, fairly flat ground, spread around, off the roads.
    {
      const r = seeded(901 + index * 31);
      caches = [];
      for (let tries = 0; tries < 4000 && caches.length < 5; tries++) {
        const a = r() * 6.28, d = TOWN_R + 16 + r() * (ISLAND_RADIUS - TOWN_R - 24);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const y = hillHeight(x, z, d);
        if (y < 0.2 || y > 9 || passOpen(x, z, d) < 0.6) continue;
        if (Math.abs(hillHeight(x + 2, z, d) - y) + Math.abs(hillHeight(x, z + 2, d) - y) > 1.2) continue;
        if (caches.some((c) => Math.hypot(c.x - x, c.z - z) < 38)) continue;
        caches.push({ x, y, z });
      }
    }

    // Landmarks, roads and farms out in the country.
    country = layoutCountry({ index, height: (x, z) => hillHeight(x, z), passOpen, caches, townR: TOWN_R, walkR: ISLAND_RADIUS });
    landParts.add(country.object);

    // The hills around the town, coloured by height.
    {
      const half = MAP_SPAN / 2;
      const g = new THREE.PlaneGeometry(560, 560, 280, 280);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      const colors = new Float32Array(p.count * 3);
      const c = new THREE.Color();
      const stops = land.stops;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const h = hillHeight(x, z);
        // Under the painted meadow this sheet sits just below it.
        p.setY(i, Math.abs(x) < half - 0.5 && Math.abs(z) < half - 0.5 ? h - 0.8 : h);
        const t = h + noise2(x * 0.5, z * 0.5) * 2.5;
        let k = stops.length - 2;
        while (k > 0 && t < stops[k][0]) k -= 1;
        const [h0, a] = stops[k], [h1, b] = stops[k + 1];
        c.set(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, (t - h0) / (h1 - h0))));
        c.multiplyScalar(0.97 + 0.05 * (noise2(x * 2.3, z * 2.3) * 0.5 + 0.5));
        c.toArray(colors, i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.computeVertexNormals();
      const hills = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
      hills.receiveShadow = true;
      landParts.add(hills);
    }

    // Water: a river, a lake or the sea, depending on the land.
    water.visible = land.water?.kind === 'sea';
    if (land.water?.kind === 'river') {
      const river = new THREE.Mesh(new THREE.PlaneGeometry(700, 14), water.material);
      river.rotation.x = -Math.PI / 2;
      river.position.set(0, -0.45, -78);
      river.renderOrder = 2;
      landParts.add(river);
    } else if (land.water?.kind === 'lake') {
      const lake = new THREE.Mesh(new THREE.CircleGeometry(17, 40), water.material);
      lake.rotation.x = -Math.PI / 2;
      lake.position.set(-86, -0.45, 6);
      lake.renderOrder = 2;
      landParts.add(lake);
    }

    // Far-off peaks, so the horizon isn't empty.
    {
      const far = seeded(314 + index * 17);
      const islandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
      const lo = new THREE.Color(land.far.low), hi = new THREE.Color(land.far.high);
      for (let i = 0; i < 15; i++) {
        const a = (i / 15) * 6.28 + far() * 0.3;
        // The seaside age keeps its west horizon open over the water.
        if (land.water?.kind === 'sea' && Math.cos(a) < -0.3) continue;
        const d = 300 + far() * 160;
        const size = 80 + far() * 90;
        const g = new THREE.SphereGeometry(size, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        const p = g.attributes.position;
        const colors = new Float32Array(p.count * 3);
        const c = new THREE.Color();
        const tall = (0.7 + far() * 0.6) * land.far.tall;
        for (let k = 0; k < p.count; k++) {
          const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
          const n = noise3(x * 0.07 + i * 9, y * 0.07, z * 0.07);
          let ny = y * tall * (0.55 + n * 0.9);
          if (index === 5 || index === 1) ny = Math.round(ny / 18) * 18; // flat-topped buttes and mesas
          p.setXYZ(k, x * (0.8 + n * 0.4), ny - 1, z * (0.8 + n * 0.4));
          const t = ny / (size * Math.max(0.3, tall));
          c.copy(lo).lerp(hi, Math.max(0, Math.min(1, t * 2.4 - 0.3 + (n - 0.5))));
          if (land.far.snow && t + (n - 0.5) * 0.3 > 0.62) c.set(land.far.snow);
          c.toArray(colors, k * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, islandMat);
        m.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
        landParts.add(m);
      }
    }

    // Trees (or palms, or cacti) on the slopes around the town.
    {
      const r = seeded(77 + index);
      const slopes = createForest();
      const list = [];
      const pick = (kinds, v) => { let acc = 0; for (const [k, w] of kinds) { acc += w; if (v < acc) return k; } return kinds[0][0]; };
      // Out in the country trees grow in groves with meadows between; past
      // RISE_R they thicken into forest up the mountain sides.
      const want = Math.round(land.slope.count * 1.7);
      treeSolids = [];
      for (let tries = 0; tries < 20000 && list.length < want; tries++) {
        const a = r() * 6.28, d = TOWN_R + 1.5 + Math.sqrt(r()) * (RISE_R + 70 - TOWN_R);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const y = hillHeight(x, z, d);
        if (y > land.slope.maxY || y < 0.15 || passOpen(x, z, d) < 0.25) continue;
        if (country.mask(x, z)) continue;
        if (d < RISE_R) {
          const grove = noise2(x * 0.05 + 3, z * 0.05 + 9) * 0.7 + noise2(x * 0.13 - 4, z * 0.13) * 0.3;
          if (grove < 0.2 && r() > 0.04) continue;
          if (caches.some((c) => Math.hypot(c.x - x, c.z - z) < 6)) continue;
        }
        // Desert palms grow along the river.
        if (land.slope.nearWater && Math.abs(z + 78) > 16 && r() < 0.85) continue;
        const scale = 1.1 + r() * 1.3;
        list.push({ x, y: y - 0.3, z, kind: pick(land.slope.kinds, r()), scale, turn: r() * 6.28 });
        if (d < ISLAND_RADIUS + 3) treeSolids.push({ x, z, r: 0.35 + scale * 0.22 });
      }
      countrySlopes = slopes;
      countryList = list;
      slopes.place(list.filter((t) => !felled.has(treeKey(t))));
      landParts.add(slopes.object);
      countryTrees = slopes.object;
      applyTreeShadows();
      for (const l of country.landmarks) treeSolids.push({ x: l.x, z: l.z, r: l.solid });
    }

    // Grass in this land's colours (sparse in the desert and the canyon).
    if (grass) earth.remove(grass);
    grass = createGrass(Math.round(land.grassCount * 1.9), TOWN_R - 4, grassAllowed, 21, land.grass);
    earth.add(grass);
    // Thinner grass out in the country, following the ground.
    if (wildGrass) { earth.remove(wildGrass); wildGrass.geometry.dispose(); }
    wildGrass = createGrass(Math.round(land.grassCount * 1.3), RISE_R, (x, z) => {
      const d = Math.hypot(x, z);
      if (d < TOWN_R - 3.5 || country.mask(x, z)) return false;
      const h = hillHeight(x, z, d);
      return h > -0.25 && h < 14;
    }, 33 + index, land.grass, (x, z) => hillHeight(x, z) - 0.05);
    earth.add(wildGrass);
    applyGrassLevel();
  }
  function applyGrassLevel() {
    if (grass) grass.count = Math.floor(grass.userData.full * [0.8, 0.45, 0.2][grassLevel]);
    if (wildGrass) wildGrass.count = Math.floor(wildGrass.userData.full * [0.6, 0.25, 0][grassLevel]);
    if (wildGrass) wildGrass.visible = grassLevel < 2;
  }

  earth.add(createClouds(16, 404, 60, 190, 34, 62));

  function onRoad(x, z, pad = 0) {
    const r = Math.hypot(x, z);
    if (r < 7 + pad) return true;
    if (Math.abs(r - 9.5) < 0.65 + pad || Math.abs(r - 19) < 0.65 + pad) return true;
    if (Math.abs(x) < 1.7 + pad && z > 5 && z < TOWN_R) return true;
    if (r > 9.5 && r < 19) {
      const a = (((Math.atan2(z, x) * 180) / Math.PI - 30) % 60 + 60) % 60;
      const off = Math.min(a, 60 - a);
      if (Math.sin(rad(off)) * r < 0.8 + pad) return true;
    }
    return false;
  }
  function blocked(x, z) {
    const r = Math.hypot(x, z);
    if (r < 8.5 || r > TOWN_R - 2.5) return true;
    if (Math.abs(r - 9.5) < 1.4 || Math.abs(r - 19) < 1.4) return true;
    if (Math.abs(x) < 3.2 && z > 5) return true;
    if (Math.abs(x) < 11 && z > GATE.z) return true;
    if (Math.hypot(x - DOCK_POS.x, z - DOCK_POS.z) < 6.5) return true;
    for (const p of EARTH_PAD_POS) if (Math.hypot(x - p.x, z - p.z) < 4.6) return true;
    for (const p of WONDER_POS.slice(0, 6)) if (Math.hypot(x - p.x, z - p.z) < 7.4) return true;
    if (Math.hypot(x - MARKET_POS.x, z - MARKET_POS.z) < 5.5) return true;
    if (Math.hypot(x - WATCHTOWER_POS.x, z - WATCHTOWER_POS.z) < 5) return true;
    if (Math.hypot(x - VAULT_POS.x, z - VAULT_POS.z) < 7) return true;
    for (let i = 0; i < FRONT_ANGLES.length; i++) {
      if (Math.hypot(x - FRONT_POS[i].x, z - FRONT_POS[i].z) < 7) return true;
      // Keep each front's path clear of trees.
      const a = (FRONT_ANGLES[i] * Math.PI) / 180, along = x * Math.cos(a) + z * Math.sin(a), across = Math.abs(-x * Math.sin(a) + z * Math.cos(a));
      if (along > FRONT_STOP - 2 && along < FRONT_R && across < 4.5) return true;
    }
    for (const p of HALL_SLOTS) if (Math.hypot(x - p.x, z - p.z) < 5.5) return true;
    return false;
  }
  function grassAllowed(x, z) {
    const r = Math.hypot(x, z);
    if (r > TOWN_R - 4 || onRoad(x, z, 0.25)) return false;
    if (Math.abs(x) < 9 && z > GATE.z + 1.5) return false;

    for (const p of WONDER_POS.slice(0, 6)) if (Math.hypot(x - p.x, z - p.z) < 5.2) return false;
    return true;
  }
  const forest = createForest(90);
  earth.add(forest.object);

  /** Paint the whole island floor for an era: sand, grass, worn patches, and that era's roads. */
  function paintGround(e, trees) {
    const ctx = mapCanvas.getContext('2d');
    const s = MAP_SIZE / MAP_SPAN;
    const X = (x) => (x + MAP_SPAN / 2) * s;
    const r = seeded(1000 + e);
    const dab = (img, x, z, radius, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, X(x) - radius * s, X(z) - radius * s, radius * 2 * s, radius * 2 * s);
    };
    ctx.globalAlpha = 1;
    const P = land.paint;
    ctx.fillStyle = css(P.base);
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    const sands = P.patches.slice(0, 3).map(stamp);
    for (let i = 0; i < 900; i++) {
      const a = r() * 6.28, d = TOWN_R - 6 + r() * 13;
      dab(sands[i % 3], Math.cos(a) * d, Math.sin(a) * d, 0.6 + r() * 2.2, 0.25);
    }
    // Grass, fading into the beach.
    ctx.globalAlpha = 1;
    const fade = ctx.createRadialGradient(X(0), X(0), (TOWN_R - 5.4) * s, X(0), X(0), (TOWN_R - 2.4) * s);
    fade.addColorStop(0, css(P.base, 1));
    fade.addColorStop(1, css(P.base, 0));
    ctx.fillStyle = fade;
    ctx.beginPath();
    ctx.arc(X(0), X(0), (TOWN_R - 2) * s, 0, 6.3);
    ctx.fill();
    // Cartoon grass: one clean green with a few big, soft patches.
    const greens = P.patches.map(stamp);
    for (let i = 0; i < 700; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * (TOWN_R - 4);
      dab(greens[Math.floor(r() * greens.length)], Math.cos(a) * d, Math.sin(a) * d, 2 + r() * 5, 0.12 + r() * 0.12);
    }
    const tufts = [stamp(0x8fb257), stamp(0x4c7634)];
    for (let i = 0; i < 0; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * 40.5;
      dab(tufts[i % 2], Math.cos(a) * d, Math.sin(a) * d, 0.12 + r() * 0.25, 0.3);
    }
    // Worn earth where things stand and where the fight happens.
    const worn = stamp(P.worn);

    for (const p of WONDER_POS.slice(0, 6)) dab(worn, p.x, p.z, 6.6, 0.6);
    dab(worn, ARENA.x, ARENA.z, 10.5, 0.75);
    // Shade under the trees.
    const shade = stamp(P.shade);
    for (const t of trees) dab(shade, t.x, t.z, 1.6 * t.scale, 0.35);
    // The seaside age: sand where the town runs down to the water.
    if (P.beach) {
      const sand = [stamp(0xead9a8), stamp(0xe2cf98)];
      for (let i = 0; i < 2600; i++) {
        const x = -70 + r() * 22, z = (r() - 0.5) * 140;
        dab(sand[i % 2], x, z, 1.2 + r() * 2.4, 0.3 + Math.max(0, (-x - 34) / 18) * 0.7);
      }
    }

    // Roads.
    const road = ROADS[e];
    const trace = () => {
      ctx.beginPath();
      ctx.arc(X(0), X(0), 9.5 * s, 0, 6.3);
      ctx.moveTo(X(19), X(0));
      ctx.arc(X(0), X(0), 19 * s, 0, 6.3);
      for (let i = 0; i < 6; i++) {
        const a = rad(i * 60 + 30);
        ctx.moveTo(X(Math.cos(a) * 9.5), X(Math.sin(a) * 9.5));
        ctx.lineTo(X(Math.cos(a) * 19), X(Math.sin(a) * 19));
      }
    };
    const avenue = () => {
      ctx.beginPath();
      ctx.moveTo(X(0), X(5));
      ctx.lineTo(X(0), X(70));
    };
    const lay = (color, alpha, grow) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = css(color);
      ctx.fillStyle = css(color);
      ctx.lineCap = 'round';
      trace();
      ctx.lineWidth = (1.3 + grow) * s;
      ctx.stroke();
      avenue();
      ctx.lineWidth = (3.4 + grow) * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(0), X(0), (7 + grow / 2) * s, 0, 6.3);
      ctx.fill();
    };
    const soft = road.kind === 'dirt';
    if (soft) {
      lay(road.edge, 0.22, 1.5);
      lay(road.edge, 0.4, 0.7);
    } else {
      lay(road.kind === 'asphalt' ? road.edge : 0x5a5a48, road.kind === 'asphalt' ? 1 : 0.55, 0.42);
    }
    lay(road.base, 1, 0);
    // Grain on the road surface: pebbles, cobbles or fine tar.
    const specks = road.speck.map(stamp);
    const count = road.kind === 'cobble' ? 60000 : soft ? 5000 : 26000;
    for (let i = 0; i < count; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * TOWN_R;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!onRoad(x, z, soft ? 0.25 : -0.12)) continue;
      const size = road.kind === 'cobble' ? 0.14 + r() * 0.07 : road.kind === 'asphalt' ? 0.05 + r() * 0.3 : 0.06 + r() * 0.45;
      dab(specks[Math.floor(r() * specks.length)], x, z, size, road.kind === 'cobble' ? 0.85 : soft ? 0.22 : 0.35);
    }
    if (soft) {
      // Ragged edges: grass creeping back over the dirt.
      for (let i = 0; i < 16000; i++) {
        const a = r() * 6.28, d = Math.sqrt(r()) * TOWN_R;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (onRoad(x, z, 0.3) && !onRoad(x, z, -0.25) && r() < 0.18) dab(greens[Math.floor(r() * 4)], x, z, 0.3 + r() * 0.4, 0.6);
      }
    }
    if (road.kind === 'asphalt') {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = e === 5 ? css(0x6fd8ff) : css(0xf1ead8);
      ctx.lineCap = 'butt';
      ctx.setLineDash([1.4 * s, 1.6 * s]);
      ctx.lineWidth = 0.16 * s;
      ctx.beginPath();
      ctx.moveTo(X(0), X(8));
      ctx.lineTo(X(0), X(GATE.z - 1));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(0), X(0), 19 * s, 0, 6.3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    mapTexture.needsUpdate = true;
  }

  // Parts that change with the era.
  const eraParts = new THREE.Group();
  earth.add(eraParts);
  let townCenter = null;
  let gateFlag = null;
  let animated = [];

  // Trees step aside for buildings placed by hand.
  let townTrees = [];
  let clearings = [];
  // Trees the player has cut down, by rounded position ('x,z' to one decimal).
  let felled = new Set();
  const treeKey = (t) => `${t.x.toFixed(1)},${t.z.toFixed(1)}`;
  function placeTownTrees() {
    forest.place(townTrees.filter((t) => !felled.has(treeKey(t)) && clearings.every((c) => Math.hypot(t.x - c.x, t.z - c.z) > 4.2)));
  }
  function placeCountryTrees() {
    if (!countryTrees) return;
    countrySlopes.place(countryList.filter((t) => !felled.has(treeKey(t))));
    applyTreeShadows();
  }
  /** Which trees are cut down (a Set of keys from nearestTree). */
  function setFelled(keys) {
    felled = new Set(keys);
    placeTownTrees();
    placeCountryTrees();
  }
  /** The closest standing tree within reach of x, z: { key, x, z } or null. */
  function nearestTree(x, z, reach = 2.2) {
    let best = null, bestD = reach;
    for (const t of [...townTrees, ...countryList]) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bestD && !felled.has(treeKey(t)) && clearings.every((c) => Math.hypot(t.x - c.x, t.z - c.z) > 4.2)) { bestD = d; best = { key: treeKey(t), x: t.x, z: t.z }; }
    }
    return best;
  }
  function setClearings(list) {
    const key = JSON.stringify(list.map((c) => [c.x, c.z]));
    if (key === setClearings.key) return;
    setClearings.key = key;
    clearings = list;
    placeTownTrees();
  }

  function setEra(era) {
    const e = Math.min(era, 5);
    if (e !== landIndex) buildLand(e);
    eraParts.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    eraParts.clear();

    townCenter = makeTownCenter(era);
    eraParts.add(townCenter);
    animated = [];
    townCenter.traverse((o) => { if (['spin', 'flicker', 'flame', 'ember', 'firelight'].includes(o.name)) animated.push(o); });
    const gate = at(makeGate(era), GATE.x, 0, GATE.z);
    gateFlag = gate.getObjectByName('flag');
    eraParts.add(gate);

    const r = seeded(42);
    const trees = [];
    for (let tries = 0; tries < 1400 && trees.length < Math.round(land.town.count * 1.6); tries++) {
      const a = r() * Math.PI * 2;
      const d = 8 + Math.sqrt(r()) * (TOWN_R - 8);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      let kind = land.town.kinds[0][0];
      { const v = r(); let acc = 0; for (const [k, w] of land.town.kinds) { acc += w; if (v < acc) { kind = k; break; } } }
      const scale = 0.85 + r() * 0.7;
      const turn = r() * 6.28;
      if (blocked(x, z)) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.6)) continue;
      trees.push({ x, z, kind, scale, turn });
    }
    townTrees = trees;
    placeTownTrees();
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = 10 + r() * (TOWN_R - 12);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = 0.5 + r() * 0.9;
      if (!blocked(x, z)) eraParts.add(at(makeRock(s), x, 0.02, z, r() * 6.28));
    }
    paintGround(e, trees);
    if (current === 'earth') applySky(era);
  }

  // --- Moon ---
  const craters = [];
  const cr = seeded(99);
  for (let i = 0; i < 26; i++) {
    const a = cr() * Math.PI * 2;
    const d = 6 + cr() * 60;
    craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 2 + cr() * 5 });
  }
  const craterSafe = (c) => {
    if (Math.hypot(c.x - LANDER_POS.x, c.z - LANDER_POS.z) < c.r + 5 || Math.hypot(c.x - STARGATE_POS.x, c.z - STARGATE_POS.z) < c.r + 8) return false;
    return MOON_PAD_POS.every((p) => Math.hypot(c.x - p.x, c.z - p.z) > c.r + 4.5) && Math.hypot(c.x, c.z) > c.r + 7;
  };
  const liveCraters = craters.filter(craterSafe);
  const moonHeight = (x, z, r) => {
    let y = r > 36 ? Math.sin(x * 0.2) * Math.cos(z * 0.17) * 1.6 * Math.min(1, (r - 36) / 10) : 0;
    for (const c of liveCraters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1.25) y += d < 1 ? -0.55 * (1 - d * d) * Math.min(1, c.r / 4) : 0.22 * (1.25 - d) * 4 * Math.min(1, c.r / 4);
    }
    return y;
  };
  // The moon's floor: grey dust, darker in the crater bowls, paler on their rims.
  const moonCanvas = document.createElement('canvas');
  moonCanvas.width = moonCanvas.height = 1024;
  {
    const ctx = moonCanvas.getContext('2d');
    const span = 190;
    const s = 1024 / span;
    const img = ctx.createImageData(1024, 1024);
    for (let py = 0; py < 1024; py++) {
      for (let px = 0; px < 1024; px++) {
        const x = px / s - span / 2, z = py / s - span / 2;
        const y = moonHeight(x, z, Math.hypot(x, z));
        const n = fbm(px / 1024, py / 1024, 6, 5, 7);
        const v = Math.max(0.2, Math.min(1, 0.6 + (n - 0.5) * 0.45 + y * 0.35));
        const i = (py * 1024 + px) * 4;
        img.data[i] = v * 196;
        img.data[i + 1] = v * 194;
        img.data[i + 2] = v * 202;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const moonMap = new THREE.CanvasTexture(moonCanvas);
  moonMap.colorSpace = THREE.SRGBColorSpace;
  moonMap.flipY = false;
  moonMap.anisotropy = 8;
  moon.add(ground(190, 170, moonHeight, groundMaterial(moonMap, grain, 110, 2.2), 190));
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  const sr = seeded(5);
  for (let i = 0; i < 1600; i++) {
    const v = new THREE.Vector3(sr() - 0.5, sr() * 0.9 + 0.02, sr() - 0.5).normalize().multiplyScalar(300);
    starPos.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false }));
  moon.add(stars);
  // Home, hanging in the sky.
  const planetCanvas = document.createElement('canvas');
  planetCanvas.width = 512;
  planetCanvas.height = 256;
  {
    const ctx = planetCanvas.getContext('2d');
    const img = ctx.createImageData(512, 256);
    for (let py = 0; py < 256; py++) {
      for (let px = 0; px < 512; px++) {
        const u = px / 512, v = py / 256;
        const landN = fbm(u, v * 0.5, 5, 5, 3);
        const cloudN = fbm(u, v * 0.5, 7, 5, 40);
        const lat = Math.abs(v - 0.5) * 2;
        let c = landN > 0.53 ? (landN > 0.62 ? [150, 135, 95] : [70, 128, 70]) : [28, 78, 160];
        if (lat > 0.86) c = [235, 240, 245];
        const cl = Math.max(0, Math.min(1, (cloudN - 0.52) * 6));
        const i = (py * 512 + px) * 4;
        for (let k = 0; k < 3; k++) img.data[i + k] = c[k] + (250 - c[k]) * cl * 0.9;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const planetMap = new THREE.CanvasTexture(planetCanvas);
  planetMap.colorSpace = THREE.SRGBColorSpace;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(26, 48, 32), new THREE.MeshStandardMaterial({ map: planetMap, emissiveMap: planetMap, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.8, fog: false }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(27.2, 48, 32), new THREE.MeshBasicMaterial({ color: 0x6fb4ff, transparent: true, opacity: 0.16, side: THREE.BackSide, fog: false, depthWrite: false }));
  planet.add(halo);
  moon.add(at(planet, -120, 95, -210));
  moon.add(at(makeLander(), LANDER_POS.x, 0, LANDER_POS.z));
  for (let i = 0; i < 30; i++) {
    const a = cr() * Math.PI * 2;
    const d = 9 + cr() * 40;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (MOON_PAD_POS.every((p) => Math.hypot(x - p.x, z - p.z) > 4.6) && Math.hypot(x - LANDER_POS.x, z - LANDER_POS.z) > 5 && Math.hypot(x - STARGATE_POS.x, z - STARGATE_POS.z) > 8) {
      const rock = makeRock(0.4 + cr() * 0.9);
      rock.traverse((o) => { if (o.isMesh) o.material = mat(cr() < 0.5 ? C.moon : C.moonDark, { kind: 'rock' }); });
      moon.add(at(rock, x, moonHeight(x, z, d) + 0.02, z, cr() * 6.28));
    }
  }

  // --- Day and night (the game follows your real clock) ---
  // light: 1 full day, 0 deep night. warm: 0..1, how much sunset colour.
  let daylight = { light: 1, warm: 0 };
  let skyBase = null; // the place's own daytime look, which night is blended from
  const nightStarGeo = new THREE.BufferGeometry();
  {
    const r = seeded(7), pos = [];
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2, y = 0.12 + r() * 0.88, rad = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * rad * 46, y * 46, Math.sin(a) * rad * 46);
    }
    nightStarGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }
  const nightStars = new THREE.Points(nightStarGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  nightStars.renderOrder = 1;
  dome.add(nightStars);
  const NIGHT = { zenith: new THREE.Color(0x0a1230), horizon: new THREE.Color(0x24325e), sun: new THREE.Color(0x9fb4ff), hemi: new THREE.Color(0x6a7fc4), ground: new THREE.Color(0x26324a) };
  const DUSK = { horizon: new THREE.Color(0xffa36a), zenith: new THREE.Color(0x5b5fae), sun: new THREE.Color(0xffa060) };
  const mixc = (a, b, t) => new THREE.Color(a).lerp(b, t);
  function applyDaylight() {
    if (!skyBase) return;
    const { light, warm } = daylight;
    const dark = 1 - light;
    let zenith = mixc(skyBase.zenith, NIGHT.zenith, dark);
    let horizon = mixc(skyBase.horizon, NIGHT.horizon, dark);
    let sunc = mixc(skyBase.sun, NIGHT.sun, dark);
    if (warm > 0) {
      horizon = horizon.lerp(DUSK.horizon, warm * 0.75);
      zenith = zenith.lerp(DUSK.zenith, warm * 0.35);
      sunc = sunc.lerp(DUSK.sun, warm * 0.8);
    }
    skyUniforms.zenith.value.copy(zenith);
    skyUniforms.horizon.value.copy(horizon);
    // At night the sun's glow in the sky becomes a faint moon instead of a blinding disc.
    skyUniforms.sunColor.value.copy(sunc).multiplyScalar(0.18 + 0.82 * light);
    sun.color.copy(sunc);
    // Moonlight: the sun fades to a dim blue key light, never to black.
    sun.intensity = skyBase.sunPower * (0.12 + 0.88 * light);
    hemi.intensity = skyBase.hemiPower * (0.38 + 0.62 * light);
    hemi.color.copy(mixc(skyBase.hemi, NIGHT.hemi, dark));
    hemi.groundColor.copy(mixc(skyBase.ground, NIGHT.ground, dark));
    scene.environmentIntensity = skyBase.env * (0.3 + 0.7 * light);
    if (scene.fog) scene.fog.color.copy(horizon);
    nightStars.material.opacity = Math.max(0, (0.55 - light) / 0.55) * 0.9;
  }
  /** Sets the time of day. light 1 day .. 0 night; warm 0..1 for sunrise and sunset. */
  function setDaylight(light, warm = 0) {
    daylight = { light, warm };
    applyDaylight();
  }

  // --- Switching ---
  let current = 'earth';
  function applySky(era) {
    const sky = SKIES[Math.min(era, 5)];
    skyUniforms.zenith.value.set(sky.zenith);
    skyUniforms.horizon.value.set(sky.horizon);
    skyUniforms.sunColor.value.set(sky.sun);
    skyUniforms.cover.value = sky.cover;
    waterUniforms.haze.value = sky.haze;
    dome.visible = true;
    scene.background = null;
    scene.fog = new THREE.FogExp2(sky.horizon, sky.haze);
    scene.environmentIntensity = 0.85;
    // Cartoon light: a bright sky fill so shadows stay soft and colours stay clean.
    hemi.intensity = 0.84; // a little less fill than before so buildings keep their shape
    hemi.color.set(0xd6ecff);
    hemi.groundColor.set(0x8e9a6a);
    sun.intensity = Math.min(era, 5) === 3 ? 2.75 : 3.1;
    sun.color.set(sky.sun);
    skyBase = { zenith: new THREE.Color(sky.zenith), horizon: new THREE.Color(sky.horizon), sun: new THREE.Color(sky.sun), hemi: new THREE.Color(0xd6ecff), ground: new THREE.Color(0x8e9a6a), sunPower: sun.intensity, hemiPower: 0.84, env: 0.85 };
    applyDaylight();
    bakeEnvironment();
  }
  // A realm is a whole other place (the Wilds, the far planet) with its own ground.
  const realms = new Set();
  function showRealm(group, era, look) {
    if (!realms.has(group)) {
      realms.add(group);
      scene.add(group);
    }
    earth.visible = false;
    moon.visible = false;
    for (const g of realms) g.visible = g === group;
    applySky(era);
    if (look) {
      skyUniforms.zenith.value.set(look.zenith);
      skyUniforms.horizon.value.set(look.horizon);
      skyUniforms.sunColor.value.set(look.sun);
      skyUniforms.cover.value = look.cover;
      hemi.color.set(look.hemi);
      hemi.groundColor.set(look.ground);
      hemi.intensity = look.hemiPower ?? 0.35;
      sun.color.set(look.sun);
      sun.intensity = look.sunPower ?? 3.4;
      scene.environmentIntensity = look.env ?? 0.85;
    }
    scene.fog = new THREE.FogExp2(look ? look.horizon : SKIES[Math.min(era, 5)].horizon, look?.haze ?? 0.0085);
    if (look) { skyBase = null; nightStars.material.opacity = 0; } else applyDaylight();
    bakeEnvironment();
  }
  function setScene(name, era) {
    for (const g of realms) g.visible = false;
    current = name;
    earth.visible = name === 'earth';
    moon.visible = name === 'moon';
    if (name === 'earth') applySky(era);
    else {
      skyBase = null;
      nightStars.material.opacity = 0;
      dome.visible = false;
      scene.background = new THREE.Color(0x020308);
      scene.fog = null;
      scene.environmentIntensity = 0.1;
      hemi.intensity = 0.3;
      hemi.color.set(0x8fa4ff);
      hemi.groundColor.set(0x6a6a78);
      sun.intensity = 4.2;
      sun.color.set(0xffffff);
    }
  }

  function update(dt, time, focus, camera) {
    skyUniforms.time.value = time;
    wind.value = time;
    if (camera) dome.position.copy(camera.position);
    if (gateFlag) gateFlag.rotation.y = Math.sin(time * 3) * 0.25;
    for (const o of animated) {
      if (o.name === 'spin') o.rotation.y += dt * 0.8;
      else if (o.name === 'flame') {
        // Each tongue of flame stretches, sways and leans on its own beat.
        const p = o.userData.phase;
        const lick = Math.sin(time * 9.3 + p) * 0.5 + Math.sin(time * 15.7 + p * 2.1) * 0.5;
        o.scale.set(1 + Math.sin(time * 7 + p) * 0.07, 1 + lick * 0.16, 1 + Math.cos(time * 8 + p) * 0.07);
        o.rotation.z = Math.sin(time * 3.1 + p) * 0.08;
        o.rotation.x = Math.cos(time * 2.7 + p) * 0.07;
        o.rotation.y += dt * 0.6;
      } else if (o.name === 'ember') {
        const t = (time * 0.45 + o.userData.seed) % 1;
        const s = o.userData.seed * 9;
        o.position.set(Math.sin(s + t * 4) * (0.15 + t * 0.5), 0.6 + t * 3.2, Math.cos(s * 1.3 + t * 3) * (0.15 + t * 0.5));
        o.material.opacity = (1 - t) * 0.9;
        o.scale.setScalar(1 - t * 0.6);
      } else if (o.name === 'firelight') o.intensity = 14 + Math.sin(time * 13) * 2.2 + Math.sin(time * 23) * 1.4;
      else o.scale.set(1 + Math.sin(time * 11) * 0.08, 1 + Math.sin(time * 13 + 1) * 0.14, 1 + Math.cos(time * 9) * 0.08);
    }
    // Keep the shadow sharp around the player.
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.copy(sunDir).multiplyScalar(80).add(sun.target.position);
  }

  /** Lighter settings for slow machines: 0 full, 1 less grass and smaller shadows, 2 least. */
  // The country forest is instanced with no culling, so every tree would be
  // drawn into the shadow map each frame: only on high quality.
  function applyTreeShadows() {
    countryTrees?.traverse((o) => { if (o.isMesh) o.castShadow = grassLevel === 0; });
  }
  /** 0 high, 1 medium, 2 low (no shadows, least grass). */
  function setQuality(level) {
    grassLevel = level;
    applyGrassLevel();
    applyTreeShadows();
    sun.castShadow = level < 2;
    const size = [2048, 1024, 512][level];
    const reach = [70, 48, 48][level];
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    sun.shadow.camera.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }

  /** Hides grass blades where covered(x, z) is true (painted paths), and shows the rest again. */
  function trimGrass(covered) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const g of [grass, wildGrass]) {
      if (!g) continue;
      const arr = g.instanceMatrix.array;
      if (!g.userData.orig) g.userData.orig = arr.slice();
      const orig = g.userData.orig;
      for (let i = 0; i < g.userData.full; i++) {
        const o = i * 16;
        if (covered(orig[o + 12], orig[o + 14])) zero.toArray(arr, o);
        else for (let k = 0; k < 16; k++) arr[o + k] = orig[o + k];
      }
      g.instanceMatrix.needsUpdate = true;
    }
  }

  /** A flat colour for the map at a spot, the same one the hills are painted with. */
  function mapColor(x, z) {
    const h = hillHeight(x, z);
    if (h < -0.35) return 0x4f9fc4;
    const stops = land.stops;
    let k = stops.length - 2;
    while (k > 0 && h < stops[k][0]) k -= 1;
    const [h0, a] = stops[k], [h1, b] = stops[k + 1];
    return new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, (h - h0) / (h1 - h0)))).getHex();
  }
  function spinCountry(dt) {
    for (const o of country.spin) o.rotation[o.userData.spin || o.userData.axis || 'z'] += dt * (o.userData.speed ?? 0.9);
  }
  return { earth, moon, landName, trimGrass, setFelled, nearestTree, caches: () => caches, treeSolids: () => (felled.size ? treeSolids.filter((t) => !felled.has(`${t.x.toFixed(1)},${t.z.toFixed(1)}`)) : treeSolids), landmarks: () => country.landmarks, roads: () => country.roads, fields: () => country.fields, mapColor, spinCountry, landIndex: () => landIndex, setEra, setClearings, setScene, showRealm, update, setQuality, setDaylight, get daylight() { return daylight; }, groundHeight: (name, x, z) => (name === 'moon' ? moonHeight(x, z, Math.hypot(x, z)) : hillHeight(x, z)), openGround: (x, z) => Boolean(country) && !country.mask(x, z) && hillHeight(x, z) > 0.15 && Math.abs(hillHeight(x + 2, z) - hillHeight(x, z)) + Math.abs(hillHeight(x, z + 2) - hillHeight(x, z)) < 1.2 };
}

export { EARTH_PADS };
