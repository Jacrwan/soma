// Epoch: the playable game. Reads and changes the state through sim.js, and
// shows it with the models from art.js in the world from world.js.

import * as THREE from 'three';
import * as S from './sim.js';
import * as A from './art.js';
import * as W from './world.js';
import { createUI, timeLeft } from './ui.js';
import { createFx, createAudio } from './fx.js';
import { avatarReady, hasAvatar, createAvatar } from './avatar.js';
import { createRealms } from './realm.js';
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 900);
const world = W.createWorld(scene, renderer);
const fx = createFx(scene, camera);
const audio = createAudio(() => state.settings.muted);

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
avatarReady.then((ok) => { if (ok) dressPlayer(); });
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
    group.position.copy(W.padPosition(sceneName, i));
    if (sceneName === 'moon') group.position.y = world.groundHeight('moon', group.position.x, group.position.z);
    parent.add(group);
    pad = pads[sceneName][i] = { group, slab: null, marker: null, building: null, bubble: null, top: 3 };
  }
  const b = state.pads[sceneName][i];
  const unlocked = i < S.padsUnlocked(state, sceneName);
  pad.group.clear();
  pad.building = pad.marker = pad.bubble = null;
  pad.group.visible = unlocked;
  if (!unlocked) return;
  pad.slab = A.makePad(b ? b.tier : S.tierFor(state, sceneName));
  pad.group.add(pad.slab);
  if (!b) {
    pad.marker = A.makePadMarker();
    pad.group.add(pad.marker);
    return;
  }
  pad.building = A.makeBuilding(b.type, b.tier, b.level, b.golden);
  pad.building.position.y = 0.12;
  // Face the plaza.
  pad.building.rotation.y = Math.atan2(-pad.group.position.x, -pad.group.position.z);
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
let fight = null;
let nextRaid = 80;
let bossCooldown = 0;
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
      world.earth.add(object);
      inv = { object, boss: isBoss, item, label: fx.label(object, isBoss ? 6.6 : 2.3 + item.size * 0.5, '') };
      invaders.set(item.id, inv);
    }
    inv.item = item;
    const waiting = isBoss && t >= 0.7;
    inv.waiting = waiting;
    if (fight && fight.id === item.id) continue;
    const lane = isBoss ? -6.5 : ((hash(item.id) % 5) - 2) * 1.5;
    const z = waiting ? W.BOSS_SPOT.z : W.PATH_START_Z + (W.PATH_END_Z - W.PATH_START_Z) * t + (isBoss ? 3 : 0);
    inv.object.position.set(waiting ? W.BOSS_SPOT.x : lane, 0, z);
    inv.object.rotation.y = waiting ? Math.PI / 2 : Math.PI;
    inv.overdue = overdue;
    const time = timeLeft(item.dueAt - now);
    const name = item.name.length > 26 ? `${item.name.slice(0, 25)}…` : item.name;
    const studied = S.studyProgress(state, item);
    const studying = state.study.active?.itemId === item.id;
    const meter = studied > 0 || studying ? `<span class="meter"><b style="width:${Math.round(studied * 100)}%"></b></span>` : '';
    const note = studying ? ' · studying now' : studied >= 1 ? ' · fully studied' : waiting ? ' · ready to fight' : '';
    inv.label.set(`<em>${isBoss ? 'Test' : 'Assignment'} · ${escapeHtml(item.courseName || 'Canvas')}</em>${escapeHtml(name)}${meter}<small>${overdue ? `overdue ${time}` : `due in ${time}`}${note}</small>`, `${isBoss ? 'boss' : ''} ${overdue ? 'overdue' : ''} ${studied >= 1 || studying ? 'studied' : ''}`);
  }
  for (const id of [...invaders.keys()]) if (!live.has(id) && !(fight && fight.id === id)) despawnInvader(id, false);
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
      if (fight && fight.id === event.item.id) endFight('gone');
    } else if (event.type === 'chest') {
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
  if (msg.type === 'canvas_snapshot' && msg.snapshot && msg.snapshot.kind === 'canvas') {
    somaPresent = true;
    const have = somaSnapshots.get(msg.snapshot.host);
    if (!have || have.syncedAt >= msg.snapshot.syncedAt) return;
    somaSnapshots.set(msg.snapshot.host, msg.snapshot);
    useSomaSnapshots();
  }
});
const askSoma = () => window.postMessage({ source: 'soma-app', type: 'hello' }, location.origin);

// --- Interface -----------------------------------------------------------------------
const ui = createUI({
  school: openSchool,
  wardrobe: openWardrobe,
  hero: () => openHero(),
  quests: () => openQuests(),
  study: (id) => openStudy(id),
  endStudy: () => endStudy(),
  help: () => ui.help({ first: false }),
  sound: () => {
    state.settings.muted = !state.settings.muted;
    refreshHud();
    if (!state.settings.muted) audio.coin();
  },
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
  const overdue = Object.values(state.school.items).find((a) => !a.submitted && !a.excused && a.dueAt && a.dueAt < now);
  ui.hud({
    coins: state.coins,
    income: S.totalIncome(state, now),
    era: state.era,
    eraName: eraName(),
    goal: wonder ? `Build the ${wonder.name}: ${S.fmt(Math.min(state.coins, wonder.cost))} / ${S.fmt(wonder.cost)}${wonder.scene !== state.scene ? ` (on ${wonder.scene === 'moon' ? 'the Moon' : 'Earth'})` : ''}` : 'You reached the stars.',
    progress: wonder ? state.coins / wonder.cost : 1,
    siege: overdue ? overdue.name : null,
    chests: state.school.chests.length,
    muted: state.settings.muted,
  });
  const hero = S.heroStats(state);
  ui.vitals({ hp: player.hp, max: hero.health, dodge: player.dashCd, slam: player.slamCd / hero.slamTime, level: hero.level, xp: state.hero.xp, need: S.xpToNext(hero.level), points: state.hero.points, capped: hero.level >= S.MAX_HERO_LEVEL });
  const story = S.storyStatus(state);
  ui.quest(realms.status() || (story ? { title: `Quest: ${story.title}`, parts: [story.text, `${story.have} / ${story.need}`], onOpen: openQuests } : null));
  ui.threats(inRealm() ? [] : S.threats(state, now).map(({ item, overdue: late }) => ({
    id: item.id, name: item.name, course: item.courseName, kind: item.kind, overdue: late, soon: item.dueAt - now < 86400000, time: timeLeft(item.dueAt - now),
    studied: S.studyProgress(state, item), studying: state.study.active?.itemId === item.id,
  })), state.school.source, inRealm());
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
      world.setEra(state.era);
      dressPlayer();
      refreshAllPads();
      refreshWonders();
      refreshHud();
      save();
    },
  });
}

function travel(to) {
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
    else if (a.dueAt && a.dueAt < now) status = `${timeLeft(a.dueAt - now)}: sieging your gate`;
    byCourse.get(a.courseName).push({ ...a, status, studied: S.studyProgress(state, a) });
  }
  const reopen = () => {
    ui.close();
    openSchool();
  };
  ui.school({
    source: state.school.source, connected: somaPresent, chests: state.school.chests.length,
    groups: [...byCourse].map(([course, items]) => ({ course, items })),
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
      askSoma();
      ui.toast('Asked the extension for the latest from Canvas.', 'good');
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
  });
}

function beginStudy(id, minutes) {
  if (!S.startStudy(state, id, minutes)) return;
  const item = id ? state.school.items[id] : null;
  audio.build();
  ui.banner('Study session', item ? item.name : `${minutes} minutes`);
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
    if (result.prepared) ui.toast(result.item.kind === 'boss' ? `${result.item.name} is fully studied: the boss is at half health.` : `${result.item.name} is fully studied: handing it in pays 50% more.`, 'good');
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

// --- Bosses -----------------------------------------------------------------------------
function startFight(inv) {
  const item = inv.item;
  ui.bossIntro({
    name: item.name, course: item.courseName, level: S.bossLevel(item), heroLevel: state.hero.level, hp: S.bossHp(state, item), power: S.playerPower(state, item.courseId), time: timeLeft(item.dueAt - Date.now()),
    studied: S.studyProgress(state, item), onStudy: () => openStudy(item.id),
    onFight: () => {
      fight = { id: item.id, item, inv, hp: S.bossHp(state, item), max: S.bossHp(state, item), hearts: 5, maxHearts: 5, slamIn: 1.6, rings: [], flash: 0 };
      audio.alarm();
      ui.boss({ name: item.name, hp: fight.hp, max: fight.max, hearts: 5, maxHearts: 5 });
    },
  });
}

function endFight(result) {
  if (!fight) return;
  const { inv, item } = fight;
  const pos = inv.object.position.clone();
  fight = null;
  ui.boss(null);
  if (result === 'won') {
    const win = S.bossWon(state, item);
    for (let k = 0; k < 4; k++) fx.burst(pos.clone().add(new THREE.Vector3(0, k * 1.5, 0)), [A.C.red, A.C.gold, A.C.white, A.C.orange][k], 30, 11, 10);
    fx.coinsTo(pos, player.object, 14, () => audio.coin());
    audio.era();
    ui.banner('Boss defeated', item.name);
    if (win) {
      ui.toast(`+${win.xp} XP, +${S.fmt(win.reward)} coins and an epic chest on your plaza`, 'gold');
      gainedXp(win);
    }
    despawnInvader(item.id, false);
  } else if (result === 'lost') {
    audio.hurt();
    bossCooldown = 8;
    ui.fade(() => {
      player.object.position.set(0, 0, 9);
      ui.toast('Knocked out. Nothing lost. Try again when you are ready.', 'bad');
    });
  } else if (result === 'fled') {
    ui.toast('You left the fight. The boss recovers.', 'bad');
    bossCooldown = 3;
  }
  syncInvaders(Date.now());
  syncChests();
  refreshHud();
  save();
}

function updateFight(dt) {
  const boss = fight.inv.object;
  const p = player.object.position;
  const dx = p.x - boss.position.x;
  const dz = p.z - boss.position.z;
  const dist = Math.hypot(dx, dz);
  if (Math.hypot(p.x - W.ARENA.x, p.z - W.ARENA.z) > W.ARENA.r + 9) return endFight('fled');
  boss.rotation.y = Math.atan2(dx, dz);
  if (dist > 3.6) {
    boss.position.x += (dx / dist) * 2.3 * dt;
    boss.position.z += (dz / dist) * 2.3 * dt;
  }
  fight.flash = Math.max(0, fight.flash - dt * 5);
  const base = 3.2 * (1 + fight.flash * 0.08);
  boss.scale.set(base, 3.2 * (1 - fight.flash * 0.06 + Math.sin(performance.now() / 260) * 0.02), base);
  fight.slamIn -= dt;
  if (fight.slamIn <= 0) {
    const enraged = fight.hp < fight.max / 2;
    fight.slamIn = enraged ? 1.7 : 2.5;
    const spots = [p.clone()];
    if (enraged) spots.push(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 0, (Math.random() - 0.5) * 9)));
    for (const spot of spots) fight.rings.push({ ring: fx.ring(new THREE.Vector3(spot.x, 0, spot.z), 3.4, 1.05), spot });
    for (const arm of boss.userData.arms || []) arm.position.y = 1.5;
  }
  for (let i = fight.rings.length - 1; i >= 0; i--) {
    const r = fight.rings[i];
    if (!r.ring.done) continue;
    fight.rings.splice(i, 1);
    for (const arm of boss.userData.arms || []) arm.position.y = 0.8;
    fx.burst(new THREE.Vector3(r.spot.x, 0, r.spot.z), A.C.red, 16, 7, 6);
    audio.hit();
    shake = 0.35;
    if (Math.hypot(p.x - r.spot.x, p.z - r.spot.z) < 3.4 && player.stun <= 0) {
      fight.hearts -= 1;
      player.stun = 0.9;
      player.vy = 7;
      fx.float(p.clone().add(new THREE.Vector3(0, 2.4, 0)), '-1', 'hurt');
      audio.hurt();
      ui.boss({ name: fight.item.name, hp: fight.hp, max: fight.max, hearts: fight.hearts, maxHearts: fight.maxHearts });
      if (fight.hearts <= 0) return endFight('lost');
    }
  }
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
  if (fight && inArc(fight.inv.object.position, 5.2)) {
    landed = true;
    const crit = Math.random() < S.heroStats(state).crit;
    const dmg = Math.round(S.playerPower(state, fight.item.courseId) * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1) * mult);
    fight.hp -= dmg;
    fight.flash = 1;
    fx.float(fight.inv.object.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 5.5, 0)), crit ? `${dmg}!` : String(dmg), 'hit');
    fx.burst(fight.inv.object.position.clone().add(new THREE.Vector3(0, 2, 0)), A.C.white, 5, 5, 4);
    ui.boss({ name: fight.item.name, hp: fight.hp, max: fight.max, hearts: fight.hearts, maxHearts: fight.maxHearts });
    if (fight.hp <= 0) endFight('won');
  }
  return landed;
}

// --- Interacting ---------------------------------------------------------------------------
let target = null;

function findTarget() {
  if (fight || player.down) return null;
  const p = player.object.position;
  let best = null;
  const offer = (dist, range, entry) => {
    if (dist < range && (!best || dist / range < best.score)) best = { ...entry, score: dist / range };
  };
  if (inRealm()) {
    realms.findTarget(p, offer);
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
  if (sceneName === 'earth' && bossCooldown <= 0) {
    for (const inv of invaders.values()) {
      if (!inv.boss || !inv.waiting) continue;
      offer(p.distanceTo(inv.object.position), 9, { text: `Fight ${inv.item.name}`, run: () => startFight(inv) });
    }
  }
  if (sceneName === 'earth' && !state.study.active) {
    for (const inv of invaders.values()) {
      if (inv.boss && inv.waiting) continue;
      offer(p.distanceTo(inv.object.position), inv.boss ? 8 : 4.5, { text: `Study for ${inv.item.name}`, run: () => openStudy(inv.item.id) });
    }
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
    names: A.COSMETIC_NAMES, colors: A.SKIN_COLORS, audio,
    onDone: () => {
      fx.coinsTo(pos, player.object, 12, () => audio.coin());
      if (result.loot.some((l) => l.kind === 'gear' && l.equipped)) dressPlayer();
      refreshHud();
    },
  });
}

const keys = new Set();
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  audio.unlock();
  if (key === 'escape') return void ui.close();
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
  else if (key === 'r') slam();
  else if (key === 't') openStudy();
  else if (key === 'h') ui.help({ first: false });
  else if (key === 'm') {
    state.settings.muted = !state.settings.muted;
    refreshHud();
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// Looking around: drag with either mouse button, scroll to zoom, or press V
// to lock the mouse so the view follows it without holding anything.
let drag = null;
const locked = () => document.pointerLockElement === canvas;
function turn(dx, dy) {
  cam.yaw -= dx * 0.0055;
  cam.pitch = Math.max(0.05, Math.min(1.45, cam.pitch + dy * 0.004));
  cam.idle = 0;
}
function toggleMouseLook() {
  if (locked()) document.exitPointerLock();
  else canvas.requestPointerLock?.();
}
document.addEventListener('pointerlockchange', () => {
  ui.toast(locked() ? 'Mouse look on: move the mouse to look. V or Esc to let go.' : 'Mouse look off. Drag to look around.', 'good');
});
document.addEventListener('mousemove', (event) => {
  if (locked() && !ui.isOpen()) turn(event.movementX, event.movementY);
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  audio.unlock();
  if (locked()) return void (event.button === 0 && attack());
  drag = { x: event.clientX, y: event.clientY, moved: 0, button: event.button };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = event.clientX;
  drag.y = event.clientY;
  turn(dx, dy);
});
const endDrag = () => {
  if (drag && drag.moved < 6 && drag.button === 0) attack();
  drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; });
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
function updateCamera(dt) {
  const p = player.object.position;
  cam.dist += (cam.want - cam.dist) * Math.min(1, dt * 10);
  // During a study session the view drifts around the town once it has been left alone.
  cam.idle += dt;
  if (S.isStudying(state) && cam.idle > 6 && !drag) cam.yaw += dt * 0.07;
  const flat = Math.cos(cam.pitch) * cam.dist;
  // Up close the view sits over the shoulder and looks at the head; far out it looks at the feet.
  const near = 1 - Math.min(1, (cam.dist - CAM_MIN) / 14);
  const want = new THREE.Vector3(p.x + Math.sin(cam.yaw) * flat, p.y + Math.sin(cam.pitch) * cam.dist + 1.5, p.z + Math.cos(cam.yaw) * flat);
  // In the valley the view stays out of the wooded slopes.
  if (!inRealm() && state.scene === 'earth') {
    for (let k = 0; k < 12 && Math.hypot(want.x, want.z) > 50; k++) { want.x += (p.x - want.x) * 0.12; want.z += (p.z - want.z) * 0.12; }
  }
  want.y = Math.max(want.y, (inRealm() ? 0 : world.groundHeight(state.scene, want.x, want.z)) + 0.7);
  camera.position.lerp(want, Math.min(1, dt * 12));
  shake = Math.max(0, shake - dt * 1.6);
  if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.lookAt(p.x, p.y + 1.6 + near * 0.5, p.z);
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
  for (const o of spinners) o.rotation.y += dt * 1.6;
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
    const pace = inv.overdue ? 9 : inv.waiting ? 2 : 5;
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
  if (!inRealm()) updateTown(dt, time);
  updateRaiders(dt);
  realms.update(dt, time, player.object.position, !player.down);
  if (fight) updateFight(dt);
  updateStudy(dt, time);
  bossCooldown = Math.max(0, bossCooldown - dt);
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
    syncInvaders(Date.now());
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
refreshHud();

if (!state.settings.seenHelp) {
  ui.help({ first: true, onStart: () => { state.settings.seenHelp = true; save(); } });
} else if (awayMs > 60000 && awayEarned >= 1) {
  ui.toast(`While you were away (${timeLeft(awayMs)}), your buildings made ${S.fmt(awayEarned)} coins. Walk past them to collect.`, 'gold');
}
loadStoredSnapshots();
askSoma();
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
  state, S,
  give(n) { S.addCoins(state, n); refreshHud(); },
  refresh() { world.setEra(state.era); world.setScene(state.scene, state.era); dressPlayer(); refreshAllPads(); refreshWonders(); syncChests(); syncInvaders(Date.now()); refreshHud(); },
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
  info: () => ({ quality, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  reset() { localStorage.removeItem(SAVE_KEY); location.reload(); },
};

requestAnimationFrame(frame);
