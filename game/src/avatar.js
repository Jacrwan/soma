// The player: the Barbarian from the KayKit Adventurers pack by Kay Lousberg
// (CC0, public/models/Barbarian.glb). A stylised character built for games,
// with its own idle, run, attack, dodge, jump and hit animations. Loads in the
// background; until then the game shows the built-in figure.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const HEIGHT = 1.95; // metres, to the top of the head
let source = null;
let fit = 1;

const loader = new GLTFLoader();
export const avatarReady = loader.loadAsync('/game/models/Barbarian.glb').then((gltf) => {
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && /Body|Head|Leg/.test(o.name)) box.expandByObject(o); });
  fit = HEIGHT / Math.max(0.5, box.max.y - Math.min(0, box.min.y));
  source = gltf;
  return true;
}).catch((error) => {
  console.warn('Avatar model did not load; using the built-in figure.', error);
  return false;
});

export const hasAvatar = () => Boolean(source);

const SWINGS = ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal'];
const ONCE = [...SWINGS, 'Dodge_Forward', 'Hit_A'];

/**
 * A fresh copy of the model. tint colours the outfit; hat and weapon are
 * ordinary objects (built in metres) that replace the model's own helmet and
 * axe. weaponLook picks which of the model's own axes to hold when no weapon
 * object is given: 0 the hand axe, 1 the great axe.
 */
export function createAvatar({ tint, hat, weapon, weaponLook = 0 }) {
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
  for (const name of ['1H_Axe_Offhand', 'Barbarian_Round_Shield', 'Mug']) if (part(name)) part(name).visible = false;
  const great = !weapon && weaponLook >= 1;
  if (part('1H_Axe')) part('1H_Axe').visible = !weapon && !great;
  if (part('2H_Axe')) part('2H_Axe').visible = great;
  if (part('Barbarian_Hat')) part('Barbarian_Hat').visible = !hat;

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
