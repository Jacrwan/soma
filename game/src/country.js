// The country around town: landmarks to discover (different in every age),
// dirt roads out to them and to the hidden caches, and farms by the walls.
// layoutCountry() builds it all for one land and returns a mask so trees and
// grass stay off the roads, fields and landmarks.

import * as THREE from 'three';
import * as A from './art.js';

const { C, box, cyl, cone, ball, at, group } = A;

const tilt = (obj, rx = 0, rz = 0) => { obj.rotation.x = rx; obj.rotation.z = rz; return obj; };
const BONE = 0xeee6d2, SANDSTONE = 0xd9b77a, OCHRE = 0xc8642e, DARK = 0x1c1722;

/** A curved piece (tusk, rib) as part of a torus. */
function arc(r, tube, angle, color) {
  const g = new THREE.TorusGeometry(r, tube, 8, 20, angle);
  const m = new THREE.Mesh(g, A.mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const stone = (w, h, d, color = C.rock) => box(w, h, d, color);
function rocks(g, n, spread, scale = 1, seed = 1) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.39 + seed, d = spread * (0.5 + ((i * 37 + seed * 11) % 10) / 20);
    g.add(at(A.makeRock(scale * (0.5 + (i % 3) * 0.25)), Math.cos(a) * d, -0.15, Math.sin(a) * d, a));
  }
}
function wheel(r, color = C.iron) {
  const w = cyl(r, r, 0.12, color, 10);
  w.rotation.x = Math.PI / 2;
  return w;
}
function banner(color, h = 4.2) {
  return group(cyl(0.06, 0.06, h, C.woodDark, 5), at(box(0.8, 1.2, 0.04, color, { kind: 'fabric' }), 0.42, h - 1.4, 0));
}
function tent(color, r = 1.6) {
  return group(at(cone(r, r * 1.5, color, 4, { kind: 'fabric' }), 0, 0, 0, Math.PI / 4), at(box(0.6, 0.9, 0.05, DARK), 0, 0, r * 0.68));
}

// --- Landmarks, by age -----------------------------------------------------------------
// Each make() returns a group sitting on y = 0. solid is how big it is to bump into.
function mammoth() {
  const g = new THREE.Group();
  const skull = ball(1.0, BONE);
  skull.scale.set(1.2, 0.9, 1.1);
  g.add(at(skull, 2.6, 0.7, 0));
  // Tusks curve down and forward from the skull, then up.
  for (const s of [-1, 1]) {
    const tusk = arc(1.4, 0.17, Math.PI * 0.9, BONE);
    tusk.position.set(4.8, 1.55, s * 0.6);
    tusk.rotation.set(0, s * -0.18, Math.PI);
    g.add(tusk);
  }
  g.add(at(tilt(cyl(0.16, 0.2, 5.2, BONE, 6), 0, Math.PI / 2), 2.2, 1.6, 0));
  for (let i = 0; i < 6; i++) {
    const rib = arc(1.35 - i * 0.07, 0.11, Math.PI, BONE);
    rib.rotation.y = Math.PI / 2;
    rib.position.set(1.4 - i * 0.65, 0.2, 0);
    g.add(rib);
  }
  rocks(g, 4, 3.4, 0.9, 2);
  return g;
}
function paintedCave() {
  const g = new THREE.Group();
  const hill = A.makeRock(7);
  hill.scale.y *= 1.15;
  g.add(at(hill, 0, -0.8, -3.2));
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(1.7, 18, 0, Math.PI), A.mat(DARK));
  g.add(at(mouth, 0, 0, 1.2));
  // A standing slab by the mouth with the herd painted on it.
  const slab = box(2.2, 2.4, 0.45, C.rockDark);
  g.add(at(tilt(slab, -0.08, 0), -3.1, 0, 1.6, 0.25));
  const marks = [[-0.6, 1.5, 0.5, 0.28], [0.1, 1.6, 0.6, 0.3], [0.6, 1.2, 0.35, 0.22], [-0.3, 0.8, 0.45, 0.25], [0.45, 0.65, 0.18, 0.4]];
  for (const [x, y, w, h] of marks) g.add(at(box(w, h, 0.04, OCHRE), -3.1 + x * Math.cos(0.25), y, 1.6 + 0.25 - x * Math.sin(0.25), 0.25));
  g.add(at(A.makeCampfire(), 1.9, 0, 3.4));
  return g;
}
function giantTree() {
  const g = new THREE.Group();
  g.add(A.makeTree(0, 3.1));
  rocks(g, 5, 3.2, 0.7, 4);
  g.add(at(A.makeDecor('mushrooms'), 2.4, 0, 1.6));
  return g;
}
function sunStones() {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = stone(1.0, 2.6 + (i % 3) * 0.6, 0.6, i % 2 ? C.rock : C.rockDark);
    g.add(at(tilt(s, 0, (i % 4 === 0 ? 0.25 : 0.04)), Math.cos(a) * 4, 0, Math.sin(a) * 4, -a));
  }
  g.add(at(stone(2.6, 0.5, 0.7), Math.cos(0.7) * 4, 3.2, Math.sin(0.7) * 4, -0.7 + Math.PI / 2));
  g.add(at(cyl(0.9, 1.1, 0.4, C.stoneDark, 7), 0, 0, 0));
  return g;
}
function riverPort() {
  const g = new THREE.Group();
  g.add(at(box(3, 0.2, 9, C.wood, { kind: 'planks' }), 0, 0.3, 3));
  for (const x of [-1.3, 1.3]) for (const z of [0, 3, 6]) g.add(at(cyl(0.14, 0.14, 1.6, C.woodDark, 6), x, -1, z));
  const hull = box(1.8, 0.8, 5, C.woodDark, { kind: 'planks' });
  g.add(at(hull, 2.8, -0.3, 5.5), at(cyl(0.07, 0.07, 4, C.woodDark, 5), 2.8, 0.4, 5.5), at(box(0.05, 2.4, 1.8, C.cream, { kind: 'fabric' }), 2.85, 1.6, 5.5));
  for (let i = 0; i < 3; i++) g.add(at(cyl(0.3, 0.2, 0.8, C.clay, 8), -0.8 + i * 0.5, 0.4, -0.8 + (i % 2) * 0.4));
  g.add(at(A.makeDecor('crates'), 0.6, 0.4, 0.4));
  return g;
}
function obelisk() {
  const g = new THREE.Group();
  g.add(cyl(1.6, 1.8, 0.5, SANDSTONE, 4), at(cyl(0.45, 0.75, 7, SANDSTONE, 4), 0, 0.5, 0, Math.PI / 4), at(cone(0.5, 0.8, C.gold, 4, { metal: 0.8, rough: 0.3 }), 0, 7.5, 0, Math.PI / 4));
  g.add(at(tilt(cyl(0.4, 0.55, 2.2, SANDSTONE, 4), Math.PI / 2, 0.3), 3, 0.4, 1.5));
  return g;
}
function caravan() {
  const g = new THREE.Group();
  g.add(at(tent(0xc94c3c), -2.4, 0, 0, 0.3), at(tent(0xe0b04a, 1.3), 2.1, 0, -1.2, -0.4), at(tent(0x3f7fbf, 1.2), 0.4, 0, 2.6, 2.6));
  g.add(at(A.makeCampfire(), 0, 0, 0), at(A.makeDecor('crates'), 2.8, 0, 1.8));
  return g;
}
function sandArch() {
  const g = new THREE.Group();
  for (const x of [-2.6, 2.6]) g.add(at(cyl(1.0, 1.3, 5.5, SANDSTONE, 6), x, 0, 0));
  const top = box(7.4, 1.4, 2.2, SANDSTONE);
  g.add(at(top, 0, 5.2, 0));
  rocks(g, 3, 4, 0.8, 7);
  return g;
}
function castleRuin() {
  const g = new THREE.Group();
  const walls = [[-4, 0, 0.8, 3.4, 8], [0, -4, 8, 2.6, 0.8], [4, 1, 0.8, 1.8, 5], [-1.5, 4, 4, 1.2, 0.8]];
  for (const [x, z, w, h, d] of walls) g.add(at(box(w, h, d, C.stone), x, 0, z));
  g.add(at(cyl(1.6, 1.8, 6.5, C.stone, 10), -4, 0, -4));
  for (let i = 0; i < 6; i++) g.add(at(box(0.6, 0.7, 0.6, C.stone), -4 + Math.cos(i) * 1.4, 6.5, -4 + Math.sin(i) * 1.4));
  rocks(g, 6, 3, 0.6, 3);
  return g;
}
function joustField() {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) g.add(at(A.makeDecor('fence'), -6.6 + i * 2.2, 0, 0));
  g.add(at(banner(0xc94c3c), -7.4, 0, -1.5), at(banner(0x3f6fd0), 7.4, 0, -1.5));
  const stand = group(box(5, 0.5, 2, C.wood, { kind: 'planks' }), at(box(5, 0.5, 1.2, C.wood, { kind: 'planks' }), 0, 0.5, -0.4), at(box(5, 0.1, 2.2, 0xc94c3c, { kind: 'fabric' }), 0, 2.4, -0.2));
  for (const x of [-2.4, 2.4]) stand.add(at(cyl(0.08, 0.08, 2.4, C.woodDark, 5), x, 0, 0.8));
  g.add(at(stand, 0, 0, -4.5));
  return g;
}
function fishingHut() {
  const g = new THREE.Group();
  g.add(at(box(3, 2.2, 2.6, C.wood, { kind: 'planks' }), 0, 0, -1), at(cone(2.5, 1.5, C.thatch, 4), 0, 2.2, -1, Math.PI / 4));
  g.add(at(box(1.6, 0.18, 6, C.wood, { kind: 'planks' }), 0, 0.25, 3.6));
  for (const z of [2, 4.5]) for (const x of [-0.7, 0.7]) g.add(at(cyl(0.1, 0.1, 1.4, C.woodDark, 5), x, -1, z));
  g.add(at(tilt(cyl(0.03, 0.03, 3, C.woodDark, 4), 0.6, 0), 0.5, 0.4, 6));
  return g;
}
function oldMill() {
  const g = A.makeDecor('windmill');
  g.scale.setScalar(2.3);
  return group(g);
}
function oldMine() {
  const g = new THREE.Group();
  const hill = A.makeRock(4.6);
  hill.scale.y *= 0.7;
  g.add(at(hill, 0, -0.6, -2.4));
  g.add(at(box(0.3, 3, 0.3, C.woodDark), -1.4, 0, 1), at(box(0.3, 3, 0.3, C.woodDark), 1.4, 0, 1), at(box(3.4, 0.35, 0.35, C.woodDark), 0, 3, 1));
  g.add(at(box(2.5, 2.8, 0.1, DARK), 0, 0, 0.9));
  for (const x of [-0.5, 0.5]) g.add(at(box(0.08, 0.08, 7, C.metal), x, 0.05, 4));
  for (let i = 0; i < 9; i++) g.add(at(box(1.5, 0.06, 0.2, C.woodDark), 0, 0, 1 + i * 0.8));
  const cart = group(at(box(1.2, 0.7, 1.6, C.iron, { metal: 0.6 }), 0, 0.3, 0), at(box(1, 0.2, 1.4, C.rockDark), 0, 1, 0));
  for (const x of [-0.6, 0.6]) for (const z of [-0.5, 0.5]) cart.add(at(wheel(0.25), x, 0.25, z));
  g.add(at(cart, 0, 0, 5));
  return g;
}
function waterTower() {
  const g = new THREE.Group();
  for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) g.add(at(box(0.2, 6, 0.2, C.iron), x, 0, z));
  g.add(at(cyl(2.0, 2.0, 2.8, C.wood, 12, { kind: 'planks' }), 0, 6, 0), at(cone(2.2, 1.2, C.slate, 12), 0, 8.8, 0));
  for (const y of [6.6, 7.9]) g.add(at(cyl(2.05, 2.05, 0.12, C.iron, 12), 0, y, 0));
  return g;
}
function chimneyRuin() {
  const g = new THREE.Group();
  g.add(at(cyl(0.9, 1.3, 12, C.brick, 10), 0, 0, 0), at(cyl(1.05, 1.05, 0.5, C.stoneDark, 10), 0, 11.5, 0));
  g.add(at(box(6, 2.4, 0.6, C.brick), 2.5, 0, 2.5), at(box(0.6, 3.4, 4, C.brick), 5.2, 0, 0.8));
  rocks(g, 5, 3.6, 0.5, 9);
  return g;
}
function steamEngine() {
  const g = new THREE.Group();
  for (const z of [-0.6, 0.6]) g.add(at(box(9, 0.1, 0.1, C.metal), 0, 0.05, z));
  for (let i = 0; i < 11; i++) g.add(at(box(0.25, 0.08, 1.8, C.woodDark), -4.5 + i * 0.9, 0, 0));
  const loco = new THREE.Group();
  loco.add(at(tilt(cyl(0.75, 0.75, 3.6, 0x2f3a33, 12, { metal: 0.5 }), 0, Math.PI / 2), 0.4, 1.4, 0));
  loco.add(at(box(1.6, 2.2, 1.8, 0x2f3a33, { metal: 0.4 }), -2.1, 0.7, 0), at(box(2, 0.2, 2.1, C.iron), -2.1, 2.9, 0));
  loco.add(at(cyl(0.25, 0.35, 1.1, C.iron, 8), 1.6, 2.1, 0), at(box(4.8, 0.4, 1.6, C.iron), 0, 0.4, 0));
  for (const x of [-1.4, 0, 1.4]) for (const z of [-0.85, 0.85]) loco.add(at(wheel(0.55, C.red), x, 0.55, z));
  g.add(loco);
  return g;
}
function lighthouse() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) g.add(at(cyl(1.3 - i * 0.12, 1.42 - i * 0.12, 2, i % 2 ? C.red : C.white, 14), 0, i * 2, 0));
  g.add(at(cyl(1.0, 1.0, 1.2, C.glass, 12), 0, 10, 0), at(ball(0.5, 0xfff1b0, 0, { emissive: 0xffe08a, glow: 2 }), 0, 10.6, 0), at(cone(1.2, 1, C.red, 12), 0, 11.2, 0));
  g.add(at(cyl(2.2, 2.4, 0.4, C.stoneDark, 10), 0, 0, 0));
  return g;
}
function windTurbine() {
  const g = new THREE.Group();
  g.add(cyl(0.25, 0.45, 13, C.white, 10), at(box(0.7, 0.7, 1.6, C.white), 0, 13, 0.2));
  const rotor = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = group(at(box(0.35, 5.5, 0.08, C.white), 0, 2.75, 0));
    blade.rotation.z = (i * Math.PI * 2) / 3;
    rotor.add(blade);
  }
  rotor.position.set(0, 13.35, 1.1);
  rotor.userData.spin = 'z';
  rotor.name = 'rotor';
  g.add(rotor);
  return g;
}
function radioMast() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0, 0.55]]) g.add(at(tilt(box(0.12, 16, 0.12, C.red), -z * 0.025, x * 0.025), x, 0, z));
  for (let y = 1.5; y < 15; y += 1.8) g.add(at(cyl(0.6 - y * 0.025, 0.6 - y * 0.025, 0.08, C.white, 3), 0, y, 0));
  g.add(at(ball(0.25, 0xff4a3a, 0, { emissive: 0xff2a1a, glow: 2.5 }), 0, 16.1, 0));
  g.add(at(box(2.4, 2, 2, C.white), 3, 0, 1));
  return g;
}
function billboard() {
  const g = new THREE.Group();
  for (const x of [-2.5, 2.5]) g.add(at(box(0.3, 4, 0.3, C.iron), x, 0, 0));
  g.add(at(box(7, 3, 0.25, 0xf5f0e7), 0, 4, 0), at(box(6.6, 2.6, 0.05, 0x3f6fd0), 0, 4.2, 0.15), at(box(3.4, 0.6, 0.05, 0xffd04a), -1, 5.2, 0.18), at(box(2, 0.4, 0.05, 0xffffff), -1.6, 4.4, 0.18));
  return g;
}
function radarDish() {
  const g = new THREE.Group();
  g.add(cyl(0.6, 0.9, 4, C.white, 10), at(box(3, 2, 3, C.white), 0, 0, 0));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 10, 0, Math.PI * 2, 0, Math.PI / 3.2), A.mat(C.white));
  dish.castShadow = true;
  const head = new THREE.Group();
  head.add(at(tilt(dish, Math.PI * 0.8, 0), 0, 2, 0), at(cyl(0.06, 0.06, 2.4, C.metal, 4), 0, 1, 0.9));
  head.position.y = 4;
  head.userData.spin = 'y';
  head.userData.speed = 0.25;
  head.name = 'rotor';
  g.add(head);
  return g;
}
function crashedSatellite() {
  const g = new THREE.Group();
  const crater = cyl(4.5, 5, 0.3, 0x8f4528, 14);
  g.add(at(crater, 0, -0.2, 0));
  const sat = group(box(2, 2, 2, C.gold, { metal: 0.8, rough: 0.35 }), at(box(4, 0.1, 1.6, 0x2a3f8a, { metal: 0.4 }), 3, 1, 0), at(box(4, 0.1, 1.6, 0x2a3f8a, { metal: 0.4 }), -3, 1, 0), at(cyl(0.05, 0.05, 2, C.metal, 4), 0, 2, 0));
  sat.rotation.set(0.35, 0.6, 0.25);
  g.add(at(sat, 0, 0.6, 0));
  rocks(g, 6, 4.2, 0.6, 5);
  return g;
}
function launchTower() {
  const g = new THREE.Group();
  g.add(cyl(4, 4.2, 0.4, C.asphalt, 12));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(at(box(0.25, 15, 0.25, C.red), x + 3, 0.4, z));
  for (let y = 2; y < 15; y += 2) g.add(at(box(2.3, 0.15, 2.3, C.red), 3, y, 0));
  g.add(at(cyl(2.6, 3.2, 0.06, 0x2b2622, 14), 0, 0.42, 0));
  return g;
}
function observatory() {
  const g = new THREE.Group();
  g.add(cyl(3, 3.2, 3, C.white, 14), at(A.dome(3, C.metal, { metal: 0.7, rough: 0.35 }), 0, 3, 0), at(box(0.9, 3.2, 0.2, DARK), 0, 3.2, 2.6));
  g.add(at(tilt(cyl(0.35, 0.35, 3, C.iron, 8), -0.6, 0), 0, 5.2, 1.6));
  return g;
}

/** Four landmarks for each age. water: wants a spot on a shore. */
export const LANDMARKS = [
  [{ id: 'mammoth', name: 'Mammoth bones', text: 'A giant from long before the town.', make: mammoth, solid: 3 },
    { id: 'cave', name: 'Painted cave', text: 'Hunters drew the herds on the rock.', make: paintedCave, solid: 4 },
    { id: 'eldertree', name: 'The elder tree', text: 'The oldest tree in the valley.', make: giantTree, solid: 1.6 },
    { id: 'sunstones', name: 'Sun stones', text: 'They line up with the summer sunrise.', make: sunStones, solid: 1.2 }],
  [{ id: 'port', name: 'River port', text: 'Boats bring copper and tin up the river.', make: riverPort, solid: 1.5, water: true },
    { id: 'obelisk', name: 'Sun obelisk', text: 'Carved from a single stone.', make: obelisk, solid: 1.8 },
    { id: 'caravan', name: 'Caravan camp', text: 'Traders resting on the long road.', make: caravan, solid: 1.2 },
    { id: 'sandarch', name: 'Sandstone arch', text: 'Wind took a thousand years to cut it.', make: sandArch, solid: 1.3 }],
  [{ id: 'castle', name: 'Castle ruin', text: 'A lord’s keep, long since fallen.', make: castleRuin, solid: 2 },
    { id: 'joust', name: 'Jousting field', text: 'Knights tilt here every spring.', make: joustField, solid: 1 },
    { id: 'fishing', name: 'Fishing hut', text: 'The best trout on the lake, says the owner.', make: fishingHut, solid: 2, water: true },
    { id: 'mill', name: 'Old mill', text: 'Still grinds flour for the town.', make: oldMill, solid: 3 }],
  [{ id: 'mine', name: 'Old mine', text: 'Coal for the factories came from here.', make: oldMine, solid: 3.5 },
    { id: 'watertower', name: 'Water tower', text: 'Keeps the steam engines fed.', make: waterTower, solid: 2 },
    { id: 'chimney', name: 'Brick chimney', text: 'All that is left of the first factory.', make: chimneyRuin, solid: 1.4 },
    { id: 'engine', name: 'Retired engine', text: 'Pulled the first train into town.', make: steamEngine, solid: 2.4 }],
  [{ id: 'lighthouse', name: 'Lighthouse', text: 'Guides ships past the rocks at night.', make: lighthouse, solid: 2.2, water: true },
    { id: 'turbine', name: 'Wind turbine', text: 'Powers half the town on a windy day.', make: windTurbine, solid: 0.8 },
    { id: 'mast', name: 'Radio mast', text: 'The town station plays study music all night.', make: radioMast, solid: 1 },
    { id: 'billboard', name: 'Old billboard', text: 'Nobody remembers what it was selling.', make: billboard, solid: 1 }],
  [{ id: 'radar', name: 'Radar dish', text: 'Listening for signals from the stars.', make: radarDish, solid: 2.2 },
    { id: 'satellite', name: 'Fallen satellite', text: 'Came down in a storm of sparks.', make: crashedSatellite, solid: 2.4 },
    { id: 'launch', name: 'Test launch pad', text: 'Where the first rockets were tried.', make: launchTower, solid: 2 },
    { id: 'observatory', name: 'Observatory', text: 'The Moon looks close enough to touch.', make: observatory, solid: 3.2 }],
];

const ROAD_COLORS = [0xb59a6c, 0xd2b07a, 0xa98a5e, 0x8f8270, 0x5a5d66, 0xb0663e];
const CROPS = [0xa9b04e, 0x7fbf4a, 0xe0c060, 0xd2b84a, 0x6fbf5a, 0x8fd3a0];

// --- Layout -----------------------------------------------------------------------------
const HALF = 150; // the mask covers -HALF..HALF in x and z, one cell per metre
export const MASK = { ROAD: 1, FIELD: 2, SITE: 3 };

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutCountry({ index, height, passOpen, caches, townR, walkR, roadFrom = null }) {
  const r = seeded(4242 + index * 97);
  const object = new THREE.Group();
  const mask = new Uint8Array(HALF * 2 * HALF * 2);
  const cell = (x, z) => (Math.round(z) + HALF) * HALF * 2 + (Math.round(x) + HALF);
  const inside = (x, z) => Math.abs(x) < HALF - 1 && Math.abs(z) < HALF - 1;
  const markCircle = (x, z, rad, v) => {
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dz * dz > rad * rad || !inside(x + dx, z + dz)) continue;
      const i = cell(x + dx, z + dz);
      mask[i] = Math.max(mask[i], v);
    }
  };
  const at_ = (x, z) => (inside(x, z) ? mask[cell(x, z)] : 0);
  const dry = (x, z) => height(x, z) > 0.15;
  const flat = (x, z) => { const y = height(x, z); return Math.abs(height(x + 2.5, z) - y) + Math.abs(height(x, z + 2.5) - y) < 1.4; };
  const spin = [];

  // Landmarks.
  const landmarks = [];
  const taken = caches.map((c) => ({ x: c.x, z: c.z }));
  for (const def of LANDMARKS[index] || []) {
    let spot = null;
    for (let tries = 0; tries < 3000 && !spot; tries++) {
      const a = r() * Math.PI * 2, d = townR + 16 + r() * (walkR - townR - 26);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = height(x, z);
      if (y < 0.15 || y > 9 || passOpen(x, z, d) < 0.55 || !flat(x, z)) continue;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < 30)) continue;
      // Water landmarks want a shore within a few metres.
      if (def.water && tries < 2400) {
        let shore = null;
        for (let k = 0; k < 12; k++) { const b = (k / 12) * Math.PI * 2; if (height(x + Math.cos(b) * 6, z + Math.sin(b) * 6) < -0.6) { shore = b; break; } }
        if (shore === null) continue;
        spot = { x, z, y, face: shore };
      } else spot = { x, z, y, face: Math.atan2(-z, -x) };
    }
    if (!spot) continue;
    taken.push(spot);
    const model = def.make();
    // Most face town; shore ones face the water.
    model.position.set(spot.x, spot.y - 0.05, spot.z);
    model.rotation.y = Math.PI / 2 - spot.face;
    model.traverse((o) => { if (o.userData.spin || o.name === 'sails') spin.push(o); });
    object.add(model);
    markCircle(spot.x, spot.z, 7, MASK.SITE);
    landmarks.push({ id: def.id, name: def.name, text: def.text, x: spot.x, y: spot.y, z: spot.z, solid: def.solid, index: landmarks.length });
  }

  // Roads: from the edge of town out to every landmark and cache, with a gentle bend.
  const roads = [];
  for (const t of [...landmarks, ...caches]) {
    const a = Math.atan2(t.z, t.x);
    const from = roadFrom?.(t.x, t.z);
    const sx = from ? from.x : Math.cos(a) * (townR - 5), sz = from ? from.z : Math.sin(a) * (townR - 5);
    const len = Math.hypot(t.x - sx, t.z - sz);
    const ex = t.x - ((t.x - sx) / len) * 4.5, ez = t.z - ((t.z - sz) / len) * 4.5;
    const n = Math.max(4, Math.ceil(len / 2));
    const px = -(ez - sz) / len, pz = (ex - sx) / len;
    const bend = (r() - 0.5) * 16, wave = (r() - 0.5) * 4;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const off = Math.sin(k * Math.PI) * bend + Math.sin(k * Math.PI * 3) * wave * Math.sin(k * Math.PI);
      pts.push({ x: sx + (ex - sx) * k + px * off, z: sz + (ez - sz) * k + pz * off });
    }
    // Never through water: wet points step sideways until they're on dry ground (around the pond).
    for (const p of pts) {
      if (dry(p.x, p.z)) continue;
      for (let o = 1.5; o <= 24; o += 1.5) {
        if (dry(p.x + px * o, p.z + pz * o)) { p.x += px * o; p.z += pz * o; break; }
        if (dry(p.x - px * o, p.z - pz * o)) { p.x -= px * o; p.z -= pz * o; break; }
      }
    }
    // Smooth out the sideways steps (no staircase roads along a creek), then leave out
    // any stretch that would still be in water: the road just stops at the bank.
    for (let pass = 0; pass < 4; pass++) for (let i = 1; i < pts.length - 1; i++) {
      pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
      pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
    }
    let run = [];
    const flush = () => { if (run.length >= 3) { roads.push(run); for (const p of run) markCircle(p.x, p.z, 2, MASK.ROAD); } run = []; };
    for (const p of pts) { if (dry(p.x, p.z)) run.push(p); else flush(); }
    flush();
  }
  object.add(roadMesh(roads, height, ROAD_COLORS[index] ?? ROAD_COLORS[0]));

  // Farms just outside the walls (wild grain and berry patches in the Stone Age).
  const fields = [];
  for (let tries = 0; tries < 600 && fields.length < 5; tries++) {
    const a = r() * Math.PI * 2, d = townR + 8 + r() * 14;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (passOpen(x, z, d) < 0.7 || !dry(x, z) || !flat(x, z)) continue;
    const w = 9 + r() * 4, depth = 6 + r() * 2;
    const rot = -a + Math.PI / 2;
    let clear = true;
    for (let i = -1; i <= 1 && clear; i++) for (let j = -1; j <= 1 && clear; j++) {
      const cx = x + Math.cos(a + Math.PI / 2) * i * w * 0.55 + Math.cos(a) * j * depth * 0.6;
      const cz = z + Math.sin(a + Math.PI / 2) * i * w * 0.55 + Math.sin(a) * j * depth * 0.6;
      if (at_(cx, cz) || !dry(cx, cz)) clear = false;
    }
    if (!clear || fields.some((f) => Math.hypot(f.x - x, f.z - z) < 16)) continue;
    fields.push({ x, z, w, d: depth, rot, orchard: fields.length === 1 });
    markCircle(x, z, Math.ceil(Math.max(w, depth) / 2 + 1.5), MASK.FIELD);
  }
  for (const f of fields) object.add(f.orchard ? orchard(f, index, height) : farm(f, index, height));

  A.bakeModel(object);
  return { object, landmarks, roads, fields, spin, mask: (x, z) => at_(x, z) };
}

function roadMesh(roads, height, color) {
  const pos = [], col = [], idx = [];
  const base = new THREE.Color(color), c = new THREE.Color();
  for (const pts of roads) {
    const start = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let tx = q.x - o.x, tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      // Narrower at the far end, like a trail fading out.
      const w = 1.5 - (i / pts.length) * 0.4;
      for (const s of [-1, 1]) {
        const x = p.x - tz * w * s, z = p.z + tx * w * s;
        pos.push(x, height(x, z) + 0.09, z);
        c.copy(base).multiplyScalar(0.92 + Math.sin(x * 3.1 + z * 2.3) * 0.05 + (s > 0 ? 0.03 : 0));
        col.push(c.r, c.g, c.b);
      }
      if (i > 0) {
        const a = start + (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.receiveShadow = true;
  return m;
}

function farm(f, index, height) {
  const g = new THREE.Group();
  g.position.set(f.x, height(f.x, f.z), f.z);
  g.rotation.y = f.rot;
  g.add(at(box(f.w, 0.08, f.d, C.dirt), 0, -0.02, 0));
  const rows = Math.floor(f.d / 1.1);
  for (let i = 0; i < rows; i++) {
    const row = box(f.w - 1, index === 0 ? 0.45 : 0.55, 0.55, CROPS[index] ?? CROPS[2], { kind: 'foliage' });
    g.add(at(row, 0, 0, -f.d / 2 + 0.7 + i * 1.1));
  }
  if (index > 0) {
    // A fence on three sides, a gate gap facing town.
    const posts = Math.ceil(f.w / 2.2);
    for (let i = 0; i < posts; i++) g.add(at(A.makeDecor('fence'), -f.w / 2 + 1.1 + i * 2.2, 0, -f.d / 2 - 0.5));
    for (const s of [-1, 1]) for (let i = 0; i < Math.ceil(f.d / 2.2); i++) g.add(at(A.makeDecor('fence'), s * (f.w / 2 + 0.5), 0, -f.d / 2 + 1.1 + i * 2.2, Math.PI / 2));
  }
  // A haystack and a scarecrow.
  const hay = cyl(0.8, 1, 1.1, C.thatch, 10);
  g.add(at(hay, f.w / 2 - 1, 0, f.d / 2 + 1.4), at(cone(0.85, 0.6, C.thatch, 10), f.w / 2 - 1, 1.1, f.d / 2 + 1.4));
  const crow = group(cyl(0.06, 0.06, 2.2, C.woodDark, 4), at(box(1.4, 0.08, 0.08, C.woodDark), 0, 1.6, 0), at(box(0.6, 0.7, 0.3, 0x5a7fbf, { kind: 'fabric' }), 0, 1.2, 0), at(ball(0.22, C.thatch, 0), 0, 2.25, 0), at(cone(0.35, 0.35, C.thatch, 8), 0, 2.4, 0));
  g.add(at(crow, -f.w / 4, 0, 0));
  return g;
}

function orchard(f, index, height) {
  const g = new THREE.Group();
  const fruit = [0xd94c3c, 0xf0a030, 0xd94c3c, 0xe0c040, 0xf07a3c, 0x9fe8ff][index] ?? 0xd94c3c;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const lx = -f.w / 2 + 1.5 + i * ((f.w - 3) / 3), lz = -f.d / 2 + 1.2 + j * ((f.d - 2.4) / 2);
    const x = f.x + Math.cos(f.rot) * lx + Math.sin(f.rot) * lz, z = f.z - Math.sin(f.rot) * lx + Math.cos(f.rot) * lz;
    const tree = new THREE.Group();
    tree.add(index === 0 ? at(ball(0.9, 0x4f8a3c, 0), 0, 0.6, 0) : A.makeTree(0, 0.55));
    tree.position.set(x, height(x, z), z);
    for (let k = 0; k < 5; k++) tree.add(at(ball(0.13, fruit, 0), Math.cos(k * 1.3) * 0.7, (index === 0 ? 0.7 : 2.0) + Math.sin(k * 2.1) * 0.4, Math.sin(k * 1.3) * 0.7));
    g.add(tree);
  }
  return g;
}
