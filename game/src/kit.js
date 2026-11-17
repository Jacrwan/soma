// Buildings and props from the KayKit Medieval Hexagon pack by Kay Lousberg
// (CC0, public/models/kit, see public/models/CREDITS.md). Same artist and the
// same texture atlas as the hero and the trees, so the town reads as one style.
//
// Every piece is a single mesh on one shared atlas material: one draw call
// (plus its shadow) however detailed the model is.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODELS } from './paths.js';

const FILES = {
  market: 'buildings/red/building_market_red',
  castle: 'buildings/yellow/building_castle_yellow',
  scaffolding: 'buildings/neutral/building_scaffolding',
  barrel: 'decoration/props/barrel',
  crate: 'decoration/props/crate_A_big',
  crateSmall: 'decoration/props/crate_B_small',
  crateLong: 'decoration/props/crate_long_A',
  sack: 'decoration/props/sack',
  wheelbarrow: 'decoration/props/wheelbarrow',
  lumber: 'decoration/props/resource_lumber',
  flagRed: 'decoration/props/flag_red',
  flagYellow: 'decoration/props/flag_yellow',
  fence: 'buildings/neutral/fence_wood_straight',
};
// Coloured buildings come in four roof colours.
export const KIT_COLORS = ['blue', 'red', 'green', 'yellow'];
for (const c of KIT_COLORS) {
  for (const b of ['home_A', 'home_B', 'church', 'tower_A', 'blacksmith', 'tavern']) FILES[`${b}:${c}`] = `buildings/${c}/building_${b}_${c}`;
}

const pieces = new Map(); // name -> { geometry, size }
let material = null;
let ready = false;
const waiting = [];

const loader = new GLTFLoader();
export const kitReady = Promise.all(Object.entries(FILES).map(([name, file]) => loader.loadAsync(`${MODELS}/kit/${file}.gltf`).then((gltf) => {
  gltf.scene.updateMatrixWorld(true);
  const geos = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!material) {
      material = o.material;
      // Matte, like the trees: the atlas is painted, so no shine.
      material.metalness = 0;
      material.roughness = 1;
    }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  const geometry = geos.length === 1 ? geos[0] : mergeAll(geos);
  geometry.computeBoundingBox();
  pieces.set(name, { geometry, size: geometry.boundingBox.getSize(new THREE.Vector3()) });
}))).then(() => {
  ready = true;
  for (const fn of waiting.splice(0)) fn();
  return true;
}).catch((error) => {
  console.warn('Town models did not load; keeping the simple ones.', error);
  return false;
});

function mergeAll(geos) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'uv']) {
    const size = key === 'uv' ? 2 : 3;
    const arr = new Float32Array(count * size);
    let at = 0;
    for (const g of geos) {
      const a = g.attributes[key];
      if (a) arr.set(a.array.subarray(0, a.count * size), at);
      at += g.attributes.position.count * size;
    }
    out.setAttribute(key, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

export const kitLoaded = () => ready;

/** Runs fn now if the models are in, otherwise as soon as they are. */
export function whenKit(fn) {
  if (ready) fn();
  else waiting.push(fn);
}

/**
 * One piece as a mesh, scaled by `scale` (the pack is about 2 units per hex),
 * standing on y = 0, centred on x/z unless `keepCentre`.
 */
export function kitMesh(name, scale = 1, { shadow = true } = {}) {
  const p = pieces.get(name);
  if (!p) return null;
  const m = new THREE.Mesh(p.geometry, material);
  m.name = 'kit';
  m.scale.setScalar(scale);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export const kitSize = (name) => pieces.get(name)?.size;

/** The roof colour closest to a hex colour (class halls pick theirs this way). */
export function nearestKitColor(hex) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  const h = hsl.h * 360;
  if (hsl.s < 0.25) return 'blue';
  if (h < 20 || h >= 330) return 'red';
  if (h < 70) return 'yellow';
  if (h < 190) return 'green';
  return 'blue';
}

/**
 * Swaps a model's simple placeholder for the pack's version once it has loaded.
 * `build(group)` fills the group with the new pieces; children marked
 * userData.keep (things the game holds on to, like a spinning lock) stay.
 */
export function upgradeWhenReady(group, build) {
  whenKit(() => {
    for (const child of [...group.children]) if (!child.userData.keep) group.remove(child);
    build(group);
  });
  return group;
}
