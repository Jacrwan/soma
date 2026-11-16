// The player: a hero from the KayKit Adventurers pack by Kay Lousberg (CC0,
// public/models/*.glb). Every hero shares one skeleton and the same idle,
// run, attack, dodge, jump and hit animations, so any of them can be picked.
// The chosen one loads in the background; until then the game shows the
// built-in figure.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const HEIGHT = 1.95; // metres, to the top of the head

// The pack paints every part from one small palette image. Repainting a few of
// its colours gives the hero natural materials: tanned hide instead of blue
// cloth, dark leather straps, a brown beard and warm brown bear fur.
function hsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
function naturalColours(map) {
  const image = map.image;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  // The palette is a grid of swatches, each a soft gradient of one colour.
  // A whole swatch is repainted together, so its gradient stays smooth.
  const COLS = 8, ROWS = 4, cw = canvas.width / COLS, ch = canvas.height / ROWS;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.floor((row + 0.2) * ch); y < (row + 0.8) * ch; y += 6) {
        for (let x = Math.floor((col + 0.15) * cw); x < (col + 0.7) * cw; x += 6) {
          const i = (y * canvas.width + x) * 4;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1;
        }
      }
      r /= n * 255; g /= n * 255; b /= n * 255;
      const [h, s, l] = hsl(r, g, b);
      const warm = r > b + 0.015;
      let paint = null; // (lightness of a pixel) -> its new colour
      if (h > 185 && h < 245 && s > 0.15) paint = (v) => rgb(31, 0.36, v * 0.92 + 0.07); // blue cloth -> tanned hide
      else if (h > 4 && h < 27 && s > 0.3 && l < 0.62) paint = (v) => rgb(20, 0.45, v * 0.72); // orange straps -> dark leather
      else if (warm && s < 0.14 && l > 0.5 && l < 0.74) paint = (v) => rgb(24, 0.44, v * 0.62); // grey beard -> brown
      else if (warm && s < 0.24 && l > 0.24 && l <= 0.5) paint = (v) => rgb(25, 0.3, v * 0.96); // grey-brown fur -> warm bear brown
      if (!paint) continue;
      for (let y = Math.floor(row * ch); y < (row + 1) * ch; y++) {
        for (let x = Math.floor(col * cw); x < (col + 1) * cw; x++) {
          const i = (y * canvas.width + x) * 4;
          const out = paint(hsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)[2]);
          d[i] = out[0] * 255;
          d[i + 1] = out[1] * 255;
          d[i + 2] = out[2] * 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const next = new THREE.CanvasTexture(canvas);
  next.colorSpace = THREE.SRGBColorSpace;
  next.flipY = map.flipY;
  next.wrapS = map.wrapS;
  next.wrapT = map.wrapT;
  next.magFilter = map.magFilter;
  next.minFilter = map.minFilter;
  return next;
}

export const CHARACTERS = [
  { id: 'barbarian', name: 'Barbarian', file: 'Barbarian.glb', weapon: '1H_Axe', great: '2H_Axe', hat: 'Barbarian_Hat', hide: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', 'Mug'], natural: true, noBeard: true, head: { file: 'Knight.glb', mesh: 'Knight_Head', trim: 0.66 } },
  { id: 'rogue', name: 'Ranger', file: 'Rogue.glb', weapon: 'Knife', great: '2H_Crossbow', hide: ['Knife_Offhand', '1H_Crossbow', 'Throwable'] },
  { id: 'hooded', name: 'Hooded ranger', file: 'Rogue_Hooded.glb', weapon: 'Knife', great: '2H_Crossbow', hide: ['Knife_Offhand', '1H_Crossbow', 'Throwable'] },
  { id: 'knight', name: 'Knight', file: 'Knight.glb', weapon: '1H_Sword', great: '2H_Sword', hat: 'Knight_Helmet', hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', 'Round_Shield'] },
  { id: 'mage', name: 'Mage', file: 'Mage.glb', weapon: '1H_Wand', great: '2H_Staff', hat: 'Mage_Hat', hide: ['Spellbook', 'Spellbook_open'] },
];
const byId = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

const loader = new GLTFLoader();
const loaded = new Map(); // id -> Promise<{ char, gltf, fit }>
let current = null; // { char, gltf, fit }

/**
 * Gives a hero another hero's head. Every KayKit hero shares one skeleton, so
 * the donor's head mesh is rebound to this model's bones by name. Used to
 * give the Barbarian (bear hat and all) the Knight's clean, beardless face.
 */
function swapHead(gltf, donor, donorName, ownName, trim = 0) {
  const meshes = (root, name) => {
    const out = [];
    root.getObjectByName(name)?.traverse((o) => { if (o.isSkinnedMesh) out.push(o); });
    return out;
  };
  const from = meshes(donor.scene, donorName);
  const own = meshes(gltf.scene, ownName);
  if (!from.length || !own.length) return;
  const parent = own[0].parent;
  for (const src of from) {
    const bones = src.skeleton.bones.map((b) => gltf.scene.getObjectByName(b.name));
    if (bones.some((b) => !b)) return;
  }
  for (const o of own) o.parent.remove(o);
  for (const src of from) {
    // The bear hat covers the top of the head; trim the borrowed scalp under
    // it so none of it pokes through.
    let geometry = src.geometry;
    if (trim && geometry.index) {
      geometry = geometry.clone();
      geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox;
      const cut = min.y + (max.y - min.y) * trim;
      const pos = geometry.attributes.position;
      const index = geometry.index.array;
      const keep = [];
      for (let t = 0; t < index.length; t += 3) {
        const y = (pos.getY(index[t]) + pos.getY(index[t + 1]) + pos.getY(index[t + 2])) / 3;
        if (y <= cut) keep.push(index[t], index[t + 1], index[t + 2]);
      }
      geometry.setIndex(keep);
    }
    const head = new THREE.SkinnedMesh(geometry, src.material);
    head.name = ownName;
    head.position.copy(src.position);
    head.quaternion.copy(src.quaternion);
    head.scale.copy(src.scale);
    parent.add(head);
    head.updateMatrixWorld(true);
    head.bind(new THREE.Skeleton(src.skeleton.bones.map((b) => gltf.scene.getObjectByName(b.name)), src.skeleton.boneInverses), src.bindMatrix);
  }
}

/** The bear hat's two white fangs hang over the face like tears; drop them. */
function dropFangs(gltf) {
  const hat = gltf.scene.getObjectByName('Barbarian_Hat');
  if (!hat) return;
  hat.traverse((o) => {
    if (!o.isMesh || !o.geometry.index) return;
    const uv = o.geometry.attributes.uv;
    const index = o.geometry.index.array;
    const keep = [];
    for (let t = 0; t < index.length; t += 3) {
      const u = (uv.getX(index[t]) + uv.getX(index[t + 1]) + uv.getX(index[t + 2])) / 3;
      const w = (uv.getY(index[t]) + uv.getY(index[t + 1]) + uv.getY(index[t + 2])) / 3;
      if (u >= 0.25 && u < 0.375 && w >= 0.25 && w < 0.5) continue;
      keep.push(index[t], index[t + 1], index[t + 2]);
    }
    o.geometry.setIndex(keep);
  });
}

function load(char) {
  if (!loaded.has(char.id)) {
    loaded.set(char.id, loader.loadAsync(`/game/models/${char.file}`).then(async (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      gltf.scene.traverse((o) => { if (o.isSkinnedMesh && /Body|Head|Leg/.test(o.name)) box.expandByObject(o); });
      const fit = HEIGHT / Math.max(0.5, box.max.y - Math.min(0, box.min.y));
      if (char.noBeard) dropFangs(gltf);
      if (char.natural) {
        const repainted = new Map();
        gltf.scene.traverse((o) => {
          if (!o.isMesh || !o.material.map?.image) return;
          // Parts share one material; repaint its texture once, not once per part.
          if (!repainted.has(o.material.map)) repainted.set(o.material.map, naturalColours(o.material.map));
          o.material.map = repainted.get(o.material.map);
        });
      }
      // Repainted first, so the borrowed head keeps its own colours.
      if (char.head) swapHead(gltf, await loader.loadAsync(`/game/models/${char.head.file}`), char.head.mesh, `${char.name}_Head`, char.head.trim);
      return { char, gltf, fit };
    }));
  }
  return loaded.get(char.id);
}

/** Switches the hero to a character (by id). Resolves true once it can be drawn. */
export function useCharacter(id) {
  const char = byId(id);
  return load(char).then((entry) => {
    if (byId(id) === char) current = entry;
    return true;
  }).catch((error) => {
    console.warn('Avatar model did not load; using the built-in figure.', error);
    return false;
  });
}

export const hasAvatar = () => Boolean(current);
export const characterId = () => current?.char.id || null;

const SWINGS = ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal'];
const ONCE = [...SWINGS, 'Dodge_Forward', 'Hit_A'];

/**
 * A fresh copy of the model. tint colours the outfit; hat and weapon are
 * ordinary objects (built in metres) that replace the model's own helmet and
 * axe. weaponLook picks which of the model's own axes to hold when no weapon
 * object is given: 0 the hand axe, 1 the great axe.
 */
export function createAvatar({ tint, hat, weapon, weaponLook = 0 }) {
  const { char, gltf: source, fit } = current;
  const model = cloneSkinned(source.scene);
  const root = new THREE.Group();
  root.add(model);
  model.scale.setScalar(fit);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    o.material = o.material.clone();
    o.material.roughness = 0.85;
    o.material.metalness = 0;
    if (tint) o.material.color.lerp(new THREE.Color(tint), 0.3);
  });
  const part = (name) => model.getObjectByName(name);
  for (const name of char.hide) if (part(name)) part(name).visible = false;
  const great = !weapon && weaponLook >= 1;
  if (part(char.weapon)) part(char.weapon).visible = !weapon && !great;
  if (part(char.great)) part(char.great).visible = great;
  if (char.hat && part(char.hat)) part(char.hat).visible = !hat;



  // Anything pinned to a bone is built in metres; undo the model's own scale.
  const pin = (to, object, place) => {
    if (!to || !object) return;
    const holder = new THREE.Group();
    holder.scale.setScalar(1 / fit);
    place(object);
    holder.add(object);
    to.add(holder);
  };
  pin(part('head'), hat, (o) => { o.position.set(0, 0.62, 0); o.scale.multiplyScalar(1.5); });
  pin(part('handslot.r'), weapon, (o) => { o.rotation.set(0, 0, 0); o.scale.multiplyScalar(1.25); });

  const mixer = new THREE.AnimationMixer(model);
  const clip = (name) => source.animations.find((a) => a.name === name);
  const actions = {};
  for (const name of ['Idle', 'Running_A', 'Jump_Idle', ...ONCE]) {
    const c = clip(name);
    if (!c) continue;
    actions[name] = mixer.clipAction(c);
    if (ONCE.includes(name)) {
      actions[name].setLoop(THREE.LoopOnce, 1);
      actions[name].clampWhenFinished = false;
    }
  }
  let base = null; // the looping action underneath
  let shot = null; // a one-off on top: a swing, a dodge, a flinch
  let lastSwing = 0;
  let swings = 0;
  let wasDodging = false;
  function loop(name) {
    const next = actions[name];
    if (!next || next === base) return;
    next.reset().fadeIn(0.14).play();
    if (base) base.fadeOut(0.14);
    base = next;
  }
  function once(name, speed = 1) {
    const next = actions[name];
    if (!next) return;
    if (shot && shot !== next) shot.fadeOut(0.08);
    next.reset().setEffectiveTimeScale(speed).fadeIn(0.06).play();
    shot = next;
  }
  mixer.addEventListener('finished', (event) => {
    if (event.action !== shot) return;
    shot.fadeOut(0.12);
    shot = null;
  });
  loop('Idle');

  root.userData.avatar = {
    /**
     * state: 'idle' | 'run'; pace speeds the legs up; swing 0..1 is an attack in
     * progress (it jumps to 1 when one starts); flags: { dodge, air, hurt }.
     */
    update(dt, state, pace = 1, swing = 0, flags = {}) {
      loop(flags.air ? 'Jump_Idle' : state === 'run' ? 'Running_A' : 'Idle');
      if (actions.Running_A) actions.Running_A.setEffectiveTimeScale(pace * 0.85);
      if (swing > lastSwing + 0.3) once(SWINGS[swings++ % SWINGS.length], 1.9);
      lastSwing = swing;
      if (flags.dodge && !wasDodging) once('Dodge_Forward', 1.6);
      wasDodging = Boolean(flags.dodge);
      if (flags.hurt) once('Hit_A', 1.4);
      mixer.update(dt);
    },
  };
  return root;
}

/**
 * A villager: any hero model without weapons or hats-for-battle, with walk,
 * idle, sit and cheer. Resolves to an object whose userData.villager.update
 * takes (dt, mode) where mode is 'idle' | 'walk' | 'sit' | 'cheer'.
 */
export function createVillager(lookId, { tint = null, scale = 0.88 } = {}) {
  const char = byId(lookId);
  return load(char).then(({ gltf, fit }) => {
    const model = cloneSkinned(gltf.scene);
    const root = new THREE.Group();
    root.add(model);
    model.scale.setScalar(fit * scale);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      o.material = o.material.clone();
      o.material.roughness = 0.85;
      o.material.metalness = 0;
      if (tint) o.material.color.lerp(new THREE.Color(tint), 0.35);
    });
    for (const name of [...char.hide, char.weapon, char.great]) {
      const part = model.getObjectByName(name);
      if (part) part.visible = false;
    }
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    const clips = { idle: 'Unarmed_Idle', walk: 'Walking_A', sit: 'Sit_Floor_Idle', cheer: 'Cheer' };
    for (const [mode, name] of Object.entries(clips)) {
      const clip = gltf.animations.find((a) => a.name === name) || gltf.animations.find((a) => a.name === 'Idle');
      if (clip) actions[mode] = mixer.clipAction(clip);
    }
    let now = null;
    // Start each villager at a different point in its loop so a crowd doesn't move in lockstep.
    mixer.setTime(Math.random() * 3);
    root.userData.villager = {
      update(dt, mode = 'idle') {
        const next = actions[mode] || actions.idle;
        if (next && next !== now) {
          next.reset().fadeIn(0.25).play();
          if (now) now.fadeOut(0.25);
          now = next;
        }
        mixer.update(dt);
      },
    };
    return root;
  });
}
