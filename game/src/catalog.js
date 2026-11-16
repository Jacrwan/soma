// The village catalog: models for the build-mode pieces added on top of the
// original decorations in art.js. makePiece(type) builds any decoration,
// new or old, already baked into as few draw calls as it can be.

import * as THREE from 'three';
import * as A from './art.js';

const leaf = 0x6fae4f, leafDark = 0x4f8a3c, bark = 0x7a5536, white = 0xf5f0e7;
const g = (...kids) => A.group(...kids);
const at = (o, x = 0, y = 0, z = 0, ry = 0) => A.at(o, x, y, z, ry);
const tilt = (o, rx = 0, rz = 0) => { o.rotation.x = rx; o.rotation.z = rz; return o; };
function scatter(n, r, make, seed = 1) {
  const out = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + seed, d = r * Math.sqrt((i + 0.5) / n);
    out.add(at(make(i), Math.cos(a) * d, 0, Math.sin(a) * d, a));
  }
  return out;
}
function flower(color, h = 0.45, head = 0.11) {
  return g(A.cyl(0.02, 0.02, h, leafDark, 4), at(A.ball(head, color, 0), 0, h, 0), at(A.ball(head * 0.45, 0xffd24a, 0), 0, h + head * 0.6, 0));
}
function tree(crown, trunkH = 1.6, crownR = 1.1, trunkColor = bark) {
  return g(A.cyl(0.14, 0.2, trunkH, trunkColor, 7), at(A.ball(crownR, crown, 0), 0, trunkH + crownR * 0.6, 0), at(A.ball(crownR * 0.7, crown, 0), crownR * 0.55, trunkH + crownR * 0.2, 0.2), at(A.ball(crownR * 0.65, crown, 0), -crownR * 0.5, trunkH + crownR * 0.35, -0.2));
}
function post(h, color = A.C.woodDark, r = 0.07) { return A.cyl(r, r, h, color, 6); }
function lampGlow(r = 0.16, color = 0xfff1b0) {
  const m = A.ball(r, color, 0, { emissive: 0xffd27a, glow: 1.6 });
  m.name = 'glow';
  return m;
}
/** Half a ring (an arch, a hook, a rack loop), standing up in the x-y plane. */
function arc(r, tube, color, angle = Math.PI, opts) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24, angle), A.mat(color, opts));
  m.castShadow = true;
  return m;
}
function wheel(r, color = A.C.woodDark) { const w = A.cyl(r, r, 0.08, color, 10); w.rotation.x = Math.PI / 2; return w; }

const PIECES = {
  // Nature.
  daisies: () => scatter(9, 0.7, (i) => flower(i % 3 ? white : 0xfff6c0, 0.3, 0.08)),
  tulips: () => scatter(8, 0.65, (i) => flower([0xe8453c, 0xffd24a, 0xf28ab0, 0xb070e0][i % 4], 0.42, 0.1)),
  sunflowers: () => scatter(5, 0.5, () => g(A.cyl(0.03, 0.03, 1.3, leafDark, 4), at(tilt(A.cyl(0.24, 0.24, 0.06, 0xffc928, 10), 1.2, 0), 0, 1.3, 0.05), at(tilt(A.cyl(0.11, 0.11, 0.08, 0x6b3f1e, 10), 1.2, 0), 0, 1.32, 0.08))),
  roses: () => g(at(A.ball(0.6, leafDark, 0), 0, 0.45, 0), ...[0, 1, 2, 3, 4, 5, 6].map((i) => at(A.ball(0.1, 0xd9283c, 0), Math.cos(i * 0.9) * 0.5, 0.55 + Math.sin(i * 1.7) * 0.25, Math.sin(i * 0.9) * 0.5))),
  stump: () => g(A.cyl(0.42, 0.5, 0.45, bark, 9), at(A.cyl(0.4, 0.4, 0.03, 0xd9b98a, 9), 0, 0.45, 0)),
  boulder: () => { const r = A.makeRock(1.5); r.add(at(A.ball(0.5, leaf, 0), 0.2, 0.9, 0.1)); return g(r); },
  pine: () => g(A.cyl(0.13, 0.18, 1.0, bark, 6), at(A.cone(1.0, 1.6, 0x2f7a52, 7), 0, 0.8, 0), at(A.cone(0.78, 1.4, 0x358a5c, 7), 0, 1.7, 0), at(A.cone(0.52, 1.1, 0x3d9966, 7), 0, 2.6, 0)),
  logbench: () => g(at(tilt(A.cyl(0.24, 0.24, 2.0, bark, 9), 0, Math.PI / 2), 0, 0.42, 0), at(A.box(0.2, 0.2, 0.3, bark), -0.7, 0, 0), at(A.box(0.2, 0.2, 0.3, bark), 0.7, 0, 0)),
  birch: () => g(A.cyl(0.11, 0.14, 2.6, 0xeeeae0, 7), ...[0.6, 1.2, 1.9].map((y) => at(A.cyl(0.115, 0.115, 0.08, 0x2a2633, 7), 0, y, 0)), at(A.ball(0.95, 0x9cc95a, 0), 0, 3.0, 0), at(A.ball(0.6, 0xb0d66a, 0), 0.4, 2.6, 0.3)),
  berrybush: () => g(at(A.ball(0.62, leafDark, 0), 0, 0.5, 0), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => at(A.ball(0.07, 0x4a3fa8, 0), Math.cos(i) * 0.55, 0.45 + (i % 3) * 0.15, Math.sin(i) * 0.55))),
  cattails: () => scatter(7, 0.5, () => g(A.cyl(0.02, 0.02, 1.3, 0x7a9a4a, 4), at(A.cyl(0.05, 0.05, 0.28, 0x6b4428, 6), 0, 1.15, 0))),
  pumpkins: () => scatter(5, 0.8, (i) => { const p = A.ball(0.3 + (i % 2) * 0.1, 0xf08a28, 0); p.scale.y = 0.7; return g(at(p, 0, 0.22, 0), at(A.cyl(0.03, 0.04, 0.14, 0x5a7a2a, 5), 0, 0.46, 0)); }),
  maple: () => tree(0xe0702a, 1.7, 1.15),
  appletree: () => { const t = tree(0x5fa052, 1.5, 1.05); for (let i = 0; i < 8; i++) t.add(at(A.ball(0.09, 0xd9302c, 0), Math.cos(i * 0.8) * 0.85, 2.0 + Math.sin(i * 1.9) * 0.5, Math.sin(i * 0.8) * 0.85)); return t; },
  greatoak: () => { const t = tree(0x4f8f3c, 3.0, 2.4, 0x6a4a2e); t.add(at(A.makeRock(0.7), 1.4, 0, 0.6)); return t; },
  // Cottage.
  haybale: () => { const h = A.cyl(0.55, 0.55, 1.1, A.C.thatch, 12); h.rotation.z = Math.PI / 2; h.position.y = 0.55; return g(h); },
  picket: () => g(...[-0.9, -0.45, 0, 0.45, 0.9].map((x) => g(at(A.box(0.14, 0.8, 0.06, white), x, 0, 0), at(A.cone(0.1, 0.16, white, 4), x, 0.8, 0, Math.PI / 4))), at(A.box(2.1, 0.08, 0.05, white), 0, 0.25, -0.05), at(A.box(2.1, 0.08, 0.05, white), 0, 0.6, -0.05)),
  mailbox: () => g(post(1.0), at(A.box(0.3, 0.32, 0.55, 0x3f6fd0), 0, 1.0, 0), at(A.box(0.04, 0.22, 0.14, 0xd9302c), 0.17, 1.2, -0.12)),
  planter: () => g(A.box(1.4, 0.45, 0.5, A.C.wood, { kind: 'planks' }), ...[0, 1, 2, 3, 4, 5].map((i) => at(flower([0xf28ab0, 0xffd24a, white][i % 3], 0.3, 0.09), -0.55 + i * 0.22, 0.4, 0))),
  birdhouse: () => g(post(1.6), at(A.box(0.4, 0.4, 0.4, 0xe0b04a, { kind: 'planks' }), 0, 1.6, 0), at(A.cone(0.36, 0.3, A.C.brick, 4), 0, 2.0, 0, Math.PI / 4), at(A.cyl(0.07, 0.07, 0.02, 0x2a2633, 8), 0, 1.82, 0.205)),
  wheelbarrow: () => g(at(A.box(0.8, 0.35, 1.0, 0x3f8f5a, { metal: 0.3 }), 0, 0.4, 0), at(wheel(0.22), 0, 0.22, 0.65), at(A.box(0.06, 0.06, 1.1, A.C.woodDark), -0.3, 0.45, -0.5), at(A.box(0.06, 0.06, 1.1, A.C.woodDark), 0.3, 0.45, -0.5), at(A.box(0.7, 0.2, 0.8, A.C.dirt), 0, 0.68, 0)),
  rosearch: () => { const a = g(post(2.2, white, 0.08), at(post(2.2, white, 0.08), 1.8, 0, 0)); const top = arc(0.9, 0.07, white); top.position.set(0.9, 2.2, 0); a.add(top); for (let i = 0; i < 14; i++) { const t = (i / 13) * Math.PI; a.add(at(A.ball(0.12, i % 3 ? 0xd9283c : leafDark, 0), 0.9 - Math.cos(t) * 0.9, 2.2 + Math.sin(t) * 0.9, 0)); } a.position.x = -0.9; return g(a); },
  swing: () => g(at(post(2.6, A.C.woodDark, 0.1), -1, 0, 0), at(post(2.6, A.C.woodDark, 0.1), 1, 0, 0), at(A.box(2.2, 0.16, 0.16, A.C.woodDark), 0, 2.6, 0), at(post(1.9, 0xd9c8a0, 0.02), -0.35, 0.7, 0), at(post(1.9, 0xd9c8a0, 0.02), 0.35, 0.7, 0), at(A.box(0.9, 0.08, 0.38, A.C.wood, { kind: 'planks' }), 0, 0.66, 0)),
  // Campus.
  picnic: () => g(at(A.box(1.8, 0.08, 0.8, A.C.wood, { kind: 'planks' }), 0, 0.75, 0), at(A.box(1.8, 0.07, 0.3, A.C.wood, { kind: 'planks' }), 0, 0.42, 0.65), at(A.box(1.8, 0.07, 0.3, A.C.wood, { kind: 'planks' }), 0, 0.42, -0.65), ...[-0.7, 0.7].map((x) => at(A.box(0.08, 0.75, 1.5, A.C.woodDark), x, 0, 0))),
  desk: () => g(at(A.box(1.2, 0.06, 0.6, A.C.wood, { kind: 'planks' }), 0, 0.75, 0), ...[[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]].map(([x, z]) => at(A.box(0.06, 0.75, 0.06, A.C.woodDark), x, 0, z)), at(A.box(0.3, 0.06, 0.22, 0xd9302c), -0.25, 0.81, 0), at(A.box(0.28, 0.05, 0.2, 0x3f6fd0), -0.24, 0.87, 0.02), at(lampGlow(0.08), 0.4, 0.95, -0.1), at(A.cyl(0.02, 0.02, 0.18, A.C.iron, 4), 0.4, 0.78, -0.1), at(A.box(0.5, 0.06, 0.45, A.C.wood), 0, 0.45, 0.6)),
  chalkboard: () => g(at(tilt(A.box(0.9, 1.0, 0.06, 0x2f4a3a), -0.2, 0), 0, 0.2, 0.15), at(tilt(A.box(1.0, 1.1, 0.04, A.C.woodDark), -0.2, 0), 0, 0.15, 0.12), at(tilt(A.box(0.6, 0.05, 0.02, white), -0.2, 0), 0, 0.85, 0.24), at(tilt(A.box(0.45, 0.05, 0.02, white), -0.2, 0), -0.05, 0.7, 0.21), at(tilt(post(1.1, A.C.woodDark, 0.04), 0.35, 0), 0, 0, -0.15)),
  library: () => g(post(0.9, A.C.woodDark, 0.08), at(A.box(0.7, 0.8, 0.5, 0x3f6fd0, { kind: 'planks' }), 0, 0.9, 0), at(A.cone(0.6, 0.4, A.C.brick, 4), 0, 1.7, 0, Math.PI / 4), at(A.box(0.55, 0.6, 0.02, A.C.glass), 0, 1.0, 0.26), ...[0, 1, 2, 3].map((i) => at(A.box(0.08, 0.22, 0.3, [0xd9302c, 0xffd24a, 0x3f8f5a, white][i]), -0.18 + i * 0.12, 1.0, 0.05))),
  bikerack: () => g(...[-0.6, 0, 0.6].map((x) => { const h = arc(0.35, 0.03, A.C.metal, Math.PI, { metal: 0.7 }); h.rotation.y = Math.PI / 2; h.position.set(x, 0, 0); return h; }), at(wheel(0.32, 0x2a2633), -0.3, 0.32, 0.25), at(wheel(0.32, 0x2a2633), 0.55, 0.32, 0.25), at(tilt(A.box(0.85, 0.05, 0.05, 0xd9302c), 0, 0.2), 0.12, 0.55, 0.25)),
  flagpole: () => { const flag = A.box(1.0, 0.6, 0.03, 0x3f6fd0, { kind: 'fabric' }); flag.name = 'flag'; return g(A.cyl(0.4, 0.5, 0.25, A.C.stone, 8), post(5.2, A.C.metal, 0.05), at(A.ball(0.09, A.C.gold, 0), 0, 5.25, 0), at(flag, 0.52, 4.5, 0)); },
  clockpost: () => g(A.cyl(0.12, 0.16, 2.6, 0x2a3540, 8, { metal: 0.5 }), at(A.box(0.6, 0.6, 0.3, 0x2a3540, { metal: 0.5 }), 0, 2.6, 0), ...[1, -1].map((s) => at(A.cyl(0.24, 0.24, 0.02, white, 16), 0, 2.9, s * 0.16)).map((m) => tilt(m, Math.PI / 2, 0)), at(lampGlow(0.12), 0, 3.35, 0)),
  globe: () => g(A.cyl(0.7, 0.8, 0.8, A.C.stone, 8), at(A.ball(0.75, 0x4a90e2, 1, { metal: 0.3 }), 0, 1.6, 0), at(tilt(A.torus(0.85, 0.05, A.C.gold, { metal: 0.8 }), 0.4, 0), 0, 1.6, 0), ...[0, 1, 2].map((i) => at(A.ball(0.25, 0x5fa052, 0), Math.cos(i * 2.1) * 0.6, 1.6 + Math.sin(i * 1.3) * 0.4, Math.sin(i * 2.1) * 0.6))),
  gazebo: () => g(A.cyl(2.2, 2.3, 0.3, A.C.stone, 8), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => at(post(2.4, white, 0.08), Math.cos(i * Math.PI / 4) * 1.9, 0.3, Math.sin(i * Math.PI / 4) * 1.9)), at(A.cone(2.6, 1.4, 0x5a7fbf, 8), 0, 2.7, 0), at(A.ball(0.15, A.C.gold, 0), 0, 4.1, 0)),
  bandstand: () => g(A.cyl(3, 3.1, 0.6, A.C.stone, 10), ...[0, 1, 2, 3, 4, 5].map((i) => at(post(3, white, 0.1), Math.cos(i * Math.PI / 3) * 2.6, 0.6, Math.sin(i * Math.PI / 3) * 2.6)), at(A.cone(3.4, 1.8, 0xc94c3c, 12), 0, 3.6, 0), ...[0, 1, 2, 3, 4, 5].map((i) => at(lampGlow(0.12), Math.cos(i * Math.PI / 3 + 0.5) * 3.1, 3.5, Math.sin(i * Math.PI / 3 + 0.5) * 3.1))),
  // Harbor.
  barrels: () => g(at(A.cyl(0.35, 0.3, 0.8, A.C.wood, 10, { kind: 'planks' }), -0.35, 0, 0), at(A.cyl(0.35, 0.3, 0.8, A.C.wood, 10, { kind: 'planks' }), 0.35, 0, 0.1), at(A.cyl(0.35, 0.3, 0.8, A.C.wood, 10, { kind: 'planks' }), 0, 0.8, 0.05), ...[0.1, 0.65].map((y) => at(A.cyl(0.36, 0.36, 0.05, A.C.iron, 10), -0.35, y, 0))),
  buoy: () => g(at(A.cone(0.5, 0.9, 0xd9302c, 10), 0, 0, 0), at(A.cyl(0.42, 0.42, 0.18, white, 10), 0, 0.35, 0), at(lampGlow(0.1, 0xffb0a0), 0, 1.0, 0)),
  anchor: () => { const a = new THREE.Group(); a.add(at(A.box(0.18, 1.8, 0.18, 0x3a4048, { metal: 0.6 }), 0, 0.4, 0), at(A.box(0.9, 0.12, 0.12, 0x3a4048, { metal: 0.6 }), 0, 1.9, 0)); const hook = arc(0.55, 0.09, 0x3a4048, Math.PI, { metal: 0.6 }); hook.rotation.z = Math.PI; hook.position.y = 0.95; a.add(hook); a.add(at(A.torus(0.16, 0.05, 0x3a4048), 0, 2.3, 0)); tilt(a, 0, 0.35); return g(a, at(A.makeRock(0.6), 0.6, 0, 0.3)); },
  bollards: () => g(...[-1, 1].map((x) => g(at(A.cyl(0.18, 0.2, 0.8, 0x3a4048, 8, { metal: 0.4 }), x, 0, 0), at(A.cyl(0.24, 0.24, 0.1, 0x3a4048, 8), x, 0.8, 0))), at(tilt(A.cyl(0.04, 0.04, 2.0, 0xd9c8a0, 5), 0, Math.PI / 2), 0, 0.6, 0)),
  rowboat: () => { const hull = A.cyl(0.7, 0.45, 2.6, 0x7a4a2e, 8, { kind: 'planks' }); hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, 0.55); hull.position.y = 0.35; return g(hull, at(A.box(0.9, 0.08, 0.3, A.C.wood), 0, 0.55, 0), at(tilt(A.box(0.06, 0.06, 2.2, A.C.woodDark), 0, 0.2), 0.2, 0.62, 0.2)); },
  nets: () => g(at(post(2, A.C.woodDark, 0.07), -1.1, 0, 0), at(post(2, A.C.woodDark, 0.07), 1.1, 0, 0), at(A.box(2.4, 0.08, 0.08, A.C.woodDark), 0, 1.95, 0), at(A.box(2.0, 1.4, 0.03, 0xc9b98a, { opacity: 0.75 }), 0, 0.5, 0), ...[0, 1, 2].map((i) => at(A.ball(0.1, 0xd9302c, 0), -0.7 + i * 0.7, 0.45, 0.04))),
  minilight: () => g(...[0, 1, 2, 3].map((i) => at(A.cyl(0.7 - i * 0.08, 0.78 - i * 0.08, 1.1, i % 2 ? 0xd9302c : white, 12), 0, i * 1.1, 0)), at(A.cyl(0.5, 0.5, 0.6, A.C.glass, 10), 0, 4.4, 0), at(lampGlow(0.28), 0, 4.7, 0), at(A.cone(0.62, 0.5, 0xd9302c, 10), 0, 5.0, 0), at(A.cyl(1.1, 1.2, 0.3, A.C.stoneDark, 10), 0, 0, 0)),
  // Night market.
  signpost: () => g(post(2.0), ...[0, 1, 2].map((i) => at(A.box(0.9, 0.22, 0.05, [0xe0b04a, 0x9fd18a, 0x8fa8e8][i], { kind: 'planks' }), 0.3 * (i % 2 ? -1 : 1), 1.85 - i * 0.32, 0, i * 0.7))),
  firepit: () => { const f = A.makeCampfire(); return g(f, ...[0, 1, 2].map((i) => at(tilt(A.cyl(0.2, 0.2, 1.2, bark, 8), 0, Math.PI / 2), Math.cos(i * 2.1) * 1.6, 0.2, Math.sin(i * 2.1) * 1.6, -i * 2.1 + Math.PI / 2))); },
  lanterns: () => { const s = g(at(post(2.6), -1.6, 0, 0), at(post(2.6), 1.6, 0, 0)); for (let i = 0; i < 6; i++) { const x = -1.3 + i * 0.52, sag = 2.4 - Math.sin(((i + 0.5) / 6) * Math.PI) * 0.35; const l = A.ball(0.14, [0xff6b4a, 0xffd04a, 0xff9fd0][i % 3], 0, { emissive: [0xff6b4a, 0xffb04a, 0xff7fc0][i % 3], glow: 1.4 }); l.name = 'glow'; s.add(at(l, x, sag, 0)); } s.add(at(tilt(A.cyl(0.015, 0.015, 3.2, 0x2a2633, 4), 0, Math.PI / 2), 0, 2.5, 0)); return s; },
  hanginglamp: () => g(post(2.4, A.C.iron, 0.06), at(A.box(0.8, 0.06, 0.06, A.C.iron), 0.35, 2.35, 0), at(A.cyl(0.015, 0.015, 0.3, A.C.iron, 4), 0.7, 2.05, 0), at(A.box(0.24, 0.32, 0.24, A.C.glass), 0.7, 1.75, 0), at(lampGlow(0.1), 0.7, 1.92, 0)),
  stall: () => { const roofA = A.box(2.4, 0.06, 0.8, 0xd9302c, { kind: 'fabric' }); const roofB = A.box(2.4, 0.06, 0.8, white, { kind: 'fabric' }); return g(A.box(2.2, 1.0, 1.0, A.C.wood, { kind: 'planks' }), ...[[-1, -0.45], [1, -0.45], [-1, 0.45], [1, 0.45]].map(([x, z]) => at(post(2.3, A.C.woodDark, 0.06), x, 0, z)), at(tilt(roofA, 0.35, 0), 0, 2.3, 0.3), at(tilt(roofB, -0.35, 0), 0, 2.3, -0.3), ...[0, 1, 2].map((i) => at(A.cyl(0.18, 0.15, 0.12, [0xffd04a, 0xd9302c, 0x9fd18a][i], 10), -0.6 + i * 0.6, 1.0, 0.1)), at(lampGlow(0.1), 0, 2.05, 0.4)); },
  fairyarch: () => { const a = g(at(post(2.6, A.C.woodDark, 0.09), -1.1, 0, 0), at(post(2.6, A.C.woodDark, 0.09), 1.1, 0, 0)); const top = arc(1.1, 0.06, A.C.woodDark); top.position.y = 2.6; a.add(top); for (let i = 0; i < 16; i++) { const t = (i / 15) * Math.PI; const b = A.ball(0.06, 0xfff1b0, 0, { emissive: 0xffe08a, glow: 2 }); b.name = 'glow'; a.add(at(b, -Math.cos(t) * 1.1, 2.6 + Math.sin(t) * 1.1, 0.05)); } for (let i = 0; i < 8; i++) { const b = A.ball(0.06, 0xfff1b0, 0, { emissive: 0xffe08a, glow: 2 }); b.name = 'glow'; a.add(at(b, (i < 4 ? -1.1 : 1.1), 0.4 + (i % 4) * 0.55, 0.1)); } return a; },
};

/** Any decoration: a catalog piece or one of the originals in art.js. */
export function makePiece(type) {
  return PIECES[type] ? A.bakeModel(PIECES[type]()) : A.makeDecor(type);
}
export const hasPiece = (type) => Boolean(PIECES[type]);
