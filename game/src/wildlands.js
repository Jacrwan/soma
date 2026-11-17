// The wild country around your town: fox camps guarding chests, buried treasure,
// standing-stone shrines and the Alpha's lair, out past the edge of town on your
// home map (no portal). Camps, treasure and the Alpha come back once a day.
//
// Kept light for weak laptops: everything is a few baked meshes, and a camp's
// foxes (skinned models) only exist while you're within WAKE metres of it. Labels
// only show for places near you.

import * as THREE from 'three';
import * as A from './art.js';
import * as S from './sim.js';
import { createEnemy, hasEnemy } from './enemies.js';
import { rockGeometry } from './nature.js';

const WAKE = 52, SLEEP = 68, LABEL_R = 46;
const CFG = { enemy: 'fox', names: ['Wild fox', 'Dire fox'], boss: 'The Alpha', speed: 6.4, reach: 2.1, windup: 0.4, eliteTint: 0x6b6f86, bossTint: 0x8d4a4a, bossScale: 2.9 };

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ctx: { world, fx, audio, ui, player, state(), hurt(amount, from), shake(v), loot(rarity, from, pos), save(),
 *        townR, walkR, height(x, z), open(x, z) -> bool (dry, no road/field/landmark), trees() -> [{x,z,r}] }
 */
export function createWildlands(ctx) {
  const { fx, audio, ui } = ctx;
  let land = null; // { index, group, camps, treasures, shrines, boss, solids }
  let enemies = [];
  let labels = [];
  let labelTick = 0;
  let active = false;
  const tmp = new THREE.Vector3();
  const polar = (r, a) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

  // --- Building the country's wild places, once per land ---------------------------
  function campProps() {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = polar(4.6, (i * 120 + 30) * Math.PI / 180);
      g.add(A.at(A.cone(1.7, 2.5, A.C.hide, 6), p.x, 0, p.z, i), A.at(A.cyl(0.05, 0.05, 2.9, A.C.woodDark, 5), p.x, 0, p.z));
    }
    for (let i = 0; i < 9; i++) {
      const p = polar(6.6, (i * 40) * Math.PI / 180);
      const spike = A.cone(0.16, 1.7, A.C.woodDark, 5);
      spike.rotation.z = Math.sin(i * 3) * 0.22;
      g.add(A.at(spike, p.x, 0, p.z));
    }
    for (let i = 0; i < 3; i++) {
      const log = A.cyl(0.12, 0.12, 1.1, A.C.woodDark, 6);
      log.rotation.set(Math.PI / 2, 0, i * 1.05);
      g.add(A.at(log, 2.4, 0.12, 0));
    }
    return A.bake(g);
  }

  function build(index) {
    const r = seeded(9100 + index * 131);
    const group = new THREE.Group();
    group.name = 'wildlands';
    const { townR, walkR } = ctx;
    const taken = [];
    const trees = ctx.trees();
    // A spot out in the country: open ground, clear of trees and of what's already placed.
    const find = (minR, maxR, clear, spacing) => {
      for (let tries = 0; tries < 900; tries++) {
        const a = r() * Math.PI * 2, d = minR + r() * (maxR - minR);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!ctx.open(x, z)) continue;
        let ok = true;
        for (let k = 0; k < 8 && ok; k++) { const q = polar(clear, k * Math.PI / 4); if (!ctx.open(x + q.x, z + q.z)) ok = false; }
        if (!ok || taken.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + spacing)) continue;
        const room = clear + 2.2; // trees are wider than their trunks
        if (trees.some((t) => Math.abs(t.x - x) < room && Math.abs(t.z - z) < room && Math.hypot(t.x - x, t.z - z) < room)) continue;
        taken.push({ x, z, r: clear + spacing * 0.5 });
        return { x, z, y: ctx.height(x, z) };
      }
      return null;
    };
    const inner = townR + 10, outer = walkR - 8;
    const boss = find(inner + 18, outer, 11, 30);
    const camps = [];
    const sizes = [[3, 'rare', -1], [3, 'rare', 0], [4, 'rare', 1], [5, 'epic', 2]];
    sizes.forEach(([count, rarity, lv], i) => {
      const s = find(inner, outer, 7, 14);
      if (s) camps.push({ ...s, count, rarity, lv, key: `land${index}:camp:${i}`, alive: 0, awake: false, chest: null });
    });
    const shrines = [];
    for (let i = 0; i < 2; i++) { const s = find(inner - 4, outer, 3.5, 12); if (s) shrines.push({ ...s, key: `land${index}:shrine:${i}`, name: ['Moss Stones', 'Hunter Stones'][i], orb: null }); }
    const treasures = [];
    for (let i = 0; i < 6; i++) { const s = find(inner - 6, outer, 1.6, 12); if (s) treasures.push({ ...s, key: `land${index}:treasure:${i}`, rarity: r() < 0.3 ? 'rare' : 'common', object: null }); }

    const solids = [];
    for (const camp of camps) {
      const props = campProps();
      props.position.set(camp.x, camp.y, camp.z);
      props.rotation.y = r() * 6.28;
      group.add(props);
      camp.chest = A.makeChest(camp.rarity);
      camp.chest.position.set(camp.x, camp.y, camp.z);
      camp.chest.rotation.y = Math.atan2(-camp.x, -camp.z);
      group.add(camp.chest);
      solids.push({ x: camp.x, z: camp.z, r: 0.9 });
    }
    for (const s of shrines) {
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const p = polar(2.6, (i * 72) * Math.PI / 180);
        const stone = A.box(0.7, 2.2 + (i % 2) * 0.7, 0.45, A.C.stoneDark);
        stone.rotation.z = Math.sin(i * 2.1) * 0.08;
        g.add(A.at(stone, p.x, 0, p.z, -(i * 72) * Math.PI / 180 + Math.PI / 2));
      }
      const stones = A.bake(g);
      stones.position.set(s.x, s.y, s.z);
      s.orb = A.ball(0.42, A.C.glow, 1, { emissive: 0x9dff9a, glow: 1.8 });
      s.orb.castShadow = false;
      s.orb.position.set(s.x, s.y + 1.9, s.z);
      group.add(stones, s.orb);
      for (let i = 0; i < 5; i++) { const p = polar(2.6, (i * 72) * Math.PI / 180); solids.push({ x: s.x + p.x, z: s.z + p.z, r: 0.5 }); }
    }
    for (const t of treasures) {
      const g = new THREE.Group();
      const mound = A.ball(0.7, A.C.dirt, 0);
      mound.scale.y = 0.35;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
      gem.position.y = 1.1;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.05, 5, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 2.6;
      g.add(mound, gem, beam);
      g.position.set(t.x, t.y, t.z);
      t.object = g;
      t.gem = gem;
      t.beam = beam;
      group.add(g);
    }
    if (boss) {
      // The Alpha's lair: a ring of standing rocks, one mesh.
      const geo = rockGeometry(false);
      const ring = new THREE.InstancedMesh(geo, A.mat(A.C.rockDark, { kind: 'rock' }), 12);
      ring.castShadow = true;
      ring.receiveShadow = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 12; i++) {
        const p = polar(12.5, (i * 30) * Math.PI / 180);
        const s = 1.6 + (i % 3) * 0.5;
        dummy.position.set(boss.x + p.x, ctx.height(boss.x + p.x, boss.z + p.z) - 0.2, boss.z + p.z);
        dummy.rotation.set(0, i, 0);
        dummy.scale.set(s, s * 1.7, s);
        dummy.updateMatrix();
        ring.setMatrixAt(i, dummy.matrix);
        if (i % 4 !== 0) solids.push({ x: boss.x + p.x, z: boss.z + p.z, r: s * 0.8 }); // three gaps to walk in through
      }
      group.add(ring);
      boss.key = `land${index}:boss`;
      boss.awake = false;
    }
    return { index, group, camps, treasures, shrines, boss, solids };
  }

  // --- Foxes -------------------------------------------------------------------------
  const heroLevel = () => ctx.state().hero.level;
  function spawn(x, z, tier, level, camp = null) {
    const scale = tier === 2 ? CFG.bossScale : tier === 1 ? 1.35 : 1;
    const m = createEnemy(CFG.enemy, { scale, tint: tier === 2 ? CFG.bossTint : tier === 1 ? CFG.eliteTint : null });
    m.object.position.set(x, ctx.height(x, z), z);
    land.group.add(m.object);
    const stats = S.enemyStats(level, tier);
    const e = {
      m, tier, camp, level, dmg: stats.damage, home: { x, z }, hp: stats.hp, max: stats.hp, mode: 'idle', t: Math.random() * 2, facing: Math.random() * 6.28, kx: 0, kz: 0,
      goal: null, label: null, swings: 0, called: false, ring: null, spot: null, dead: false,
      name: tier === 2 ? CFG.boss : CFG.names[tier], reach: CFG.reach * (tier === 2 ? 2.1 : tier === 1 ? 1.2 : 1), speed: CFG.speed * (tier === 2 ? 0.82 : tier === 1 ? 1.08 : 1),
    };
    enemies.push(e);
    return e;
  }
  function despawn(e) { e.label?.remove(); e.m.object.parent?.remove(e.m.object); }
  function wakeCamp(camp) {
    camp.awake = true;
    if (S.exploreDone(ctx.state(), camp.key)) { camp.alive = 0; return; }
    camp.alive = 0;
    const lv = Math.max(1, heroLevel() + camp.lv);
    for (let k = 0; k < camp.count; k++) {
      const p = polar(3.2 + (k % 2) * 1.6, (k * (360 / camp.count)) * Math.PI / 180);
      spawn(camp.x + p.x, camp.z + p.z, k === 0 && camp.count >= 4 ? 1 : 0, lv, camp);
      camp.alive += 1;
    }
  }
  function sleepCamp(camp) {
    camp.awake = false;
    enemies = enemies.filter((e) => { if (e.camp === camp && !e.dead) { despawn(e); return false; } return true; });
  }
  function wakeBoss(b) {
    b.awake = true;
    if (S.exploreDone(ctx.state(), b.key)) return;
    b.enemy = spawn(b.x, b.z, 2, heroLevel() + 3);
    meter(b.enemy);
  }
  function sleepBoss(b) {
    b.awake = false;
    if (b.enemy && !b.enemy.dead) { despawn(b.enemy); enemies = enemies.filter((e) => e !== b.enemy); }
    b.enemy = null;
  }

  function meter(e) {
    const hard = e.level >= heroLevel() + 3;
    const html = `<em>${hard ? 'Too strong · ' : ''}Level ${e.level}</em>${e.name}<span class="meter hp"><b style="width:${Math.max(0, Math.round((e.hp / e.max) * 100))}%"></b></span>`;
    if (e.label) e.label.set(html);
    else e.label = fx.label(e.m.object, e.m.height + 0.5, html, e.tier === 2 || hard ? 'boss' : '');
  }
  function kill(e) {
    const state = ctx.state();
    const pos = e.m.object.position.clone();
    e.dead = true;
    e.t = 0;
    e.m.die();
    e.label?.remove();
    e.label = null;
    const reward = S.killReward(state, e.tier);
    fx.burst(pos, e.tier === 2 ? A.C.gold : A.C.white, e.tier === 2 ? 40 : 12, 7, 7);
    fx.coinsTo(pos, ctx.player.object, e.tier === 2 ? 14 : 4, () => audio.coin());
    fx.float(pos.clone().add(tmp.set(0, e.m.height + 0.6, 0)), `+${S.fmt(reward)}`);
    audio.pop();
    const drop = S.rollDrop(state, e.tier, e.level);
    if (drop) ui.toast(`Dropped: ${drop.item.name} (${drop.item.rarity})${drop.equipped ? ', equipped' : ', in your bag'}`, 'gold');
    if (e.camp) {
      e.camp.alive -= 1;
      if (e.camp.alive === 0) {
        S.noteExplore(state, 'camp', 'wilds');
        ui.toast(`Camp cleared. Its ${e.camp.rarity} chest is yours.`, 'gold');
        ctx.track?.('camp_cleared');
        audio.build();
      }
      labelTick = 0;
    }
    if (e.tier === 2) {
      S.markExplored(state, land.boss.key);
      S.noteExplore(state, 'boss', 'wilds');
      audio.era();
      ui.banner('The Alpha is down', 'It comes back tomorrow');
      ctx.track?.('alpha_beaten');
      ctx.shake(0.5);
      setTimeout(() => { if (active) ctx.loot('legendary', 'Beat the Alpha', pos); }, 1300);
    }
    ctx.save();
  }
  function damage(e, amount, from, knock) {
    if (e.dead) return;
    e.hp -= amount;
    e.m.hurt();
    const dx = e.m.object.position.x - from.x, dz = e.m.object.position.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const push = knock / (e.tier === 2 ? 5 : e.tier === 1 ? 1.6 : 1);
    e.kx += (dx / d) * push;
    e.kz += (dz / d) * push;
    if (e.mode === 'idle' || e.mode === 'return') e.mode = 'chase';
    if (e.hp <= 0) kill(e);
    else meter(e);
  }
  function face(e, want, dt) { e.facing += Math.atan2(Math.sin(want - e.facing), Math.cos(want - e.facing)) * Math.min(1, dt * 9); }
  function step(e, x, z, speed, dt) {
    const pos = e.m.object.position;
    const dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    pos.x += (dx / d) * Math.min(d, speed * dt);
    pos.z += (dz / d) * Math.min(d, speed * dt);
    face(e, Math.atan2(dx, dz), dt);
    return d;
  }
  function updateEnemy(e, dt, p, alive) {
    const pos = e.m.object.position;
    if (e.dead) { e.t += dt; e.m.update(dt); return e.t < 2; }
    const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
    pos.x += e.kx * dt; pos.z += e.kz * dt;
    e.kx *= Math.max(0, 1 - dt * 7); e.kz *= Math.max(0, 1 - dt * 7);
    const fromHome = Math.hypot(pos.x - e.home.x, pos.z - e.home.z);
    let anim = 'idle', rate = 1;
    if (e.mode === 'idle') {
      e.t -= dt;
      if (e.t <= 0) { e.t = 2 + Math.random() * 4; e.goal = e.tier === 2 || Math.random() < 0.4 ? null : { x: e.home.x + (Math.random() - 0.5) * 9, z: e.home.z + (Math.random() - 0.5) * 9 }; }
      if (e.goal) { anim = 'walk'; if (step(e, e.goal.x, e.goal.z, 1.5, dt) < 0.3) e.goal = null; }
      if (alive && d < (e.tier === 2 ? 17 : 12)) {
        e.mode = 'chase';
        if (e.tier === 2) { audio.alarm(); ui.toast(`${e.name} has seen you.`, 'bad'); }
        meter(e);
      }
    } else if (e.mode === 'chase') {
      if (!alive || fromHome > 30) e.mode = 'return';
      else if (d < e.reach) {
        e.swings += 1;
        if (e.tier === 2 && e.swings % 3 === 0) { e.mode = 'slam'; e.spot = { x: p.x, z: p.z }; e.ring = fx.ring(new THREE.Vector3(p.x, ctx.height(p.x, p.z) + 0.05, p.z), 4.6, 1); }
        else { e.mode = 'windup'; e.t = CFG.windup * (e.tier === 2 ? 1.5 : 1); }
      } else { anim = 'run'; rate = 1.15; step(e, p.x, p.z, e.speed, dt); }
      if (e.tier === 2 && !e.called && e.hp < e.max / 2) {
        e.called = true;
        ui.toast(`${e.name} calls for help.`, 'bad');
        for (let k = 0; k < 3; k++) { const q = polar(7, (k * 120 + 20) * Math.PI / 180); spawn(pos.x + q.x, pos.z + q.z, 0, Math.max(1, e.level - 3)).mode = 'chase'; }
      }
    } else if (e.mode === 'windup') {
      face(e, Math.atan2(dx, dz), dt);
      e.t -= dt;
      if (e.t <= 0) { e.m.strike(); e.mode = 'strike'; e.t = 0.16; }
    } else if (e.mode === 'strike') {
      e.t -= dt;
      if (e.t <= 0) { if (d < e.reach + 1.1) ctx.hurt(e.dmg * S.levelEdge(heroLevel(), e.level).take, pos); e.mode = 'recover'; e.t = 0.75; }
    } else if (e.mode === 'slam') {
      face(e, Math.atan2(dx, dz), dt);
      if (e.ring.done) {
        e.m.strike();
        fx.burst(new THREE.Vector3(e.spot.x, ctx.height(e.spot.x, e.spot.z), e.spot.z), A.C.red, 18, 8, 7);
        audio.hit();
        ctx.shake(0.4);
        if (Math.hypot(p.x - e.spot.x, p.z - e.spot.z) < 4.6) ctx.hurt(e.dmg * 1.5 * S.levelEdge(heroLevel(), e.level).take, e.spot);
        e.mode = 'recover'; e.t = 0.9;
      }
    } else if (e.mode === 'recover') {
      e.t -= dt;
      if (e.t <= 0) e.mode = 'chase';
    } else if (e.mode === 'return') {
      anim = 'run';
      e.hp = Math.min(e.max, e.hp + e.max * dt * 0.4);
      if (step(e, e.home.x, e.home.z, e.speed, dt) < 1) { e.mode = 'idle'; e.label?.remove(); e.label = null; }
    }
    pos.y = ctx.height(pos.x, pos.z);
    if (e.mode !== 'strike' && e.mode !== 'recover' && e.mode !== 'slam') e.m.play(anim);
    e.m.object.rotation.y = e.facing;
    e.m.update(dt, rate);
    return true;
  }

  // --- Labels: only for places near you, refreshed a few times a second -----------------
  function refreshLabels(p) {
    for (const l of labels) l.remove();
    labels = [];
    if (!land) return;
    const state = ctx.state();
    for (const camp of land.camps) {
      if (!camp.chest.visible || Math.hypot(p.x - camp.x, p.z - camp.z) > LABEL_R) continue;
      const lv = Math.max(1, heroLevel() + camp.lv);
      labels.push(fx.label(camp.chest, 3.4, camp.alive || !camp.awake ? `<em>Level ${lv} fox camp</em>${camp.awake ? camp.alive : camp.count} guarding a ${camp.rarity} chest` : `<em>Camp cleared</em>${camp.rarity} chest`, camp.alive || !camp.awake ? 'boss' : 'studied'));
    }
    for (const s of land.shrines) if (s.orb.visible && Math.hypot(p.x - s.x, p.z - s.z) < LABEL_R) labels.push(fx.label(s.orb, 1.4, `<em>Shrine</em>${s.name}`, 'studied'));
    const b = land.boss;
    if (b && !S.exploreDone(state, b.key) && !b.awake && Math.hypot(p.x - b.x, p.z - b.z) < LABEL_R + 20) labels.push(fx.label(b.chestLabelAnchor, 6, '<em>Lair</em>The Alpha sleeps here', 'boss'));
  }

  function ensureLand() {
    const index = ctx.world.landIndex();
    if (land && land.index === index) return;
    if (land) { for (const e of enemies) despawn(e); enemies = []; land.group.parent?.remove(land.group); }
    land = build(index);
    for (const b of [land.boss].filter(Boolean)) { b.chestLabelAnchor = new THREE.Object3D(); b.chestLabelAnchor.position.set(b.x, b.y, b.z); land.group.add(b.chestLabelAnchor); }
    ctx.world.earth.add(land.group);
    sync();
  }
  /** Chests, treasure and orbs match today's progress. */
  function sync() {
    if (!land) return;
    const state = ctx.state();
    for (const c of land.camps) { c.chest.visible = !S.exploreDone(state, c.key); c.chest.userData.lid && (c.chest.userData.lid.rotation.x = 0); }
    for (const t of land.treasures) t.object.visible = !S.exploreDone(state, t.key);
    for (const s of land.shrines) s.orb.visible = !state.explore.shrines?.[s.key];
    labelTick = 0;
  }

  return {
    /** True while you're out on your home map (not in a realm, not on the Moon). */
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) { if (!hasEnemy(CFG.enemy)) { active = false; return; } ensureLand(); land.group.visible = true; sync(); return; }
      for (const e of enemies) despawn(e);
      enemies = [];
      for (const l of labels) l.remove();
      labels = [];
      if (land) { land.group.visible = false; for (const c of land.camps) c.awake = false; if (land.boss) { land.boss.awake = false; land.boss.enemy = null; } }
    },
    get active() { return active; },
    places: () => (land ? { camps: land.camps, treasures: land.treasures, shrines: land.shrines, boss: land.boss } : null),

    update(dt, time, p, alive) {
      if (!active || !land) return;
      ensureLand();
      // Wake camps (and the Alpha) you walk up to; put far ones to sleep.
      for (const camp of land.camps) {
        const d = Math.hypot(p.x - camp.x, p.z - camp.z);
        if (!camp.awake && d < WAKE && camp.chest.visible) { wakeCamp(camp); labelTick = 0; } else if (camp.awake && d > SLEEP) { sleepCamp(camp); labelTick = 0; }
        if (camp.chest.visible && !camp.alive && camp.awake) camp.chest.scale.setScalar(1 + Math.sin(time * 5) * 0.05);
      }
      const b = land.boss;
      if (b) {
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (!b.awake && d < WAKE) { wakeBoss(b); labelTick = 0; } else if (b.awake && d > SLEEP + 10) { sleepBoss(b); labelTick = 0; }
      }
      enemies = enemies.filter((e) => { const keep = updateEnemy(e, dt, p, alive); if (!keep) e.m.object.parent?.remove(e.m.object); return keep; });
      for (let i = 0; i < enemies.length; i++) {
        const a = enemies[i];
        if (a.dead || a.mode === 'idle') continue;
        for (let j = i + 1; j < enemies.length; j++) {
          const c = enemies[j];
          if (c.dead) continue;
          const dx = c.m.object.position.x - a.m.object.position.x, dz = c.m.object.position.z - a.m.object.position.z, d = Math.hypot(dx, dz);
          const min = 1.1 + (a.tier === 2 || c.tier === 2 ? 1.6 : 0);
          if (d < min && d > 0.001) {
            const push = ((min - d) / d) * 0.5;
            if (c.tier !== 2) { c.m.object.position.x += dx * push; c.m.object.position.z += dz * push; }
            if (a.tier !== 2) { a.m.object.position.x -= dx * push; a.m.object.position.z -= dz * push; }
          }
        }
      }
      for (const s of land.shrines) if (s.orb.visible) s.orb.position.y = s.y + 1.9 + Math.sin(time * 1.8 + s.x) * 0.2;
      for (const t of land.treasures) {
        if (!t.object.visible) continue;
        const near = Math.hypot(p.x - t.x, p.z - t.z) < 30;
        t.gem.visible = t.beam.visible = near;
        if (near) { t.gem.rotation.y = time * 3; t.gem.position.y = 1.1 + Math.sin(time * 3 + t.x) * 0.15; }
      }
      labelTick -= dt;
      if (labelTick <= 0) { labelTick = 0.5; refreshLabels(p); }
    },

    /** The player's swing. Returns how many foxes it hit. */
    strike({ from, facing, reach, wide, damage: amount, knock, crit: critChance = 0.1 }) {
      if (!active) return 0;
      let hits = 0;
      const fx0 = Math.sin(facing), fz0 = Math.cos(facing);
      for (const e of [...enemies]) {
        if (e.dead) continue;
        const pos = e.m.object.position;
        const dx = pos.x - from.x, dz = pos.z - from.z, d = Math.hypot(dx, dz);
        const size = e.tier === 2 ? 2.4 : 0.5;
        if (d > reach + size) continue;
        if (!wide && d > 1.5 + size && (dx * fx0 + dz * fz0) / d < 0.15) continue;
        const crit = Math.random() < critChance;
        const dealt = Math.max(1, Math.round(amount * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1) * S.levelEdge(heroLevel(), e.level).deal));
        fx.float(pos.clone().add(tmp.set((Math.random() - 0.5) * 0.8, e.m.height + 0.3, 0)), crit ? `${dealt}!` : String(dealt), 'hit');
        damage(e, dealt, from, knock);
        hits += 1;
      }
      return hits;
    },

    findTarget(p, offer) {
      if (!active || !land) return;
      const state = ctx.state();
      for (const camp of land.camps) {
        if (!camp.chest.visible || camp.alive || !camp.awake) continue;
        offer(Math.hypot(p.x - camp.x, p.z - camp.z), 3.6, { text: `Open the ${camp.rarity} chest`, run: () => {
          S.markExplored(state, camp.key);
          camp.chest.visible = false;
          labelTick = 0;
          ctx.loot(camp.rarity, 'Fox camp', new THREE.Vector3(camp.x, camp.y, camp.z));
        } });
      }
      for (const t of land.treasures) {
        if (!t.object.visible) continue;
        offer(Math.hypot(p.x - t.x, p.z - t.z), 3, { text: 'Dig up the treasure', run: () => {
          S.markExplored(state, t.key);
          S.noteExplore(state, 'treasure', 'wilds');
          t.object.visible = false;
          ctx.loot(t.rarity, 'Buried treasure', new THREE.Vector3(t.x, t.y, t.z));
        } });
      }
      for (const s of land.shrines) {
        if (!s.orb.visible) continue;
        offer(Math.hypot(p.x - s.x, p.z - s.z), 4.6, { text: `Touch the ${s.name}`, run: () => {
          const relic = S.useShrine(state, s.key, s.name);
          s.orb.visible = false;
          labelTick = 0;
          if (!relic) return;
          fx.burst(new THREE.Vector3(s.x, s.y + 1.8, s.z), A.C.glow, 30, 8, 9);
          audio.era();
          ui.banner('Shrine blessing', `+${Math.round(relic.bonus * 100)}% earnings, for good`);
          ctx.save();
        } });
      }
    },

    solids(p) {
      return active && land ? land.solids.filter((s) => Math.abs(s.x - p.x) < 8 && Math.abs(s.z - p.z) < 8) : [];
    },
    /** Nearby foxes, for things like the lock-on and the danger music. */
    get fighting() { return enemies.some((e) => !e.dead && e.mode !== 'idle' && e.mode !== 'return'); },
    sync,
  };
}
