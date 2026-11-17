// Owl, drawn as a 2D cartoon (an SVG) on a sprite that always faces the
// camera, like a companion in a storybook. Three frames: eyes open, blinking,
// and wings up; the game swaps between them to blink and flap.

import * as THREE from 'three';

const INK = '#2f1d14';
/** The SVG for one frame. blink: eyes closed. flap: wings raised. */
export function owlSvg({ blink = false, flap = false } = {}) {
  const wingL = flap
    ? 'M58 112 C30 96 18 70 26 52 C40 66 54 84 66 100 Z'
    : 'M60 108 C40 118 34 150 46 172 C58 160 66 136 66 116 Z';
  const wingR = flap
    ? 'M142 112 C170 96 182 70 174 52 C160 66 146 84 134 100 Z'
    : 'M140 108 C160 118 166 150 154 172 C142 160 134 136 134 116 Z';
  const eye = (cx) => blink
    ? `<path d="M${cx - 17} 104 Q${cx} 116 ${cx + 17} 104" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round"/>`
    : `<circle cx="${cx}" cy="104" r="18" fill="#f5a623"/><circle cx="${cx}" cy="104" r="13" fill="${INK}"/><circle cx="${cx + 5}" cy="98" r="5" fill="#fff"/><circle cx="${cx - 5}" cy="110" r="2.4" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 230" width="400" height="460">
  <g stroke="${INK}" stroke-width="5" stroke-linejoin="round">
    <path d="${wingL}" fill="#6e4529"/>
    <path d="${wingR}" fill="#6e4529"/>
    <path d="M100 52 C146 52 156 92 156 128 C156 176 132 202 100 202 C68 202 44 176 44 128 C44 92 54 52 100 52 Z" fill="#9a6640"/>
    <path d="M60 64 L52 30 L84 56 Z" fill="#7a4c2e"/>
    <path d="M140 64 L148 30 L116 56 Z" fill="#7a4c2e"/>
    <path d="M100 128 C126 128 138 150 136 172 C134 192 118 200 100 200 C82 200 66 192 64 172 C62 150 74 128 100 128 Z" fill="#f4e2c4"/>
    <circle cx="75" cy="104" r="27" fill="#fbefd9"/>
    <circle cx="125" cy="104" r="27" fill="#fbefd9"/>
  </g>
  <g fill="none" stroke="#d6a548" stroke-width="2.5" opacity=".9"><path d="M84 156 q6 6 12 0 M104 156 q6 6 12 0 M94 172 q6 6 12 0 M78 172 q4 5 8 1 M114 173 q4 4 8 -1"/></g>
  ${eye(75)}${eye(125)}
  <g stroke="${INK}" stroke-width="4" stroke-linejoin="round"><path d="M92 118 L108 118 L100 134 Z" fill="#f2a33a"/></g>
  <g fill="none" stroke="#c9952e" stroke-width="4.5"><circle cx="75" cy="104" r="23"/><circle cx="125" cy="104" r="23"/><path d="M98 104 q2 -4 4 0"/></g>
  <g stroke="${INK}" stroke-width="4" stroke-linejoin="round">
    <path d="M80 200 l-6 12 M86 202 l0 12 M92 200 l6 12" stroke="#e8962e" stroke-width="5" stroke-linecap="round"/>
    <path d="M108 200 l-6 12 M114 202 l0 12 M120 200 l6 12" stroke="#e8962e" stroke-width="5" stroke-linecap="round"/>
    <path d="M58 44 L100 26 L142 44 L100 62 Z" fill="#2b2a3f"/>
    <path d="M78 52 L78 64 C78 70 122 70 122 64 L122 52 L100 62 Z" fill="#2b2a3f"/>
  </g>
  <path d="M100 44 L136 52 L138 70" stroke="#f2c14e" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <circle cx="138" cy="72" r="5" fill="#f2c14e" stroke="${INK}" stroke-width="2.5"/>
</svg>`;
}

function texture(svg) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 460;
      c.getContext('2d').drawImage(img, 0, 0, 400, 460);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      resolve(t);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// --- Owl in 3D, cel-shaded to match the drawing ------------------------------------
// Smooth shapes, flat toon shading in three tones, and a dark outline around
// every part (an inverted copy drawn behind it), so it reads like the cartoon.
let toonRamp = null;
function ramp() {
  if (toonRamp) return toonRamp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp(), ...extra });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x2f1d14, side: THREE.BackSide });
function part(geo, color, { outline = 0.022, extra } = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, toon(color, extra));
  g.add(m);
  if (outline) {
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.setScalar(1);
    o.onBeforeRender = () => {};
    // Push the outline out along the normals, the same distance everywhere.
    o.material = OUTLINE.clone();
    o.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normal * ${outline.toFixed(3)};`);
    };
    g.add(o);
  }
  g.userData.mesh = m;
  return g;
}
const sphere = (r, w = 32, h = 24) => new THREE.SphereGeometry(r, w, h);
function bodyGeometry() {
  // An upright owl body: narrow, widest a third of the way up, tapering to the shoulders.
  const pts = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const y = t * 0.56;
    const r = 0.19 * Math.sin(Math.min(1, t * 1.05) * Math.PI) ** 0.7 * (1 - 0.25 * t) + 0.002;
    pts.push(new THREE.Vector2(r, y));
  }
  const g = new THREE.LatheGeometry(pts, 36);
  g.computeVertexNormals();
  return g;
}
export function makeOwl3D() {
  const root = new THREE.Group();
  const brown = 0x8f5d3b, dark = 0x5f3b23, face = 0xf3e2c6, belly = 0xe8d0a6, amber = 0xf5a623;
  const body = part(bodyGeometry(), brown, { outline: 0.018 });
  body.position.y = 0.06;
  root.add(body);
  const front = part(sphere(0.16), belly, { outline: 0.012 });
  front.scale.set(0.82, 1.25, 0.45);
  front.position.set(0, 0.26, 0.11);
  root.add(front);
  // Belly stripes.
  for (const [x, y] of [[-0.05, 0.32], [0.05, 0.32], [0, 0.25], [-0.06, 0.19], [0.06, 0.19], [0, 0.13]]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.01), new THREE.MeshBasicMaterial({ color: 0xb88a5a }));
    v.position.set(x, y, 0.185 - Math.abs(y - 0.24) * 0.12);
    root.add(v);
  }
  // Head: wider than the body, a little flat, with a heart-shaped face and tall tufts.
  const head = part(sphere(0.2), brown, { outline: 0.018 });
  head.scale.set(1.12, 0.86, 0.95);
  head.position.y = 0.6;
  root.add(head);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const tuft = part(new THREE.ConeGeometry(0.05, 0.17, 10), dark, { outline: 0.012 });
    tuft.position.set(sx * 0.15, 0.78, -0.01);
    tuft.rotation.z = -sx * 0.3;
    root.add(tuft);
    const disc = part(sphere(0.105), face, { outline: 0.01 });
    disc.scale.set(1, 1.08, 0.38);
    disc.position.set(sx * 0.085, 0.61, 0.15);
    root.add(disc);
    const eye = new THREE.Group();
    const iris = new THREE.Mesh(sphere(0.066), toon(amber));
    iris.scale.set(1, 1, 0.3);
    const pupil = new THREE.Mesh(sphere(0.05), new THREE.MeshBasicMaterial({ color: 0x1e120c }));
    pupil.scale.set(1, 1, 0.3);
    pupil.position.z = 0.006;
    const shine = new THREE.Mesh(sphere(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    shine.position.set(-sx * 0.016, 0.02, 0.022);
    eye.add(iris, pupil, shine);
    eye.position.set(sx * 0.082, 0.615, 0.19);
    root.add(eye);
    eyes.push(eye);
  }
  const beak = part(new THREE.ConeGeometry(0.028, 0.07, 10), 0xf2a33a, { outline: 0.01 });
  beak.rotation.x = Math.PI + 0.35;
  beak.position.set(0, 0.55, 0.22);
  root.add(beak);
  // Wings: long feathered wings from the shoulders. Folded, they lie along the
  // body; flying, they spread wide and beat.
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    const lens = [0.46, 0.42, 0.36, 0.28];
    lens.forEach((len, i) => {
      const f = part(sphere(0.5, 18, 10), i % 2 ? 0x75492c : dark, { outline: 0.01 });
      f.scale.set(len, 0.05 + 0.01 * (3 - i), 0.04);
      f.position.set(sx * len * 0.5, -i * 0.03, -i * 0.03);
      f.rotation.z = sx * -i * 0.14;
      pivot.add(f);
    });
    pivot.position.set(sx * 0.15, 0.44, -0.02);
    pivot.userData = { side: sx };
    root.add(pivot);
    wings.push(pivot);
  }
  // Tail feathers and feet.
  const tail = part(new THREE.ConeGeometry(0.08, 0.16, 6), dark, { outline: 0.01 });
  tail.rotation.x = -2.5;
  tail.position.set(0, 0.08, -0.14);
  root.add(tail);
  for (const sx of [-1, 1]) for (const t of [-0.4, 0, 0.4]) {
    const toe = part(new THREE.CapsuleGeometry(0.014, 0.04, 4, 8), 0xe8962e, { outline: 0.006 });
    toe.rotation.set(Math.PI / 2, 0, t);
    toe.position.set(sx * 0.06 + Math.sin(t) * 0.025, 0.04, 0.1);
    root.add(toe);
  }
  // A small graduation cap, tilted.
  const cap = new THREE.Group();
  const board = part(new THREE.BoxGeometry(0.3, 0.025, 0.3), 0x2b2a3f, { outline: 0.008 });
  board.rotation.y = Math.PI / 4;
  const crown = part(new THREE.CylinderGeometry(0.1, 0.11, 0.06, 20), 0x2b2a3f, { outline: 0.008 });
  crown.position.y = -0.04;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), toon(0xf2c14e));
  cord.position.set(0.11, -0.05, 0.04);
  const tassel = new THREE.Mesh(sphere(0.022, 10, 8), toon(0xf2c14e));
  tassel.position.set(0.11, -0.13, 0.04);
  cap.add(board, crown, cord, tassel);
  cap.position.set(0, 0.79, 0);
  cap.rotation.z = -0.14;
  root.add(cap);
  root.traverse((o) => { if (o.isMesh) o.castShadow = o.material.type === 'MeshToonMaterial'; });
  root.userData = { wings, eyes };
  return root;
}

/** Owl in the world: { object, update(dt, time, ground, moving) }. */
export function createOwl() {
  const object = new THREE.Group();
  const model = makeOwl3D();
  model.scale.setScalar(1.25);
  object.add(model);
  let nextBlink = 2;
  let phase = 0;
  return {
    object,
    update(dt, time, ground = 0, moving = false) {
      // A gentle hover, wings beating while it keeps up with you, a blink now and then.
      model.position.y = Math.sin(time * 2.2) * 0.08;
      model.rotation.z = Math.sin(time * 1.1) * 0.05;
      // A hovering owl never stops flapping: slow, wide beats while it waits, fast ones when it chases you.
      const rate = moving ? 15 : 7;
      phase += dt * rate;
      const beat = Math.sin(phase);
      const reach = moving ? 0.75 : 0.55;
      for (const w of model.userData.wings) {
        const s = w.userData.side;
        w.rotation.z = s * (0.1 + beat * reach);
        w.rotation.y = s * (0.15 + Math.max(0, -beat) * 0.25);
      }
      // The body lifts on each downstroke.
      model.position.y += Math.max(0, -beat) * 0.04;
      nextBlink -= dt;
      const shut = nextBlink < 0.12;
      if (nextBlink < 0) nextBlink = 2.5 + Math.random() * 3;
      for (const e of model.userData.eyes) e.scale.y = shut ? 0.12 : 1;
      void ground;
    },
  };
}
