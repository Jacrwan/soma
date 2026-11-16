// Epoch: the playable game. Reads and changes the state through sim.js, and
// shows it with the models from art.js in the world from world.js.

import * as THREE from 'three';
import * as S from './sim.js';
import * as A from './art.js';
import * as W from './world.js';
import { createUI, timeLeft } from './ui.js';
import { createFx, createAudio } from './fx.js';
import { useCharacter, hasAvatar, createAvatar, createVillager, previewAvatar, CHARACTERS } from './avatar.js';
import { createRealms } from './realm.js';
import { makePractice } from './practice.js';
import * as Soma from './soma.js';
import { focusView } from './nature.js';
import { enemiesReady, hasEnemy, createEnemy } from './enemies.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- State ----------------------------------------------------------------------
// Inside Soma the save belongs to the signed-in student, so two accounts in
// one browser never share a hero. Signed out, it is a guest save.
function somaUserId() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      const id = JSON.parse(localStorage.getItem(key))?.user?.id;
      if (typeof id === 'string') return id;
    }
  } catch { /* storage blocked: play as a guest */ }
  return null;
}
const SOMA_USER = somaUserId();
const SAVE_KEY = SOMA_USER ? `${S.SAVE_KEY}:${SOMA_USER}` : S.SAVE_KEY;
let state;
try {
  const saved = localStorage.getItem(SAVE_KEY);
  state = saved ? S.deserialize(saved) : S.newState();
} catch {
  state = S.newState();
}
const save = () => {
  try {
    localStorage.setItem(SAVE_KEY, S.serialize(state));
  } catch { /* private window or full storage: the game still runs */ }
};
const awayMs = Date.now() - state.lastTick;
const awayEarned = S.tick(state);

// --- Renderer, camera, world ------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Neutral keeps the cartoon colours as painted; ACES would mute them.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 900);
const world = W.createWorld(scene, renderer);
const fx = createFx(scene, camera);
const audio = createAudio(() => state.settings);

// Finishing: soft glow on bright things, a slight vignette and warmth, then tone mapping.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.7, 0.92);
composer.addPass(bloom);
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.08);
      c.rgb *= vec3(1.03, 1.0, 0.97);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * 0.55;
      gl_FragColor = c;
    }`,
}));
composer.addPass(new OutputPass());

function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// If frames run slow for a few seconds, step the detail down (never back up, to avoid flapping).
let quality = 0;
const pace = { time: 0, frames: 0, slow: 0, warm: 8 };
function watchPace(dt) {
  if (state.settings.quality !== 'auto') return; // the player picked a level in Settings
  if (pace.warm > 0) { pace.warm -= dt; return; } // loading hitches don't count
  if (dt > 0.25 || document.visibilityState !== 'visible') { pace.time = 0; pace.frames = 0; return; }
  pace.time += dt;
  pace.frames += 1;
  if (pace.time < 4) return;
  const fps = pace.frames / pace.time;
  pace.time = 0;
  pace.frames = 0;
  pace.slow = fps < 36 ? pace.slow + 1 : 0;
  if (pace.slow >= 2 && quality < 2) { pace.slow = 0; setQuality(quality + 1); }
}
function setQuality(level) {
  quality = level;
  pixelRatio = level === 0 ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 1.3);
  bloom.enabled = level < 2;
  world.setQuality(level);
  resize();
}

const root = () => (state.scene === 'moon' ? world.moon : world.earth);
const eraName = (era = state.era) => S.ERAS[Math.min(era, S.ERAS.length - 1)].name;

// --- Player ----------------------------------------------------------------------
const player = { object: new THREE.Group(), model: null, vy: 0, grounded: true, facing: Math.PI, swing: 0, cooldown: 0, walk: 0, stun: 0, hp: 100, hurtAt: -99, safe: 0, dash: 0, dashCd: 0, dashX: 0, dashZ: 0, slamCd: 0, combo: 0, comboAt: -9, down: false };
scene.add(player.object);
function dressPlayer() {
  if (player.model) player.object.remove(player.model);
  const hat = state.scene === 'moon' ? 'hat:astro' : state.cosmetics.hat;
  if (hasAvatar()) {
    const tint = state.cosmetics.color === 'color:clay' ? null : A.SKIN_COLORS[state.cosmetics.color];
    // The hero keeps the model's own axes until a blade from the later ages is equipped.
    const look = state.hero.gear.weapon ? state.hero.gear.weapon.look : 0;
    player.model = createAvatar({ tint, hat: hat === 'hat:none' ? null : A.makeHat(hat), weapon: look >= 3 ? A.makeWeapon(look) : null, weaponLook: look >= 2 ? 1 : 0 });
  } else player.model = A.makeCharacter(state.cosmetics.color, hat);
  player.object.add(player.model);
}
/** The model the hero wears: an outfit (e.g. Frost Knight) or the picked character. */
function heroLook() {
  const outfit = S.OUTFITS[state.cosmetics.outfit];
  return outfit ? { id: outfit.base, palette: outfit.palette } : { id: state.cosmetics.character, palette: null };
}
function wearLook() {
  const look = heroLook();
  return useCharacter(look.id, look.palette).then((ok) => { if (ok) dressPlayer(); return ok; });
}
wearLook();
function pickCharacter(id) {
  state.cosmetics.character = id;
  state.cosmetics.outfit = null;
  save();
  useCharacter(id).then((ok) => { if (ok && state.cosmetics.character === id) { dressPlayer(); fx.burst(player.object.position.clone().add(new THREE.Vector3(0, 1, 0)), A.C.gold, 18, 5, 5); } });
}
const CAM_MIN = 4.5;
const CAM_MAX = 60;
const cam = { yaw: 0.6, pitch: 0.62, dist: 26, want: 26, idle: 0 };

// --- Town: pads, buildings, wonders --------------------------------------------------
const pads = { earth: [], moon: [] };
const wonderObjects = new Map(); // wonder index -> { object, built }
let spinners = [];

function heightOf(object) {
  return new THREE.Box3().setFromObject(object).max.y - object.getWorldPosition(new THREE.Vector3()).y;
}

function refreshPad(sceneName, i) {
  const parent = sceneName === 'moon' ? world.moon : world.earth;
  let pad = pads[sceneName][i];
  if (!pad) {
    const group = new THREE.Group();
    parent.add(group);
    pad = pads[sceneName][i] = { group, slab: null, marker: null, building: null, bubble: null, top: 3 };
  }
  // A building placed by hand stands where it was put; otherwise on its fixed spot.
  const custom = state.padSpots?.[sceneName]?.[i];
  const spot = custom || W.padPosition(sceneName, i);
  const b = state.pads[sceneName][i];
  const unlocked = i < S.padsUnlocked(state, sceneName) && Boolean(spot) && (Boolean(b) || !custom);
  pad.group.clear();
  pad.building = pad.marker = pad.bubble = null;
  pad.group.visible = unlocked;
  if (!unlocked) return;
  pad.group.position.set(spot.x, world.groundHeight(sceneName, spot.x, spot.z), spot.z);
  pad.slab = A.makePad(b ? b.tier : S.tierFor(state, sceneName));
  pad.group.add(pad.slab);
  if (!b) {
    pad.marker = A.makePadMarker();
    pad.group.add(pad.marker);
    return;
  }
  pad.building = A.makeBuilding(b.type, b.tier, b.level, b.golden);
  pad.building.position.y = 0.12;
  // Face the plaza, or the way it was turned when placed.
  pad.building.rotation.y = custom ? custom.rot : Math.atan2(-pad.group.position.x, -pad.group.position.z);
  pad.group.add(pad.building);
  pad.top = heightOf(pad.building) + 0.6;
  pad.bubble = A.makeCoinBubble();
  pad.bubble.visible = false;
  pad.group.add(pad.bubble);
  spinners = spinners.filter((o) => o.parent);
  pad.building.traverse((o) => { if (o.name === 'spin') spinners.push(o); });
}

function refreshAllPads() {
  for (let i = 0; i < S.EARTH_PADS; i++) refreshPad('earth', i);
  world.setClearings(Object.values(state.padSpots?.earth || {}));
  for (let i = 0; i < S.MOON_PADS; i++) refreshPad('moon', i);
}

function refreshWonders() {
  for (const entry of wonderObjects.values()) entry.object.parent?.remove(entry.object);
  wonderObjects.clear();
  const next = S.nextWonder(state);
  for (let index = 0; index <= 6; index++) {
    const built = state.wonders.includes(index);
    const isNext = next && next.index === index;
    if (!built && !isNext) continue;
    // Each age is a new land, so an old age's wonder stays behind in its own
    // land. Only the rocket stays, to fly from, and the Star Gate on the Moon.
    if (built && index < 5) continue;
    const parent = index === 6 ? world.moon : world.earth;
    const object = built ? A.makeWonder(index) : A.makeWonderSite();
    object.position.copy(W.wonderPosition(index));
    object.rotation.y = Math.atan2(-object.position.x, -object.position.z);
    parent.add(object);
    wonderObjects.set(index, { object, built });
  }
}

// --- School: invaders, bosses, chests -----------------------------------------------
const invaders = new Map(); // assignment id -> { object, label, boss }
const chests = new Map(); // chest id -> { object, opening }
const raiders = [];
let fight = null; // exam day playing out at the gate: { id, item, inv, event, t, slams }
let nextRaid = 80;
const somaSnapshots = new Map();
let somaPresent = false;

const hash = (text) => [...String(text)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

function despawnInvader(id, pop) {
  const inv = invaders.get(id);
  if (!inv) return null;
  const pos = inv.object.position.clone();
  if (pop) {
    fx.burst(pos, inv.boss ? A.C.red : A.C.purple, inv.boss ? 40 : 18, 8, 9);
    audio.pop();
  }
  inv.label.remove();
  inv.object.parent?.remove(inv.object);
  invaders.delete(id);
  return pos;
}

function syncInvaders(now) {
  if (state.scene !== 'earth' || inRealm()) {
    for (const id of [...invaders.keys()]) despawnInvader(id, false);
    return;
  }
  const live = new Set();
  for (const { item, t, overdue } of S.threats(state, now)) {
    live.add(item.id);
    const seen = state.school.seen[item.id];
    const isBoss = item.kind === 'boss' && !(seen && seen.boss);
    let inv = invaders.get(item.id);
    if (inv && inv.boss !== isBoss) {
      despawnInvader(item.id, false);
      inv = null;
    }
    if (!inv) {
      const object = A.makeCreature(isBoss ? 'boss' : 'invader', item.size);
      // New arrivals step out of their course's lair and march in.
      const lair = frontFor(item.courseId);
      object.position.set(lair.x, 0, lair.z);
      object.rotation.y = Math.atan2(-lair.x, -lair.z);
      world.earth.add(object);
      inv = { object, boss: isBoss, item, label: fx.label(object, isBoss ? 6.6 : 2.3 + item.size * 0.5, '') };
      invaders.set(item.id, inv);
    }
    inv.item = item;
    if (fight && fight.id === item.id) continue;
    // Its place on its course's front: a step closer to town every day. Work
    // due within a day leaves the front and comes after you (moveInvaders).
    inv.home = frontSpot(item, t, isBoss);
    inv.overdue = overdue;
    inv.mode = isBoss ? 'road' : overdue ? 'charge' : item.dueAt - now < CHASE_HOURS * 3600000 ? 'follow' : 'road';
    if (isBoss) { showArmor(inv, S.examArmor(state, item)); showCrystals(inv, item); }
    const time = timeLeft(item.dueAt - now);
    const name = item.name.length > 26 ? `${item.name.slice(0, 25)}…` : item.name;
    const studied = S.studyProgress(state, item);
    const studying = state.study.active?.itemId === item.id;
    const meter = studied > 0 || studying ? `<span class="meter"><b style="width:${Math.round(studied * 100)}%"></b></span>` : '';
    const armor = isBoss ? Math.round(S.examArmor(state, item) * 100) : 0;
    const weak = isBoss && state.topics[item.id]?.length ? S.crystalsLeft(state, item) : null;
    const packLeft = !isBoss && state.steps[item.id] ? state.steps[item.id].filter((x) => !x.done).length : null;
    const note = studying ? ' · studying now' : isBoss ? (weak !== null ? ` · ${weak ? `${weak} weak point${weak === 1 ? '' : 's'} left` : 'no weak points left'}` : armor ? ` · armor ${armor}%` : ' · no armor left') : packLeft !== null ? ` · ${packLeft ? `${packLeft} step${packLeft === 1 ? '' : 's'} left` : 'all steps done, hand it in'}` : studied >= 1 ? ' · fully studied' : '';
    const bossMeter = isBoss ? `<span class="meter armor"><b style="width:${armor}%"></b></span>` : meter;
    inv.label.set(`<em>${isBoss ? 'Exam' : 'Assignment'} · ${escapeHtml(item.courseName || 'Canvas')}</em>${escapeHtml(name)}${bossMeter}<small>${isBoss ? `reaches town in ${time}` : overdue ? `overdue ${time}` : `due in ${time}`}${note}</small>`, `${isBoss ? 'boss' : ''} ${overdue ? 'overdue' : ''} ${studied >= 1 || studying ? 'studied' : ''}`);
  }
  for (const id of [...invaders.keys()]) if (!live.has(id) && !(fight && fight.id === id)) despawnInvader(id, false);
  // Only the most urgent few come into town; the rest wait at the gate.
  const chasers = [...invaders.values()].filter((inv) => inv.mode !== 'road').sort((a, b) => a.item.dueAt - b.item.dueAt);
  chasers.slice(MAX_CHASERS).forEach((inv) => { inv.mode = 'road'; inv.home = frontSpot(inv.item, 1, inv.boss); });
  syncPacks();
}

// --- Assignments on the move ------------------------------------------------------------
const CHASE_HOURS = 24; // due within this long: it comes into town after you
const MAX_CHASERS = 5;
const BUMP_EVERY = 2.5; // seconds between bumps from late work
let shooNote = 0;
let bumpAny = 0; // one bump at a time, however many are late

function moveInvaders(dt, time) {
  const p = player.object.position;
  const studying = S.isStudying(state);
  const list = [...invaders.values()].filter((inv) => !(fight && fight.id === inv.item.id) && inv.home);
  for (const inv of list) {
    const o = inv.object.position;
    inv.bumpCd = Math.max(0, (inv.bumpCd || 0) - dt);
    // Knocked back by a swing: slide, then come again.
    if (inv.knock && inv.knock.t > 0) {
      inv.knock.t -= dt;
      o.x += inv.knock.x * dt;
      o.z += inv.knock.z * dt;
    } else {
      let tx = inv.home.x, tz = inv.home.z, speed = inv.boss ? 1.6 : 2.4, stop = 0.05;
      if (inv.mode === 'follow' || (inv.mode === 'charge' && studying)) {
        // Hangs around you, a few steps off, so you can't forget it.
        const a = (hash(inv.item.id) % 360) * (Math.PI / 180) + time * 0.15;
        tx = p.x + Math.sin(a) * 4.2;
        tz = p.z + Math.cos(a) * 4.2;
        speed = 5.2;
        stop = 0.6;
      } else if (inv.mode === 'charge') {
        tx = p.x;
        tz = p.z;
        speed = 6.2;
        stop = 1.1;
      }
      const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
      // Far behind (you ran off, or it just arrived)? It hurries.
      const step = Math.min(d - stop, speed * (d > 25 ? 2.2 : 1) * dt);
      if (d > stop && step > 0) {
        o.x += (dx / d) * step;
        o.z += (dz / d) * step;
        inv.walking = true;
        inv.object.rotation.y = Math.atan2(dx, dz);
      } else {
        inv.walking = false;
        if (inv.mode === 'road') inv.object.rotation.y = Math.atan2(-o.x, -o.z);
        else inv.object.rotation.y = Math.atan2(p.x - o.x, p.z - o.z);
      }
    }
    // Late work bumps into you until it's handed in. Never while you study.
    if (inv.mode === 'charge' && !studying && inv.bumpCd <= 0 && bumpAny <= 0 && Math.hypot(p.x - o.x, p.z - o.z) < 1.7) {
      inv.bumpCd = BUMP_EVERY;
      bumpAny = 1.5;
      if (hurtPlayer(Math.max(1, Math.round(S.heroStats(state).health * 0.04)), o)) {
        fx.burst(o.clone().add(new THREE.Vector3(0, 1, 0)), A.C.purple, 10, 5, 5);
        fx.float(o.clone().add(new THREE.Vector3(0, 2.6, 0)), 'Late!', 'hurt');
      }
    }
    if (!inv.boss) o.y = world.groundHeight('earth', o.x, o.z);
  }
  // Chasers keep a little space between them instead of stacking.
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].object.position, b = list[j].object.position;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      const room = list[i].boss || list[j].boss ? 3.2 : 1.5;
      if (d > 0.001 && d < room) {
        const push = (room - d) * 0.5;
        a.x -= (dx / d) * push; a.z -= (dz / d) * push;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      }
    }
  }
  shooNote = Math.max(0, shooNote - dt);
  bumpAny = Math.max(0, bumpAny - dt);
}

/** A swing knocks assignments back; only handing them in on Canvas gets rid of them. */
function shoveInvaders(inArc) {
  let landed = false;
  const p = player.object.position;
  for (const inv of invaders.values()) {
    if (inv.boss || !inv.home || (fight && fight.id === inv.item.id)) continue;
    const o = inv.object.position;
    if (!inArc(o, 3.2)) continue;
    landed = true;
    const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz) || 1;
    inv.knock = { x: (dx / d) * 14, z: (dz / d) * 14, t: 0.35 };
    inv.bumpCd = Math.max(inv.bumpCd || 0, 1.2);
    fx.burst(o.clone().add(new THREE.Vector3(0, 1, 0)), A.C.white, 8, 5, 4);
    if (shooNote <= 0) {
      shooNote = 4;
      fx.float(o.clone().add(new THREE.Vector3(0, 2.8, 0)), 'Hand it in to beat it', 'hit');
    }
  }
  return landed;
}

/** Shows as many armor pieces as the exam has armor left; pieces that just came off fly away. */
function showArmor(inv, armor) {
  const pieces = inv.object.userData.armor || [];
  const keep = Math.ceil(armor * pieces.length - 1e-9);
  pieces.forEach((piece, i) => {
    const on = i < keep;
    if (piece.visible && !on && inv.armorShown !== undefined) {
      const at = new THREE.Vector3();
      piece.getWorldPosition(at);
      fx.burst(at, 0x8e99a8, 14, 7, 7);
      fx.float(at.clone().add(new THREE.Vector3(0, 1.5, 0)), 'Armor broken', 'hit');
      audio.hit();
    }
    piece.visible = on;
  });
  inv.armorShown = keep;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function syncChests() {
  if (inRealm()) return;
  const ids = new Set(state.school.chests.map((c) => c.id));
  for (const [id, entry] of chests) {
    if (!ids.has(id)) {
      entry.object.parent?.remove(entry.object);
      chests.delete(id);
    }
  }
  state.school.chests.forEach((chest, i) => {
    let entry = chests.get(chest.id);
    if (!entry) {
      entry = { object: A.makeChest(chest.rarity), chest };
      chests.set(chest.id, entry);
    }
    if (entry.object.parent !== root()) root().add(entry.object);
    const p = W.chestPosition(i, state.scene);
    entry.object.position.set(p.x, world.groundHeight(state.scene, p.x, p.z), p.z);
    entry.object.rotation.y = Math.atan2(-p.x, -p.z) + Math.PI;
  });
}

function handleSchoolEvents(events) {
  for (const event of events) {
    if (event.type === 'handed-in') {
      const pos = despawnInvader(event.item.id, true) || new THREE.Vector3(0, 0, W.PATH_END_Z);
      if (state.scene === 'earth') fx.coinsTo(pos, player.object, 10, () => audio.coin());
      ui.toast(`Handed in: ${event.item.name}  +${S.fmt(event.reward)} coins, +${event.xp} XP`, 'good');
      gainedXp(event);
    } else if (event.type === 'chest') {
      if (event.exam && event.chest.coins) ui.banner(`Exam graded: ${event.chest.percent}%`, `${event.chest.from}  +${event.xp} XP, +${S.fmt(event.chest.coins)} coins`);
      ui.toast(`A ${event.chest.rarity} chest dropped: ${event.chest.from}${event.chest.percent != null ? ` (${event.chest.percent}%)` : ''}${event.xp ? `, +${event.xp} XP` : ''}`, 'gold');
      gainedXp(event);
      audio.chest();
    } else if (event.type === 'new') {
      ui.toast(`New on the horizon: ${event.item.name}`);
    }
  }
  syncChests();
  syncInvaders(Date.now());
  refreshHud();
}

function applySchool(items, source) {
  handleSchoolEvents(S.syncSchool(state, items, Date.now(), { source }));
  save();
}

// Canvas comes from Soma. The app keeps every Canvas site this account has
// connected in localStorage (src/lib/canvasDeepSync.ts), so the game reads the
// same copy the dashboard uses. The Soma for Canvas extension also posts fresh
// snapshots to this page; those are only taken for sites Soma already holds,
// because the extension belongs to the browser and not to an account.
const SOMA_SNAPSHOTS = 'soma_canvas_deep_sync';
function storedSnapshots() {
  try {
    const raw = JSON.parse(localStorage.getItem(SOMA_SNAPSHOTS) || '{}');
    return Object.values(raw).filter((s) => s && s.kind === 'canvas' && typeof s.host === 'string' && Array.isArray(s.assignments));
  } catch {
    return [];
  }
}
function useSomaSnapshots() {
  if (!somaSnapshots.size || !['none', 'soma', 'demo'].includes(state.school.source)) return;
  const first = state.school.source !== 'soma';
  if (state.school.source === 'demo') state.school = S.newState().school;
  applySchool([...somaSnapshots.values()].flatMap(S.fromSomaSnapshot), 'soma');
  if (first) ui.toast('Connected to your Canvas through Soma. These are your real assignments now.', 'good');
}
function loadStoredSnapshots() {
  let changed = false;
  for (const s of storedSnapshots()) {
    const have = somaSnapshots.get(s.host);
    if (have && have.syncedAt >= s.syncedAt) continue;
    somaSnapshots.set(s.host, s);
    changed = true;
  }
  if (changed) useSomaSnapshots();
}
// Soma open in another tab saved a newer sync.
window.addEventListener('storage', (event) => { if (event.key === SOMA_SNAPSHOTS) loadStoredSnapshots(); });
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const msg = event.data;
  if (!msg || msg.source !== 'soma-extension') return;
  if (msg.type === 'present') somaPresent = true;
  if (msg.type === 'sync_done') {
    lastSyncDone = Date.now();
    if (syncWanted) {
      syncWanted = false;
      const failed = (Array.isArray(msg.results) ? msg.results : []).filter((r) => r && !r.ok);
      ui.toast(failed.length ? `Couldn't reach Canvas: ${failed[0].error || 'sign in to Canvas and try again'}.` : 'Canvas synced. Everything here is up to date.', failed.length ? 'bad' : 'good');
    }
  }
  if (msg.type === 'canvas_snapshot' && msg.snapshot && msg.snapshot.kind === 'canvas') {
    somaPresent = true;
    const have = somaSnapshots.get(msg.snapshot.host);
    if (!have || have.syncedAt >= msg.snapshot.syncedAt) return;
    somaSnapshots.set(msg.snapshot.host, msg.snapshot);
    useSomaSnapshots();
  }
});
const askSoma = () => window.postMessage({ source: 'soma-app', type: 'hello' }, location.origin);

// Coming back to this tab (say, after handing something in on Canvas) asks the
// extension to re-read Canvas, so the hand-in shows up here by itself. At most
// every three minutes, to go easy on Canvas.
let lastSyncAsk = 0;
let lastSyncDone = 0;
let syncWanted = false;
function askSync(force = false) {
  const now = Date.now();
  if (!force && now - lastSyncAsk < 180000) return;
  lastSyncAsk = now;
  window.postMessage({ source: 'soma-app', type: 'sync_request' }, location.origin);
}
window.addEventListener('focus', () => askSync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') askSync(); });
const lastSynced = () => Math.max(0, ...[...somaSnapshots.values()].map((s) => Date.parse(s.syncedAt) || 0));

// --- Interface -----------------------------------------------------------------------
const ui = createUI({
  school: openSchool,
  wardrobe: openWardrobe,
  hero: () => openHero(),
  quests: () => openQuests(),
  ignore: (id) => ignoreItem(id, true),
  study: (id) => openStudy(id),
  endStudy: () => endStudy(),
  help: () => ui.help({ first: false }),
  sound: () => toggleMute(),
  settings: () => openSettings(),
  pass: () => openPass(),
  interact: () => interact(),
});

// --- Realms: the Wilds and the far planet ------------------------------------------------
const realms = createRealms({
  world, fx, audio, ui, player,
  state: () => state,
  hurt: (amount, from) => hurtPlayer(amount, from),
  shake: (v) => { shake = Math.max(shake, v); },
  loot: (rarity, from, pos) => openLoot(S.grantChest(state, rarity, from).id, pos),
  leave: () => leaveRealm(),
  save: () => save(),
});
const inRealm = () => Boolean(realms.active);

function enterRealm(name) {
  if (build.on) toggleBuild(false);
  if (!realms.ready(name)) return void ui.toast('Still loading that place. Try again in a moment.', 'bad');
  if (state.study.active && false) return;
  audio.launch();
  ui.fade(() => {
    for (const r of raiders.splice(0)) r.object.parent?.remove(r.object);
    const spawn = realms.enter(name);
    player.object.position.copy(spawn);
    player.facing = Math.PI;
    player.hp = S.maxHealth(state);
    player.down = false;
    cam.yaw = 0;
    syncInvaders(Date.now());
    refreshHud();
    ui.banner(name === 'wilds' ? 'Camps, treasure and the Alpha' : 'The far side of the Star Gate', realms.title);
  });
}

function leaveRealm(knockedOut = false) {
  const from = realms.active;
  if (!from) return;
  ui.fade(() => {
    realms.leave();
    world.setScene(state.scene, state.era);
    const back = from === 'wilds' ? W.DOCK_POS.clone().add(new THREE.Vector3(-4, 0, 0)) : W.STARGATE_POS.clone().add(new THREE.Vector3(0, 0, 6));
    if (knockedOut && state.scene === 'earth') back.set(0, 0, 9);
    player.object.position.set(back.x, 0, back.z);
    player.hp = S.maxHealth(state);
    player.down = false;
    player.vy = 0;
    syncInvaders(Date.now());
    syncChests();
    refreshHud();
    if (knockedOut) ui.toast('Knocked out. You wake up back home with everything you found.', 'bad');
    save();
  });
}

/** amount is health lost. Returns false when the hit was dodged. */
function hurtPlayer(amount, from) {
  if (player.safe > 0 || player.down || ui.isOpen()) return false;
  const p = player.object.position;
  player.hp -= amount;
  player.hurtAt = performance.now() / 1000;
  player.stun = 0.35;
  player.safe = 0.5;
  shake = Math.max(shake, 0.25);
  audio.hurt();
  ui.hurt();
  fx.float(p.clone().add(new THREE.Vector3(0, 2.4, 0)), `-${Math.round(amount)}`, 'hurt');
  if (from) {
    const dx = p.x - from.x, dz = p.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    player.dashX = (dx / d) * 9;
    player.dashZ = (dz / d) * 9;
    player.dash = 0.12;
  }
  if (player.hp <= 0) {
    player.hp = 0;
    player.down = true;
    leaveRealm(true);
  }
  return true;
}

function dodge() {
  if (player.dashCd > 0 || player.down || ui.isOpen() || !player.grounded) return;
  let ix = 0, iz = 0;
  if (keys.has('w') || keys.has('arrowup')) iz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) iz += 1;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  let wx = Math.sin(player.facing), wz = Math.cos(player.facing);
  if (ix || iz) {
    const len = Math.hypot(ix, iz), sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
    wx = (ix * cos + iz * sin) / len;
    wz = (iz * cos - ix * sin) / len;
    player.facing = Math.atan2(wx, wz);
  }
  player.dashX = wx * 27;
  player.dashZ = wz * 27;
  player.dash = 0.2;
  player.safe = 0.34;
  player.dashCd = S.heroStats(state).dodgeTime;
  audio.swing();
  fx.burst(player.object.position, A.C.white, 6, 3, 2);
}

function slam() {
  if (player.slamCd > 0 || player.down || ui.isOpen() || fight && false) return;
  player.slamCd = S.heroStats(state).slamTime;
  player.swing = 1;
  player.vy = 7.5;
  player.grounded = false;
  player.safe = Math.max(player.safe, 0.5);
  const p = player.object.position;
  setTimeout(() => {
    const at = player.object.position.clone();
    fx.ring(at, 6.5, 0.01, 0xffd76a);
    fx.burst(at, A.C.gold, 34, 12, 6);
    shake = Math.max(shake, 0.45);
    audio.hit();
    audio.thud();
    const power = S.playerPower(state);
    realms.strike({ from: at, facing: player.facing, reach: 6.5, wide: true, damage: power * 2.6, knock: 16, crit: S.heroStats(state).crit });
    hitTownEnemies((pos, reach) => Math.hypot(pos.x - at.x, pos.z - at.z) < 6.5 + (reach > 5 ? 2 : 0), 2.6);
  }, 380);
  void p;
}

function refreshHud() {
  const now = Date.now();
  const wonder = S.nextWonder(state);
  const late = S.lateItems(state, now).sort((a, b) => a.dueAt - b.dueAt);
  ui.hud({
    coins: state.coins,
    income: S.totalIncome(state, now),
    era: state.era,
    eraName: eraName(),
    goal: wonder ? `Build the ${wonder.name}: ${S.fmt(Math.min(state.coins, wonder.cost))} / ${S.fmt(wonder.cost)}${wonder.scene !== state.scene ? ` (on ${wonder.scene === 'moon' ? 'the Moon' : 'Earth'})` : ''}` : 'You reached the stars.',
    progress: wonder ? state.coins / wonder.cost : 1,
    siege: null,
    chests: state.school.chests.length,
    muted: state.settings.muted,
  });
  const hero = S.heroStats(state);
  ui.vitals({ hp: player.hp, max: hero.health, dodge: player.dashCd, slam: player.slamCd / hero.slamTime, level: hero.level, xp: state.hero.xp, need: S.xpToNext(hero.level), points: state.hero.points, capped: hero.level >= S.MAX_HERO_LEVEL });
  const story = S.storyStatus(state);
  ui.quest(realms.status() || (story ? { title: `Quest: ${story.title}`, parts: [story.text, `${story.have} / ${story.need}`], onOpen: openQuests } : null));
  ui.alert(deadlineAlert(late, now));
  ui.threats(inRealm() ? [] : S.threats(state, now).map(({ item, overdue }) => ({
    id: item.id, name: item.name, course: item.courseName, kind: item.kind, overdue, soon: item.dueAt - now < 86400000, time: timeLeft(item.dueAt - now),
    level: S.deadlineLevel(state, item, now),
    studied: S.studyProgress(state, item), studying: state.study.active?.itemId === item.id,
  })), state.school.source, inRealm());
}

/** The bar under the coins: the most pressing deadline, or nothing. */
function deadlineAlert(late, now) {
  if (late.length) {
    const item = late[0];
    const cost = S.lateCost(state, item, now);
    return {
      level: 'late', id: item.id, name: item.name, more: late.length - 1, canIgnore: true,
      text: cost.stopped ? `late ${timeLeft(now - item.dueAt)} · cost you ${S.fmt(cost.coins)} coins and ${cost.xp} XP` : `late ${timeLeft(now - item.dueAt)} · losing ${S.fmt(cost.perHour)} coins and ${cost.xpPerHour} XP an hour`,
    };
  }
  const soon = Object.values(state.school.items)
    .map((item) => ({ item, level: S.deadlineLevel(state, item, now) }))
    .filter((d) => d.level === 'critical' || d.level === 'urgent')
    .sort((a, b) => a.item.dueAt - b.item.dueAt);
  if (!soon.length) return null;
  const { item, level } = soon[0];
  return { level, id: item.id, name: item.name, more: soon.length - 1, canIgnore: false, text: `due in ${timeLeft(item.dueAt - now)}` };
}

function ignoreItem(id, on) {
  const item = state.school.items[id];
  if (!item) return;
  S.setIgnored(state, id, on);
  if (on) ui.toast(`Ignoring ${item.name}: no warnings or losses for it. Undo it from the Canvas list.`, 'good');
  else ui.toast(`${item.name} counts again.`, 'good');
  syncInvaders(Date.now());
  refreshHud();
  save();
}

// --- Deadlines: warnings and what late work costs ------------------------------------
let lateShown = { coins: 0, xp: 0, at: 0 };
function checkDeadlines(startup = false) {
  checkExams();
  const now = Date.now();
  const lost = S.chargeLate(state, now);
  lateShown.coins += lost.coins;
  lateShown.xp += lost.xp;
  if (startup && (lost.coins >= 1 || lost.xp)) {
    ui.toast(`Late work cost you ${S.fmt(lost.coins)} coins and ${lost.xp} XP while you were away. Hand it in to stop the losses.`, 'bad');
    lateShown = { coins: 0, xp: 0, at: now };
  } else if (now - lateShown.at > 12000 && (lateShown.coins >= 1 || lateShown.xp >= 1)) {
    // Every so often, show the drain where the player can see it.
    const bits = [lateShown.coins >= 1 ? `-${S.fmt(lateShown.coins)}` : null, lateShown.xp >= 1 ? `-${lateShown.xp} XP` : null].filter(Boolean);
    fx.float(player.object.position.clone().add(new THREE.Vector3(0, 3, 0)), `${bits.join('  ')} late`, 'hurt');
    lateShown = { coins: 0, xp: 0, at: now };
  }
  const warnings = S.newWarnings(state, now);
  warnings.slice(0, 3).forEach((w, i) => setTimeout(() => {
    const name = w.item.name;
    if (w.level === 'late') {
      audio.alarm();
      ui.banner('Assignment late', name);
      ui.toast(`${name} is late. Until it's handed in you lose 1% of your coins and ${S.LATE_XP_RATE} XP every hour. Nothing to submit? Press Ignore.`, 'bad');
    } else if (w.level === 'critical') {
      audio.alarm();
      ui.toast(`Due in ${timeLeft(w.item.dueAt - now)}: ${name}. Hand it in on time to avoid losses.`, 'bad');
    } else {
      ui.toast(`Due within a day: ${name}`, 'gold');
    }
  }, i * 900));
  if (warnings.length > 3) setTimeout(() => ui.toast(`${warnings.length - 3} more deadlines need you. Open Canvas to see them.`, 'gold'), 2800);
  if (warnings.length || lost.coins || lost.xp) refreshHud();
}

function deny(text) {
  audio.deny();
  ui.toast(text, 'bad');
}

function openBuild(i) {
  const tier = S.tierFor(state);
  ui.build({
    eraName: state.scene === 'moon' ? 'Lunar' : eraName(Math.min(state.era, S.LAST_EARTH_TIER)),
    options: S.TYPES.map((type) => ({
      type, name: S.BUILDINGS[type].names[tier], cost: S.buildCost(type, tier),
      income: S.buildingIncome(state, { type, tier, level: 1, golden: false }), affordable: state.coins >= S.buildCost(type, tier),
    })),
    onPick: (type) => {
      if (!S.build(state, i, type)) return deny('Not enough coins yet.');
      built(i, `${S.BUILDINGS[type].names[tier]} built`);
    },
  });
}

function built(i, text) {
  refreshPad(state.scene, i);
  const pos = pads[state.scene][i].group.position;
  fx.burst(pos, A.C.gold, 16, 5, 7);
  fx.burst(pos, A.C.white, 10, 4, 5);
  audio.build();
  ui.toast(text, 'good');
  refreshHud();
  save();
}

function openBuilding(i) {
  const b = state.pads[state.scene][i];
  const tier = S.tierFor(state);
  ui.building({
    name: S.buildingName(b), level: b.level, maxLevel: S.MAX_LEVEL, income: S.buildingIncome(state, b), stored: b.stored, cap: S.buildingCap(state, b), golden: b.golden, tokens: state.tokens,
    upgrade: b.level < S.MAX_LEVEL ? { cost: S.upgradeCost(b), affordable: state.coins >= S.upgradeCost(b), income: S.buildingIncome(state, { ...b, level: b.level + 1 }) } : null,
    modernize: b.tier < tier ? { name: S.BUILDINGS[b.type].names[tier], cost: S.modernizeCost(state, b), affordable: state.coins >= S.modernizeCost(state, b), income: S.buildingIncome(state, { ...b, tier, level: 1 }) } : null,
    gild: !b.golden,
    onUpgrade: () => (S.upgrade(state, i) ? built(i, `${S.buildingName(b)} is now level ${b.level}`) : deny('Not enough coins yet.')),
    onModernize: () => (S.modernize(state, i) ? built(i, `Rebuilt as ${S.buildingName(b)}`) : deny('Not enough coins yet.')),
    onGild: () => (S.gild(state, i) ? built(i, `${S.buildingName(b)} turned golden`) : deny('You need a golden token. Legendary chests have them.')),
  });
}

function openWonder(wonder) {
  ui.wonder({
    name: wonder.name, cost: wonder.cost, affordable: state.coins >= wonder.cost, nextEra: eraName(state.era + 1),
    newLand: wonder.scene === 'earth' && wonder.index < S.MOON_TIER - 1 ? ['the desert river', 'the lake hills', 'the rocky gorge', 'the seaside', 'the red canyon'][wonder.index] : null,
    onBuild: () => {
      const done = S.buildWonder(state);
      if (!done) return deny('Not enough coins yet.');
      const pos = W.wonderPosition(done.index);
      for (let k = 0; k < 6; k++) {
        setTimeout(() => {
          const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 14, 6 + Math.random() * 8, (Math.random() - 0.5) * 14));
          fx.burst(p, [A.C.gold, A.C.red, A.C.teal, A.C.purple, A.C.blue][k % 5], 26, 9, 5);
        }, k * 260);
      }
      audio.era();
      ui.banner(done.index === 5 ? 'The Moon is waiting' : done.index === 6 ? 'You reached the stars' : 'A new age begins', eraName());
      if (done.index === 5) setTimeout(() => ui.toast('Walk to the rocket and press E to fly to the Moon.', 'gold'), 3600);
      if (done.newLand) {
        // Let the wonder stand for a moment, then set out for the new land.
        refreshWonders();
        save();
        setTimeout(() => moveToNewLand(done), 3200);
        return;
      }
      world.setEra(state.era);
      dressPlayer();
      refreshAllPads();
      refreshWonders();
      refreshHud();
      save();
    },
  });
}

/** The start of a new age: a fresh, empty town in a new landscape. */
function moveToNewLand(done) {
  if (build.on) toggleBuild(false);
  audio.launch();
  ui.fade(() => {
    world.setEra(state.era);
    dressPlayer();
    refreshAllPads();
    refreshWonders();
    syncDecor();
    for (const r of raiders.splice(0)) r.object.parent?.remove(r.object);
    player.object.position.set(0, 0, 9);
    player.vy = 0;
    // The villagers come along, walking in through the new gate.
    for (const f of folk.values()) { f.object.position.set((f.i % 3 - 1) * 1.2, 0, W.GATE.z - 1); f.target = null; f.wait = 1 + f.i; }
    syncInvaders(Date.now());
    syncChests();
    syncHalls();
    applyTimeOfDay();
    refreshHud();
    ui.banner(eraName(), `A new land: ${world.landName()}`);
    setTimeout(() => ui.toast(`Your old town stays behind. A settler's purse of ${S.fmt(done.purse)} coins${done.decorBack ? ` (+${S.fmt(done.decorBack)} for your decorations)` : ''} gets the first homes built.`, 'gold'), 2600);
    save();
  });
}

function travel(to) {
  if (build.on) toggleBuild(false);
  audio.launch();
  ui.fade(() => {
    state.scene = to;
    world.setScene(to, state.era);
    dressPlayer();
    const spawn = to === 'moon' ? W.MOON_SPAWN : W.wonderPosition(5).clone().add(new THREE.Vector3(0, 0, 9));
    player.object.position.set(spawn.x, 0, spawn.z);
    player.vy = 0;
    for (const r of raiders.splice(0)) r.object.parent?.remove(r.object);
    syncInvaders(Date.now());
    syncChests();
    refreshHud();
    ui.banner(to === 'moon' ? 'One small step' : 'Welcome home', to === 'moon' ? 'The Moon' : 'Earth');
    save();
  });
}

function openWardrobe() {
  ui.wardrobe({
    owned: state.cosmetics.owned, hat: state.cosmetics.hat, color: state.cosmetics.color, names: A.COSMETIC_NAMES, colors: A.SKIN_COLORS,
    all: ['color:clay', 'hat:none', ...S.COSMETICS],
    onPick: (id) => {
      if (id.startsWith('hat:')) state.cosmetics.hat = id;
      else state.cosmetics.color = id;
      dressPlayer();
      save();
      ui.close();
      openWardrobe();
    },
  });
}

function openSchool() {
  const now = Date.now();
  const byCourse = new Map();
  for (const a of Object.values(state.school.items).sort((x, y) => (x.dueAt || 0) - (y.dueAt || 0))) {
    if (!byCourse.has(a.courseName)) byCourse.set(a.courseName, []);
    let status = a.dueAt ? (a.dueAt < now ? `Was due ${timeLeft(now - a.dueAt)} ago` : `Due in ${timeLeft(a.dueAt - now)}`) : 'No due date';
    if (a.submitted) status = typeof a.score === 'number' && a.pointsPossible ? `Graded: ${Math.round((a.score / a.pointsPossible) * 100)}%` : 'Handed in, waiting for a grade';
    const ignored = !a.submitted && S.isIgnored(state, a);
    if (ignored) status = state.school.ignored[a.id] === true ? 'Ignored: nothing to hand in' : 'Ignored: Canvas says on paper or no submission';
    else if (!a.submitted && a.dueAt && a.dueAt < now) {
      const cost = S.lateCost(state, a, now);
      status = `Late ${timeLeft(now - a.dueAt)}${cost.coins >= 1 || cost.xp ? ` · has cost ${S.fmt(cost.coins)} coins and ${cost.xp} XP` : ''}`;
    }
    byCourse.get(a.courseName).push({ ...a, status, ignored, late: !ignored && !a.submitted && a.dueAt && a.dueAt < now, studied: S.studyProgress(state, a) });
  }
  const reopen = () => {
    ui.close();
    openSchool();
  };
  ui.school({
    source: state.school.source, connected: somaPresent, chests: state.school.chests.length,
    groups: [...byCourse].map(([course, items]) => ({ course, items })),
    synced: lastSynced() ? timeLeft(Date.now() - lastSynced()) : null,
    onIgnore: (id, on) => {
      ignoreItem(id, on);
      reopen();
    },
    onStudy: (id) => {
      ui.close();
      openStudy(id);
    },
    onDemo: () => {
      state.school = S.newState().school;
      applySchool(S.demoSemester(), 'demo');
      reopen();
    },
    onClear: () => {
      syncWanted = true;
      askSync(true);
      ui.toast('Syncing with Canvas…', 'good');
    },
  });
}

// --- The hero: levels, gear, skills, quests ---------------------------------------------
/** Shows experience just earned, and the level-up when it tips over. */
function gainedXp(result) {
  if (!result || !result.xp) return;
  const p = player.object.position;
  fx.float(p.clone().add(new THREE.Vector3(0, 3.2, 0)), `+${result.xp} XP`);
  if (!result.levels) return;
  player.hp = S.maxHealth(state);
  for (let k = 0; k < 3; k++) fx.burst(p.clone().add(new THREE.Vector3(0, 0.6 + k, 0)), [A.C.gold, A.C.white, A.C.teal][k], 30, 9, 9);
  fx.ring(p.clone(), 7, 0.01, 0xffd76a);
  shake = Math.max(shake, 0.3);
  audio.era();
  setTimeout(() => ui.banner(`+${result.levels} skill point${result.levels === 1 ? '' : 's'} · press C`, `Level ${result.level}`), result.levels && ui.isOpen() ? 600 : 0);
}

function gearLine(got) {
  const i = got.item;
  const stat = i.slot === 'weapon' ? `+${i.might} damage` : i.slot === 'armor' ? `+${i.health} health` : `+${i.crit}% crit`;
  return `${i.name} (${i.rarity}, ${stat})${got.equipped ? ', equipped' : ', in your bag'}`;
}

function checkStory() {
  if (ui.isOpen()) return;
  const paid = S.claimStory(state);
  if (!paid) return;
  audio.chest();
  ui.banner('Quest complete', paid.title);
  const bits = [];
  if (paid.coins) bits.push(`+${S.fmt(paid.coins)} coins`);
  if (paid.gear) bits.push(gearLine(paid.gear));
  ui.toast(`Reward: ${bits.join(' · ')}`, 'gold');
  const next = S.storyStatus(state);
  if (next) setTimeout(() => ui.toast(`New quest: ${next.title}. ${next.text}.`), 1800);
  if (paid.gear?.equipped) dressPlayer();
  refreshHud();
  save();
}

function openHero() {
  if (fight) return;
  const hero = state.hero;
  const stats = S.heroStats(state);
  const reopen = () => {
    ui.close();
    dressPlayer();
    refreshHud();
    save();
    openHero();
  };
  const courses = new Map();
  for (const a of Object.values(state.school.items)) courses.set(a.courseId, a.courseName);
  ui.hero({
    level: hero.level, xp: hero.xp, need: S.xpToNext(hero.level), capped: hero.level >= S.MAX_HERO_LEVEL, points: hero.points, stats,
    gear: S.SLOTS.map((slot) => ({ slot, item: hero.gear[slot] })),
    bag: hero.bag.map((item) => ({ item, better: S.gearScore(item) > S.gearScore(hero.gear[item.slot]), value: S.sellValue(item) })),
    bagSize: S.BAG_SIZE,
    skills: Object.entries(S.SKILLS).map(([id, skill]) => ({ id, ...skill, rank: S.skillRank(state, id) })),
    masteries: [...courses].map(([id, name]) => ({ name, level: S.mastery(state, id), minutes: Math.round(state.study.courses[id] || 0) })),
    onEquip: (id) => { if (S.equipGear(state, id)) { audio.build(); reopen(); } },
    onSell: (id) => { if (S.sellGear(state, id)) { audio.coin(); reopen(); } },
    onSkill: (id) => { if (S.spendSkill(state, id)) { audio.build(); reopen(); } },
    onWardrobe: () => { ui.close(); openWardrobe(); },
    onStyle: () => { ui.close(); openStyle(); },
    characters: CHARACTERS.map(({ id, name }) => ({ id, name })), character: state.cosmetics.character,
    onCharacter: (id) => { pickCharacter(id); ui.close(); openHero(); },
    onStudy: () => { ui.close(); openStudy(); },
  });
}

function openQuests() {
  const now = Date.now();
  const story = S.storyStatus(state);
  ui.quests({
    story, done: state.quest.step, total: S.STORY.length, level: state.hero.level,
    school: S.threats(state, now).map(({ item, overdue }) => ({
      id: item.id, name: item.name, course: item.courseName, kind: item.kind, overdue, time: timeLeft(item.dueAt - now),
      studied: S.studyProgress(state, item), goal: S.STUDY_GOAL[item.size || 1],
      studyXp: Math.round(S.STUDY_GOAL[item.size || 1] * S.XP_PER_MINUTE * S.XP_FULL_SESSION), handInXp: S.XP_HAND_IN[item.size || 1],
      bossLevel: item.kind === 'boss' ? S.bossLevel(item) : null,
    })),
    onStudy: (id) => { ui.close(); openStudy(id); },
    onPractice: (id) => { ui.close(); openPractice(id); },
  });
}

// --- Studying ---------------------------------------------------------------------------
// A session is a real timer. While it runs the town fires on the book being
// studied, and the tab title counts down so it can be left in the background.
const bolts = [];
const studyRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9, depthWrite: false }));
studyRing.rotation.x = Math.PI / 2;
studyRing.visible = false;
const boltGeo = new THREE.SphereGeometry(0.22, 12, 8);
const boltMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
let boltIn = 1;
const TITLE = document.title;
const clock = (ms) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

function openStudy(selected = null) {
  if (state.study.active) return void ui.toast('A study session is already running.', 'bad');
  if (fight) return;
  const now = Date.now();
  const items = S.threats(state, now).map(({ item }) => ({
    id: item.id, name: item.name, course: item.courseName, kind: item.kind,
    studied: S.studyProgress(state, item), minutes: state.study.minutes[item.id] || 0, goal: S.STUDY_GOAL[item.size || 1],
  }));
  ui.study({
    items, selected: selected ?? items[0]?.id ?? null, lengths: S.STUDY_LENGTHS, chestsLeft: S.studyChestsLeft(state, now), streak: state.study.streak,
    xpRate: S.XP_PER_MINUTE * S.XP_FULL_SESSION * S.heroStats(state).studyXp,
    onStart: (id, minutes) => beginStudy(id, minutes),
    onPractice: (id) => openPractice(id),
  });
}

/** A round of AI practice questions on an item; defaults to the most urgent exam, then anything due. */
function openPractice(id = null, topic = null) {
  if (fight || ui.isOpen()) return;
  const now = Date.now();
  const list = S.threats(state, now).map((t) => t.item);
  const item = (id && state.school.items[id]) || list.filter((a) => a.kind === 'boss').sort((a, b) => a.dueAt - b.dueAt)[0] || list[0];
  if (!item) return void ui.toast('Nothing to practice for yet. Exams and assignments from Canvas show up here.', 'bad');
  ui.practice({
    name: item.name, course: item.courseName || 'your course', armor: item.kind === 'boss' ? S.examArmor(state, item) : null,
    load: () => makePractice(item, 5, topic),
    onAnswer: (q, right) => { if (!right) S.addReview(state, item, topic ? { ...q, topic } : q); },
    finish: (right, wrong) => {
      const r = S.finishPractice(state, item.id, right, wrong, Date.now(), topic);
      if (r.lures) setTimeout(() => ui.toast('Good round: +1 lure for the Wilds', 'good'), 600);
      gainedXp(r);
      syncInvaders(Date.now());
      refreshHud();
      save();
      if (right) audio.coin();
      const armor = item.kind === 'boss' ? ` ${item.name} has ${Math.round(S.examArmor(state, item) * 100)}% armor left.` : '';
      const toast = `Practice: ${right} right. +${r.xp} XP${r.minutes ? `, ${r.minutes} min of study credit` : ''}.${armor}`;
      ui.toast(toast, 'good');
      if (r.prepared) ui.toast(item.kind === 'boss' ? `${item.name} has no armor left. Your gate will hold on exam day.` : `${item.name} is fully studied: handing it in pays 50% more.`, 'gold');
      return `+${r.xp} XP${r.minutes ? ` and ${r.minutes} minutes of study credit` : ''}.${armor}${wrong ? ` The ${wrong} you missed come${wrong === 1 ? 's' : ''} back for review tomorrow.` : ''}${r.capped ? ' Practice credit for this one is used up today; more rounds still pay XP.' : ''}`;
    },
    again: () => openPractice(item.id),
  });
}

function beginStudy(id, minutes, topic = null) {
  if (!S.startStudy(state, id, minutes, Date.now(), topic)) return;
  if (dayPhase().sleeping) setTimeout(() => ui.toast('The town is asleep. Wren stays up by the fire with you.', 'good'), 1500);
  const item = id ? state.school.items[id] : null;
  audio.build();
  ui.banner('Study session', item ? `${item.name}${topic ? ` · ${topic}` : ''}` : `${minutes} minutes`);
  ui.toast('Timer running. Go do the work: the town earns double until it ends.', 'gold');
  boltIn = 0.6;
  studyTick();
  refreshHud();
  save();
}

function endStudy() {
  const active = state.study.active;
  if (!active) return;
  const inv = active.itemId ? invaders.get(active.itemId) : null;
  const result = S.finishStudy(state);
  document.title = TITLE;
  ui.focus(null);
  studyRing.visible = false;
  for (const b of bolts.splice(0)) b.m.parent?.remove(b.m);
  if (!result.coins) ui.toast('Session ended before five minutes. Nothing earned this time.', 'bad');
  else {
    const pos = inv ? inv.object.position.clone() : player.object.position.clone();
    if (result.complete) {
      for (let k = 0; k < 3; k++) fx.burst(pos.clone().add(new THREE.Vector3(0, 1 + k, 0)), [A.C.gold, A.C.white, A.C.orange][k], 26, 10, 10);
      shake = Math.max(shake, 0.3);
      audio.era();
      ui.banner('Session complete', `${Math.round(result.minutes)} minutes studied`);
    }
    fx.coinsTo(pos, player.object, 12, () => audio.coin());
    const bits = [`+${result.xp} XP and +${S.fmt(result.coins)} coins for ${Math.round(result.minutes)} minutes`];
    gainedXp(result);
    if (result.chest) bits.push(`a ${result.chest.rarity} chest on your plaza`);
    else if (result.complete) bits.push('no more study chests today');
    if (result.complete && result.streak > 1) bits.push(`${result.streak} day streak`);
    ui.toast(bits.join(' · '), 'gold');
    if (result.lures) ui.toast(`+${result.lures} lure${result.lures === 1 ? '' : 's'} for catching creatures in the Wilds (you have ${state.critters.lures})`, 'good');
    if (result.prepared) ui.toast(result.item.kind === 'boss' ? `${result.item.name} has no armor left. Your gate will hold on exam day.` : `${result.item.name} is fully studied: handing it in pays 50% more.`, 'good');
  }
  syncChests();
  syncInvaders(Date.now());
  refreshHud();
  save();
}

/** Once a second, in the background too: the countdown, the tab title, and the finish. */
function studyTick() {
  const active = state.study.active;
  if (!active) return;
  const now = Date.now();
  if (now >= active.endsAt) return endStudy();
  const item = active.itemId ? state.school.items[active.itemId] : null;
  const left = clock(active.endsAt - now);
  document.title = `${left} · Studying · Epoch`;
  ui.focus({ time: left, name: item ? item.name : 'Free study', progress: (now - active.startedAt) / (active.endsAt - active.startedAt) });
}
setInterval(studyTick, 1000);

function updateStudy(dt, time) {
  const active = state.study.active;
  const inv = active && active.itemId ? invaders.get(active.itemId) : null;
  const show = Boolean(inv) && state.scene === 'earth' && !fight && !inRealm();
  studyRing.visible = show;
  if (show) {
    if (studyRing.parent !== world.earth) world.earth.add(studyRing);
    studyRing.position.set(inv.object.position.x, 0.25 + Math.sin(time * 2.4) * 0.1, inv.object.position.z);
    studyRing.scale.setScalar((inv.boss ? 2.6 : 0.7 + inv.item.size * 0.25) * (1 + Math.sin(time * 4) * 0.05));
    studyRing.rotation.z = time * 0.9;
    boltIn -= dt;
    if (boltIn <= 0) {
      boltIn = 1.6 + Math.random() * 1.2;
      const m = new THREE.Mesh(boltGeo, boltMat);
      const side = Math.random() < 0.5 ? -3.2 : 3.2;
      m.position.set(side, 7.5, W.GATE.z);
      world.earth.add(m);
      bolts.push({ m, from: m.position.clone(), inv, t: 0 });
    }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += dt * 1.7;
    const t = Math.min(1, b.t);
    const to = b.inv.object.position;
    const height = b.inv.boss ? 3.5 : 1.1;
    b.m.position.set(b.from.x + (to.x - b.from.x) * t, b.from.y + (to.y + height - b.from.y) * t + Math.sin(t * Math.PI) * 4, b.from.z + (to.z - b.from.z) * t);
    b.m.scale.setScalar(1 + Math.sin(time * 30) * 0.2);
    if (t >= 1) {
      b.m.parent?.remove(b.m);
      bolts.splice(i, 1);
      if (!b.inv.object.parent) continue;
      fx.burst(b.m.position, A.C.gold, 7, 3.5, 4);
      b.inv.flinch = 0.35;
    }
  }
  for (const inv2 of invaders.values()) {
    if (!inv2.flinch) continue;
    inv2.flinch = Math.max(0, inv2.flinch - dt);
    const k = Math.sin((inv2.flinch / 0.35) * Math.PI);
    inv2.object.scale.set(1 + k * 0.18, 1 - k * 0.22, 1 + k * 0.18);
  }
}

// --- Exam day -----------------------------------------------------------------------------
// Nobody fights an exam. Studying strips its armor while it marches; on exam
// day it reaches the gate, slams it a few times, and the armor left decides
// what happens (S.resolveExams). The grade, when it posts, pays the reward.
const examQueue = [];
function checkExams() {
  for (const event of S.resolveExams(state, Date.now())) examQueue.push(event);
  if (examQueue.length) save();
  if (!fight && examQueue.length) startExamDay(examQueue.shift());
}

function startExamDay(event) {
  const inv = invaders.get(event.item.id);
  if (!inv || state.scene !== 'earth' || inRealm()) return finishExamDay(event, null);
  fight = { id: event.item.id, item: event.item, inv, event, t: 0, slams: 0 };
  const stop = frontSpot(event.item, 1, true);
  inv.object.position.set(stop.x, 0, stop.z);
  inv.object.rotation.y = Math.atan2(-stop.x, -stop.z);
  inv.label.set(`<em>Exam day · ${escapeHtml(event.item.courseName || 'Canvas')}</em>${escapeHtml(event.item.name)}<span class="meter armor"><b style="width:${Math.round(event.armor * 100)}%"></b></span><small>at the gate · armor ${Math.round(event.armor * 100)}%</small>`, 'boss overdue');
  ui.banner('Exam day', `${event.item.name} reached the town`);
  audio.alarm();
}

function updateExamDay(dt) {
  const { inv, event } = fight;
  fight.t += dt;
  const arms = inv.object.userData.arms || [];
  // Three slams on the gate, then the verdict.
  const beat = fight.t - 1.2 - fight.slams * 1.1;
  for (const arm of arms) arm.position.y = beat > -0.35 && beat < 0 ? 1.6 : 0.8;
  if (fight.slams < 3 && beat >= 0) {
    fight.slams += 1;
    shake = Math.max(shake, event.outcome === 'held' ? 0.25 : 0.6);
    const at = inv.object.position;
    const toward = new THREE.Vector3(-at.x, 0, -at.z).normalize().multiplyScalar(3);
    fx.ring(at.clone().add(toward), 4, 0.6);
    fx.burst(at.clone().add(toward).add(new THREE.Vector3(0, 2, 0)), event.outcome === 'held' ? 0x8e99a8 : A.C.red, 12, 6, 6);
    audio.thud();
  }
  if (fight.t > 5) {
    const pos = inv.object.position.clone();
    fight = null;
    finishExamDay(event, pos);
  }
}

function finishExamDay(event, pos) {
  villagersReact(event);
  const { item, outcome, coins, chest, wrecked } = event;
  if (pos) {
    despawnInvader(item.id, false);
    const colors = outcome === 'held' ? [A.C.gold, A.C.white, A.C.gold] : [A.C.red, 0x1a1420, A.C.red];
    for (let k = 0; k < 3; k++) fx.burst(pos.clone().add(new THREE.Vector3(0, k * 1.6, 0)), colors[k], 28, 10, 9);
  }
  if (outcome === 'held') {
    if (pos) fx.coinsTo(pos, player.object, 14, () => audio.coin());
    audio.era();
    ui.banner('The gate held', `Your studying broke ${item.name}`);
    ui.toast(`+${S.fmt(coins)} coins and an epic chest. Your grade will pay more when it posts.`, 'gold');
  } else if (outcome === 'dented') {
    audio.hurt();
    ui.banner('The walls took a hit', `${item.name} still had ${Math.round(event.armor * 100)}% armor`);
    ui.toast(`Repairs cost ${S.fmt(-coins)} coins. Study earlier next time to break its armor first.`, 'bad');
  } else {
    audio.hurt();
    if (wrecked) {
      refreshPad(wrecked.scene, wrecked.index);
      const at = pads[wrecked.scene][wrecked.index]?.group.position;
      if (at && state.scene === wrecked.scene) for (let k = 0; k < 3; k++) fx.burst(at.clone().add(new THREE.Vector3(0, 1 + k, 0)), [A.C.red, 0x6b5a48, A.C.orange][k], 30, 9, 9);
    }
    ui.banner('A building was wrecked', `${item.name} hit the gate with ${Math.round(event.armor * 100)}% armor`);
    ui.toast(`Lost ${S.fmt(-coins)} coins${wrecked ? ' and a level on your best building' : ''}. Your grade still pays when it posts.`, 'bad');
  }
  syncChests();
  syncInvaders(Date.now());
  refreshHud();
  save();
}

// --- Raiders ----------------------------------------------------------------------------
function spawnRaid() {
  if (inRealm()) return;
  const targets = state.pads[state.scene].map((b, i) => ({ b, i })).filter(({ b }) => b);
  if (targets.length < 2 || fight) return;
  const count = Math.min(6, 2 + Math.floor(targets.length / 3));
  const radius = state.scene === 'moon' ? W.MOON_RADIUS - 1 : W.ISLAND_RADIUS - 2;
  const base = Math.random() * Math.PI * 2;
  for (let k = 0; k < count; k++) {
    const a = base + (k - count / 2) * 0.16;
    const enemy = hasEnemy('bandit') ? createEnemy('bandit', { tint: 0xc8b0a0 }) : null;
    const object = enemy ? enemy.object : A.makeCreature('raider', 1);
    enemy?.play('run');
    object.position.set(Math.cos(a) * radius, 0, -Math.abs(Math.sin(a)) * radius * (state.scene === 'moon' ? Math.sign(Math.sin(a)) || 1 : 1));
    root().add(object);
    const target = targets[Math.floor(Math.random() * targets.length)];
    raiders.push({ object, enemy, target: target.i, mode: 'approach', hp: S.enemyStats(S.raiderLevel(state), 0).hp, level: S.raiderLevel(state), carry: 0, wait: 0, hitFlash: 0, home: object.position.clone() });
  }
  audio.alarm();
  ui.toast('Raiders! They are after the coins in your buildings.', 'bad');
}

function updateRaiders(dt) {
  for (let i = raiders.length - 1; i >= 0; i--) {
    const r = raiders[i];
    const pad = pads[state.scene][r.target];
    const goal = r.mode === 'approach' && pad ? pad.group.position : r.home;
    const dx = goal.x - r.object.position.x;
    const dz = goal.z - r.object.position.z;
    const dist = Math.hypot(dx, dz);
    r.hitFlash = Math.max(0, r.hitFlash - dt * 4);
    r.object.scale.setScalar((r.enemy ? 1 : 1.15) * (1 + r.hitFlash * 0.25));
    r.enemy?.play(r.mode === 'loot' ? 'idle' : 'run');
    r.enemy?.update(dt);
    if (r.mode === 'loot') {
      r.wait -= dt;
      if (r.wait <= 0) {
        const b = state.pads[state.scene][r.target];
        if (b) {
          r.carry = Math.floor(b.stored * 0.3);
          b.stored -= r.carry;
        }
        r.mode = 'flee';
      }
    } else if (dist < (r.mode === 'approach' ? 3.6 : 1.5)) {
      if (r.mode === 'approach') {
        r.mode = 'loot';
        r.wait = 1.6;
      } else {
        if (r.carry > 0) ui.toast(`A raider got away with ${S.fmt(r.carry)} coins.`, 'bad');
        r.object.parent?.remove(r.object);
        raiders.splice(i, 1);
        continue;
      }
    } else {
      const speed = (r.mode === 'flee' ? 5.4 : 4.4) * (r.hitFlash > 0.3 ? 0.2 : 1);
      r.object.position.x += (dx / dist) * speed * dt;
      r.object.position.z += (dz / dist) * speed * dt;
      r.object.rotation.y = Math.atan2(dx, dz);
    }
    r.object.position.y = world.groundHeight(state.scene, r.object.position.x, r.object.position.z) + (r.enemy ? 0 : Math.abs(Math.sin(performance.now() / 110 + i)) * 0.25);
  }
}

// --- Attacking ----------------------------------------------------------------------------
// Three swings in a row make a combo: the third hits twice as hard, in a full circle.
function attack() {
  if (player.cooldown > 0 || ui.isOpen() || player.down) return;
  const time = performance.now() / 1000;
  player.combo = time - player.comboAt < 0.95 ? (player.combo % 3) + 1 : 1;
  player.comboAt = time;
  const finisher = player.combo === 3;
  player.cooldown = finisher ? 0.5 : 0.3;
  player.swing = 1;
  audio.swing();
  const p = player.object.position;
  const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
  const reachMult = finisher ? 1.35 : 1;
  const inArc = (pos, reach) => {
    const to = new THREE.Vector3(pos.x - p.x, 0, pos.z - p.z);
    const d = to.length();
    return d < reach * reachMult && (finisher || d < 1.4 || to.normalize().dot(fwd) > 0.2);
  };
  const hero = S.heroStats(state);
  const mult = finisher ? hero.finisher : 1;
  let landed = hitTownEnemies(inArc, mult);
  if (shoveInvaders(inArc)) landed = true;
  if (realms.strike({ from: p, facing: player.facing, reach: 3.3 * reachMult, wide: finisher, damage: S.playerPower(state) * mult, knock: finisher ? 13 : 5, crit: hero.crit }) > 0) landed = true;
  // A small step into the swing, so hits feel like they carry weight.
  if (!fight) {
    player.dashX = fwd.x * 7;
    player.dashZ = fwd.z * 7;
    player.dash = 0.08;
  }
  if (finisher) {
    fx.ring(p.clone(), 3.3 * reachMult, 0.01, 0xffffff);
    if (landed) fx.float(p.clone().add(new THREE.Vector3(0, 3, 0)), 'Combo!', 'hit');
  }
  if (landed) {
    audio.hit();
    shake = Math.max(shake, finisher ? 0.28 : 0.12);
  }
}

/** Raiders and the test boss, which live in the town rather than a realm. */
function hitTownEnemies(inArc, mult = 1) {
  let landed = false;
  for (let i = raiders.length - 1; i >= 0; i--) {
    const r = raiders[i];
    if (!inArc(r.object.position, 3.4)) continue;
    landed = true;
    const dmg = Math.max(1, Math.round(S.playerPower(state) * mult * S.levelEdge(state.hero.level, r.level).deal));
    r.hp -= dmg;
    r.hitFlash = 1;
    r.enemy?.hurt();
    fx.float(r.object.position.clone().add(new THREE.Vector3(0, 2, 0)), String(dmg), 'hit');
    if (r.hp <= 0) {
      const bounty = Math.max(12, Math.round(S.baseIncome(state) * 20)) + r.carry;
      S.addCoins(state, bounty);
      state.stats.raidersBeaten += 1;
      fx.burst(r.object.position, A.C.teal, 16, 7, 7);
      fx.coinsTo(r.object.position, player.object, 5, () => audio.coin());
      fx.float(r.object.position.clone().add(new THREE.Vector3(0, 2.6, 0)), `+${S.fmt(bounty)}`);
      r.object.parent?.remove(r.object);
      raiders.splice(i, 1);
    }
  }
  return landed;
}

// --- Interacting ---------------------------------------------------------------------------
let target = null;

function findTarget() {
  if (fight || player.down || build.on || tryOn) return null;
  const p = player.object.position;
  let best = null;
  const offer = (dist, range, entry) => {
    if (dist < range && (!best || dist / range < best.score)) best = { ...entry, score: dist / range };
  };
  if (inRealm()) {
    realms.findTarget(p, offer);
    for (const c of critters) if (!c.gone) offer(Math.hypot(p.x - c.object.position.x, p.z - c.object.position.z), 2.8, { text: `Catch the ${S.CRITTERS[c.species].name.toLowerCase()} · 1 lure (${state.critters.lures} left)`, run: () => catchCritter(c) });
    return best;
  }
  for (const [id, entry] of chests) {
    if (entry.opening || entry.object.parent !== root()) continue;
    offer(p.distanceTo(entry.object.position), 3.4, { text: `Open the ${entry.chest.rarity} chest`, run: () => openChest(id) });
  }
  const sceneName = state.scene;
  for (let i = 0; i < S.padsUnlocked(state); i++) {
    const pad = pads[sceneName][i];
    const b = state.pads[sceneName][i];
    const d = Math.hypot(p.x - pad.group.position.x, p.z - pad.group.position.z);
    if (b) offer(d, 5, { text: `${S.buildingName(b)}: upgrade`, run: () => openBuilding(i) });
    else offer(d, 4, { text: 'Build here', run: () => openBuild(i) });
  }
  const wonder = S.nextWonder(state);
  if (wonder && wonder.scene === sceneName) {
    const w = W.wonderPosition(wonder.index);
    offer(Math.hypot(p.x - w.x, p.z - w.z), 8, { text: `Build the ${wonder.name} (${S.fmt(wonder.cost)})`, run: () => openWonder(wonder) });
  }
  if (sceneName === 'earth' && state.wonders.includes(5)) {
    const w = W.wonderPosition(5);
    offer(Math.hypot(p.x - w.x, p.z - w.z), 9, { text: 'Fly to the Moon', run: () => ui.travel({ title: 'Moon Rocket', subtitle: 'A new colony with its own buildings, and the Star Gate.', label: 'Launch', onGo: () => travel('moon') }) });
  }
  if (sceneName === 'earth') offer(Math.hypot(p.x - W.DOCK_POS.x, p.z - W.DOCK_POS.z), 5.5, { text: 'Take the trail to the Wilds', run: () => ui.travel({ title: 'The Wilds', subtitle: 'Levels 1 to 10. Untamed forest past the eastern pass. Monster camps guard chests, treasure is buried in the woods, and the Alpha waits at the far end. It all comes back each day.', label: 'Head out', onGo: () => enterRealm('wilds') }) });
  if (sceneName === 'moon' && state.wonders.includes(6)) {
    offer(Math.hypot(p.x - W.STARGATE_POS.x, p.z - W.STARGATE_POS.z), 7, { text: 'Step through the Star Gate', run: () => ui.travel({ title: 'Kepler Reach', subtitle: 'Levels 14 to 30. A world on the far side of the gate. Sentry machines guard the best loot in the game, and the Core Guardian holds the centre.', label: 'Step through', onGo: () => enterRealm('nova') }) });
  }
  if (sceneName === 'moon') {
    offer(Math.hypot(p.x - W.LANDER_POS.x, p.z - W.LANDER_POS.z), 5.5, { text: 'Return to Earth', run: () => ui.travel({ title: 'Lander', subtitle: 'Your town keeps earning while you are away.', label: 'Fly home', onGo: () => travel('earth') }) });
  }
  if (sceneName === 'earth') offer(Math.hypot(p.x - BOARD_POS.x, p.z - BOARD_POS.z), 4, { text: 'Canvas board: your assignments and grades', run: openSchool });
  if (sceneName === 'earth' && !build.on) {
    offer(Math.hypot(p.x - MARKET_POS.x, p.z - MARKET_POS.z), 5, { text: 'Open the market', run: openMarket });
    offer(Math.hypot(p.x - VAULT_POS.x, p.z - VAULT_POS.z), 5.5, { text: `The Vault: ${S.vaultFound(state)}/${Object.keys(S.COLLECTIBLES).length} rare finds`, run: openVault });
    offer(Math.hypot(p.x - WATCH_POS.x, p.z - WATCH_POS.z), 5, { text: 'Watchtower: what Canvas doesn\u2019t show', run: openWatchtower });
    for (const [id, sh] of shadows) offer(Math.hypot(p.x - sh.object.position.x, p.z - sh.object.position.z), 3.4, sh.revealed ? { text: `Mark \u201c${sh.reading.label}\u201d as read`, run: () => readShadow(id) } : { text: 'Something from your syllabus (Watchtower)', run: openWatchtower });
    for (const [name, f] of folk) offer(Math.hypot(p.x - f.object.position.x, p.z - f.object.position.z), 3.2, { text: `Talk to ${name}`, run: () => openVillager(name) });
    for (const g of ghosts) offer(p.distanceTo(g.object.position), 3.6, { text: `Review ${S.dueReviews(state).length} missed questions`, run: openReview });
    for (const [id, h] of halls) {
      const next = S.threats(state).map((t) => t.item).filter((a) => a.courseId === id).sort((a, b) => a.dueAt - b.dueAt)[0];
      offer(Math.hypot(p.x - h.object.position.x, p.z - h.object.position.z), 5, { text: `Study for ${h.name}`, run: () => openStudy(next?.id ?? null) });
    }
  }
  if (sceneName === 'earth' && !state.study.active) {
    for (const inv of invaders.values()) {
      if (fight && fight.id === inv.item.id) continue;
      const steps = state.steps[inv.item.id];
      offer(p.distanceTo(inv.object.position), inv.boss ? 8 : 4.5, inv.boss
        ? { text: `${inv.item.name}: weak points and study`, run: () => openExam(inv.item.id) }
        : { text: steps ? `${inv.item.name}: steps and study` : `Break ${inv.item.name} into steps`, run: () => openSteps(inv.item.id) });
    }
    for (const [itemId, pack] of packs) for (const m of pack.values()) offer(Math.hypot(p.x - m.object.position.x, p.z - m.object.position.z), 2.6, { text: `Done: ${m.step.text}`, run: () => doneStep(itemId, m.step.id) });
  }
  return best;
}

function interact() {
  if (ui.isOpen()) return;
  if (target) target.run();
}

function openChest(id) {
  const entry = chests.get(id);
  if (!entry || ui.isOpen()) return;
  openLoot(id, entry.object.position.clone());
}

/** Opens a chest the player owns, wherever it is, with the full reveal. */
function openLoot(id, pos) {
  const chest = state.school.chests.find((c) => c.id === id);
  const result = S.openChest(state, id);
  if (!result) return;
  fx.burst(pos, A.RARITY_COLORS[chest.rarity], 26, 8, 10);
  syncChests();
  save();
  ui.loot({
    rarity: result.chest.rarity, from: result.chest.from, percent: result.chest.percent, loot: result.loot,
    names: A.COSMETIC_NAMES, colors: A.SKIN_COLORS, audio, collectibles: S.COLLECTIBLES, best: result.best,
    thumb: (id) => thumbFor({ kind: 'collectible', id }),
    onDone: () => {
      fx.coinsTo(pos, player.object, 12, () => audio.coin());
      if (result.loot.some((l) => l.kind === 'gear' && l.equipped)) dressPlayer();
      if (result.loot.some((l) => l.kind === 'collectible' && !l.dupe)) { syncPedestals(); const top = result.loot.find((l) => l.kind === 'collectible'); if (tierRank(top.tier) >= 3) ui.banner(top.tier === 'mythic' ? 'MYTHIC FIND' : 'Legendary find', S.COLLECTIBLES[top.id].name); }
      refreshHud();
    },
  });
}

const keys = new Set();
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  audio.unlock();
  if (key === 'escape') return void (build.on && !ui.isOpen() ? toggleBuild(false) : ui.isOpen() ? ui.close() : openSettings());
  if (ui.isOpen()) return;
  keys.add(key);
  if (key === ' ') event.preventDefault();
  if (event.repeat) return;
  if (key === 'e' || key === 'enter') interact();
  else if (key === 'f') attack();
  else if (key === 'g') openSchool();
  else if (key === 'c') openHero();
  else if (key === 'j') openQuests();
  else if (key === 'v') toggleMouseLook();
  else if (key === 'q') dodge();
  else if (key === 'r') { if (build.on) { build.rot += Math.PI / 4; } else slam(); }
  else if (key === 'b') toggleBuild();
  else if ((key === 'x' || key === 'delete' || key === 'backspace') && build.on) removeBuild();
  else if (key === 't') openStudy();
  else if (key === 'p') openPractice();
  else if (key === 'h') ui.help({ first: false });
  else if (key === 'm') toggleMute();
  else if (key === 'o') openSettings();
  else if (key === 'k') openCollection();
  else if (key === 'y') openPass();
  else if (key === 'u') openVault();
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// Looking around, like most RPGs: hold the right mouse button and move the
// mouse to turn the view (the cursor hides while you hold it). Left click
// only swings, it never turns the view. V locks the mouse for hands-free
// looking; scroll zooms. Only real mouse movement turns the view, so it
// never drifts on its own.
let drag = null; // set while the right button is held
let lookHeld = false; // pointer lock taken for a right-button hold, not V
const locked = () => document.pointerLockElement === canvas;
const LOOK_SPEED = 0.0042;
function turn(dx, dy) {
  // Browsers sometimes report a huge jump on the first locked move; drop it.
  if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;
  const k = LOOK_SPEED * (state.settings.sensitivity || 1);
  cam.yaw -= dx * k;
  cam.pitch = Math.max(0.05, Math.min(1.45, cam.pitch + dy * k * 0.8));
  cam.idle = 0;
}
// Some browsers (or an embedding page) refuse pointer lock; that must never throw.
function lockPointer() {
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* refused */ }
}
function toggleMouseLook() {
  lookHeld = false;
  if (locked()) document.exitPointerLock();
  else lockPointer();
}

// Shift lock (like Roblox): tap Shift or press the lock button. The cursor
// hides, the mouse turns the camera, the hero always faces where the camera
// looks, and the view sits over the right shoulder. Holding Shift still runs.
let shiftLock = false;
let shoulder = 0; // 0..1, eases the over-the-shoulder offset in and out
const lockButton = document.getElementById('skLock');
const crosshair = document.getElementById('crosshair');
function showShiftLock() {
  lockButton?.classList.toggle('on', shiftLock);
  if (crosshair) crosshair.hidden = !shiftLock;
  // No cursor in shift lock, even where the browser won't lock the mouse.
  document.body.classList.toggle('shiftlock', shiftLock && !ui.isOpen());
}
let lockRefusedSaid = false;
document.addEventListener('pointerlockerror', () => {
  if (!shiftLock || lockRefusedSaid) return;
  lockRefusedSaid = true;
  ui.toast('This browser won\u2019t lock the mouse, so turning stops at the edge of the window. In Chrome it turns forever.', 'bad');
});
function toggleShiftLock(on = !shiftLock) {
  shiftLock = on;
  lookHeld = false;
  if (on && !locked()) lockPointer();
  if (!on && locked()) document.exitPointerLock();
  showShiftLock();
  ui.toast(on ? 'Shift lock on: move the mouse to look, your hero faces where you look. Tap Shift to turn it off.' : 'Shift lock off', 'good');
}
lockButton?.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); toggleShiftLock(); });
let shiftDownAt = 0;
let shiftUsed = false;
window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift' && !event.repeat) { shiftDownAt = event.timeStamp; shiftUsed = false; }
  else if (event.key !== 'Shift') shiftUsed = true;
}, true);
window.addEventListener('keyup', (event) => {
  // A quick tap toggles shift lock; holding Shift to run doesn't.
  if (event.key !== 'Shift' || ui.isOpen()) return;
  // Timed from the keys themselves, so a slow frame can't turn a tap into a hold.
  if (event.timeStamp - shiftDownAt < 250 && !shiftUsed) toggleShiftLock();
}, true);

document.addEventListener('pointerlockchange', () => {
  showShiftLock();
  if (shiftLock) return; // shift lock says its own thing; Esc pauses it until the next click
  if (lookHeld) {
    if (!locked()) lookHeld = false;
    return;
  }
  ui.toast(locked() ? 'Mouse look on: move the mouse to look. V or Esc to let go.' : 'Mouse look off. Hold right click to look around.', 'good');
});
document.addEventListener('mousemove', (event) => {
  if (ui.isOpen()) return;
  if (locked()) turn(event.movementX, event.movementY);
  else if (drag) turn(event.clientX - drag.x, event.clientY - drag.y);
  else if (shiftLock && !build.on) turn(event.movementX || 0, event.movementY || 0);
  if (drag) { drag.x = event.clientX; drag.y = event.clientY; }
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('mousedown', (event) => {
  audio.unlock();
  if (shiftLock && !locked() && event.button === 0) { lockPointer(); if (locked()) return; }
  if (event.button === 0) return void (build.on ? placeBuild() : attack());
  if (event.button !== 2) return;
  event.preventDefault();
  drag = { x: event.clientX, y: event.clientY };
  if (!locked()) {
    lookHeld = true;
    try {
      const asked = canvas.requestPointerLock?.({ unadjustedMovement: true });
      asked?.catch?.(() => {});
      asked?.catch?.(() => canvas.requestPointerLock?.()?.catch?.(() => { lookHeld = false; }));
    } catch { lookHeld = false; }
  }
});
const endLook = (event) => {
  if (event && event.button !== 2) return;
  drag = null;
  if (lookHeld) {
    lookHeld = false;
    if (locked()) document.exitPointerLock();
  }
};
window.addEventListener('mouseup', endLook);
window.addEventListener('blur', () => endLook());
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  // Mice send big steps and trackpads many small ones; pinch arrives with ctrlKey.
  const step = event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY;
  cam.want = Math.max(CAM_MIN, Math.min(CAM_MAX, cam.want * Math.exp(Math.max(-120, Math.min(120, step)) * (event.ctrlKey ? 0.012 : 0.0022))));
  cam.idle = 0;
}, { passive: false });

// --- Movement ------------------------------------------------------------------------------
function solids() {
  if (inRealm()) return realms.solids(player.object.position);
  const list = [];
  const sceneName = state.scene;
  state.pads[sceneName].forEach((b, i) => {
    if (b && i < S.padsUnlocked(state)) list.push({ x: pads[sceneName][i].group.position.x, z: pads[sceneName][i].group.position.z, r: 2.5 });
  });
  for (const [index, entry] of wonderObjects) {
    if (!entry.built || (index === 6) !== (sceneName === 'moon')) continue;
    list.push({ x: entry.object.position.x, z: entry.object.position.z, r: index === 0 ? 1.6 : index === 6 ? 2.2 : 4.6 });
  }
  if (sceneName === 'earth') list.push({ x: 0, z: 0, r: 2.4 }, { x: -3.2, z: W.GATE.z, r: 1.5 }, { x: 3.2, z: W.GATE.z, r: 1.5 });
  else list.push({ x: W.LANDER_POS.x, z: W.LANDER_POS.z, r: 2.2 });
  if (fight) list.push({ x: fight.inv.object.position.x, z: fight.inv.object.position.z, r: 2.6 });
  if (sceneName === 'earth') {
    list.push({ x: MARKET_POS.x, z: MARKET_POS.z, r: 2.6 }, { x: WATCH_POS.x, z: WATCH_POS.z, r: 2.4 }, { x: VAULT_POS.x, z: VAULT_POS.z, r: 3.4 });
    for (const h of halls.values()) list.push({ x: h.object.position.x, z: h.object.position.z, r: 2.7 });
    for (const d of state.decor) { const r = S.DECOR[d.type]?.solid; if (r) list.push({ x: d.x, z: d.z, r }); }
  }
  return list;
}

function updatePlayer(dt, time) {
  const p = player.object.position;
  const moon = state.scene === 'moon' && !inRealm();
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.stun = Math.max(0, player.stun - dt);
  player.safe = Math.max(0, player.safe - dt);
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.slamCd = Math.max(0, player.slamCd - dt);
  // Health comes back after a few quiet seconds.
  const maxHp = S.maxHealth(state);
  if (!player.down && time - player.hurtAt > S.heroStats(state).regenDelay) player.hp = Math.min(maxHp, player.hp + maxHp * 0.12 * dt);
  if (player.dash > 0) {
    player.dash -= dt;
    p.x += player.dashX * dt;
    p.z += player.dashZ * dt;
  }
  let ix = 0;
  let iz = 0;
  if (!ui.isOpen() && !player.down) {
    if (keys.has('w') || keys.has('arrowup')) iz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) iz += 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
  }
  const moving = ix !== 0 || iz !== 0;
  if (moving) {
    const len = Math.hypot(ix, iz);
    const sin = Math.sin(cam.yaw);
    const cos = Math.cos(cam.yaw);
    // Forward is away from the camera.
    const wx = (ix * cos + iz * sin) / len;
    const wz = (iz * cos - ix * sin) / len;
    const speed = (keys.has('shift') ? 12.5 : 8) * (player.stun > 0 ? 0.45 : 1);
    p.x += wx * speed * dt;
    p.z += wz * speed * dt;
    const want = Math.atan2(wx, wz);
    let delta = want - player.facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    player.facing += delta * Math.min(1, dt * 14);
    player.walk += dt * (keys.has('shift') ? 15 : 11);
  }
  if (shiftLock && !ui.isOpen()) {
    // Face where the camera looks, even standing still or walking sideways.
    let turn = cam.yaw + Math.PI - player.facing;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    player.facing += turn * Math.min(1, dt * 18);
  }
  for (const s of solids()) {
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const d = Math.hypot(dx, dz);
    const min = s.r + 0.55;
    if (d < min && d > 0.0001) {
      p.x = s.x + (dx / d) * min;
      p.z = s.z + (dz / d) * min;
    }
  }
  const limit = inRealm() ? realms.radius : moon ? W.MOON_RADIUS : W.ISLAND_RADIUS;
  const r = Math.hypot(p.x, p.z);
  if (r > limit) {
    p.x *= limit / r;
    p.z *= limit / r;
  }
  const ground = inRealm() ? 0 : world.groundHeight(state.scene, p.x, p.z);
  if (player.grounded && keys.has(' ') && !ui.isOpen()) {
    player.vy = moon ? 6.2 : 8.6;
    player.grounded = false;
  }
  player.vy -= (moon ? 5.5 : 24) * dt;
  p.y += player.vy * dt;
  if (p.y <= ground) {
    p.y = ground;
    player.vy = 0;
    player.grounded = true;
  } else player.grounded = false;

  player.object.rotation.y = player.facing;
  const avatar = player.model.userData.avatar;
  if (avatar) {
    player.swing = Math.max(0, player.swing - dt * 3.2);
    const sprint = keys.has('shift');
    avatar.update(dt, moving ? 'run' : 'idle', sprint ? 1.75 : 1.3, player.swing, { dodge: player.dash > 0.1 && player.safe > 0.2, air: !player.grounded && Math.abs(player.vy) > 2, hurt: time - player.hurtAt < 0.05 });
    player.model.rotation.z = player.stun > 0 ? Math.sin(time * 40) * 0.08 : 0;
    return;
  }
  const parts = player.model.userData.parts;
  const swing = moving ? Math.sin(player.walk) * 0.9 : 0;
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  parts.armL.rotation.x = moving ? -swing * 0.8 : Math.sin(time * 1.6) * 0.06;
  player.swing = Math.max(0, player.swing - dt * 4.5);
  parts.armR.rotation.x = player.swing > 0 ? -2.4 * Math.sin(player.swing * Math.PI) - 0.3 : moving ? swing * 0.8 : -Math.sin(time * 1.6) * 0.06;
  parts.body.position.y = moving ? Math.abs(Math.sin(player.walk)) * 0.09 : Math.sin(time * 2) * 0.02;
  // Small things that make the character feel alive.
  const life = player.life || (player.life = { blink: 2, look: 0, squash: 0, wasGrounded: true });
  life.blink -= dt;
  if (life.blink < -0.13) life.blink = 1.6 + Math.random() * 3.2;
  if (parts.eyes) parts.eyes.scale.y = life.blink < 0 ? 0.12 : 1;
  if (player.grounded && !life.wasGrounded) life.squash = 1;
  life.wasGrounded = player.grounded;
  life.squash = Math.max(0, life.squash - dt * 5);
  const air = player.grounded ? 0 : Math.max(-1, Math.min(1, player.vy * 0.06));
  const sy = 1 - life.squash * 0.2 + air * 0.12;
  player.model.scale.set(1 + (1 - sy) * 0.6, sy, 1 + (1 - sy) * 0.6);
  player.model.rotation.x = moving ? 0.12 : 0;
  if (parts.head) {
    parts.head.rotation.y = moving ? 0 : Math.sin(time * 0.55) * 0.3 * (0.5 + 0.5 * Math.sin(time * 0.17));
    parts.head.rotation.z = moving ? Math.sin(player.walk) * 0.04 : Math.sin(time * 0.4) * 0.05;
    parts.head.rotation.x = moving ? -0.06 : Math.sin(time * 2) * 0.02;
  }
  if (parts.tuft) parts.tuft.rotation.x = (moving ? Math.sin(player.walk * 2) * 0.35 : Math.sin(time * 2.2) * 0.08) - air * 0.9;
  if (parts.charm) parts.charm.rotation.z = (moving ? Math.sin(player.walk) * 0.7 : Math.sin(time * 1.8) * 0.12);
  if (parts.pack) parts.pack.rotation.x = moving ? Math.sin(player.walk * 2) * 0.05 : 0;
  if (parts.brows) for (const brow of parts.brows) brow.position.y = 0.2 + (player.swing > 0 ? -0.04 : air > 0.2 ? 0.04 : 0);
  player.model.rotation.z = player.stun > 0 ? Math.sin(time * 40) * 0.08 : 0;
}

let shake = 0;
const camFocus = Object.assign(new THREE.Vector3(), { ready: false });
function updateCamera(dt) {
  const p = player.object.position;
  cam.dist += (cam.want - cam.dist) * Math.min(1, dt * 10);
  cam.idle += dt;
  // The view follows a smoothed point on the hero, but turning is applied at
  // once: the camera sits exactly where yaw and pitch say, so it never lags
  // behind the mouse or keeps sliding after you stop.
  if (!camFocus.ready) { camFocus.copy(p); camFocus.ready = true; }
  camFocus.lerp(p, Math.min(1, dt * 14));
  if (camFocus.distanceTo(p) > 12) camFocus.copy(p);
  const f = camFocus;
  const flat = Math.cos(cam.pitch) * cam.dist;
  // Up close the view sits over the shoulder and looks at the head; far out it looks at the feet.
  const near = 1 - Math.min(1, (cam.dist - CAM_MIN) / 14);
  // In shift lock the view slides over the right shoulder.
  shoulder += ((shiftLock && !ui.isOpen() ? 1 : 0) - shoulder) * Math.min(1, dt * 8);
  const side = 1.4 * shoulder;
  const rx = Math.cos(cam.yaw) * side, rz = -Math.sin(cam.yaw) * side;
  const want = new THREE.Vector3(f.x + Math.sin(cam.yaw) * flat + rx, f.y + Math.sin(cam.pitch) * cam.dist + 1.5, f.z + Math.cos(cam.yaw) * flat + rz);
  // In the valley the view stays out of the wooded slopes.
  if (!inRealm() && state.scene === 'earth') {
    for (let k = 0; k < 12 && Math.hypot(want.x, want.z) > W.TOWN_R + 6; k++) { want.x += (f.x - want.x) * 0.12; want.z += (f.z - want.z) * 0.12; }
  }
  want.y = Math.max(want.y, (inRealm() ? 0 : world.groundHeight(state.scene, want.x, want.z)) + 0.7);
  camera.position.copy(want);
  shake = Math.max(0, shake - dt * 1.6);
  if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.lookAt(f.x + rx, f.y + 1.6 + near * 0.5 + shoulder * 0.3, f.z + rz);
  camera.updateMatrixWorld();
  focusView.value.set(p.x, p.y + 1, p.z).applyMatrix4(camera.matrixWorldInverse);
}

function updateTown(dt, time) {
  const sceneName = state.scene;
  const p = player.object.position;
  const list = state.pads[sceneName];
  for (let i = 0; i < list.length; i++) {
    const pad = pads[sceneName][i];
    const b = list[i];
    if (!pad || !pad.group.visible) continue;
    if (pad.marker) {
      pad.marker.rotation.y = time * 1.2;
      pad.marker.position.y = 0.1 + Math.sin(time * 2.4 + i) * 0.08;
    }
    if (!b) continue;
    const rate = S.buildingIncome(state, b);
    const full = b.stored / Math.max(1, S.buildingCap(state, b));
    pad.bubble.visible = b.stored > rate * 12;
    if (pad.bubble.visible) {
      pad.bubble.position.y = pad.top + 0.5 + Math.sin(time * 2.6 + i) * 0.18;
      pad.bubble.rotation.y = time * 2.2;
      pad.bubble.scale.setScalar(0.7 + Math.min(1, full * 6) * 0.6);
    }
    if (!fight && b.stored >= Math.max(1, rate * 2.5) && Math.hypot(p.x - pad.group.position.x, p.z - pad.group.position.z) < 5.4) {
      const amount = S.collect(state, i);
      if (amount > 0) {
        const from = pad.group.position.clone().add(new THREE.Vector3(0, pad.top * 0.5, 0));
        fx.coinsTo(from, player.object, 3 + Math.round(Math.min(1, full * 4) * 8), () => audio.coin());
        fx.float(pad.group.position.clone().add(new THREE.Vector3(0, pad.top + 1, 0)), `+${S.fmt(amount)}`);
      }
    }
  }
  for (const o of spinners) { if (o.userData.axis === 'z') o.rotation.z += dt * 0.9; else o.rotation.y += dt * 1.6; }
  for (const [index, entry] of wonderObjects) {
    if (index === 6 && entry.built) {
      const portal = entry.object.getObjectByName('portal');
      if (portal) portal.material.opacity = 0.55 + Math.sin(time * 2) * 0.2;
    }
  }
  for (const [id, entry] of chests) {
    const beam = entry.object.getObjectByName('beam');
    if (beam) {
      beam.rotation.y = time * 0.8;
      beam.material.opacity = 0.16 + Math.sin(time * 3) * 0.06;
    }
    entry.object.scale.setScalar(1 + Math.sin(time * 3 + entry.object.position.x) * 0.03);
  }
  for (const inv of invaders.values()) {
    if (fight && fight.id === inv.item.id) continue;
    const feet = inv.object.userData.feet;
    const pace = !inv.walking ? 1.5 : inv.mode === 'charge' ? 11 : inv.boss ? 3 : 7;
    feet[0].position.y = 0.12 + Math.max(0, Math.sin(time * pace)) * 0.16;
    feet[1].position.y = 0.12 + Math.max(0, -Math.sin(time * pace)) * 0.16;
    inv.object.userData.body.position.y = 0.75 + Math.abs(Math.sin(time * pace)) * (inv.overdue ? 0.14 : 0.05);
  }
}

// --- Loop ------------------------------------------------------------------------------------
let last = performance.now();
let hudTimer = 0;
let slowTimer = 0;
let saveTimer = 0;

function frame(nowMs) {
  const rawDt = (nowMs - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = nowMs;
  const time = nowMs / 1000;
  S.tick(state);
  updatePlayer(dt, time);
  if (!inRealm()) { moveInvaders(dt, time); updateTown(dt, time); }
  updateBuild();
  // A panel needs the cursor back; a click on the game afterwards re-locks.
  if (locked() && ui.isOpen()) document.exitPointerLock();
  if (shiftLock) document.body.classList.toggle('shiftlock', !ui.isOpen());
  if (!inRealm() && state.scene === 'earth') moveVillagers(dt, time);
  updateCritters(dt, time);
  if (!inRealm() && state.scene === 'earth') { moveShadows(dt, time); movePacks(dt, time); animateLairs(time); }
  watchtower.userData.beam.rotation.y += dt * 0.6;
  updatePet(dt, time);
  updateTheme(dt, time);
  updateAura(dt, time);
  for (const g of gardenAnim) {
    if (!g.parent) continue;
    if (g.name === 'koifish') for (const f of g.children) { f.userData.a += dt * 0.6 / f.userData.r; f.position.set(Math.cos(f.userData.a) * f.userData.r, 0.1, Math.sin(f.userData.a) * f.userData.r * 0.8); f.rotation.y = -f.userData.a; }
    else for (const p of g.children) { const t = (time * 0.15 + p.userData.seed) % 1; p.position.set(Math.sin(p.userData.seed * 7 + time) * 1.2, 2.6 - t * 2.6, Math.cos(p.userData.seed * 5) * 1.1 + t * 0.6); p.rotation.set(time * 2 + p.userData.seed, 0, time); }
  }
  updateTrail(dt);
  if (tryOn) { cam.yaw += dt * 0.5; cam.pitch += (0.18 - cam.pitch) * Math.min(1, dt * 3); cam.want += (5.5 - cam.want) * Math.min(1, dt * 3); }
  ghosts.forEach((g, i) => { g.object.position.y = 0.5 + Math.sin(time * 1.6 + i) * 0.25; g.object.rotation.y = Math.sin(time * 0.5 + i) * 0.6; });
  updateRaiders(dt);
  realms.update(dt, time, player.object.position, !player.down);
  if (fight) updateExamDay(dt);
  updateStudy(dt, time);
  if (!ui.isOpen() && !inRealm() && document.visibilityState === 'visible') {
    nextRaid -= dt;
    if (nextRaid <= 0) {
      nextRaid = 150 + Math.random() * 120;
      spawnRaid();
    }
  }
  target = ui.isOpen() ? null : findTarget();
  ui.prompt(target ? target.text : null);
  updateCamera(dt);
  world.update(dt, time, player.object.position, camera);
  watchPace(rawDt);
  fx.update(dt);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.2;
    refreshHud();
  }
  slowTimer -= dt;
  if (slowTimer <= 0) {
    slowTimer = 1;
    audio.setMusic(S.isStudying(state) ? 'study' : 'town');
    syncInvaders(Date.now());
    syncHalls();
    syncFronts();
    syncReview();
    villagerTick(Date.now());
    applyTimeOfDay();
    dailyTick();
    watchChests();
    if (build.on) drawBuildBar();
    checkDeadlines();
    checkStory();
  }
  saveTimer -= dt;
  if (saveTimer <= 0) {
    saveTimer = 8;
    save();
  }
  composer.render();
  requestAnimationFrame(frame);
}

// --- Start -------------------------------------------------------------------------------------
world.setEra(state.era);
world.setScene(state.scene, state.era);
const BOARD_POS = new THREE.Vector3(6.4, 0, 24);
const board = A.makeBoard();
board.position.copy(BOARD_POS);
board.rotation.y = -0.5;
world.earth.add(board);
fx.label(board, 3.3, '<em>Canvas</em>Assignment board', 'board');
const dock = A.makeDock();
dock.position.copy(W.DOCK_POS);
dock.rotation.y = Math.atan2(W.DOCK_POS.x, W.DOCK_POS.z) - Math.PI / 2;
world.earth.add(dock);
fx.label(dock, 5, '<em>Explore</em>Trail to the Wilds', 'board');

// --- Market, class halls, build mode and review ghosts ------------------------------------
const deg = (d) => (d * Math.PI) / 180;
const ring = (r, d) => new THREE.Vector3(Math.cos(deg(d)) * r, 0, Math.sin(deg(d)) * r);
const faceCentre = (o) => { o.rotation.y = Math.atan2(-o.position.x, -o.position.z); };
const onGround = (o, x, z) => o.position.set(x, world.groundHeight('earth', x, z), z);

const MARKET_POS = W.MARKET_POS;
const market = A.makeMarket();
onGround(market, MARKET_POS.x, MARKET_POS.z);
faceCentre(market);
world.earth.add(market);
fx.label(market, 4.6, '<em>Market</em>New stock every day', 'board');

function openMarket() {
  const offers = S.marketStock(state);
  const junk = state.hero.bag.filter((i) => S.gearScore(i) <= S.gearScore(state.hero.gear[i.slot]));
  ui.market({
    coins: state.coins,
    offers: offers.map((o) => ({ ...o, name: o.kind === 'look' ? A.COSMETIC_NAMES[o.id] || o.id : o.kind === 'decor' ? S.DECOR[o.id].name : null })),
    junk: { count: junk.length, value: junk.reduce((sum, i) => sum + S.sellValue(i), 0) },
    onBuy: (i) => {
      const got = S.buyOffer(state, i);
      if (!got) return void audio.deny();
      audio.coin();
      const o = got.offer;
      if (o.kind === 'gear') { ui.toast(got.equipped ? `Bought and equipped ${o.item.name}` : `Bought ${o.item.name}: it's in your bag (C)`, 'gold'); dressPlayer(); }
      else if (o.kind === 'look') ui.toast('New look unlocked: wear it from the Wardrobe in the Hero panel.', 'gold');
      else if (o.kind === 'tea') ui.toast('Study tea: your next study session pays 50% more XP.', 'gold');
      else ui.toast(`${S.DECOR[o.id].name} unlocked in build mode (B).`, 'gold');
      refreshHud(); save(); ui.close(); openMarket();
    },
    showcase: Object.entries(S.COLLECTIBLES).filter(([, c]) => c.tier === 'mythic' || c.tier === 'legendary').sort(([, a], [, b]) => tierRank(b.tier) - tierRank(a.tier)).map(([id, c]) => ({ id, name: c.name, tier: c.tier, owned: Boolean(state.vault.owned[id]), odds: `${S.DROP_TABLE.legendary.odds[c.tier]}% from a legendary chest`, src: thumbFor({ kind: 'collectible', id }) })),
    onVault: () => { ui.close(); openVault(); },
    onSellJunk: () => {
      const coins = S.sellJunk(state);
      if (coins) { audio.coin(); ui.toast(`Sold old gear for ${S.fmt(coins)} coins`, 'good'); }
      refreshHud(); save(); ui.close(); openMarket();
    },
  });
}

// One hall per class, on the outer ring south of the plaza. It gains a floor
// each mastery level, so the classes you study tower over the ones you don't.
const HALL_SLOTS = W.HALL_SLOTS;
const HALL_COLORS = [0x4a78d0, 0xd9534f, 0x3fb8a8, 0xf08a3c, 0x7a56c2, 0xc9a227];
const halls = new Map(); // courseId -> { object, label, level, slot }
const nextFloorAt = (level) => 15 * (level + 1) ** 2;
function syncHalls() {
  const list = S.courseHalls(state).slice(0, HALL_SLOTS.length);
  const ids = new Set(list.map((h) => h.id));
  for (const [id, h] of halls) if (!ids.has(id)) { h.object.parent?.remove(h.object); h.label.remove(); halls.delete(id); }
  list.forEach((hall, slot) => {
    let h = halls.get(hall.id);
    if (!h || h.level !== hall.level || h.slot !== slot) {
      const grew = h && h.level < hall.level;
      if (h) { h.object.parent?.remove(h.object); h.label.remove(); }
      const object = A.makeHall(hall.level, HALL_COLORS[hash(hall.id) % HALL_COLORS.length]);
      const at = HALL_SLOTS[slot];
      onGround(object, at.x, at.z);
      faceCentre(object);
      world.earth.add(object);
      h = { object, level: hall.level, slot, label: fx.label(object, (object.userData.height || 3) + 0.4, '', 'board') };
      halls.set(hall.id, h);
      if (grew) {
        for (let k = 0; k < 3; k++) fx.burst(object.position.clone().add(new THREE.Vector3(0, 2 + k * 2, 0)), [A.C.gold, A.C.white, A.C.gold][k], 18, 7, 7);
        ui.toast(`Your ${hall.name} hall grew to ${hall.level} floor${hall.level === 1 ? '' : 's'}`, 'gold');
        audio.build();
      }
    }
    h.name = hall.name;
    h.label.set(`<em>Class hall · ${hall.level ? `${hall.level} floor${hall.level === 1 ? '' : 's'}` : 'not started'}</em>${escapeHtml(hall.name)}<small>${hall.minutes} min studied · next floor at ${nextFloorAt(hall.level)}</small>`, 'board');
  });
}

// Build mode: place decorations anywhere in town.
const decorObjects = new Map(); // decor id -> object
const gardenAnim = []; // koi that swim, petals that fall
function syncDecor() {
  const ids = new Set(state.decor.map((d) => d.id));
  for (const [id, o] of decorObjects) if (!ids.has(id)) { o.parent?.remove(o); decorObjects.delete(id); }
  for (const d of state.decor) {
    if (decorObjects.has(d.id)) continue;
    const o = A.makeDecor(d.type);
    onGround(o, d.x, d.z);
    o.rotation.y = d.rot;
    world.earth.add(o);
    decorObjects.set(d.id, o);
    o.traverse((m) => { if (m.name === 'sails') spinners.push(m); if (m.name === 'koifish' || m.name === 'petals') gardenAnim.push(m); });
  }
}

const build = { on: false, type: 'b:home', rot: 0, ghost: null, at: null, ok: false, bar: null };
const pointer = { x: innerWidth / 2, y: innerHeight / 2 };
canvas.addEventListener('mousemove', (event) => { pointer.x = event.clientX; pointer.y = event.clientY; });
const ray = new THREE.Raycaster();
function groundAt(x, y) {
  const rect = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  for (let t = 0.5; t < 180; t += 0.4) {
    const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
    if (py <= world.groundHeight('earth', px, pz)) return new THREE.Vector3(px, 0, pz);
  }
  return null;
}
// Buildings keep off the plaza and the ring roads.
function onTownRoad(x, z) {
  const r = Math.hypot(x, z);
  return r < 9 || Math.abs(r - 9.5) < 2.4 || Math.abs(r - 19) < 2.6;
}
function buildBlocked(x, z, big = false) {
  if (Math.hypot(x, z) > W.ISLAND_RADIUS - (big ? 5 : 3) || Math.hypot(x, z) < 3.2) return true;
  if (big) for (const d of state.decor) if (Math.hypot(x - d.x, z - d.z) < 3) return true;
  const near = (p, r) => Math.hypot(x - p.x, z - p.z) < r + (big ? 1.4 : 0);
  for (let i = 0; i < S.EARTH_PADS; i++) {
    const spot = state.padSpots.earth[i] || (i < S.FIXED_EARTH_PADS ? W.padPosition('earth', i) : null);
    if (spot && near(spot, state.pads.earth[i] ? 4.4 : 3.3)) return true;
  }
  for (let i = 0; i < 7; i++) if (W.wonderPosition(i) && near(W.wonderPosition(i), 5)) return true;
  if (near(MARKET_POS, 3.6) || near(BOARD_POS, 2.4) || near(W.GATE, 4) || near(W.DOCK_POS, 4)) return true;
  for (const at of HALL_SLOTS) if (near(at, 3.4)) return true;
  if (near(W.WATCHTOWER_POS, 3.6)) return true;
  // Keep the road to the gate clear for the marching assignments.
  if (Math.abs(x) < 2.6 && z > 3) return true;
  return false;
}
const isBuilding = (type) => type.startsWith('b:');
const buildingType = (type) => type.slice(2);
function pieceCost(type) {
  return isBuilding(type) ? S.buildCost(buildingType(type), S.tierFor(state, 'earth')) : S.decorCost(state, type);
}
function makeGhost(type) {
  const g = isBuilding(type) ? A.makeBuilding(buildingType(type), S.tierFor(state, 'earth'), 1, false) : A.makeDecor(type);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.6;
    o.material.depthWrite = false;
    o.castShadow = false;
  });
  return g;
}
function setGhost(type) {
  build.type = type;
  if (build.ghost) build.ghost.parent?.remove(build.ghost);
  build.ghost = makeGhost(type);
  world.earth.add(build.ghost);
  drawBuildBar();
}
function drawBuildBar() {
  if (!build.bar) return;
  const list = [...Object.keys(S.BUILDINGS).map((k) => `b:${k}`), ...S.decorAvailable(state)];
  const count = S.buildingCount(state);
  build.bar.replaceChildren(
    ...list.map((type) => {
      const cost = pieceCost(type);
      const b = document.createElement('button');
      b.className = `build-item ${type === build.type ? 'on' : ''} ${state.coins < cost ? 'poor' : ''}`;
      const name = isBuilding(type) ? S.buildingName({ type: buildingType(type), tier: S.tierFor(state, 'earth') }) : S.DECOR[type].name;
      if (isBuilding(type)) b.classList.add('building');
      b.innerHTML = `<b>${name}</b><small><span class="coin sm"></span>${S.fmt(cost)}</small>`;
      b.onclick = (e) => { e.stopPropagation(); setGhost(type); };
      return b;
    }),
    Object.assign(document.createElement('p'), { className: 'build-help', textContent: `Click to place · R rotate · X remove a decoration (half back) · B or Esc when done · buildings ${count.used}/${count.room} this age · decorations ${state.decor.length}/${S.DECOR_MAX}` }),
  );
}
function toggleBuild(force) {
  const on = force ?? !build.on;
  if (on && (state.scene !== 'earth' || inRealm() || fight || ui.isOpen())) return void ui.toast('Build mode works in your town on Earth.', 'bad');
  build.on = on;
  document.querySelector('.hotbar')?.toggleAttribute('hidden', on);
  if (on) {
    build.bar = document.createElement('div');
    build.bar.id = 'buildbar';
    document.getElementById('hud').append(build.bar);
    if (!isBuilding(build.type) && !S.decorAvailable(state).includes(build.type)) build.type = 'b:home';
    setGhost(build.type);
    ui.toast('Build mode: pick a piece below and click to place it.', 'good');
  } else {
    build.bar?.remove();
    build.bar = null;
    build.ghost?.parent?.remove(build.ghost);
    build.ghost = null;
  }
}
function updateBuild() {
  if (!build.on || !build.ghost) return;
  const p = player.object.position;
  let at = locked() ? null : groundAt(pointer.x, pointer.y);
  if (!at || at.distanceTo(p) > 40) at = new THREE.Vector3(p.x + Math.sin(player.facing) * 3.5, 0, p.z + Math.cos(player.facing) * 3.5);
  at.x = Math.round(at.x * 2) / 2;
  at.z = Math.round(at.z * 2) / 2;
  build.at = at;
  const big = isBuilding(build.type);
  const roomy = big ? S.buildingCount(state).used < S.buildingCount(state).room && !onTownRoad(at.x, at.z) : state.decor.length < S.DECOR_MAX;
  build.ok = !buildBlocked(at.x, at.z, big) && state.coins >= pieceCost(build.type) && roomy;
  onGround(build.ghost, at.x, at.z);
  build.ghost.rotation.y = build.rot;
  build.ghost.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(build.ok ? 0x0f2a12 : 0x5a0f0f); });
}
function placeBuild() {
  if (!build.on || !build.at) return;
  if (!build.ok) {
    audio.deny();
    const full = isBuilding(build.type) && S.buildingCount(state).used >= S.buildingCount(state).room;
    return void ui.toast(full ? 'This age has no room for more buildings. Upgrade the ones you have, or build the wonder for a bigger town.' : state.coins < pieceCost(build.type) ? 'Not enough coins for that.' : 'Can’t build there: keep roads, buildings and the gate road clear.', 'bad');
  }
  if (isBuilding(build.type)) {
    const i = S.placeBuilding(state, buildingType(build.type), build.at.x, build.at.z, build.rot);
    if (i < 0) return void audio.deny();
    audio.build();
    refreshPad('earth', i);
    world.setClearings(Object.values(state.padSpots.earth));
    for (let k = 0; k < 2; k++) fx.burst(new THREE.Vector3(build.at.x, 1 + k, build.at.z), [A.C.white, A.C.gold][k], 16, 6, 6);
    ui.toast(`Built a ${S.buildingName(state.pads.earth[i])}. Walk up to it to upgrade.`, 'good');
    refreshHud(); drawBuildBar(); save();
    return;
  }
  const piece = S.placeDecor(state, build.type, build.at.x, build.at.z, build.rot);
  if (!piece) return void audio.deny();
  audio.build();
  syncDecor();
  fx.burst(new THREE.Vector3(piece.x, world.groundHeight('earth', piece.x, piece.z), piece.z), A.C.white, 8, 4, 4);
  refreshHud();
  drawBuildBar();
  save();
}
function removeBuild() {
  if (!build.on || !build.at) return;
  let best = null, dist = 2;
  for (const d of state.decor) {
    const dd = Math.hypot(d.x - build.at.x, d.z - build.at.z);
    if (dd < dist) { dist = dd; best = d; }
  }
  if (!best) return;
  const back = S.removeDecor(state, best.id);
  syncDecor();
  audio.pop();
  ui.toast(`Removed ${S.DECOR[best.type].name}: +${S.fmt(back)} coins back`, 'good');
  refreshHud();
  drawBuildBar();
  save();
}

// Review ghosts: missed practice questions come back as pale books by the board.
const ghosts = [];
function syncReview() {
  const due = state.scene === 'earth' && !inRealm() ? S.dueReviews(state).length : 0;
  const want = Math.min(3, Math.ceil(due / 4));
  while (ghosts.length > want) { const g = ghosts.pop(); g.object.parent?.remove(g.object); g.label?.remove(); }
  while (ghosts.length < want) {
    const object = A.makeCreature('invader', 1);
    object.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.55;
      if (o.material.emissive) o.material.emissive.setHex(0x3a6aa8);
      o.castShadow = false;
    });
    const i = ghosts.length;
    object.position.set(BOARD_POS.x + 2.2 + i * 1.6, 0, BOARD_POS.z - 2.4 - i * 0.8);
    world.earth.add(object);
    ghosts.push({ object, label: i === 0 ? fx.label(object, 2.6, '', 'review') : null });
  }
  if (ghosts[0]) ghosts[0].label.set(`<em>Review</em>${due} missed question${due === 1 ? '' : 's'}<small>press E to go over them</small>`, 'review');
}


// --- Villagers ------------------------------------------------------------------------
// People who live in town: they wander between the fire, the market, the
// board and their homes, talk about your real schoolwork when you're near,
// give a small quest each day, and leave if the town keeps getting wrecked.
const folk = new Map(); // name -> { object, model, label, target, wait, mode, k, lineAt, cheer }
const VILLAGER_TINTS = { Mira: 0x9fd18a, Juna: 0xf2b0a0, Tobin: null, Pell: 0xc9b07a, Odo: null, Wren: 0x8fa8e8, Sela: 0xe0b860, Bram: null };
function spotsFor(person, i) {
  const spots = [];
  const fireA = (i / 8) * Math.PI * 2;
  spots.push({ x: Math.cos(fireA) * 2.9, z: Math.sin(fireA) * 2.9, sit: true }); // by the fire
  spots.push({ x: MARKET_POS.x - Math.sin(Math.atan2(MARKET_POS.x, MARKET_POS.z)) * 3.6 + (i % 3 - 1), z: MARKET_POS.z - 3 + (i % 2) });
  spots.push({ x: BOARD_POS.x - 2.2 + (i % 3), z: BOARD_POS.z - 2.5 });
  const pad = W.padPosition('earth', i % 6);
  spots.push({ x: pad.x * 0.8, z: pad.z * 0.8 });
  const hall = HALL_SLOTS[i % HALL_SLOTS.length];
  spots.push({ x: hall.x * 0.82, z: hall.z * 0.82 });
  for (let k = 0; k < 2; k++) { const a = (hash(person.name + k) % 360) * Math.PI / 180, r = 6 + (hash(person.name + 'r' + k) % 12); spots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); }
  return spots;
}
function syncVillagers() {
  const names = new Set(state.villagers.list.map((p) => p.name));
  for (const [name, f] of folk) {
    if (names.has(name)) continue;
    fx.burst(f.object.position.clone().add(new THREE.Vector3(0, 1, 0)), A.C.white, 14, 5, 5);
    f.object.parent?.remove(f.object);
    f.label.remove();
    folk.delete(name);
  }
  state.villagers.list.forEach((person, i) => {
    if (folk.has(person.name)) return;
    const object = new THREE.Group();
    // New arrivals walk in through the gate.
    object.position.set((i % 3 - 1) * 1.2, 0, W.GATE.z - 1);
    world.earth.add(object);
    const f = { object, model: null, label: fx.label(object, 2.35, '', 'npc empty'), target: null, wait: 1 + i, mode: 'idle', k: hash(person.name) % 7, lineAt: 0, cheer: 0, spots: spotsFor(person, i), i };
    folk.set(person.name, f);
    createVillager(person.look, { tint: VILLAGER_TINTS[person.name] }).then((model) => {
      if (folk.get(person.name) !== f) return;
      f.model = model;
      object.add(model);
    }).catch(() => {});
  });
}
function villagerTick(now) {
  const day = S.villagerDay(state, now);
  if (day) {
    for (const p of day.left) ui.toast(`${p.name} the ${p.role.toLowerCase()} packed up and left. Too much late work.`, 'bad');
    if (day.late) ui.toast(`The town is grumbling: ${day.late} late assignment${day.late === 1 ? '' : 's'} made everyone a bit unhappier.`, 'bad');
  }
  const newcomer = S.moveIn(state, now);
  if (newcomer) ui.toast(`${newcomer.name} the ${newcomer.role.toLowerCase()} moved into town. Go say hi (E).`, 'gold');
  if (day || newcomer) save();
  syncVillagers();
}
function villagersReact(event) {
  for (const p of event.left || []) ui.toast(`${p.name} the ${p.role.toLowerCase()} left town after ${event.item.name} wrecked the gate.`, 'bad');
  if (event.outcome === 'held') for (const f of folk.values()) f.cheer = 4;
  syncVillagers();
}
function moveVillagers(dt, time) {
  const p = player.object.position;
  const now = Date.now();
  for (const person of state.villagers.list) {
    const f = folk.get(person.name);
    if (!f) continue;
    const o = f.object.position;
    const near = Math.hypot(p.x - o.x, p.z - o.z) < 4.8 && state.scene === 'earth' && !inRealm();
    f.cheer = Math.max(0, f.cheer - dt);
    let mode = 'idle';
    // Late at night everyone goes home to bed, except Wren, who keeps the fire.
    const bedtime = phase.sleeping && person.name !== 'Wren';
    if (bedtime && !f.target && f.object.visible) {
      const home = f.spots[3];
      if (Math.hypot(home.x - o.x, home.z - o.z) < 0.4) f.object.visible = false;
      else f.target = home;
    }
    if (!phase.sleeping && !f.object.visible) { f.object.visible = true; f.wait = 2; }
    if (person.name === 'Wren' && phase.sleeping && !f.target && !f.sitting) f.target = f.spots[0];
    if (!f.object.visible) { f.label.set('', 'npc empty'); continue; }
    if (f.cheer > 0) mode = 'cheer';
    else if (near) {
      // Stops to chat: turns to face you.
      f.object.rotation.y = Math.atan2(p.x - o.x, p.z - o.z);
    } else if (f.target) {
      const dx = f.target.x - o.x, dz = f.target.z - o.z, d = Math.hypot(dx, dz);
      if (d < 0.25) {
        f.wait = 6 + (hash(person.name + Math.floor(time)) % 14);
        f.sitting = Boolean(f.target.sit);
        if (f.sitting) f.object.rotation.y = Math.atan2(-o.x, -o.z);
        f.target = null;
      } else {
        const step = Math.min(d, 1.55 * dt);
        o.x += (dx / d) * step;
        o.z += (dz / d) * step;
        f.object.rotation.y = Math.atan2(dx, dz);
        mode = 'walk';
      }
    } else {
      f.wait -= dt;
      if (f.sitting) mode = 'sit';
      if (f.wait <= 0 && !(phase.sleeping && person.name === 'Wren')) {
        f.sitting = false;
        f.target = f.spots[hash(person.name + Math.floor(time / 7)) % f.spots.length];
      }
    }
    o.y = world.groundHeight('earth', o.x, o.z);
    f.mode = mode;
    f.model?.userData.villager.update(dt, mode);
    // What shows over their head: a line when you're close, "!" when their quest is done.
    const ready = person.quest && !person.quest.done && S.questProgress(state, person.quest) >= person.quest.target;
    if (near) {
      if (time - f.lineAt > 6) { f.k += 1; f.lineAt = time; }
      f.label.set(`<em>${person.name} · ${person.role}</em>${escapeHtml(S.villagerLine(state, person, now, f.k))}`, 'npc talk');
    } else if (ready) f.label.set('<b>!</b>', 'npc mark');
    else if (person.mood < 30) f.label.set('<b>…</b>', 'npc sad');
    else f.label.set('', 'npc empty');
  }
}
function openVillager(name) {
  const person = state.villagers.list.find((x) => x.name === name);
  if (!person) return;
  if (S.talkTo(state, name)) save();
  const f = folk.get(name);
  const q = person.quest;
  ui.villager({
    name: person.name, role: person.role, mood: person.mood, friend: person.friend,
    line: S.villagerLine(state, person, Date.now(), f ? f.k : 0),
    quest: q ? { text: q.text, have: S.questProgress(state, q), need: q.target, done: q.done, reward: q.reward.coins } : null,
    gift: S.giftReady(state, name),
    onClaim: () => {
      const r = S.claimVillagerQuest(state, name);
      if (!r) return;
      audio.chest();
      if (f) f.cheer = 3;
      fx.coinsTo(f ? f.object.position.clone() : player.object.position.clone(), player.object, 8, () => audio.coin());
      ui.toast(`${name}: thank you! +${S.fmt(r.coins)} coins, and you two are closer now.`, 'gold');
      refreshHud(); save(); ui.close(); openVillager(name);
    },
    onGift: () => {
      const g = S.villagerGift(state, name);
      if (!g) return;
      audio.coin();
      ui.toast(g.tea ? `${name} gave you a cup of study tea: your next session pays 50% more XP.` : `${name} slipped you ${S.fmt(g.coins)} coins.`, 'gold');
      refreshHud(); save(); ui.close(); openVillager(name);
    },
  });
}


// --- Time of day: the game follows your real clock ------------------------------------
let clockOverride = null; // hours, for testing (window.epoch.hour)
function dayPhase(date = new Date()) {
  const h = clockOverride ?? date.getHours() + date.getMinutes() / 60;
  let light = 1, warm = 0;
  if (h >= 18 && h < 20.5) light = 1 - (h - 18) / 2.5;
  else if (h >= 20.5 || h < 5) light = 0;
  else if (h >= 5 && h < 7) light = (h - 5) / 2;
  if (h >= 17.5 && h < 21) warm = Math.max(0, 1 - Math.abs(h - 19.2) / 1.6);
  else if (h >= 4.8 && h < 7.5) warm = Math.max(0, 1 - Math.abs(h - 6) / 1.2);
  return { h, light, warm, night: light < 0.35, sleeping: h >= 23 || h < 6 };
}
let phase = dayPhase();
function applyTimeOfDay() {
  phase = dayPhase();
  const space = state.scene === 'moon' || (inRealm() && realms.active !== 'wilds');
  if (!space) world.setDaylight(phase.light, phase.warm);
  // Lamps, hall windows and the fire matter more after dark.
  const dark = 1 - phase.light;
  const brighten = (o) => {
    if (!o.isMesh || !o.material.emissive || (o.name !== 'glow' && o.name !== 'window')) return;
    // Materials are shared between meshes, so the daytime glow is kept on the
    // material itself; keeping it per mesh multiplied the same material over and over.
    const m = o.material;
    if (m.userData.baseGlow === undefined) m.userData.baseGlow = m.emissiveIntensity;
    // Windows warm up a lot; lamps already glow, so only a little (bloom does the rest).
    m.emissiveIntensity = m.userData.baseGlow * (o.name === 'window' ? 1 + 2 * dark : 0.7 + 0.3 * dark);
  };
  for (const o of decorObjects.values()) o.traverse(brighten);
  for (const h of halls.values()) h.object.traverse(brighten);
}

// --- Daily quests and the morning report ------------------------------------------------
const dailyEl = document.getElementById('daily');
dailyEl?.addEventListener('click', () => openDaily());
function drawDaily() {
  if (!dailyEl) return;
  const d = state.daily;
  const done = d.quests.filter((q) => S.dailyProgress(state, q) >= q.target).length;
  dailyEl.replaceChildren();
  const head = document.createElement('div');
  head.className = 'daily-head';
  head.innerHTML = `<b>${d.fromPlan ? 'Your plan' : 'Today'}</b><span>${done}/${d.quests.length}</span>${d.streak ? `<em>🔥 ${d.streak} day${d.streak === 1 ? '' : 's'}</em>` : ''}`;
  dailyEl.append(head);
  for (const q of d.quests) {
    const row = document.createElement('div');
    const have = S.dailyProgress(state, q);
    row.className = `daily-row ${have >= q.target ? 'done' : ''} ${q.type === 'plan' ? 'plan' : ''}`;
    row.innerHTML = `<i></i><span>${escapeHtml(q.text)}</span><small>${have >= q.target ? '✓' : q.type === 'plan' ? (q.minutes ? `${q.minutes}m` : '') : `${have}/${q.target}`}</small>`;
    // Planned tasks come from Soma: click to check one off (it updates in Soma too).
    if (q.type === 'plan' && !q.claimed) row.addEventListener('click', (e) => { e.stopPropagation(); togglePlanTask(q.id, have < 1); });
    dailyEl.append(row);
  }
}
function dailyTick(startup = false) {
  const fresh = S.dailyRefresh(state);
  const r = S.claimDaily(state);
  if (r.claimed) {
    audio.coin();
    ui.toast(`Daily quest${r.claimed === 1 ? '' : 's'} done: +${S.fmt(r.coins)} coins`, 'good');
  }
  if (r.chest) {
    audio.era();
    ui.banner(r.milestone ? `${r.streak}-day streak!` : `Day ${r.streak} streak`, r.milestone ? `A ${r.milestone} chest and 5 lures` : 'All three done: a chest is on your plaza');
    syncChests();
  }
  if (fresh || r.claimed) save();
  drawDaily();
  if (fresh && !startup && state.daily.reported !== state.daily.day) openMorning();
}
function openDaily() { openMorning(true); }
function openMorning(manual = false) {
  if (ui.isOpen()) return;
  state.daily.reported = state.daily.day;
  save();
  const now = Date.now();
  const next = S.threats(state, now).map((t) => t.item).sort((a, b) => a.dueAt - b.dueAt);
  const exam = next.find((a) => a.kind === 'boss');
  const greeting = phase.h < 12 && phase.h >= 4 ? 'Good morning' : phase.h < 18 ? 'Good afternoon' : 'Good evening';
  ui.morning({
    title: manual ? 'Today' : greeting,
    away: !manual && awayMs > 60000 ? { time: timeLeft(awayMs), coins: awayEarned } : null,
    due: next.filter((a) => a.kind !== 'boss' && a.dueAt - now < 2 * 86400000).slice(0, 4).map((a) => ({ name: a.name, course: a.courseName, time: a.dueAt < now ? `${timeLeft(now - a.dueAt)} late` : `in ${timeLeft(a.dueAt - now)}`, late: a.dueAt < now })),
    exam: exam ? { name: exam.name, course: exam.courseName, armor: Math.round(S.examArmor(state, exam) * 100), time: timeLeft(exam.dueAt - now) } : null,
    reviews: S.dueReviews(state, now).length,
    people: state.villagers.list.length,
    sad: state.villagers.list.filter((p) => p.mood < 30).map((p) => p.name),
    quests: state.daily.quests.map((q) => ({ text: q.text, have: S.dailyProgress(state, q), need: q.target, reward: q.reward })),
    streak: state.daily.streak, best: state.daily.best || 0,
    lures: state.critters.lures,
    onGo: () => ui.close(),
  });
}

// --- Creatures in the Wilds, lures, the collection book and your pet ------------------
const critters = []; // { species, object, target, wait, flee, gone }
let critterSpawn = 0;
function clearCritters() {
  for (const c of critters) c.object.parent?.remove(c.object);
  critters.length = 0;
}
function spawnCritter() {
  const group = realms.group;
  if (!group) return;
  const species = S.rollCritter(phase.night);
  const object = A.makeCritter(species);
  const p = player.object.position;
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 30;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (Math.hypot(x, z) > realms.radius - 5) continue;
    object.position.set(x, 0, z);
    object.rotation.y = Math.random() * 6.28;
    group.add(object);
    critters.push({ species, object, target: null, wait: 1 + Math.random() * 3, flee: 0, gone: false, phase: Math.random() * 6 });
    return;
  }
}
function updateCritters(dt, time) {
  if (realms.active !== 'wilds') { if (critters.length) clearCritters(); return; }
  critterSpawn -= dt;
  if (critterSpawn <= 0 && critters.filter((c) => !c.gone).length < 6) { spawnCritter(); critterSpawn = 4; }
  const p = player.object.position;
  for (let i = critters.length - 1; i >= 0; i--) {
    const c = critters[i];
    const o = c.object.position;
    const dPlayer = Math.hypot(p.x - o.x, p.z - o.z);
    // Running at them scares them off; walking up slowly works.
    if (!c.gone && dPlayer < 3.2 && keys.has('shift')) c.flee = Math.max(c.flee, 2.5);
    let speed = 0, tx = o.x, tz = o.z;
    if (c.flee > 0 || c.gone) {
      c.flee -= dt;
      const away = Math.atan2(o.x - p.x, o.z - p.z);
      tx = o.x + Math.sin(away) * 5; tz = o.z + Math.cos(away) * 5;
      speed = 7;
      if (c.gone && dPlayer > 30) { c.object.parent?.remove(c.object); critters.splice(i, 1); continue; }
    } else if (c.target) {
      tx = c.target.x; tz = c.target.z; speed = c.object.userData.flies ? 1.4 : 1.8;
      if (Math.hypot(tx - o.x, tz - o.z) < 0.3) { c.target = null; c.wait = 2 + Math.random() * 4; }
    } else {
      c.wait -= dt;
      if (c.wait <= 0) {
        const a = Math.random() * Math.PI * 2;
        c.target = { x: o.x + Math.cos(a) * (3 + Math.random() * 6), z: o.z + Math.sin(a) * (3 + Math.random() * 6) };
        if (Math.hypot(c.target.x, c.target.z) > realms.radius - 5) c.target = { x: o.x * 0.8, z: o.z * 0.8 };
      }
    }
    const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
    const body = c.object.userData.body;
    if (speed && d > 0.05) {
      o.x += (dx / d) * Math.min(d, speed * dt);
      o.z += (dz / d) * Math.min(d, speed * dt);
      c.object.rotation.y = Math.atan2(dx, dz);
      // Bunnies and frogs hop; the rest trot.
      const hop = c.species === 'bunny' || c.species === 'frog';
      body.position.y = hop ? Math.abs(Math.sin(time * 9 + c.phase)) * 0.35 : Math.abs(Math.sin(time * 12 + c.phase)) * 0.06;
    } else {
      body.position.y = 0;
      if (dPlayer < 6) c.object.rotation.y += (Math.atan2(p.x - o.x, p.z - o.z) - c.object.rotation.y) * Math.min(1, dt * 3);
    }
    if (c.object.userData.flies) body.position.y = 0.4 + Math.sin(time * 2 + c.phase) * 0.25;
    for (const w of c.object.userData.wings || []) w.rotation.z = Math.sin(time * (c.species === 'moth' ? 14 : 3) + c.phase) * (c.species === 'moth' ? 0.7 : 0.15) * (w.position.x < 0 ? 1 : -1);
  }
}
function catchCritter(c) {
  if (c.gone) return;
  if (state.critters.lures < 1) return void ui.toast('No lures left. Every 10 minutes of studying earns one.', 'bad');
  const info = S.CRITTERS[c.species];
  const r = S.tryCatch(state, c.species);
  if (!r) return;
  if (r.ok) {
    fx.burst(c.object.position.clone().add(new THREE.Vector3(0, 0.6, 0)), A.C.gold, 22, 6, 6);
    audio.chest();
    ui.toast(r.first ? `New creature: ${info.name}! +${S.fmt(r.coins)} coins. Open the collection with K.` : `Caught another ${info.name}.`, 'gold');
    if (r.first && state.critters.pet === c.species) { ui.toast(`${info.name} is following you now. It boosts study XP.`, 'good'); dressPet(); }
    c.object.parent?.remove(c.object);
    critters.splice(critters.indexOf(c), 1);
  } else {
    audio.deny();
    fx.burst(c.object.position.clone().add(new THREE.Vector3(0, 0.6, 0)), A.C.white, 10, 5, 5);
    ui.toast(`The ${info.name.toLowerCase()} got away. (${state.critters.lures} lure${state.critters.lures === 1 ? '' : 's'} left)`, 'bad');
    c.gone = true;
  }
  save();
}
let petObject = null;
function dressPet() {
  if (petObject) petObject.parent?.remove(petObject);
  petObject = null;
  const id = state.critters.pet;
  if (!id) return;
  petObject = A.makeCritter(id);
  petObject.scale.setScalar(id === 'stag' ? 0.55 : 0.85);
  petObject.position.copy(player.object.position).add(new THREE.Vector3(1.4, 0, -1.4));
  scene.add(petObject);
}
function updatePet(dt, time) {
  if (!petObject) return;
  const p = player.object.position, o = petObject.position;
  const behind = new THREE.Vector3(p.x - Math.sin(player.facing) * 1.6 + Math.cos(player.facing) * 0.9, p.y, p.z - Math.cos(player.facing) * 1.6 - Math.sin(player.facing) * 0.9);
  const dx = behind.x - o.x, dz = behind.z - o.z, d = Math.hypot(dx, dz);
  if (d > 25) o.copy(behind);
  const body = petObject.userData.body;
  if (d > 0.4) {
    const step = Math.min(d, Math.max(3, d * 3) * dt);
    o.x += (dx / d) * step; o.z += (dz / d) * step;
    petObject.rotation.y = Math.atan2(dx, dz);
    body.position.y = Math.abs(Math.sin(time * 10)) * 0.2;
  } else body.position.y *= 0.8;
  o.y = inRealm() ? p.y * 0.0 : (state.scene === 'earth' ? world.groundHeight('earth', o.x, o.z) : p.y);
  if (petObject.userData.flies) body.position.y = 0.6 + Math.sin(time * 2) * 0.2;
  for (const w of petObject.userData.wings || []) w.rotation.z = Math.sin(time * 12) * 0.5 * (w.position.x < 0 ? 1 : -1);
}
function openCollection() {
  if (ui.isOpen()) return;
  ui.collection({
    lures: state.critters.lures, pet: state.critters.pet,
    list: Object.entries(S.CRITTERS).map(([id, c]) => ({ id, ...c, count: state.critters.caught[id] || 0, bonus: { common: 2, rare: 4, epic: 7, legendary: 12 }[c.rarity] })),
    onPet: (id) => { S.setPet(state, id); dressPet(); save(); ui.close(); openCollection(); },
  });
}


// --- Soma: the plan, the syllabus, the Watchtower and the Oracle ---------------------------
// With Soma's plan (trial or paid): syllabus readings Canvas doesn't show
// march as shadow books, today's AI-planned tasks become the daily quests,
// and the Oracle plans your week. Without it, the shadows march unrevealed.
let somaBusy = false;
let somaAt = 0;
async function somaRefresh(force = false) {
  if (somaBusy || (!force && Date.now() - somaAt < 180000)) return;
  somaBusy = true;
  somaAt = Date.now();
  try {
    const status = await Soma.planStatus();
    const plan = status === 'offline' ? { todos: [], readings: [] } : await Soma.loadPlan().catch(() => ({ todos: [], readings: [] }));
    S.setSomaPlan(state, { status, ...plan });
    syncShadows();
    drawDaily();
    save();
  } finally {
    somaBusy = false;
  }
}
window.addEventListener('focus', () => somaRefresh());

const WATCH_POS = W.WATCHTOWER_POS;
const watchtower = A.makeWatchtower();
onGround(watchtower, WATCH_POS.x, WATCH_POS.z);
watchtower.rotation.y = Math.atan2(-WATCH_POS.x, -WATCH_POS.z);
world.earth.add(watchtower);
const watchLabel = fx.label(watchtower, watchtower.userData.height + 0.3, '<em>Soma</em>Watchtower', 'board');

// Shadow books: syllabus readings due in the next 10 days (or a week late).
const shadows = new Map(); // reading id -> { object, label, reading, revealed }
function syncShadows() {
  const now = Date.now();
  const revealed = state.soma.status === 'plus';
  const wanted = new Map();
  if (state.scene === 'earth' && !inRealm()) {
    for (const r of state.soma.readings) {
      if (r.exam || !r.due) continue;
      const due = Date.parse(`${r.due}T23:59:00`);
      if (!Number.isFinite(due) || due - now > 10 * 86400000 || now - due > 7 * 86400000) continue;
      wanted.set(r.id, { r, due });
    }
  }
  for (const [id, sh] of shadows) {
    if (wanted.has(id) && sh.revealed === revealed) continue;
    sh.object.parent?.remove(sh.object);
    sh.label.remove();
    shadows.delete(id);
  }
  let i = 0;
  for (const [id, { r, due }] of wanted) {
    let sh = shadows.get(id);
    if (!sh) {
      const object = A.makeShadowBook(revealed);
      world.earth.add(object);
      sh = { object, reading: r, revealed, label: fx.label(object, 2.4, '', 'shadow') };
      shadows.set(id, sh);
    }
    // They march on the side lanes, a step closer each day, like Canvas work.
    const t = Math.max(0, Math.min(1, 1 - (due - now) / (10 * 86400000)));
    const lane = (i % 2 ? 1 : -1) * (6.5 + (i % 3) * 1.4);
    sh.home = { x: lane, z: W.PATH_START_Z + (W.PATH_END_Z - W.PATH_START_Z) * t };
    if (!sh.placed) { sh.object.position.set(lane, 0, W.PATH_START_Z + 4); sh.placed = true; }
    sh.reading = r;
    const when = due < now ? `${timeLeft(now - due)} behind` : `due ${new Date(due).toLocaleDateString(undefined, { weekday: 'short' })}`;
    sh.label.set(revealed
      ? `<em>Syllabus · ${escapeHtml(r.course)}</em>${escapeHtml(`${r.label}${r.title ? ` ${r.title}` : ''}`)}<small>${when} · not on Canvas</small>`
      : '<em>Not on Canvas</em>Something from your syllabus<small>the Watchtower can reveal it</small>', `shadow ${revealed ? 'seen' : ''}`);
    i += 1;
  }
}
function moveShadows(dt, time) {
  for (const sh of shadows.values()) {
    const o = sh.object.position;
    if (sh.home) {
      const dx = sh.home.x - o.x, dz = sh.home.z - o.z, d = Math.hypot(dx, dz);
      if (d > 0.1) { o.x += (dx / d) * Math.min(d, 2 * dt); o.z += (dz / d) * Math.min(d, 2 * dt); sh.object.rotation.y = Math.atan2(dx, dz); }
      else sh.object.rotation.y = Math.PI;
    }
    o.y = 0.15 + Math.sin(time * 1.4 + o.x) * 0.12;
    for (const w of sh.object.userData.wisps.children) {
      const t = (time * 0.5 + w.userData.seed) % 1;
      w.position.set(Math.sin(w.userData.seed * 5 + time) * 0.5, 0.4 + t * 1.6, -0.3 + Math.cos(w.userData.seed * 3) * 0.3);
      w.material.opacity = 0.55 * (1 - t);
    }
  }
}
async function readShadow(id) {
  const sh = shadows.get(id);
  if (!sh) return;
  try {
    await Soma.markRead(id);
  } catch {
    return void ui.toast('Could not reach Soma to mark it read. Try again in a moment.', 'bad');
  }
  const r = S.readingDone(state, id);
  for (let k = 0; k < 2; k++) fx.burst(sh.object.position.clone().add(new THREE.Vector3(0, 1 + k, 0)), [0xb48cff, A.C.white][k], 18, 6, 6);
  audio.pop();
  if (r) { gainedXp(r); ui.toast(`Marked read in Soma: ${sh.reading.label}. +${S.fmt(r.coins)} coins, +${r.xp} XP`, 'good'); }
  syncShadows();
  refreshHud();
  save();
}

/** The Watchtower: what Canvas doesn't show, your plan, and the Oracle. */
function openWatchtower() {
  const st = state.soma;
  const now = Date.now();
  const days = new Map();
  for (const t of st.todos) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date).push({ ...t, done: Boolean(st.done[t.id]) });
  }
  ui.watchtower({
    status: st.status,
    readings: st.readings.filter((r) => !r.exam && r.due).slice(0, 12).map((r) => ({ id: r.id, name: `${r.label}${r.title ? ` ${r.title}` : ''}`, course: r.course, due: r.due, late: Date.parse(`${r.due}T23:59:00`) < now })),
    hidden: st.readings.filter((r) => !r.exam && r.due).length,
    plan: [...days].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, 7).map(([date, list]) => ({ date, label: new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), list })),
    upgrade: Soma.UPGRADE_URL,
    onRead: (id) => { ui.close(); readShadow(id); },
    onToggle: (id, done) => togglePlanTask(id, done),
    onOracle: (ask) => {
      const due = [
        ...S.threats(state, now).map((t) => t.item).map((a) => `${a.name} (${a.courseName}) due ${new Date(a.dueAt).toDateString()}${a.kind === 'boss' ? ', exam' : ''}`),
        ...st.readings.slice(0, 20).map((r) => `Read ${r.label}${r.title ? ` ${r.title}` : ''} (${r.course}) by ${r.due}, from the syllabus`),
      ];
      const planned = st.todos.filter((t) => !st.done[t.id]).map((t) => `${t.date}: ${t.text}`);
      return Soma.askOracle({ due, planned, ask });
    },
    onAccept: async (tasks) => {
      await Soma.addTasks(tasks);
      ui.toast(`Added ${tasks.length} task${tasks.length === 1 ? '' : 's'} to your Soma plan. They'll show up as daily quests on their day.`, 'gold');
      audio.chest();
      await somaRefresh(true);
    },
  });
}
async function togglePlanTask(id, done) {
  state.soma.done[id] = done;
  drawDaily();
  try { await Soma.setTodoDone(id, done); } catch { ui.toast('Could not reach Soma. It will sync next time.', 'bad'); }
  dailyTick();
  save();
}


// --- Thumbnails: real renders of the actual models, for the pass and the style panel ---
const thumbCache = new Map();
const thumbScene = new THREE.Scene();
thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a7a, 2.4));
const thumbSun = new THREE.DirectionalLight(0xfff2e0, 2.6);
thumbSun.position.set(3, 5, 4);
thumbScene.add(thumbSun);
const thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const thumbTarget = new THREE.WebGLRenderTarget(256, 256, { samples: 4 });
function renderThumb(object, angle = 0.6) {
  thumbScene.add(object);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const d = sphere.radius / Math.sin((thumbCam.fov * Math.PI) / 360) * 1.05;
  thumbCam.position.set(sphere.center.x + Math.sin(angle) * d, sphere.center.y + d * 0.35, sphere.center.z + Math.cos(angle) * d);
  thumbCam.lookAt(sphere.center);
  const before = renderer.getRenderTarget();
  renderer.setRenderTarget(thumbTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(thumbScene, thumbCam);
  const px = new Uint8Array(256 * 256 * 4);
  renderer.readRenderTargetPixels(thumbTarget, 0, 0, 256, 256, px);
  renderer.setRenderTarget(before);
  thumbScene.remove(object);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  // Flip rows and go from linear light to screen colour.
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = ((255 - y) * 256 + x) * 4, o = (y * 256 + x) * 4;
      for (let k = 0; k < 3; k++) img.data[o + k] = 255 * Math.pow(px[i + k] / 255, 1 / 2.2);
      img.data[o + 3] = px[i + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
function makeLure() {
  const g = new THREE.Group();
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.7, 14), new THREE.MeshStandardMaterial({ color: 0xbfe8f5, transparent: true, opacity: 0.45, roughness: 0.1 }));
  jar.position.y = 0.35;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc04a, emissiveIntensity: 2 }));
  glow.position.y = 0.35;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 14), new THREE.MeshStandardMaterial({ color: 0x8a5a3a }));
  lid.position.y = 0.74;
  g.add(jar, glow, lid);
  return g;
}
/** A data URL for a reward or cosmetic; resolves once the model is ready. */
function thumbFor(reward) {
  const key = `${reward.kind}:${reward.id || reward.rarity || ''}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let job;
  if (reward.kind === 'outfit') {
    const o = S.OUTFITS[reward.id];
    job = previewAvatar(o.base, o.palette).then((m) => renderThumb(m, 0.5));
  } else {
    let object;
    if (reward.kind === 'decor') object = A.makeDecor(reward.id);
    else if (reward.kind === 'pet') object = A.makeCritter(reward.id);
    else if (reward.kind === 'chest') { object = A.makeChest(reward.rarity); object.getObjectByName('beam')?.removeFromParent(); }
    else if (reward.kind === 'lures') object = makeLure();
    else if (reward.kind === 'coins') {
      // A little stack with one coin standing on its edge.
      object = new THREE.Group();
      for (let i = 0; i < 4; i++) { const c = A.makeCoin(); c.rotation.set(0, i * 0.4, 0); c.position.set((i % 2) * 0.04, 0.05 + i * 0.13, 0); object.add(c); }
      const up = A.makeCoin(); up.position.set(0.75, 0.42, 0.1); up.rotation.y = 0.5; object.add(up);
    }
    else if (reward.kind === 'theme') object = A.makeLanternScene();
    else if (reward.kind === 'collectible') object = collectibleModel(reward.id);
    job = Promise.resolve(renderThumb(object, reward.kind === 'decor' || reward.kind === 'collectible' ? 0.7 : 0.4));
  }
  thumbCache.set(key, job);
  return job;
}
const rewardName = (r) => r.kind === 'outfit' ? S.OUTFITS[r.id].name : r.kind === 'theme' ? S.THEMES[r.id].name : r.kind === 'decor' ? S.DECOR[r.id].name
  : r.kind === 'pet' ? S.CRITTERS[r.id].name : r.kind === 'chest' ? `${r.rarity[0].toUpperCase()}${r.rarity.slice(1)} chest` : r.kind === 'lures' ? `${r.n} lures` : 'Coins';

// --- The Semester Pass panel ------------------------------------------------------------
function openPass() {
  if (ui.isOpen()) return;
  const p = state.pass;
  const tier = S.passTier(state);
  ui.pass({
    season: p.season, tier, tiers: S.PASS_TIERS, points: p.points, per: S.PASS_TIER_POINTS, premium: p.premium,
    rows: S.PASS_REWARDS.map((r) => ({
      tier: r.tier,
      free: { ...r.free, name: rewardName(r.free), claimed: p.freeClaimed.includes(r.tier) },
      premium: { ...r.premium, name: rewardName(r.premium), claimed: p.premiumClaimed.includes(r.tier) },
    })),
    thumb: thumbFor,
    onClaim: (t, track) => {
      const got = S.claimPass(state, t, track);
      if (!got) return;
      audio.chest();
      ui.toast(`Semester Pass: ${rewardName(got)}${got.coins ? ` (+${S.fmt(got.coins)})` : ''}`, 'gold');
      if (got.kind === 'chest') syncChests();
      if (got.kind === 'outfit') ui.toast('New outfit: try it on from Style (Hero panel).', 'good');
      if (got.kind === 'theme') ui.toast('New town theme: turn it on from Style (Hero panel).', 'good');
      refreshHud(); save(); ui.close(); openPass();
    },
    onClaimAll: () => {
      let n = 0;
      for (const [t, track] of S.passClaimable(state)) if (S.claimPass(state, t, track)) n += 1;
      if (n) { audio.chest(); ui.toast(`Claimed ${n} reward${n === 1 ? '' : 's'}`, 'gold'); syncChests(); }
      refreshHud(); save(); ui.close(); openPass();
    },
  });
}

// --- Style: outfits, town themes, and the dressing room ------------------------------------
let tryOn = null; // { outfit, prevOutfit, cam } while in the dressing room
function openStyle() {
  if (ui.isOpen()) return;
  const c = state.cosmetics;
  ui.style({
    outfits: Object.entries(S.OUTFITS).map(([id, o]) => ({ id, ...o, owned: c.outfits.includes(id), on: c.outfit === id })),
    themes: Object.entries(S.THEMES).map(([id, t]) => ({ id, ...t, owned: c.themes.includes(id), on: c.theme === id })),
    thumb: thumbFor,
    onTry: (id) => { ui.close(); startTryOn(id); },
    onWear: (id) => { c.outfit = id; save(); wearLook(); ui.close(); openStyle(); },
    onTheme: (id) => { c.theme = c.theme === id ? null : id; save(); applyTheme(); ui.close(); openStyle(); },
    onPass: () => { ui.close(); openPass(); },
  });
}
function startTryOn(id) {
  tryOn = { outfit: id, prev: state.cosmetics.outfit, cam: { ...cam } };
  state.cosmetics.outfit = id;
  wearLook();
  ui.dressing({
    name: S.OUTFITS[id].name, text: S.OUTFITS[id].text, owned: state.cosmetics.outfits.includes(id),
    onWear: () => { const t = tryOn; tryOn = null; Object.assign(cam, t.cam); save(); ui.toast(`Wearing ${S.OUTFITS[id].name}`, 'gold'); },
    onBack: () => { const t = tryOn; tryOn = null; state.cosmetics.outfit = t.prev; Object.assign(cam, t.cam); wearLook(); },
  });
}

// Town themes: the Lantern Festival hangs lanterns over the roads.
let themeObject = null;
function applyTheme() {
  if (themeObject) { themeObject.parent?.remove(themeObject); themeObject = null; }
  if (state.cosmetics.theme === 'lanterns') {
    themeObject = A.makeLanternFestival();
    world.earth.add(themeObject);
  }
}
function updateTheme(dt, time) {
  if (!themeObject) return;
  const { lanterns, sky, mats } = themeObject.userData;
  const dark = 1 - phase.light;
  for (const m of mats) m.emissiveIntensity = 0.45 + dark * 0.75;
  for (const l of lanterns) l.rotation.z = Math.sin(time * 1.3 + l.userData.phase) * 0.08;
  // Sky lanterns drift up after dark, then start again from the town.
  for (const s of sky) {
    s.visible = dark > 0.4;
    if (!s.visible) continue;
    const t = (time * 0.018 + s.userData.seed) % 1;
    s.position.set(s.userData.x + Math.sin(time * 0.2 + s.userData.seed * 9) * 3 * t, 2 + t * 70, s.userData.z + t * 12);
    s.material.opacity = Math.min(1, (1 - t) * 1.6);
  }
}

// The Frost Knight leaves frost where it steps.
const frost = [];
let frostStep = 0;
function updateTrail(dt) {
  const outfit = S.OUTFITS[state.cosmetics.outfit];
  for (let i = frost.length - 1; i >= 0; i--) {
    const f = frost[i];
    f.life -= dt;
    f.mesh.material.opacity = Math.max(0, f.life / 2.4) * 0.85;
    if (f.life <= 0) { f.mesh.parent?.remove(f.mesh); frost.splice(i, 1); }
  }
  if (!outfit || outfit.trail !== 'frost' || !player.grounded) return;
  const moving = keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d') || keys.has('arrowup') || keys.has('arrowdown') || keys.has('arrowleft') || keys.has('arrowright');
  frostStep -= dt;
  if (!moving || frostStep > 0) return;
  frostStep = 0.22;
  const p = player.object.position;
  const side = frost.length % 2 ? 0.18 : -0.18;
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), new THREE.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, opacity: 0.85, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.scale.set(0.8, 1.3, 1);
  m.position.set(p.x + Math.cos(player.facing) * side, p.y + 0.06, p.z - Math.sin(player.facing) * side);
  scene.add(m);
  frost.push({ mesh: m, life: 2.4 });
  if (Math.random() < 0.5) fx.burst(p.clone().add(new THREE.Vector3(0, 0.2, 0)), 0xdff4ff, 3, 1.5, 2);
}


// --- Course fronts: each class's work comes from its own lair ----------------------------
const lairs = new Map(); // courseId -> { object, label }
function courseOrder() {
  return S.courseHalls(state).map((h) => h.id);
}
function frontIndex(courseId) {
  const i = courseOrder().indexOf(courseId);
  return (i < 0 ? hash(String(courseId)) : i) % W.FRONT_ANGLES.length;
}
function frontFor(courseId) { return W.FRONT_POS[frontIndex(courseId)]; }
/** Where an item stands on its front: t 0 at the lair, 1 at the edge of town. */
function frontSpot(item, t, boss = false) {
  const a = (W.FRONT_ANGLES[frontIndex(item.courseId)] * Math.PI) / 180;
  const r = W.FRONT_R - 3 - (W.FRONT_R - 3 - W.FRONT_STOP) * t;
  const lane = boss ? 0 : ((hash(item.id) % 5) - 2) * 1.6;
  return { x: Math.cos(a) * r - Math.sin(a) * lane, z: Math.sin(a) * r + Math.cos(a) * lane };
}
const COURSE_COLORS = [0x4a78d0, 0xd9534f, 0x3fb8a8, 0xf08a3c, 0x7a56c2, 0xc9a227];
function syncFronts() {
  const ids = state.scene === 'earth' && !inRealm() ? courseOrder().slice(0, W.FRONT_ANGLES.length) : [];
  for (const [id, l] of lairs) if (!ids.includes(id)) { l.object.parent?.remove(l.object); l.label.remove(); lairs.delete(id); }
  const names = new Map(S.courseHalls(state).map((h) => [h.id, h.name]));
  const now = Date.now();
  ids.forEach((id) => {
    let l = lairs.get(id);
    if (!l) {
      const at = frontFor(id);
      const object = A.makeLair(COURSE_COLORS[hash(id) % COURSE_COLORS.length]);
      onGround(object, at.x, at.z);
      faceCentre(object);
      world.earth.add(object);
      l = { object, label: fx.label(object, 5.2, '', 'board') };
      lairs.set(id, l);
    }
    const coming = S.threats(state, now).filter((x) => x.item.courseId === id).length;
    l.label.set(`<em>${escapeHtml(names.get(id) || 'Course')} front</em>${coming ? `${coming} on the way` : 'Quiet for now'}`, 'board');
  });
}
function animateLairs(time) {
  for (const l of lairs.values()) {
    const { rift, swirl } = l.object.userData;
    rift.material.opacity = 0.7 + Math.sin(time * 2) * 0.12;
    swirl.rotation.z = -time * 1.2;
  }
}

// --- Packs: an assignment's steps follow it as minions --------------------------------------
const packs = new Map(); // itemId -> Map(stepId -> { object, step })
function syncPacks() {
  for (const [itemId, pack] of packs) {
    const inv = invaders.get(itemId);
    const live = new Set((state.steps[itemId] || []).filter((x) => !x.done).map((x) => x.id));
    for (const [stepId, m] of pack) {
      if (inv && live.has(stepId)) continue;
      if (inv) for (let k = 0; k < 2; k++) fx.burst(m.object.position.clone().add(new THREE.Vector3(0, 0.5 + k * 0.4, 0)), [A.C.gold, A.C.white][k], 10, 4, 5);
      m.object.parent?.remove(m.object);
      m.label?.remove();
      pack.delete(stepId);
    }
    if (!inv) packs.delete(itemId);
  }
  for (const inv of invaders.values()) {
    if (inv.boss) continue;
    const steps = (state.steps[inv.item.id] || []).filter((x) => !x.done);
    if (!steps.length) continue;
    let pack = packs.get(inv.item.id);
    if (!pack) { pack = new Map(); packs.set(inv.item.id, pack); }
    steps.forEach((step, i) => {
      if (pack.has(step.id)) return;
      const object = A.makeCreature('invader', 0);
      object.scale.multiplyScalar(0.78);
      object.position.copy(inv.object.position);
      world.earth.add(object);
      pack.set(step.id, { object, step, slot: i });
    });
  }
}
function movePacks(dt, time) {
  const p = player.object.position;
  for (const [itemId, pack] of packs) {
    const inv = invaders.get(itemId);
    if (!inv) continue;
    const lead = inv.object.position;
    let i = 0;
    const n = pack.size;
    for (const m of pack.values()) {
      // Minions trail their leader in a loose fan.
      const a = inv.object.rotation.y + Math.PI + ((i - (n - 1) / 2) * 0.62);
      const tx = lead.x + Math.sin(a) * 2.6, tz = lead.z + Math.cos(a) * 2.6;
      const o = m.object.position;
      const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
      if (d > 0.05) { o.x += (dx / d) * Math.min(d, Math.max(2.5, d * 3) * dt); o.z += (dz / d) * Math.min(d, Math.max(2.5, d * 3) * dt); m.object.rotation.y = Math.atan2(dx, dz); }
      o.y = world.groundHeight('earth', o.x, o.z);
      const feet = m.object.userData.feet;
      const pace = d > 0.2 ? 12 : 2;
      feet[0].position.y = 0.12 + Math.max(0, Math.sin(time * pace + i)) * 0.16;
      feet[1].position.y = 0.12 + Math.max(0, -Math.sin(time * pace + i)) * 0.16;
      // Its step shows when you're close.
      const near = Math.hypot(p.x - o.x, p.z - o.z) < 4.5;
      if (near && !m.label) m.label = fx.label(m.object, 1.6, `<em>Step</em>${escapeHtml(m.step.text)}`, 'step');
      else if (!near && m.label) { m.label.remove(); m.label = null; }
      i += 1;
    }
  }
}
async function doneStep(itemId, stepId) {
  const r = S.finishStep(state, itemId, stepId);
  if (!r) return;
  audio.coin();
  gainedXp(r);
  if (r.step.somaId) Soma.setTodoDone(r.step.somaId, true).catch(() => ui.toast('Could not reach Soma; it will catch up.', 'bad'));
  ui.toast(r.left ? `Step done: ${r.step.text}. +${S.fmt(r.coins)} coins · ${r.left} to go` : `Last step done! Hand ${state.school.items[itemId]?.name || 'it'} in on Canvas to finish it off.`, 'good');
  syncPacks();
  syncInvaders(Date.now());
  drawDaily();
  save();
}
function openSteps(itemId) {
  const item = state.school.items[itemId];
  if (!item || ui.isOpen()) return;
  ui.steps({
    name: item.name, course: item.courseName, due: timeLeft(item.dueAt - Date.now()), late: item.dueAt < Date.now(),
    steps: (state.steps[itemId] || []).map((x) => ({ ...x })),
    fromSoma: (state.steps[itemId] || []).some((x) => x.somaId),
    template: S.stepTemplate(item),
    onBreak: (texts) => { S.breakDown(state, itemId, texts); syncPacks(); syncInvaders(Date.now()); save(); ui.close(); openSteps(itemId); },
    onDone: (stepId) => { ui.close(); doneStep(itemId, stepId); },
    onStudy: () => { ui.close(); openStudy(itemId); },
  });
}

// --- Exam weak points ----------------------------------------------------------------------
function showCrystals(inv, item) {
  const crystals = inv.object.userData.crystals || [];
  const topics = state.topics[item.id] || [];
  const left = topics.filter((t) => t.minutes < S.TOPIC_GOAL).length;
  crystals.forEach((c, i) => {
    const on = i < left;
    if (c.visible && !on && inv.crystalsShown !== undefined) {
      const at = new THREE.Vector3();
      c.getWorldPosition(at);
      fx.burst(at, 0x9fe8ff, 22, 8, 8);
      fx.float(at.clone().add(new THREE.Vector3(0, 1.4, 0)), 'Weak point broken!', 'hit');
      audio.hit();
    }
    c.visible = on;
  });
  inv.crystalsShown = left;
}
function openExam(itemId) {
  const item = state.school.items[itemId];
  if (!item || ui.isOpen()) return;
  ui.exam({
    name: item.name, course: item.courseName, time: timeLeft(item.dueAt - Date.now()), armor: Math.round(S.examArmor(state, item) * 100),
    topics: (state.topics[itemId] || []).map((t) => ({ name: t.name, pct: Math.min(100, Math.round((t.minutes / S.TOPIC_GOAL) * 100)) })),
    suggestions: S.suggestTopics(state, item),
    plus: state.soma.status === 'plus',
    onTopics: (names) => { S.setTopics(state, itemId, names); syncInvaders(Date.now()); save(); ui.close(); openExam(itemId); },
    onStudy: (topic, minutes) => { ui.close(); beginStudy(itemId, minutes, topic); },
    onPractice: (topic) => { ui.close(); openPractice(itemId, topic); },
  });
}


// --- The Vault: rare finds from chests, and the odds of each tier ---------------------------
const VAULT_POS = W.VAULT_POS;
const vault = A.makeVault();
onGround(vault, VAULT_POS.x, VAULT_POS.z);
faceCentre(vault);
world.earth.add(vault);
vault.traverse((o) => { if (o.name === 'spin') spinners.push(o); });
fx.label(vault, 7, '<em>The Vault</em>Rare finds and their odds', 'board');
const tierRank = (t) => S.TIERS.indexOf(t);
function collectibleModel(id) {
  const c = S.COLLECTIBLES[id];
  if (!c) return null;
  if (c.kind === 'hat') { const h = A.makeHat(id); h.scale.setScalar(1.4); return h; }
  if (c.kind === 'pet') return A.makeCritter(id);
  if (c.kind === 'decor') { const d = A.makeDecor(id); d.scale.setScalar(id === 'obelisk' ? 0.32 : 0.55); return d; }
  if (c.kind === 'aura') {
    // A still frame of the aura around a small glowing orb.
    const g = A.makeAura(id);
    for (const m of g.userData.motes) m.position.set(Math.cos(m.userData.seed * 9) * 0.6, 0.2 + (m.userData.seed % 1) * 1.2, Math.sin(m.userData.seed * 9) * 0.6);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshStandardMaterial({ color: A.RARITY_COLORS[c.tier], emissive: A.RARITY_COLORS[c.tier], emissiveIntensity: 1.2 })));
    g.scale.setScalar(0.6);
    return g;
  }
  return A.makeTrophy(id);
}
// Four pedestals in front of the Vault show your rarest finds.
const pedestals = [];
function syncPedestals() {
  for (const p of pedestals) p.group.parent?.remove(p.group);
  pedestals.length = 0;
  const owned = Object.keys(S.COLLECTIBLES).filter((id) => state.vault.owned[id]).sort((a, b) => tierRank(S.COLLECTIBLES[b].tier) - tierRank(S.COLLECTIBLES[a].tier)).slice(0, 4);
  const toward = Math.atan2(-VAULT_POS.x, -VAULT_POS.z);
  owned.forEach((id, i) => {
    const side = (i - 1.5) * 2.1;
    const x = VAULT_POS.x + Math.sin(toward) * 5.2 + Math.cos(toward) * side;
    const z = VAULT_POS.z + Math.cos(toward) * 5.2 - Math.sin(toward) * side;
    const group = A.makePedestal(A.RARITY_COLORS[S.COLLECTIBLES[id].tier]);
    onGround(group, x, z);
    const item = collectibleModel(id);
    if (item) { item.position.y = 1.3; item.name = 'showpiece'; group.add(item); }
    world.earth.add(group);
    pedestals.push({ group, item, id });
  });
}

// Auras circle the hero.
let auraObject = null;
function dressAura() {
  if (auraObject) auraObject.parent?.remove(auraObject);
  auraObject = null;
  const id = state.vault.aura;
  if (!id || !state.vault.owned[id]) return;
  auraObject = A.makeAura(id);
  player.object.add(auraObject);
}
function updateAura(dt, time) {
  for (const p of pedestals) if (p.item) { p.item.rotation.y = time * 0.8; p.item.position.y = 1.3 + Math.sin(time * 1.5 + p.group.position.x) * 0.06; }
  if (!auraObject) return;
  const kind = auraObject.userData.kind;
  for (const m of auraObject.userData.motes) {
    const s = m.userData.seed;
    if (kind === 'sparkle') { const a = time * 0.8 + s * 9; m.position.set(Math.cos(a) * (0.7 + (s % 0.5)), 0.4 + ((time * 0.3 + s) % 1) * 1.8, Math.sin(a) * (0.7 + (s % 0.5))); m.material.opacity = 0.4 + Math.sin(time * 4 + s * 10) * 0.4; }
    else { const t = (time * 0.6 + s) % 1; const a = s * 20; m.position.set(Math.cos(a) * (0.5 + t * 0.4), t * 2.4, Math.sin(a) * (0.5 + t * 0.4)); m.material.opacity = 1 - t; m.scale.setScalar(1 - t * 0.6); }
  }
  auraObject.traverse((o) => {
    if (o.name === 'ribbon') { o.rotation.z += dt * o.userData.speed; o.material.opacity = 0.4 + Math.sin(time * 1.5 + o.position.y * 3) * 0.2; }
    if (o.name === 'disk') o.rotation.y += dt * 0.5;
    if (o.name === 'nebula') o.material.opacity = 0.14 + Math.sin(time) * 0.05;
    if (o.name === 'orbit') for (const st of o.children) { st.userData.a += dt * 0.7; st.position.set(Math.cos(st.userData.a) * 0.8, Math.sin(st.userData.a * 2) * 0.2, Math.sin(st.userData.a) * 0.8); st.rotation.y += dt * 2; }
  });
}

function openVault() {
  if (ui.isOpen()) return;
  const v = state.vault;
  ui.vault({
    found: S.vaultFound(state), total: Object.keys(S.COLLECTIBLES).length,
    sinceEpic: v.sinceEpic, sinceMythic: v.sinceMythic, pityEpic: S.PITY_EPIC, pityMythic: S.PITY_MYTHIC,
    waiting: state.school.chests.length,
    table: S.DROP_TABLE,
    tiers: [...S.TIERS].reverse().map((tier) => ({
      tier,
      items: Object.entries(S.COLLECTIBLES).filter(([, c]) => c.tier === tier).map(([id, c]) => ({
        id, ...c, count: v.owned[id] || 0,
        on: (c.kind === 'hat' && state.cosmetics.hat === id) || (c.kind === 'aura' && v.aura === id) || (c.kind === 'pet' && state.critters.pet === id),
      })),
    })),
    thumb: (id) => thumbFor({ kind: 'collectible', id }),
    onUse: (id) => {
      const c = S.COLLECTIBLES[id];
      if (c.kind === 'hat') { state.cosmetics.hat = state.cosmetics.hat === id ? 'hat:none' : id; dressPlayer(); }
      if (c.kind === 'aura') { v.aura = v.aura === id ? null : id; dressAura(); }
      if (c.kind === 'pet') { S.setPet(state, state.critters.pet === id ? null : id); dressPet(); }
      if (c.kind === 'decor') { ui.close(); toggleBuild(true); setGhost(id); return; }
      save(); ui.close(); openVault();
    },
    onOpenChest: () => {
      const chest = [...state.school.chests].sort((a, b) => tierRank(b.rarity) - tierRank(a.rarity))[0];
      if (!chest) return;
      ui.close();
      openLoot(chest.id, player.object.position.clone());
    },
  });
}

// Every new chest gets a heads-up, wherever it came from.
let chestsSeen = null;
function watchChests() {
  const n = state.school.chests.length;
  if (chestsSeen !== null && n > chestsSeen) {
    const newest = state.school.chests.slice(chestsSeen);
    for (const c of newest.slice(-2)) ui.toast(`A ${c.rarity} chest landed on your plaza: ${c.from}`, c.rarity === 'legendary' || c.rarity === 'epic' ? 'gold' : 'good');
    syncChests();
    audio.chest();
  }
  chestsSeen = n;
}

// --- Settings ------------------------------------------------------------------------------
function toggleMute() {
  state.settings.muted = !state.settings.muted;
  audio.applyVolumes();
  refreshHud();
  save();
  if (!state.settings.muted) audio.coin();
  ui.toast(state.settings.muted ? 'Sound off (M to turn it back on)' : 'Sound on', 'good');
}
function applySettings() {
  const st = state.settings;
  audio.applyVolumes();
  document.getElementById('labels').style.display = st.labels === false ? 'none' : '';
  if (st.quality !== 'auto' && st.quality !== quality) setQuality(st.quality);
  refreshHud();
}
function openSettings() {
  if (ui.isOpen()) return;
  ui.settings({
    values: { ...state.settings },
    onChange: (key, value) => {
      state.settings[key] = value;
      if (key === 'quality' && value === 'auto') { pace.slow = 0; setQuality(0); }
      applySettings();
      if (key === 'sfxVol' || key === 'sfx') audio.coin();
      save();
    },
    onHelp: () => { ui.close(); ui.help({ first: false }); },
  });
}

function openReview() {
  const cards = S.dueReviews(state).slice(0, 10).map((c) => ({ ...c }));
  if (!cards.length) return void ui.toast('Nothing to review right now. Missed practice questions come back here.', 'good');
  const tally = { xp: 0, minutes: 0, learned: 0, levels: 0 };
  ui.practice({
    title: 'Review', name: 'Review', course: `${cards.length} question${cards.length === 1 ? '' : 's'} you missed before`, loading: 'Getting your missed questions…',
    load: () => Promise.resolve({ questions: cards, files: [] }),
    onAnswer: (q, right) => {
      const r = S.answerReview(state, q.id, right);
      if (!r) return;
      tally.xp += r.xp || 0; tally.minutes += r.minutes; tally.learned += r.learned ? 1 : 0;
      if (r.levels) gainedXp(r);
      if (r.prepared) ui.toast('An exam just lost the last of its armor.', 'gold');
    },
    finish: (right) => {
      if (right) audio.coin();
      refreshHud(); syncInvaders(Date.now()); syncReview(); save();
      ui.toast(`Review: ${right} remembered. +${tally.xp} XP${tally.minutes ? `, ${tally.minutes} min of study credit` : ''}.`, 'good');
      return `+${tally.xp} XP${tally.minutes ? ` and ${tally.minutes} minutes of study credit` : ''}.${tally.learned ? ` ${tally.learned} learned for good.` : ''} Misses come back tomorrow.`;
    },
    again: openReview,
  });
}

enemiesReady.then(() => {});
dressPlayer();
if (state.scene === 'moon') player.object.position.copy(W.MOON_SPAWN);
else player.object.position.set(0, 0, 9);
camera.position.set(14, 16, 30);
refreshAllPads();
refreshWonders();
// What is already saved needs no announcement: this only rebuilds the scene.
syncChests();
syncInvaders(Date.now());
syncHalls();
syncDecor();
syncReview();
villagerTick(Date.now());
applyTimeOfDay();
dressPet();
dressAura();
syncPedestals();
watchChests();
dailyTick(true);
syncFronts();
somaRefresh(true);
applyTheme();
applySettings();
refreshHud();
if (S.dueReviews(state).length) setTimeout(() => ui.toast(`${S.dueReviews(state).length} missed questions are back for review. Find the pale books by the Canvas board.`, 'gold'), 3000);

if (!state.settings.seenHelp) {
  ui.help({ first: true, onStart: () => { state.settings.seenHelp = true; save(); } });
} else if (awayMs > 60000 && awayEarned >= 1) {
  ui.toast(`While you were away (${timeLeft(awayMs)}), your buildings made ${S.fmt(awayEarned)} coins. Walk past them to collect.`, 'gold');
}
loadStoredSnapshots();
askSoma();
// The morning report waits a moment so Canvas has synced.
setTimeout(() => { dailyTick(); if (state.settings.seenHelp && state.daily.reported !== state.daily.day) openMorning(); }, 3500);
checkDeadlines(true);
// No Canvas data after a moment: show a sample semester so the gate isn't empty.
setTimeout(() => {
  if (state.school.source !== 'none') return;
  applySchool(S.demoSemester(), 'demo');
  ui.toast('Showing a sample semester. Connect Canvas in Soma and your real classes appear here.', 'gold');
}, 2500);
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

// A handle for testing from the browser console.
window.epoch = {
  state, S, cam,
  give(n) { S.addCoins(state, n); refreshHud(); },
  refresh() { world.setEra(state.era); world.setScene(state.scene, state.era); dressPlayer(); refreshAllPads(); refreshWonders(); syncChests(); syncInvaders(Date.now()); syncDecor(); refreshHud(); },
  look(yaw, pitch, dist) { Object.assign(cam, { yaw, pitch, dist, want: dist }); },
  moveTo(x, z) { player.object.position.set(x, 0, z); },
  raid: spawnRaid,
  realm(name = 'wilds') { if (name) enterRealm(name); else leaveRealm(); },
  realms, player, attack, dodge, slam,
  xp(n = 100) { gainedXp(S.addXp(state, n)); refreshHud(); },
  gear(rarity = 'rare', slot = null) { const got = S.addGear(state, S.rollGear(state, rarity, Math.random, slot)); dressPlayer(); return got; },
  hero: openHero, quests: openQuests,
  study(id, seconds = 20) { beginStudy(id ?? null, seconds / 60); },
  chest(rarity = 'legendary') {
    const id = `test:${Date.now()}`;
    state.school.chests.push({ id, rarity, from: 'Test chest', percent: 96 });
    syncChests();
    openChest(id);
  },
  quality(n) { setQuality(n); },
  exams: checkExams,
  character: pickCharacter,
  folk: () => [...folk].map(([name, f]) => ({ name, x: +f.object.position.x.toFixed(1), z: +f.object.position.z.toFixed(1), mode: f.mode, loaded: Boolean(f.model) })),
  hour(h) { clockOverride = h; applyTimeOfDay(); return dayPhase(); },
  critters: () => critters.map((c) => ({ species: c.species, x: +c.object.position.x.toFixed(1), z: +c.object.position.z.toFixed(1), gone: c.gone })),
  morning: () => openMorning(),
  collection: () => openCollection(),
  hideMarket(v = false) { market.visible = v; },
  pick(fx, fy) {
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
    return r.intersectObjects(scene.children, true).slice(0, 4).map((h) => { const names = []; for (let o = h.object; o; o = o.parent) if (o.name) names.push(o.name); return { d: +h.distance.toFixed(1), names, type: h.object.type, emissive: h.object.material?.emissive?.getHexString?.(), glow: h.object.material?.emissiveIntensity, color: h.object.material?.color?.getHexString?.() }; });
  },
  wonder: () => openWonder(S.nextWonder(state)),
  somaMock(data) { Soma.useMock(data); return somaRefresh(true); },
  premium(on = true) { state.pass.premium = on; },
  passPoints(n) { S.passPoints(state, n); },
  pass: () => openPass(), style: () => openStyle(), watch: () => openWatchtower(), tryOn: (id) => startTryOn(id),
  theme(id) { state.cosmetics.theme = id; applyTheme(); },
  outfit(id) { state.cosmetics.outfit = id; return wearLook(); },
  pet(id) { state.critters.caught[id] = 1; S.setPet(state, id); dressPet(); },
  uiOpen: () => ui.isOpen(),
  shiftLock: () => ({ on: shiftLock, locked: locked(), yaw: cam.yaw, facing: player.facing }),
  exam: (id) => openExam(id), steps: (id) => openSteps(id),
  vault: () => openVault(), aura(id) { state.vault.owned[id] = 1; state.vault.aura = id; dressAura(); }, grant(id) { state.vault.owned[id] = (state.vault.owned[id] || 0) + 1; if (S.COLLECTIBLES[id].kind === 'hat' && !state.cosmetics.owned.includes(id)) state.cosmetics.owned.push(id); if (S.COLLECTIBLES[id].kind === 'pet') state.critters.caught[id] = 1; if (S.COLLECTIBLES[id].kind === 'decor' && !state.decorUnlocked.includes(id)) state.decorUnlocked.push(id); syncPedestals(); }, openTop() { const c = state.school.chests.at(-1); if (c) openLoot(c.id, player.object.position.clone()); },
  invaders: () => [...invaders.values()].map((i) => ({ name: i.item.name, mode: i.mode, x: +i.object.position.x.toFixed(1), z: +i.object.position.z.toFixed(1), inScene: Boolean(i.object.parent) })),
  armor(id) { const inv = invaders.get(id); return inv && inv.object.userData.armor?.filter((p) => p.visible).length; },
  info: () => ({ quality, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  reset() { localStorage.removeItem(SAVE_KEY); location.reload(); },
};

requestAnimationFrame(frame);
