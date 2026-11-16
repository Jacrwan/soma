// Places to explore and fight in, away from the town: the Wilds (by boat, from
// the first day) and Kepler Reach (through the Star Gate, the end of the game).
// Each has monster camps guarding chests, buried treasure, shrines and a boss.
// Camps, treasure and the boss come back once a day.

import * as THREE from 'three';
import * as A from './art.js';
import * as S from './sim.js';
import { ground, groundMaterial } from './world.js';
import { createForest, createGrass, rockGeometry } from './nature.js';
import { fbm, noiseTexture } from './tex.js';
import { createEnemy, hasEnemy } from './enemies.js';

const RADIUS = 72;
const SPAWN = new THREE.Vector3(0, 0, 63);
const rad = (deg) => (deg * Math.PI) / 180;
const polar = (r, deg) => ({ x: Math.cos(rad(deg)) * r, z: Math.sin(rad(deg)) * r });

const CAMPS = [[34, 40, 3, 'rare'], [46, 118, 4, 'rare'], [30, 190, 3, 'rare'], [52, 232, 5, 'epic'], [50, 318, 4, 'rare'], [60, 5, 5, 'epic']];
const BOSS_AT = polar(54, 270);
const SHRINES = [polar(22, 292), polar(63, 152)];

export const REALMS = {
  wilds: {
    title: 'The Wilds', enemy: 'fox', names: ['Wild fox', 'Dire fox'], boss: 'The Alpha', seed: 71,
    speed: 6.4, reach: 2.1, windup: 0.4, eliteTint: 0x6b6f86, bossTint: 0x8d4a4a, bossScale: 2.9,
    palette: [[120, 182, 78], [136, 196, 90], [206, 172, 118]], rock: [150, 154, 160],
    shrine: ['Moss Stones', 'Hunter Stones'], look: null, grass: true,
    levels: { camps: [1, 2, 3, 6, 4, 8], roam: [1, 3], boss: 10 },
  },
  nova: {
    title: 'Kepler Reach', enemy: 'robot', names: ['Sentry', 'Warden'], boss: 'Core Guardian', seed: 913,
    speed: 5.4, reach: 2.5, windup: 0.5, tint: 0xa9adb6, eliteTint: 0xc9906a, bossTint: 0xc8604e, bossScale: 2.6,
    // A dead, airless world: rust and ash regolith under a black sky and hard sunlight.
    palette: [[104, 84, 70], [142, 116, 96], [78, 64, 56]], rock: [92, 84, 78], craters: 46,
    shrine: ['Signal Stones', 'Star Stones'], grass: false,
    levels: { camps: [14, 16, 18, 24, 20, 26], roam: [14, 17], boss: 30 },
    look: { zenith: 0x010207, horizon: 0x120d10, sun: 0xfff1df, cover: 0, hemi: 0x7f8fb0, ground: 0x2a1f18, hemiPower: 0.1, sunPower: 4.4, env: 0.22, haze: 0.0016 },
  },
};

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const edgeHeight = (x, z, r) => (r < RADIUS + 2 ? 0 : Math.min(38, ((r - RADIUS - 2) / 9) ** 1.5 * 7 * (1 + 0.35 * Math.sin(x * 0.21) * Math.cos(z * 0.17))));
// The far planet has low crater-rim hills instead of cliffs, so the sky stays open.
const rimHeight = (x, z, r) => edgeHeight(x, z, r) * 0.3;

export function createRealms(ctx) {
  const { world, fx, audio, ui, player } = ctx;
  const built = {};
  let now = null; // the realm you are in
  let enemies = [];
  const tmp = new THREE.Vector3();

  // --- Building a realm, once --------------------------------------------------------
  function paint(cfg, spots) {
    const size = 1024;
    const span = (RADIUS + 50) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c2d = canvas.getContext('2d');
    const img = c2d.createImageData(size, size);
    const [a, b, dirt] = cfg.palette;
    const rc = seeded(cfg.seed + 3);
    const craters = Array.from({ length: cfg.craters || 0 }, () => {
      const p = polar(6 + rc() * (RADIUS + 30), rc() * 360);
      return { x: p.x, z: p.z, r: 1.6 + rc() * rc() * 11 };
    });
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px / size - 0.5) * span, z = (py / size - 0.5) * span;
        const r = Math.hypot(x, z);
        const n = fbm(px / size, py / size, 9, 5, cfg.seed);
        const fine = fbm(px / size, py / size, 40, 3, cfg.seed + 5);
        let worn = Math.max(0, (fbm(px / size, py / size, 5, 4, cfg.seed + 11) - 0.58) * 5);
        for (const s of spots) {
          const d = Math.hypot(x - s.x, z - s.z);
          if (d < s.r) worn = Math.max(worn, 1 - (d / s.r) ** 2);
        }
        const rocky = Math.max(0, Math.min(1, (r - RADIUS + 1) / 7));
        const t = Math.max(0, Math.min(1, (n - 0.35) * 2.2));
        let shade = cfg.craters ? 0.8 + fine * 0.4 : 0.95 + fine * 0.1;
        // Impact craters: a dark bowl, a bright raised rim, and one wall in sunlight.
        for (const c of craters) {
          const dx = x - c.x, dz = z - c.z;
          if (Math.abs(dx) > c.r * 1.5 || Math.abs(dz) > c.r * 1.5) continue;
          const d = Math.hypot(dx, dz) / c.r;
          if (d > 1.45) continue;
          const side = Math.max(-1, Math.min(1, (dx * 0.7 + dz * 0.5) / (c.r * Math.max(0.25, d))));
          const ss = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
          const bowl = 1 - ss(0.7, 1.0, d);
          const rim = ss(0.82, 1.0, d) * (1 - ss(1.0, 1.4, d));
          shade *= (1 - bowl * (0.2 - side * 0.2 * ss(0.15, 0.9, d))) * (1 + rim * (0.24 - side * 0.14));
        }
        const i = (py * size + px) * 4;
        for (let k = 0; k < 3; k++) {
          let v = a[k] + (b[k] - a[k]) * t;
          v += (dirt[k] - v) * Math.min(1, worn) * 0.85;
          v += (cfg.rock[k] - v) * rocky;
          img.data[i + k] = v * shade;
        }
        img.data[i + 3] = 255;
      }
    }
    c2d.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false;
    map.anisotropy = 8;
    return { map, span };
  }

  function campProps(cfg, name) {
    const g = new THREE.Group();
    if (name === 'wilds') {
      for (let i = 0; i < 3; i++) {
        const p = polar(4.6, i * 120 + 30);
        g.add(A.at(A.cone(1.7, 2.5, A.C.hide, 6), p.x, 0, p.z, i), A.at(A.cyl(0.05, 0.05, 2.9, A.C.woodDark, 5), p.x, 0, p.z));
      }
      for (let i = 0; i < 9; i++) {
        const p = polar(6.6, i * 40);
        const spike = A.cone(0.16, 1.7, A.C.woodDark, 5);
        spike.rotation.z = Math.sin(i * 3) * 0.22;
        g.add(A.at(spike, p.x, 0, p.z));
      }
      for (let i = 0; i < 3; i++) {
        const log = A.cyl(0.12, 0.12, 1.1, A.C.woodDark, 6);
        log.rotation.set(Math.PI / 2, 0, i * 1.05);
        g.add(A.at(log, 2.4, 0.12, 0));
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const p = polar(5.4, i * 90 + 45);
        g.add(A.at(A.cyl(0.28, 0.42, 3.4, A.C.iron, 8, { metal: 0.8, rough: 0.35 }), p.x, 0, p.z), A.at(A.box(1.1, 0.25, 1.1, A.C.metal, { metal: 0.8, rough: 0.4 }), p.x, 0, p.z));
        g.add(A.at(A.ball(0.34, A.C.glow, 0, { emissive: 0x58e6ff, glow: 1.6 }), p.x, 3.6, p.z));
      }
      g.add(A.at(A.box(1.5, 0.5, 1.5, A.C.iron, { metal: 0.8, rough: 0.4 }), 2.6, 0, 0));
    }
    return A.bake(g);
  }

  function build(name) {
    const cfg = REALMS[name];
    const r = seeded(cfg.seed);
    const group = new THREE.Group();
    const camps = CAMPS.map(([d, deg, count, rarity], i) => ({ ...polar(d, deg), count, rarity, level: cfg.levels.camps[i], key: `${name}:camp:${i}`, alive: 0, chest: null, label: null }));
    const shrines = SHRINES.map((p, i) => ({ ...p, key: `${name}:shrine:${i}`, name: cfg.shrine[i], orb: null }));
    const taken = [{ ...SPAWN, r: 12 }, { ...BOSS_AT, r: 15 }, ...camps.map((c) => ({ x: c.x, z: c.z, r: 9 })), ...shrines.map((s) => ({ x: s.x, z: s.z, r: 6 }))];
    const free = (x, z, pad = 0) => Math.hypot(x, z) < RADIUS - 1 && taken.every((t) => Math.hypot(x - t.x, z - t.z) > t.r + pad);

    const treasures = [];
    while (treasures.length < 7) {
      const p = polar(16 + r() * 52, r() * 360);
      if (free(p.x, p.z, 2) && treasures.every((t) => Math.hypot(p.x - t.x, p.z - t.z) > 14)) treasures.push({ ...p, key: `${name}:treasure:${treasures.length}`, rarity: r() < 0.3 ? 'rare' : 'common', object: null });
    }

    const { map, span } = paint(cfg, taken.map((t) => ({ x: t.x, z: t.z, r: t.r * 0.9 })));
    group.add(ground(span, 150, name === 'wilds' ? edgeHeight : rimHeight, groundMaterial(map, noiseTexture('dust', 256), 150, name === 'wilds' ? 0.3 : 3.2, name === 'wilds' ? 0.2 : 1), span));

    // Trees and rocks you have to walk around.
    const solids = [];
    if (name === 'wilds') {
      const forest = createForest();
      const trees = [];
      for (let tries = 0; trees.length < 430 && tries < 6000; tries++) {
        const p = polar(Math.sqrt(r()) * (RADIUS + 9), r() * 360);
        const clump = fbm((p.x / 160 + 1) % 1, (p.z / 160 + 1) % 1, 5, 3, 9);
        if (clump < 0.42 + r() * 0.2 || !free(p.x, p.z, 1.5) || Math.abs(p.x) < 2.5 && p.z > 40) continue;
        const tree = { x: p.x, z: p.z, kind: r() < 0.6 ? 1 : 0, turn: r() * 6.28, scale: 0.9 + r() * 0.9 };
        trees.push(tree);
        if (Math.hypot(p.x, p.z) < RADIUS) solids.push({ x: p.x, z: p.z, r: 0.5 });
      }
      forest.place(trees);
      group.add(forest.object);
      const grass = createGrass(84000, RADIUS, (x, z) => free(x, z, -2.5), 33);
      group.add(grass);
    } else {
      // Loose stones everywhere, too small to block the way.
      const dummy = new THREE.Object3D();
      const pebbles = new THREE.InstancedMesh(rockGeometry(true), A.mat(A.C.rockDark, { kind: 'rock' }), 700);
      pebbles.castShadow = true;
      pebbles.receiveShadow = true;
      for (let i = 0; i < 700; i++) {
        const p = polar(Math.sqrt(r()) * (RADIUS + 20), r() * 360);
        const sc = 0.08 + r() * r() * 0.5;
        dummy.position.set(p.x, -sc * 0.25, p.z);
        dummy.rotation.set(r() * 3, r() * 6.28, r() * 3);
        dummy.scale.set(sc, sc * (0.5 + r() * 0.6), sc * (0.7 + r() * 0.6));
        dummy.updateMatrix();
        pebbles.setMatrixAt(i, dummy.matrix);
      }
      group.add(pebbles);
      // Wind-carved spires of dark basalt.
      const spires = new THREE.InstancedMesh(rockGeometry(true), A.mat(A.C.rockDark, { kind: 'rock' }), 60);
      spires.castShadow = true;
      spires.receiveShadow = true;
      let ns = 0;
      for (let tries = 0; ns < 60 && tries < 900; tries++) {
        const p = polar(10 + r() * (RADIUS + 14), r() * 360);
        if (!free(p.x, p.z, 2)) { if (Math.hypot(p.x, p.z) < RADIUS) continue; }
        const sc = 0.9 + r() * 1.6;
        dummy.position.set(p.x, -0.3, p.z);
        dummy.rotation.set((r() - 0.5) * 0.3, r() * 6.28, (r() - 0.5) * 0.3);
        dummy.scale.set(sc, sc * (2.4 + r() * 3.2), sc);
        dummy.updateMatrix();
        spires.setMatrixAt(ns++, dummy.matrix);
        if (Math.hypot(p.x, p.z) < RADIUS) solids.push({ x: p.x, z: p.z, r: sc * 0.85 });
      }
      spires.count = ns;
      group.add(spires);

      // The sky: thousands of stars, the band of the galaxy, a banded gas giant with rings, and its moon.
      const positions = [], colors = [];
      const tints = [[1, 1, 1], [0.8, 0.88, 1], [1, 0.93, 0.8], [1, 0.8, 0.7]];
      const pole = new THREE.Vector3(0.45, 0.6, -0.66).normalize();
      const u = new THREE.Vector3(1, 0, 0).cross(pole).normalize(), v = pole.clone().cross(u);
      for (let i = 0; i < 9000; i++) {
        if (i < 3800) tmp.set(r() - 0.5, r() - 0.5, r() - 0.5);
        else {
          // Along the galaxy's plane, thinning out away from it.
          const a = r() * 6.283, off = (r() + r() + r() - 1.5) * 0.22;
          tmp.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).addScaledVector(pole, off);
        }
        if (tmp.lengthSq() < 0.0001) continue;
        tmp.normalize().multiplyScalar(560);
        if (tmp.y < -20) continue;
        positions.push(tmp.x, tmp.y, tmp.z);
        const t = tints[Math.floor(r() * tints.length)];
        const bright = 0.25 + r() ** 3 * 1.6;
        colors.push(t[0] * bright, t[1] * bright, t[2] * bright);
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      starGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ vertexColors: true, size: 1.5, sizeAttenuation: false, fog: false, depthWrite: false }));
      starField.frustumCulled = false;
      group.add(starField);

      const R = 96;
      const bandCanvas = document.createElement('canvas');
      bandCanvas.width = 1024;
      bandCanvas.height = 512;
      const b2d = bandCanvas.getContext('2d');
      const bandImg = b2d.createImageData(1024, 512);
      const stops = [[214, 178, 140], [176, 124, 86], [232, 208, 176], [150, 98, 70], [224, 190, 150], [120, 86, 70], [206, 160, 120]];
      for (let py = 0; py < 512; py++) {
        for (let px = 0; px < 1024; px++) {
          const swirl = fbm(px / 1024, py / 512, 6, 4, 31) - 0.5;
          const lat = py / 512 + swirl * 0.07 + (fbm(px / 1024, py / 512, 22, 3, 57) - 0.5) * 0.02;
          const f = Math.max(0, Math.min(0.999, lat)) * (stops.length - 1) * 2.3 % (stops.length - 1);
          const k = Math.floor(f), t = f - k;
          const c0 = stops[k], c1 = stops[Math.min(stops.length - 1, k + 1)];
          const grain = 0.9 + fbm(px / 1024, py / 512, 60, 2, 83) * 0.2;
          const idx = (py * 1024 + px) * 4;
          for (let q = 0; q < 3; q++) bandImg.data[idx + q] = (c0[q] + (c1[q] - c0[q]) * (t * t * (3 - 2 * t))) * grain;
          bandImg.data[idx + 3] = 255;
        }
      }
      b2d.putImageData(bandImg, 0, 0);
      const bandMap = new THREE.CanvasTexture(bandCanvas);
      bandMap.colorSpace = THREE.SRGBColorSpace;
      bandMap.wrapS = THREE.RepeatWrapping;
      const giant = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40), new THREE.MeshStandardMaterial({ map: bandMap, roughness: 1, metalness: 0, fog: false, envMapIntensity: 0 }));
      giant.name = 'giant';
      const air = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffc9a0, transparent: true, opacity: 0.13, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const ringCanvas = document.createElement('canvas');
      ringCanvas.width = 512;
      ringCanvas.height = 4;
      const r2d = ringCanvas.getContext('2d');
      for (let px = 0; px < 512; px++) {
        const t = px / 512;
        const gap = t > 0.56 && t < 0.62 ? 0.08 : 1;
        const alpha = Math.max(0, Math.min(1, t * 12)) * Math.max(0, Math.min(1, (1 - t) * 9)) * (0.35 + 0.65 * fbm(t, 0.5, 40, 3, 7)) * gap;
        const tone = 200 + fbm(t, 0.2, 18, 2, 19) * 50;
        r2d.fillStyle = `rgba(${tone},${tone * 0.9},${tone * 0.76},${alpha * 0.85})`;
        r2d.fillRect(px, 0, 1, 4);
      }
      const ringMap = new THREE.CanvasTexture(ringCanvas);
      ringMap.colorSpace = THREE.SRGBColorSpace;
      const ringGeo = new THREE.RingGeometry(R * 1.3, R * 2.35, 160, 1);
      const rp = ringGeo.attributes.position, ruv = ringGeo.attributes.uv;
      for (let i = 0; i < rp.count; i++) ruv.setXY(i, (Math.hypot(rp.getX(i), rp.getY(i)) - R * 1.3) / (R * 1.05), 0.5);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringMap, transparent: true, side: THREE.DoubleSide, fog: false, depthWrite: false }));
      ring.rotation.x = 1.32;
      giant.add(air, ring);
      giant.rotation.z = 0.32;
      giant.position.set(-230, 170, -330);
      group.add(giant);
      const moonlet = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 20), new THREE.MeshStandardMaterial({ color: 0xb6b0a8, map: noiseTexture('dust', 256), roughness: 1, fog: false, envMapIntensity: 0 }));
      moonlet.position.set(120, 210, -300);
      group.add(moonlet);
    }
    const rockMesh = new THREE.InstancedMesh(rockGeometry(name !== 'wilds'), A.mat(A.C.rock, { kind: 'rock' }), 70);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let rocks = 0;
    for (let tries = 0; rocks < 70 && tries < 800; tries++) {
      const p = polar(8 + r() * (RADIUS + 4), r() * 360);
      if (!free(p.x, p.z, 1) && Math.hypot(p.x, p.z) < RADIUS) continue;
      const s = 0.6 + r() * r() * 2.6;
      dummy.position.set(p.x, -0.1, p.z);
      dummy.rotation.set(0, r() * 6.28, 0);
      dummy.scale.set(s, s * (0.6 + r() * 0.6), s);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(rocks++, dummy.matrix);
      if (s > 1.1 && Math.hypot(p.x, p.z) < RADIUS) solids.push({ x: p.x, z: p.z, r: s * 0.8 });
    }
    rockMesh.count = rocks;
    group.add(rockMesh);

    // The way home.
    const exit = new THREE.Group();
    if (name === 'wilds') exit.add(A.makeGate(0));
    else {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(3, 0.32, 10, 40), A.mat(A.C.iron, { metal: 0.85, rough: 0.3 }));
      const pool = new THREE.Mesh(new THREE.CircleGeometry(2.8, 40), new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      frame.position.y = pool.position.y = 3.2;
      exit.add(frame, pool);
    }
    exit.position.set(SPAWN.x + 9, 0, SPAWN.z + 1);
    exit.rotation.y = -0.9;
    group.add(exit);

    for (const camp of camps) {
      const props = campProps(cfg, name);
      props.position.set(camp.x, 0, camp.z);
      group.add(props);
      camp.chest = A.makeChest(camp.rarity);
      camp.chest.position.set(camp.x, 0, camp.z);
      camp.chest.rotation.y = Math.atan2(SPAWN.x - camp.x, SPAWN.z - camp.z);
      group.add(camp.chest);
      solids.push({ x: camp.x, z: camp.z, r: 0.9 });
    }
    for (const shrine of shrines) {
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const p = polar(2.6, i * 72);
        const stone = A.box(0.7, 2.2 + (i % 2) * 0.7, 0.45, name === 'wilds' ? A.C.stoneDark : A.C.slate);
        stone.rotation.z = Math.sin(i * 2.1) * 0.08;
        g.add(A.at(stone, p.x, 0, p.z, -rad(i * 72) + Math.PI / 2));
      }
      const stones = A.bake(g);
      stones.position.set(shrine.x, 0, shrine.z);
      shrine.orb = A.ball(0.42, A.C.glow, 1, { emissive: name === 'wilds' ? 0x9dff9a : 0x9fe8ff, glow: 1.8 });
      shrine.orb.castShadow = false;
      shrine.orb.position.set(shrine.x, 1.9, shrine.z);
      group.add(stones, shrine.orb);
    }
    for (const t of treasures) {
      const g = new THREE.Group();
      const mound = A.ball(0.7, name === 'wilds' ? A.C.dirt : A.C.rockDark, 0);
      mound.scale.y = 0.35;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
      gem.position.y = 1.1;
      gem.name = 'gem';
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.05, 5, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 2.6;
      g.add(mound, gem, beam);
      g.position.set(t.x, 0, t.z);
      t.object = g;
      group.add(g);
    }
    // The boss lair: a ring of standing rocks.
    const lair = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const p = polar(12.5, i * 30);
      const s = 1.6 + (i % 3) * 0.5;
      const rock = new THREE.Mesh(rockGeometry(name !== 'wilds'), A.mat(name === 'wilds' ? A.C.rockDark : A.C.iron, { kind: 'rock' }));
      rock.scale.set(s, s * 1.7, s);
      rock.castShadow = true;
      lair.add(A.at(rock, p.x, 0, p.z, i));
      solids.push({ x: BOSS_AT.x + p.x, z: BOSS_AT.z + p.z, r: s * 0.8 });
    }
    lair.position.set(BOSS_AT.x, 0, BOSS_AT.z);
    group.add(lair);

    return { name, cfg, group, camps, shrines, treasures, solids, exit, labels: [], roam: Array.from({ length: 9 }, () => polar(14 + r() * 52, r() * 360)).filter((p) => free(p.x, p.z, 4)) };
  }

  // --- Enemies ------------------------------------------------------------------------
  function spawn(x, z, tier, level, camp = null) {
    const cfg = now.cfg;
    const scale = tier === 2 ? cfg.bossScale : tier === 1 ? 1.35 : 1;
    const m = createEnemy(cfg.enemy, { scale, tint: tier === 2 ? cfg.bossTint : tier === 1 ? cfg.eliteTint : cfg.tint ?? null });
    m.object.position.set(x, 0, z);
    now.group.add(m.object);
    const stats = S.enemyStats(level, tier);
    const max = stats.hp;
    const e = {
      m, tier, camp, level, dmg: stats.damage, home: { x, z }, hp: max, max, mode: 'idle', t: Math.random() * 2, facing: Math.random() * 6.28, kx: 0, kz: 0,
      goal: null, label: null, swings: 0, called: false, ring: null, dead: false,
      name: tier === 2 ? cfg.boss : cfg.names[tier], reach: cfg.reach * (tier === 2 ? 2.1 : tier === 1 ? 1.2 : 1), speed: cfg.speed * (tier === 2 ? 0.82 : tier === 1 ? 1.08 : 1),
    };
    enemies.push(e);
    return e;
  }

  function clearEnemies() {
    for (const e of enemies) {
      e.label?.remove();
      e.m.object.parent?.remove(e.m.object);
    }
    enemies = [];
  }

  function populate() {
    clearEnemies();
    const state = ctx.state();
    const realm = now;
    realm.camps.forEach((camp, i) => {
      const cleared = S.exploreDone(state, camp.key);
      camp.alive = 0;
      camp.chest.visible = !cleared;
      camp.chest.userData.lid.rotation.x = 0;
      if (cleared) return;
      for (let k = 0; k < camp.count; k++) {
        const p = polar(3.2 + (k % 2) * 1.6, k * (360 / camp.count) + i * 40);
        spawn(camp.x + p.x, camp.z + p.z, k === 0 && camp.count >= 4 ? 1 : 0, camp.level, camp);
        camp.alive += 1;
      }
    });
    realm.roam.forEach((p, i) => spawn(p.x, p.z, 0, realm.cfg.levels.roam[0] + (i % (realm.cfg.levels.roam[1] - realm.cfg.levels.roam[0] + 1))));
    if (!S.exploreDone(state, `${realm.name}:boss`)) meter(spawn(BOSS_AT.x, BOSS_AT.z, 2, realm.cfg.levels.boss));
    for (const t of realm.treasures) t.object.visible = !S.exploreDone(state, t.key);
    for (const s of realm.shrines) s.orb.visible = !state.explore.shrines[s.key];
    refreshLabels();
  }

  function refreshLabels() {
    for (const l of now.labels) l.remove();
    now.labels = [fx.label(now.exit, 5.4, `<em>${now.name === 'wilds' ? 'Trail' : 'Star Gate'}</em>Way home`, 'board')];
    for (const camp of now.camps) {
      if (!camp.chest.visible) continue;
      now.labels.push(fx.label(camp.chest, 3.4, camp.alive ? `<em>Level ${camp.level} camp</em>${camp.alive} guarding a ${camp.rarity} chest` : `<em>Camp cleared</em>${camp.rarity} chest`, camp.alive ? 'boss' : 'studied'));
    }
    for (const s of now.shrines) if (s.orb.visible) now.labels.push(fx.label(s.orb, 1.4, `<em>Shrine</em>${s.name}`, 'studied'));
  }

  function meter(e) {
    const hard = e.level >= ctx.state().hero.level + 3;
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
    fx.coinsTo(pos, player.object, e.tier === 2 ? 14 : 4, () => audio.coin());
    fx.float(pos.clone().add(tmp.set(0, e.m.height + 0.6, 0)), `+${S.fmt(reward)}`);
    audio.pop();
    const drop = S.rollDrop(state, e.tier, e.level);
    if (drop) ui.toast(`Dropped: ${drop.item.name} (${drop.item.rarity})${drop.equipped ? ', equipped' : ', in your bag'}`, 'gold');
    if (e.camp) {
      e.camp.alive -= 1;
      if (e.camp.alive === 0) {
        S.noteExplore(state, 'camp', now.name);
        ui.toast(`Camp cleared. Its ${e.camp.rarity} chest is yours.`, 'gold');
        audio.build();
      }
      refreshLabels();
    }
    if (e.tier === 2) {
      S.markExplored(state, `${now.name}:boss`);
      S.noteExplore(state, 'boss', now.name);
      audio.era();
      ui.banner('Boss defeated', e.name);
      ctx.shake(0.5);
      const realm = now;
      setTimeout(() => { if (now === realm) ctx.loot('legendary', `Beat ${e.name}`, pos); }, 1300);
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

  function step(e, x, z, speed, dt) {
    const pos = e.m.object.position;
    const dx = x - pos.x, dz = z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    pos.x += (dx / d) * Math.min(d, speed * dt);
    pos.z += (dz / d) * Math.min(d, speed * dt);
    face(e, Math.atan2(dx, dz), dt);
    return d;
  }
  function face(e, want, dt) {
    const delta = Math.atan2(Math.sin(want - e.facing), Math.cos(want - e.facing));
    e.facing += delta * Math.min(1, dt * 9);
  }

  function updateEnemy(e, dt, p, alive) {
    const pos = e.m.object.position;
    if (e.dead) {
      e.t += dt;
      e.m.update(dt);
      return e.t < 2;
    }
    const dx = p.x - pos.x, dz = p.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 85) return true; // too far to matter
    pos.x += e.kx * dt;
    pos.z += e.kz * dt;
    e.kx *= Math.max(0, 1 - dt * 7);
    e.kz *= Math.max(0, 1 - dt * 7);
    const fromHome = Math.hypot(pos.x - e.home.x, pos.z - e.home.z);
    let anim = 'idle';
    let rate = 1;
    if (e.mode === 'idle') {
      e.t -= dt;
      if (e.t <= 0) {
        e.t = 2 + Math.random() * 4;
        e.goal = e.tier === 2 || Math.random() < 0.4 ? null : { x: e.home.x + (Math.random() - 0.5) * 9, z: e.home.z + (Math.random() - 0.5) * 9 };
      }
      if (e.goal) {
        anim = 'walk';
        if (step(e, e.goal.x, e.goal.z, 1.5, dt) < 0.3) e.goal = null;
      }
      if (alive && d < (e.tier === 2 ? 17 : 13)) {
        e.mode = 'chase';
        if (e.tier === 2) {
          audio.alarm();
          ui.toast(`${e.name} has seen you.`, 'bad');
          meter(e);
        }
      }
    } else if (e.mode === 'chase') {
      if (!alive || fromHome > 42) e.mode = 'return';
      else if (d < e.reach) {
        e.swings += 1;
        if (e.tier === 2 && e.swings % 3 === 0) {
          e.mode = 'slam';
          e.ring = fx.ring(new THREE.Vector3(p.x, 0, p.z), 4.6, 1);
          e.spot = { x: p.x, z: p.z };
        } else {
          e.mode = 'windup';
          e.t = now.cfg.windup * (e.tier === 2 ? 1.5 : 1);
        }
      } else {
        anim = 'run';
        rate = 1.15;
        step(e, p.x, p.z, e.speed, dt);
      }
      if (e.tier === 2 && !e.called && e.hp < e.max / 2) {
        e.called = true;
        ui.toast(`${e.name} calls for help.`, 'bad');
        for (let k = 0; k < 3; k++) {
          const q = polar(7, k * 120 + 20);
          spawn(pos.x + q.x, pos.z + q.z, 0, Math.max(1, e.level - 3)).mode = 'chase';
        }
      }
    } else if (e.mode === 'windup') {
      face(e, Math.atan2(dx, dz), dt);
      e.t -= dt;
      if (e.t <= 0) {
        e.m.strike();
        e.mode = 'strike';
        e.t = e.m.kind === 'robot' ? 0.3 : 0.16;
      }
    } else if (e.mode === 'strike') {
      e.t -= dt;
      if (e.t <= 0) {
        if (d < e.reach + 1.1) ctx.hurt(e.dmg * S.levelEdge(ctx.state().hero.level, e.level).take, pos);
        e.mode = 'recover';
        e.t = 0.75;
      }
    } else if (e.mode === 'slam') {
      face(e, Math.atan2(dx, dz), dt);
      if (e.ring.done) {
        e.m.strike();
        fx.burst(new THREE.Vector3(e.spot.x, 0, e.spot.z), A.C.red, 18, 8, 7);
        audio.hit();
        ctx.shake(0.4);
        if (Math.hypot(p.x - e.spot.x, p.z - e.spot.z) < 4.6) ctx.hurt(e.dmg * 1.5 * S.levelEdge(ctx.state().hero.level, e.level).take, e.spot);
        e.mode = 'recover';
        e.t = 0.9;
      }
    } else if (e.mode === 'recover') {
      e.t -= dt;
      if (e.t <= 0) e.mode = 'chase';
    } else if (e.mode === 'return') {
      anim = 'run';
      e.hp = Math.min(e.max, e.hp + e.max * dt * 0.4);
      if (step(e, e.home.x, e.home.z, e.speed, dt) < 1) {
        e.mode = 'idle';
        e.label?.remove();
        e.label = null;
      }
    }
    if (e.mode !== 'strike' && e.mode !== 'recover' && !(e.mode === 'slam')) e.m.play(anim);
    e.m.object.rotation.y = e.facing;
    e.m.update(dt, rate);
    return true;
  }

  return {
    get active() { return now ? now.name : null; },
    get group() { return now ? now.group : null; },
    get title() { return now ? now.cfg.title : ''; },
    radius: RADIUS,
    ready: (name) => hasEnemy(REALMS[name].enemy),

    /** Builds the place if needed, fills it, and returns where the player stands. */
    enter(name) {
      if (!built[name]) built[name] = build(name);
      now = built[name];
      world.showRealm(now.group, ctx.state().era, now.cfg.look);
      populate();
      return SPAWN.clone();
    },

    leave() {
      if (!now) return;
      clearEnemies();
      for (const l of now.labels) l.remove();
      now.labels = [];
      now = null;
    },

    update(dt, time, p, alive) {
      if (!now) return;
      enemies = enemies.filter((e) => {
        const keep = updateEnemy(e, dt, p, alive);
        if (!keep) e.m.object.parent?.remove(e.m.object);
        return keep;
      });
      // Keep a pack from standing inside itself.
      for (let i = 0; i < enemies.length; i++) {
        const a = enemies[i];
        if (a.dead || a.mode === 'idle') continue;
        for (let j = i + 1; j < enemies.length; j++) {
          const b = enemies[j];
          if (b.dead) continue;
          const dx = b.m.object.position.x - a.m.object.position.x, dz = b.m.object.position.z - a.m.object.position.z;
          const d = Math.hypot(dx, dz);
          const min = 1.1 + (a.tier === 2 || b.tier === 2 ? 1.6 : 0);
          if (d < min && d > 0.001) {
            const push = ((min - d) / d) * 0.5;
            if (b.tier !== 2) { b.m.object.position.x += dx * push; b.m.object.position.z += dz * push; }
            if (a.tier !== 2) { a.m.object.position.x -= dx * push; a.m.object.position.z -= dz * push; }
          }
        }
      }
      for (const s of now.shrines) {
        s.orb.position.y = 1.9 + Math.sin(time * 1.8 + s.x) * 0.2;
      }
      for (const t of now.treasures) {
        if (!t.object.visible) continue;
        const near = Math.hypot(p.x - t.x, p.z - t.z) < 26;
        t.object.children[1].visible = t.object.children[2].visible = near;
        t.object.children[1].rotation.y = time * 3;
        t.object.children[1].position.y = 1.1 + Math.sin(time * 3 + t.x) * 0.15;
      }
      for (const camp of now.camps) if (camp.chest.visible && !camp.alive) camp.chest.scale.setScalar(1 + Math.sin(time * 5) * 0.05);
    },

    /** The player's swing. Returns how many enemies it hit. */
    strike({ from, facing, reach, wide, damage: amount, knock, crit: critChance = 0.1 }) {
      if (!now) return 0;
      let hits = 0;
      const fx0 = Math.sin(facing), fz0 = Math.cos(facing);
      for (const e of [...enemies]) {
        if (e.dead) continue;
        const pos = e.m.object.position;
        const dx = pos.x - from.x, dz = pos.z - from.z;
        const d = Math.hypot(dx, dz);
        const size = e.tier === 2 ? 2.4 : 0.5;
        if (d > reach + size) continue;
        if (!wide && d > 1.5 + size && (dx * fx0 + dz * fz0) / d < 0.15) continue;
        const crit = Math.random() < critChance;
        const dealt = Math.max(1, Math.round(amount * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1) * S.levelEdge(ctx.state().hero.level, e.level).deal));
        fx.float(pos.clone().add(tmp.set((Math.random() - 0.5) * 0.8, e.m.height + 0.3, 0)), crit ? `${dealt}!` : String(dealt), 'hit');
        damage(e, dealt, from, knock);
        hits += 1;
      }
      return hits;
    },

    findTarget(p, offer) {
      if (!now) return;
      const state = ctx.state();
      const realm = now;
      offer(Math.hypot(p.x - realm.exit.position.x, p.z - realm.exit.position.z), 5.5, { text: realm.name === 'wilds' ? 'Walk home' : 'Step back through the Star Gate', run: () => ctx.leave() });
      for (const camp of realm.camps) {
        if (!camp.chest.visible || camp.alive) continue;
        offer(Math.hypot(p.x - camp.x, p.z - camp.z), 3.6, {
          text: `Open the ${camp.rarity} chest`,
          run: () => {
            S.markExplored(state, camp.key);
            camp.chest.visible = false;
            refreshLabels();
            ctx.loot(camp.rarity, `${realm.cfg.title} camp`, new THREE.Vector3(camp.x, 0, camp.z));
          },
        });
      }
      for (const t of realm.treasures) {
        if (!t.object.visible) continue;
        offer(Math.hypot(p.x - t.x, p.z - t.z), 3, {
          text: 'Dig up the treasure',
          run: () => {
            S.markExplored(state, t.key);
            S.noteExplore(state, 'treasure', realm.name);
            t.object.visible = false;
            ctx.loot(t.rarity, 'Buried treasure', new THREE.Vector3(t.x, 0, t.z));
          },
        });
      }
      for (const s of realm.shrines) {
        if (!s.orb.visible) continue;
        offer(Math.hypot(p.x - s.x, p.z - s.z), 4.6, {
          text: `Touch the ${s.name}`,
          run: () => {
            const relic = S.useShrine(state, s.key, s.name);
            s.orb.visible = false;
            refreshLabels();
            if (!relic) return;
            fx.burst(new THREE.Vector3(s.x, 1.8, s.z), A.C.glow, 30, 8, 9);
            audio.era();
            ui.banner('Shrine blessing', `+${Math.round(relic.bonus * 100)}% earnings, for good`);
            ctx.save();
          },
        });
      }
    },

    solids(p) {
      return now ? now.solids.filter((s) => Math.abs(s.x - p.x) < 8 && Math.abs(s.z - p.z) < 8) : [];
    },

    status() {
      if (!now) return null;
      const state = ctx.state();
      const camps = now.camps.filter((c) => !c.chest.visible).length;
      const found = now.treasures.filter((t) => !t.object.visible).length;
      const shrines = now.shrines.filter((s) => !s.orb.visible).length;
      const boss = S.exploreDone(state, `${now.name}:boss`);
      return { title: now.cfg.title, parts: [`Camps ${camps}/${now.camps.length}`, `Treasure ${found}/${now.treasures.length}`, `Shrines ${shrines}/${now.shrines.length}`, `${now.cfg.boss}: ${boss ? 'beaten' : 'alive'}`] };
    },
  };
}
