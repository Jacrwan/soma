// The player as a real rigged human model (public/models/readyplayer.me.glb),
// moving with the idle and run cycles from Soldier.glb. Both files come from the
// three.js examples. Loads in the background; until then the game shows the
// built-in figure.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned, retargetClip } from 'three/addons/utils/SkeletonUtils.js';
import { noiseTexture, noise3 } from './tex.js';

let source = null; // the human model
let clips = null; // { idle, run }, moved over from the motion file

// The human (readyplayer.me.glb) has no animations of its own, and Soldier.glb has
// good idle and run cycles on a different skeleton. Play the soldier's motion and
// copy it, pose by pose, onto the human's bones.
function borrowMotion(human, donor) {
  const target = [];
  human.scene.traverse((o) => { if (o.isSkinnedMesh) target.push(o); });
  human.scene.updateMatrixWorld(true);
  donor.scene.updateMatrixWorld(true);
  const helper = new THREE.SkeletonHelper(donor.scene);
  const skeleton = new THREE.Skeleton(helper.bones);
  // Copying poses leaves the human bent into the last one; remember how it stood.
  const rest = [];
  human.scene.traverse((o) => rest.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const options = { hip: 'mixamorigHips', scale: 0.01, getBoneName: (bone) => `mixamorig${bone.name}` };
  const out = {};
  for (const [key, name] of [['idle', 'Idle'], ['run', 'Run']]) {
    const clip = retargetClip(target[0], skeleton, donor.animations.find((a) => a.name === name), options);
    // Address bones by name so the clip can drive any copy of the model.
    for (const track of clip.tracks) track.name = track.name.replace(/^\.bones\[(.+?)\]/, '$1');
    // Keep the turning of each bone, drop the hip's travel: the two bodies measure it differently.
    clip.tracks = clip.tracks.filter((track) => !track.name.endsWith('.position'));
    out[key] = clip;
  }
  for (const [o, p, q, sc] of rest) {
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(sc);
  }
  human.scene.updateMatrixWorld(true);
  return out;
}

const loader = new GLTFLoader();
export const avatarReady = Promise.all([loader.loadAsync('/game/models/readyplayer.me.glb'), loader.loadAsync('/game/models/Soldier.glb')]).then(([human, donor]) => {
  clips = borrowMotion(human, donor);
  source = human;
  return true;
}).catch((error) => {
  console.warn('Avatar model did not load; using the built-in figure.', error);
  return false;
});

export const hasAvatar = () => Boolean(source);

// --- Stone Age look: the same person in furs and hides ---------------------------------
const furMaps = new Map();
function furMaterial(color, repeat, skinned = false) {
  const key = `${repeat}`;
  if (!furMaps.has(key)) {
    const t = noiseTexture('fur', 256);
    t.repeat.setScalar(repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    furMaps.set(key, t);
  }
  const map = furMaps.get(key);
  return new THREE.MeshStandardMaterial({ color, map, bumpMap: map, bumpScale: skinned ? 4 : 3, roughness: 1, metalness: 0 });
}
/** A shaggy lump of fur: a sphere pushed in and out by noise. */
function furLump(r, color, sx = 1, sy = 1, sz = 1, seed = 1) {
  const g = new THREE.SphereGeometry(r, 16, 12);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3((v.x / r) * 2.2 + seed, (v.y / r) * 2.2 - seed, (v.z / r) * 2.2 + seed * 0.3);
    const fine = noise3((v.x / r) * 7 + seed, (v.y / r) * 7, (v.z / r) * 7);
    v.multiplyScalar(1 + (n - 0.5) * 0.36 + (fine - 0.5) * 0.14);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, furMaterial(color, 3));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const PELT = 0xcfa066, HIDE = 0x8f6846, DARK = 0x5c4435, WOLF = 0xaa9b86, HAIR = 0x2e2019;

/** Swap the suit for a fur coat, hide leggings and fur boots; add a pelt hood, a mantle, a beard and a tooth necklace. */
function dressStoneAge(model) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (/Headwear/.test(o.name)) o.visible = false;
    else if (/Outfit_Top/.test(o.name)) o.material = furMaterial(PELT, 9, true);
    else if (/Outfit_Bottom/.test(o.name)) o.material = furMaterial(HIDE, 14, true);
    else if (/Footwear/.test(o.name)) o.material = furMaterial(DARK, 7, true);
    else if (/Beard/.test(o.name)) o.material = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.9 });
  });
  model.updateMatrixWorld(true);
  // Built standing in the model's own space, then handed to the bone that should carry each piece.
  const wear = (boneName, piece, x, y, z) => {
    const bone = model.getObjectByName(boneName);
    if (!bone) return;
    piece.position.set(x, y, z);
    model.add(piece);
    piece.updateMatrixWorld(true);
    bone.attach(piece);
  };
  // Pelt hood: crown, back of the head, flaps over the ears, two small ears of the animal it was.
  wear('Head', furLump(0.118, WOLF, 1.02, 0.7, 1.12, 1), 0, 1.795, -0.012);
  wear('Head', furLump(0.108, WOLF, 1.05, 1.15, 0.8, 2), 0, 1.72, -0.07);
  for (const x of [-1, 1]) {
    wear('Head', furLump(0.05, WOLF, 0.6, 1.5, 1, 3 + x), x * 0.098, 1.7, -0.005);
    wear('Head', furLump(0.028, WOLF, 0.7, 1.5, 0.5, 6 + x), x * 0.06, 1.875, 0.0);
  }
  // Unkempt hair showing under the hood, and a proper beard.
  for (const x of [-0.05, 0, 0.05]) wear('Head', furLump(0.03, HAIR, 1.1, 0.8, 0.6, 9 + x * 20), x, 1.79, 0.088);
  wear('Head', furLump(0.05, HAIR, 1.25, 1.1, 0.62, 12), 0, 1.632, 0.082);
  for (const x of [-1, 1]) wear('Head', furLump(0.035, HAIR, 0.7, 1.35, 0.8, 14 + x), x * 0.07, 1.665, 0.05);
  // Mantle of thick fur over the shoulders, hiding the collar.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    wear('Spine2', furLump(0.075, i % 3 ? PELT : WOLF, 1.15, 0.8, 1.1, 20 + i), Math.sin(a) * 0.17, 1.5 + Math.cos(a) * 0.012, Math.cos(a) * 0.105 - 0.005);
  }
  // A belt, and a necklace of teeth.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    wear('Hips', furLump(0.04, DARK, 1.3, 0.7, 1, 40 + i), Math.sin(a) * 0.165, 1.03, Math.cos(a) * 0.115);
  }
  const ivory = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.5 });
  for (let i = -3; i <= 3; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.045, 8), ivory);
    tooth.rotation.x = Math.PI;
    tooth.castShadow = true;
    wear('Spine2', tooth, i * 0.026, 1.435 - Math.abs(i) * 0.004 + (i * i) * 0.0045, 0.128 - Math.abs(i) * 0.006);
  }
}

/**
 * A fresh copy of the model. tint colours the clothing; hat and weapon are
 * ordinary objects (built in metres) that get pinned to the head and right hand.
 */
export function createAvatar({ tint, hat, weapon, stoneAge = false }) {
  const model = cloneSkinned(source.scene);
  const root = new THREE.Group();
  root.add(model);
  model.rotation.y = Math.PI;
  model.scale.multiplyScalar(1.08);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    o.material = o.material.clone();
    if (tint && /Outfit_Top/.test(o.name)) o.material.color.lerp(new THREE.Color(tint), 0.6);
    o.material.envMapIntensity = 0.9;
  });
  if (stoneAge) dressStoneAge(model);
  root.updateMatrixWorld(true);
  const bone = (name) => model.getObjectByName(name);
  const head = bone('Head');
  const hand = bone('RightHand');
  const arm = bone('RightArm');
  const foreArm = bone('RightForeArm');
  const spine = bone('Spine1');

  // Bones in this file are measured in centimetres; undo that for anything pinned to one.
  const pin = (to, object, place) => {
    if (!to || !object) return;
    const holder = new THREE.Group();
    const s = new THREE.Vector3();
    to.getWorldScale(s);
    holder.scale.setScalar(1 / s.x);
    place(object);
    holder.add(object);
    to.add(holder);
  };
  pin(head, hat, (o) => { o.position.set(0, 0.17, 0.02); o.scale.multiplyScalar(0.62); });
  pin(hand, weapon, (o) => { o.position.set(0, 0.08, 0.02); o.rotation.set(0, 0, -Math.PI / 2); o.position.x = 0.12; o.scale.multiplyScalar(0.62); });

  const mixer = new THREE.AnimationMixer(model);
  const actions = { idle: mixer.clipAction(clips.idle), run: mixer.clipAction(clips.run) };
  for (const a of Object.values(actions)) {
    a.play();
    a.setEffectiveWeight(0);
  }
  actions.idle.setEffectiveWeight(1);
  const weights = { idle: 1, run: 0 };
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(1, 0, 0);

  root.userData.avatar = {
    /** state: 'idle' | 'walk' | 'run'; pace speeds the legs up; swing 0..1 is an attack in progress. */
    update(dt, state, pace = 1, swing = 0) {
      for (const name of Object.keys(weights)) {
        const want = name === state ? 1 : 0;
        weights[name] += (want - weights[name]) * Math.min(1, dt * 9);
        actions[name].setEffectiveWeight(weights[name]);
      }
      actions.run.setEffectiveTimeScale(pace);
      mixer.update(dt);
      if (swing > 0 && arm) {
        // An overhead chop laid on top of whatever the body is doing.
        const t = Math.sin(swing * Math.PI);
        arm.quaternion.multiply(q.setFromAxisAngle(axis, -1.9 * t));
        if (foreArm) foreArm.quaternion.multiply(q.setFromAxisAngle(axis, -0.5 * t));
        if (spine) spine.quaternion.multiply(q.setFromAxisAngle(axis, 0.25 * t));
      }
    },
  };
  return root;
}
