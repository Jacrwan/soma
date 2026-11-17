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
// The shape: one soft bell, head and body together, wide at the bottom with a
// gently rounded top. Brown on top and down the back, with a V of brown over
// the face; white on the face and belly (vertex colours).
const BROWN = 0x9b7a63, BROWN_DARK = 0x6d5242, WHITE = 0xfbf7f0;
function bellGeometry() {
  const pts = [];
  const H = 0.74;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, y = t * H;
    // A soft round bottom, fullest a third of the way up, easing in to a round head.
    const bottom = Math.max(0, Math.sin(Math.min(1, t / 0.3) * Math.PI / 2)) ** 0.8;
    const top = Math.max(0, Math.cos(Math.min(1, Math.max(0, (t - 0.58) / 0.42)) * Math.PI / 2)) ** 0.75;
    const r = (0.335 - 0.03 * Math.max(0, t - 0.3)) * bottom * top;
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const g = new THREE.LatheGeometry(pts, 96);
  const pos = g.attributes.position, colors = new Float32Array(pos.count * 3);
  const brown = new THREE.Color(BROWN), white = new THREE.Color(WHITE);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const front = z / Math.max(0.001, Math.hypot(x, z)); // 1 straight ahead, -1 behind
    // Where brown starts: low on the back, high on the face, dipping to a V in the middle of the forehead.
    const edge = front > 0 ? 0.62 - 0.06 * Math.max(0, 1 - Math.abs(x) / 0.06) + 0.03 * (1 - front) : 0.18 + 0.44 * (1 + front);
    const k = Math.max(0, Math.min(1, (y - edge) / 0.012 + 0.5));
    new THREE.Color().copy(white).lerp(brown, k).toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
export function makeOwl3D() {
  const root = new THREE.Group();
  const body = part(bellGeometry(), 0xffffff, { outline: 0.016, extra: { vertexColors: true } });
  root.add(body);
  // Little ear points at the top corners.
  for (const sx of [-1, 1]) {
    const ear = part(new THREE.ConeGeometry(0.06, 0.1, 12), BROWN, { outline: 0.012 });
    ear.position.set(sx * 0.2, 0.7, 0);
    ear.rotation.z = -sx * 0.5;
    root.add(ear);
  }
  // Big glossy eyes with two highlights each, rosy cheeks, a small yellow beak.
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    const ball = part(sphere(0.105, 32, 24), 0x2b1d18, { outline: 0.01, extra: { emissive: 0x120c09 } });
    ball.scale.set(1, 1.05, 0.42);
    const big = new THREE.Mesh(sphere(0.036, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    big.scale.z = 0.5;
    big.position.set(-0.03, 0.035, 0.04);
    const small = new THREE.Mesh(sphere(0.016, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    small.scale.z = 0.5;
    small.position.set(0.035, -0.03, 0.04);
    eye.add(ball, big, small);
    eye.position.set(sx * 0.125, 0.47, 0.265);
    eye.rotation.y = sx * 0.3;
    root.add(eye);
    eyes.push(eye);
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), new THREE.MeshBasicMaterial({ color: 0xf6a27a, transparent: true, opacity: 0.85 }));
    cheek.scale.set(1.2, 0.75, 1);
    cheek.position.set(sx * 0.215, 0.38, 0.255);
    cheek.rotation.y = sx * 0.62;
    root.add(cheek);
  }
  const beak = part(new THREE.ConeGeometry(0.045, 0.085, 3), 0xf5c03a, { outline: 0.01 });
  beak.rotation.set(Math.PI + 0.25, 0, 0);
  beak.position.set(0, 0.405, 0.32);
  root.add(beak);
  // Feather marks on the belly.
  for (const [x, y] of [[-0.09, 0.27], [0.02, 0.28], [0.12, 0.25], [-0.13, 0.19], [-0.02, 0.2], [0.08, 0.17], [-0.06, 0.12], [0.04, 0.1]]) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 4, 10, Math.PI), new THREE.MeshBasicMaterial({ color: 0x8a6d5a }));
    m.rotation.z = Math.PI;
    const r = 0.31 - 0.02;
    const z = Math.sqrt(Math.max(0, r * r - x * x)) + 0.005;
    m.position.set(x, y, z);
    m.rotation.y = Math.atan2(x, z);
    root.add(m);
  }
  // Wings: leaf-shaped, brown with darker tips, hinged at the shoulder.
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    const wing = part(sphere(0.2, 24, 16), BROWN, { outline: 0.012 });
    wing.scale.set(0.32, 1, 0.55);
    wing.position.set(0, -0.17, 0);
    const tip = part(sphere(0.12, 20, 12), BROWN_DARK, { outline: 0.008 });
    tip.scale.set(0.34, 0.9, 0.5);
    tip.position.set(sx * 0.012, -0.3, 0.01);
    pivot.add(wing, tip);
    pivot.position.set(sx * 0.3, 0.44, -0.02);
    pivot.rotation.z = sx * 0.18;
    pivot.userData = { side: sx };
    root.add(pivot);
    wings.push(pivot);
  }
  // Yellow feet in front.
  for (const sx of [-1, 1]) for (const t of [-0.45, 0, 0.45]) {
    const toe = part(new THREE.CapsuleGeometry(0.028, 0.04, 6, 10), 0xf5c03a, { outline: 0.008 });
    toe.rotation.set(Math.PI / 2, 0, t);
    toe.position.set(sx * 0.11 + Math.sin(t) * 0.035, 0.035, 0.2);
    root.add(toe);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = o.material.type === 'MeshToonMaterial'; });
  root.userData = { wings, eyes };
  return root;
}

/** Owl in the world: { object, update(dt, time, ground, moving) }. */
export function createOwl() {
  const object = new THREE.Group();
  const model = makeOwl3D();
  model.scale.setScalar(1.15);
  object.add(model);
  let nextBlink = 2;
  let phase = 0;
  return {
    object,
    update(dt, time, ground = 0, moving = false) {
      // A gentle hover, wings beating while it keeps up with you, a blink now and then.
      model.position.y = Math.sin(time * 2.2) * 0.08;
      model.rotation.z = Math.sin(time * 1.1) * 0.05;
      // A hovering owl keeps flapping: slow wide beats while waiting, quick ones when chasing you.
      phase += dt * (moving ? 15 : 8);
      const beat = (Math.sin(phase) + 1) / 2; // 0 down, 1 up
      for (const w of model.userData.wings) {
        const s = w.userData.side;
        w.rotation.z = s * (0.18 + beat * (moving ? 1.25 : 0.95));
      }
      model.position.y += (1 - beat) * 0.035;
      nextBlink -= dt;
      const shut = nextBlink < 0.12;
      if (nextBlink < 0) nextBlink = 2.5 + Math.random() * 3;
      for (const e of model.userData.eyes) e.scale.y = shut ? 0.12 : 1;
      void ground;
    },
  };
}
