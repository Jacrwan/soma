// The two places you can stand: the island and the moon. Builds the ground,
// water, sky, light, roads and scenery, and knows where everything goes.

import * as THREE from 'three';
import { C, mat, at, makeRock, makeTownCenter, makeGate, makeLander } from './art.js';
import { noiseTexture, rippleNormals, fbm, noise3 } from './tex.js';
import { createForest, createGrass, createClouds, wind } from './nature.js';
import { EARTH_PADS, MOON_PADS } from './sim.js';

export const ISLAND_RADIUS = 43; // how far you can walk
export const MOON_RADIUS = 33;
export const GATE = new THREE.Vector3(0, 0, 28);
export const PATH_START_Z = 44.5; // where invaders land
export const PATH_END_Z = 31; // where they stop, in front of the gate
export const ARENA = { x: 0, z: 37, r: 8.5 };
export const BOSS_SPOT = new THREE.Vector3(-6.5, 0, 37);
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
export function hillHeight(x, z, r = Math.hypot(x, z)) {
  if (r < 45) return 0;
  const open = passOpen(x, z, r);
  const rise = ((r - 45) / 12) ** 1.55 * 4.4 * (0.75 + 0.45 * noise2(x * 0.35, z * 0.35));
  return Math.min(74, rise * (0.05 + 0.95 * open * open));
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

const MAP_SPAN = 104; // metres the painted ground map covers
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
    float edge = r - 45.6 - sin(time * 0.7 + atan(p.y, p.x) * 5.0) * 0.35;
    float wash = (1.0 - smoothstep(0.0, 1.6, edge)) * smoothstep(-1.8, 0.2, edge);
    float bands = smoothstep(0.72, 0.98, sin(edge * 1.9 - time * 1.1 + chop * 2.5) * 0.5 + 0.5) * (1.0 - smoothstep(1.0, 7.0, edge)) * step(0.0, edge);
    float foam = clamp(wash * (0.55 + chop) + bands * 0.55, 0.0, 1.0);
    col = mix(col, vec3(1.0), foam * 0.85);
    float alpha = clamp(mix(0.45, 0.97, smoothstep(44.5, 54.0, r)) + fres * 0.4 + foam, 0.0, 1.0);
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
  Object.assign(sun.shadow.camera, { left: -52, right: 52, top: 52, bottom: -52, near: 1, far: 170 });
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
  const island = ground(MAP_SPAN, 104, hillHeight, groundMaterial(mapTexture, grain, 70, 0.25, 0.18), MAP_SPAN);
  earth.add(island);

  // The hills and mountains around the valley, coloured by height.
  {
    const half = MAP_SPAN / 2;
    const g = new THREE.PlaneGeometry(560, 560, 140, 140);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const stops = [[0, 0x84bd52], [7, 0x72b048], [22, 0x5c9a40], [32, 0x8f949a], [48, 0xa9aeb4], [58, 0xf4f6f8]];
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
    earth.add(hills);
  }

  const waterUniforms = {
    ripples: { value: rippleNormals(256) }, time: skyUniforms.time, haze: { value: 0.006 },
    zenith: skyUniforms.zenith, horizon: skyUniforms.horizon, sunDir: skyUniforms.sunDir, sunColor: skyUniforms.sunColor,
    deep: { value: new THREE.Color(0x0d4f6e) }, shallow: { value: new THREE.Color(0x3fc4c0) },
  };
  const water = new THREE.Mesh(new THREE.CircleGeometry(900, 72), new THREE.ShaderMaterial({ uniforms: waterUniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.5;
  water.renderOrder = 2;
  water.visible = false; // the valley has no sea

  earth.add(createClouds(16, 404, 60, 190, 34, 62));

  // Far-off peaks, so the horizon isn't empty.
  const far = seeded(314);
  const islandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * 6.28 + far() * 0.3;
    const d = 300 + far() * 160;
    const size = 80 + far() * 90;
    const g = new THREE.SphereGeometry(size, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const tall = 0.7 + far() * 0.6;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = noise3(x * 0.07 + i * 9, y * 0.07, z * 0.07);
      const ny = y * tall * (0.55 + n * 0.9);
      p.setXYZ(k, x * (0.8 + n * 0.4), ny - 1, z * (0.8 + n * 0.4));
      const t = ny / (size * tall);
      c.set(0x5c9a40).lerp(new THREE.Color(0x9aa0a6), Math.max(0, Math.min(1, t * 2.4 - 0.3 + (n - 0.5))));
      if (t + (n - 0.5) * 0.3 > 0.62) c.set(0xf4f6f8);
      c.toArray(colors, k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, islandMat);
    m.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    earth.add(m);
  }

  // Woods on the slopes around the valley. They never change, so they are placed once.
  {
    const r = seeded(77);
    const slopes = createForest();
    const list = [];
    for (let tries = 0; tries < 6000 && list.length < 780; tries++) {
      const a = r() * 6.28, d = 46.5 + r() * r() * 95;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = hillHeight(x, z, d);
      if (y > 34 || passOpen(x, z, d) < 0.25) continue;
      list.push({ x, y: y - 0.3, z, kind: r() < 0.5 ? 0 : 1, scale: 1.1 + r() * 1.3, turn: r() * 6.28 });
    }
    slopes.place(list);
    earth.add(slopes.object);
  }

  function onRoad(x, z, pad = 0) {
    const r = Math.hypot(x, z);
    if (r < 7 + pad) return true;
    if (Math.abs(r - 9.5) < 0.65 + pad || Math.abs(r - 19) < 0.65 + pad) return true;
    if (Math.abs(x) < 1.7 + pad && z > 5 && z < 45) return true;
    if (r > 9.5 && r < 19) {
      const a = (((Math.atan2(z, x) * 180) / Math.PI - 30) % 60 + 60) % 60;
      const off = Math.min(a, 60 - a);
      if (Math.sin(rad(off)) * r < 0.8 + pad) return true;
    }
    return false;
  }
  function blocked(x, z) {
    const r = Math.hypot(x, z);
    if (r < 8.5 || r > 42.5) return true;
    if (Math.abs(r - 9.5) < 1.4 || Math.abs(r - 19) < 1.4) return true;
    if (Math.abs(x) < 3.2 && z > 5) return true;
    if (Math.abs(x) < 11 && z > 28) return true;
    if (Math.hypot(x - DOCK_POS.x, z - DOCK_POS.z) < 6.5) return true;
    for (const p of EARTH_PAD_POS) if (Math.hypot(x - p.x, z - p.z) < 4.6) return true;
    for (const p of WONDER_POS.slice(0, 6)) if (Math.hypot(x - p.x, z - p.z) < 7.4) return true;
    return false;
  }
  function grassAllowed(x, z) {
    const r = Math.hypot(x, z);
    if (r > 41 || onRoad(x, z, 0.25)) return false;
    if (Math.abs(x) < 9 && z > 29.5) return false;
    for (const p of EARTH_PAD_POS) if (Math.hypot(x - p.x, z - p.z) < 3.3) return false;
    for (const p of WONDER_POS.slice(0, 6)) if (Math.hypot(x - p.x, z - p.z) < 5.2) return false;
    return true;
  }
  const grass = createGrass(52000, 41, grassAllowed);
  earth.add(grass);
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
    ctx.fillStyle = '#84bd52';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    const sands = [stamp(0x7db54c), stamp(0x8ac459), stamp(0x79b04a)];
    for (let i = 0; i < 900; i++) {
      const a = r() * 6.28, d = 39 + r() * 13;
      dab(sands[i % 3], Math.cos(a) * d, Math.sin(a) * d, 0.6 + r() * 2.2, 0.25);
    }
    // Grass, fading into the beach.
    ctx.globalAlpha = 1;
    const fade = ctx.createRadialGradient(X(0), X(0), 39.6 * s, X(0), X(0), 42.6 * s);
    fade.addColorStop(0, css(0x84bd52, 1));
    fade.addColorStop(1, css(0x84bd52, 0));
    ctx.fillStyle = fade;
    ctx.beginPath();
    ctx.arc(X(0), X(0), 43 * s, 0, 6.3);
    ctx.fill();
    // Cartoon grass: one clean green with a few big, soft patches.
    const greens = [0x7db54c, 0x8ac459, 0x8fc95e, 0x79b04a].map(stamp);
    for (let i = 0; i < 700; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * 41;
      dab(greens[Math.floor(r() * greens.length)], Math.cos(a) * d, Math.sin(a) * d, 2 + r() * 5, 0.12 + r() * 0.12);
    }
    const tufts = [stamp(0x8fb257), stamp(0x4c7634)];
    for (let i = 0; i < 0; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * 40.5;
      dab(tufts[i % 2], Math.cos(a) * d, Math.sin(a) * d, 0.12 + r() * 0.25, 0.3);
    }
    // Worn earth where things stand and where the fight happens.
    const worn = stamp(0xc9a46e);
    for (const p of EARTH_PAD_POS) dab(worn, p.x, p.z, 4.6, 0.75);
    for (const p of WONDER_POS.slice(0, 6)) dab(worn, p.x, p.z, 6.6, 0.6);
    dab(worn, ARENA.x, ARENA.z, 10.5, 0.75);
    // Shade under the trees.
    const shade = stamp(0x5f9640);
    for (const t of trees) dab(shade, t.x, t.z, 1.6 * t.scale, 0.35);

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
      ctx.lineTo(X(0), X(52));
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
      const a = r() * 6.28, d = Math.sqrt(r()) * 45;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!onRoad(x, z, soft ? 0.25 : -0.12)) continue;
      const size = road.kind === 'cobble' ? 0.14 + r() * 0.07 : road.kind === 'asphalt' ? 0.05 + r() * 0.3 : 0.06 + r() * 0.45;
      dab(specks[Math.floor(r() * specks.length)], x, z, size, road.kind === 'cobble' ? 0.85 : soft ? 0.22 : 0.35);
    }
    if (soft) {
      // Ragged edges: grass creeping back over the dirt.
      for (let i = 0; i < 16000; i++) {
        const a = r() * 6.28, d = Math.sqrt(r()) * 45;
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
      ctx.lineTo(X(0), X(27));
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

  function setEra(era) {
    const e = Math.min(era, 5);
    eraParts.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    eraParts.clear();

    townCenter = makeTownCenter(era);
    eraParts.add(townCenter);
    animated = [];
    townCenter.traverse((o) => { if (o.name === 'spin' || o.name === 'flicker') animated.push(o); });
    const gate = at(makeGate(era), GATE.x, 0, GATE.z);
    gateFlag = gate.getObjectByName('flag');
    eraParts.add(gate);

    const r = seeded(42);
    const trees = [];
    for (let tries = 0; tries < 900 && trees.length < TREES[e]; tries++) {
      const a = r() * Math.PI * 2;
      const d = 8 + Math.sqrt(r()) * 35;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const kind = r() < 0.55 ? 0 : 1;
      const scale = 0.85 + r() * 0.7;
      const turn = r() * 6.28;
      if (blocked(x, z)) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.6)) continue;
      trees.push({ x, z, kind, scale, turn });
    }
    forest.place(trees);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = 10 + r() * 33;
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
    hemi.intensity = 0.95;
    hemi.color.set(0xd6ecff);
    hemi.groundColor.set(0x7fa85a);
    sun.intensity = Math.min(era, 5) === 3 ? 2.6 : 2.9;
    sun.color.set(sky.sun);
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
    bakeEnvironment();
  }
  function setScene(name, era) {
    for (const g of realms) g.visible = false;
    current = name;
    earth.visible = name === 'earth';
    moon.visible = name === 'moon';
    if (name === 'earth') applySky(era);
    else {
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
      else o.scale.set(1 + Math.sin(time * 11) * 0.08, 1 + Math.sin(time * 13 + 1) * 0.14, 1 + Math.cos(time * 9) * 0.08);
    }
    // Keep the shadow sharp around the player.
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.copy(sunDir).multiplyScalar(80).add(sun.target.position);
  }

  /** Lighter settings for slow machines: 0 full, 1 less grass and smaller shadows, 2 least. */
  function setQuality(level) {
    grass.count = Math.floor(grass.userData.full * [1, 0.55, 0.25][level]);
    const size = [2048, 1024, 1024][level];
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }

  return { earth, moon, setEra, setScene, showRealm, update, setQuality, groundHeight: (name, x, z) => (name === 'moon' ? moonHeight(x, z, Math.hypot(x, z)) : hillHeight(x, z)) };
}

export { EARTH_PADS };
