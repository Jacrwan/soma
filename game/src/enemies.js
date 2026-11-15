// Enemies as real rigged models with their own walk and run cycles:
// foxes in the Wilds, soldiers raiding the town, robots on the far planet.
// Fox.glb is from the Khronos glTF samples (CC-BY 4.0, PixelMannen / tomkranis);
// Soldier.glb and RobotExpressive.glb are from the three.js examples.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const KINDS = {
  fox: { file: 'Fox.glb', height: 1.15, yaw: 0, idle: 'Survey', walk: 'Walk', run: 'Run' },
  bandit: { file: 'Soldier.glb', height: 1.9, yaw: Math.PI, idle: 'Idle', walk: 'Walk', run: 'Run' },
  robot: { file: 'RobotExpressive.glb', height: 2.2, yaw: 0, idle: 'Idle', walk: 'Walking', run: 'Running', attack: 'Punch', death: 'Death' },
};

const sources = {};
const loader = new GLTFLoader();
export const enemiesReady = Promise.all(Object.entries(KINDS).map(([kind, info]) =>
  loader.loadAsync(`/game/models/${info.file}`).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    sources[kind] = { gltf, fit: info.height / Math.max(0.001, box.max.y - box.min.y), floor: box.min.y };
  }).catch((error) => console.warn(`Enemy model ${info.file} did not load.`, error)),
));

export const hasEnemy = (kind) => Boolean(sources[kind]);

/**
 * A fresh enemy. `object` is what the game moves and turns; the model inside
 * faces the object's +Z. Call update(dt) every frame.
 */
export function createEnemy(kind, { scale = 1, tint = null } = {}) {
  const info = KINDS[kind];
  const source = sources[kind];
  const object = new THREE.Group();
  const model = cloneSkinned(source.gltf.scene);
  model.scale.multiplyScalar(source.fit * scale);
  model.position.y = -source.floor * source.fit * scale;
  model.rotation.y = info.yaw;
  const body = new THREE.Group(); // tips over on death, lunges on a bite
  body.add(model);
  object.add(body);

  const materials = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    o.material = o.material.clone();
    if (tint !== null) o.material.color.multiply(new THREE.Color(tint));
    o.material.emissive = new THREE.Color(0xffffff);
    o.material.emissiveIntensity = 0;
    materials.push(o.material);
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const key of ['idle', 'walk', 'run', 'attack', 'death']) {
    const clip = info[key] && source.gltf.animations.find((a) => a.name === info[key]);
    if (clip) actions[key] = mixer.clipAction(clip);
  }
  for (const key of ['attack', 'death']) {
    if (!actions[key]) continue;
    actions[key].setLoop(THREE.LoopOnce, 1);
    actions[key].clampWhenFinished = true;
  }
  let current = null;
  let flash = 0;
  let lunge = 0;
  let dying = -1;

  function play(name, fade = 0.2) {
    const next = actions[name] || actions.idle;
    if (!next || next === current) return;
    next.reset().fadeIn(fade).play();
    if (current) current.fadeOut(fade);
    current = next;
  }
  play('idle', 0);

  return {
    object,
    kind,
    height: info.height * scale,
    play,
    /** The hit landing: a punch clip where the model has one, a forward lunge where it doesn't. */
    strike() {
      if (actions.attack) play('attack', 0.08);
      else lunge = 1;
    },
    hurt() {
      flash = 1;
    },
    die() {
      dying = 0;
      if (actions.death) play('death', 0.1);
    },
    update(dt, speed = 1) {
      mixer.timeScale = speed;
      mixer.update(dt);
      flash = Math.max(0, flash - dt * 5);
      for (const m of materials) m.emissiveIntensity = flash * 0.9;
      lunge = Math.max(0, lunge - dt * 3.2);
      const k = Math.sin(lunge * Math.PI);
      body.position.z = k * 0.9 * scale;
      body.position.y = k * 0.35 * scale;
      body.rotation.x = -k * 0.35;
      if (dying >= 0) {
        dying += dt;
        if (!actions.death) body.rotation.z = Math.min(1, dying / 0.35) * 1.5;
        if (dying > 0.9) object.position.y -= dt * 1.2;
      }
    },
  };
}
