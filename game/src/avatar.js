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
const PELT = 0xb98a52, DARK = 0x4a3528, HAIR = 0x2a1c14;

const SKIN = new THREE.Color(0xd9976b);

/**
 * Clothing that is fur where `bare` says 0 and skin where it says 1. The suit
 * the model wears is long-sleeved and long-legged; marking the sleeves, one
 * shoulder and the lower legs as skin turns it into a one-shoulder pelt.
 */
function peltMaterial(color, repeat, skin) {
  const material = furMaterial(color, repeat, true);
  material.bumpMap = null;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSkin = { value: skin };
    shader.vertexShader = `attribute float bare;\nvarying float vBare;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBare = bare;');
    shader.fragmentShader = `uniform vec3 uSkin;\nvarying float vBare;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#include <map_fragment>
        float bareSkin = smoothstep(0.42, 0.58, vBare);
        float hem = smoothstep(0.2, 0.42, vBare) * (1.0 - bareSkin);
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - hem * 0.45), uSkin, bareSkin);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.62, bareSkin);');
  };
  return material;
}

/** Marks which parts of a garment are bare skin. test(x, y, z) returns 0 to 1, in the model's standing pose. */
function markBare(mesh, test) {
  const g = mesh.geometry;
  if (g.attributes.bare) return;
  const p = g.attributes.position;
  const bare = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ragged = (noise3(x * 26, y * 26, z * 26) - 0.5) * 0.05;
    bare[i] = Math.max(0, Math.min(1, test(x, y + ragged, z)));
  }
  g.setAttribute('bare', new THREE.BufferAttribute(bare, 1));
}
const ramp = (v, from, to) => (v - from) / (to - from);

/** Stone Age: bare arms and legs, a pelt over one shoulder, fur boots, long hair, a beard and a tooth necklace. */
function dressStoneAge(model) {
  const skin = SKIN;
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (/Headwear/.test(o.name)) o.visible = false;
    else if (/Outfit_Top/.test(o.name)) {
      // Sleeves are skin; so is the right shoulder, above a line that runs from the left collar down to the right ribs.
      markBare(o, (x, y) => Math.max(ramp(Math.abs(x), 0.165, 0.2), x < 0.1 ? ramp(y - (1.3 + (x + 0.18) * 0.72), -0.015, 0.02) : 0));
      o.material = peltMaterial(PELT, 9, skin);
    } else if (/Outfit_Bottom/.test(o.name)) {
      // The pelt ends above the knee.
      markBare(o, (x, y) => ramp(0.62 - y, -0.015, 0.02));
      o.material = peltMaterial(PELT, 9, skin);
    } else if (/Footwear/.test(o.name)) o.material = furMaterial(DARK, 7, true);
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
  // Long, unkempt hair: crown, back of the head, down the neck, and over the ears.
  wear('Head', furLump(0.116, HAIR, 1.0, 0.66, 1.1, 1), 0, 1.795, -0.015);
  wear('Head', furLump(0.108, HAIR, 1.03, 1.2, 0.78, 2), 0, 1.71, -0.072);
  wear('Head', furLump(0.085, HAIR, 1.15, 1.25, 0.6, 5), 0, 1.6, -0.085);
  for (const x of [-1, 1]) wear('Head', furLump(0.05, HAIR, 0.55, 1.7, 0.95, 3 + x), x * 0.098, 1.68, -0.01);
  for (const x of [-0.05, 0, 0.05]) wear('Head', furLump(0.03, HAIR, 1.1, 0.8, 0.6, 9 + x * 20), x, 1.79, 0.088);
  // A full beard.
  wear('Head', furLump(0.05, HAIR, 1.25, 1.1, 0.62, 12), 0, 1.632, 0.082);
  for (const x of [-1, 1]) wear('Head', furLump(0.035, HAIR, 0.7, 1.35, 0.8, 14 + x), x * 0.07, 1.665, 0.05);
  // Thick fur where the pelt sits on the left shoulder, and a ragged hem at the thigh.
  for (let i = 0; i < 5; i++) wear('Spine2', furLump(0.07, PELT, 1.2, 0.8, 1.1, 20 + i), 0.08 + i * 0.03, 1.5 - i * 0.012, (i % 2 ? -0.09 : 0.09) * (1 - i * 0.12));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      wear(side < 0 ? 'RightUpLeg' : 'LeftUpLeg', furLump(0.045, PELT, 1.2, 1.0, 1.1, 30 + i + side), side * 0.095 + Math.sin(a) * 0.095, 0.64, Math.cos(a) * 0.1 + 0.01);
    }
  }
  // A hide belt and a necklace of teeth.
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.022, 8, 28), new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.9 }));
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.74, 1);
  belt.castShadow = true;
  wear('Hips', belt, 0, 1.04, 0.012);
  const ivory = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.5 });
  for (let i = -3; i <= 3; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.045, 8), ivory);
    tooth.rotation.x = Math.PI;
    tooth.castShadow = true;
    wear('Spine2', tooth, i * 0.026, 1.435 - Math.abs(i) * 0.004 + (i * i) * 0.0045, 0.128 - Math.abs(i) * 0.006);
  }
}

/**
 * Turns the lifelike model into a cartoon one, to sit with the stylised world:
 * flat skin instead of a photo texture, big simple eyes and brows, a bigger
 * head, hands and feet, and shorter legs. Returns how much the head and hands grew.
 */
const HEAD_SIZE = 1.36, HAND_SIZE = 1.32, LEG_SIZE = 0.9, FOOT_SIZE = 1.22;
function cartoon(model) {
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.78, metalness: 0 });
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (/Wolf3D_(Head|Body)$/.test(o.name)) o.material = skinMat;
    else if (/^Eye(Left|Right)$/.test(o.name)) o.visible = false;
    else if (o.material.map && /Outfit|Headwear|Hair/.test(o.name)) {
      // Keep the clothes' colours but lose the photographic shine.
      o.material.roughness = 0.9;
      o.material.metalness = 0;
      o.material.normalMap = null;
      o.material.envMapIntensity = 0.3;
    }
  });
  model.updateMatrixWorld(true);
  const head = model.getObjectByName('Head');
  if (head) {
    const put = (piece, x, y, z) => {
      piece.position.set(x, y, z);
      model.add(piece);
      piece.updateMatrixWorld(true);
      head.attach(piece);
    };
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.6 });
    for (const x of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 12), white);
      eye.scale.set(1, 1.15, 0.55);
      put(eye, x * 0.033, 1.732, 0.1);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 12, 10), dark);
      pupil.scale.set(1, 1.1, 0.5);
      put(pupil, x * 0.031, 1.731, 0.111);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.013, 0.016), dark);
      brow.rotation.z = x * -0.22;
      put(brow, x * 0.034, 1.765, 0.102);
    }
  }
  const foot = model.getObjectByName('LeftToeBase') || model.getObjectByName('LeftFoot');
  const before = foot ? foot.getWorldPosition(new THREE.Vector3()).y : 0;
  const grow = (name, k) => model.getObjectByName(name)?.scale.multiplyScalar(k);
  grow('Head', HEAD_SIZE);
  for (const side of ['Left', 'Right']) {
    grow(`${side}Hand`, HAND_SIZE);
    grow(`${side}UpLeg`, LEG_SIZE);
    grow(`${side}Foot`, FOOT_SIZE / LEG_SIZE);
  }
  model.updateMatrixWorld(true);
  // Shorter legs lift the feet; set them back on the ground.
  if (foot) model.position.y -= foot.getWorldPosition(new THREE.Vector3()).y - before;
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
  cartoon(model);
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
  pin(head, hat, (o) => { o.position.set(0, 0.17 * HEAD_SIZE, 0.02 * HEAD_SIZE); o.scale.multiplyScalar(0.62 * HEAD_SIZE); });
  pin(hand, weapon, (o) => { o.position.set(0, 0.09 * HAND_SIZE, 0.03 * HAND_SIZE); o.rotation.set(Math.PI / 2, 0, 0); o.scale.multiplyScalar(0.78); });

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
