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

/** The Owl sprite: { object, update(dt, time, flying) }. */
export function createOwl() {
  const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.5, 1.72, 1);
  sprite.center.set(0.5, 0.1);
  sprite.renderOrder = 4;
  const object = new THREE.Group();
  object.add(sprite);
  // A soft shadow under Owl so it reads as being in the world.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  object.add(shadow);
  const frames = {};
  Promise.all([texture(owlSvg()), texture(owlSvg({ blink: true })), texture(owlSvg({ flap: true }))]).then(([open, blink, flap]) => {
    Object.assign(frames, { open, blink, flap });
    material.map = open;
    material.needsUpdate = true;
  });
  let nextBlink = 2;
  return {
    object,
    update(dt, time, ground = 0, moving = false) {
      if (!frames.open) return;
      // Hovering: a gentle bob, a flap of the wings every so often (often while moving), a blink now and then.
      const flapping = moving ? Math.sin(time * 14) > 0 : Math.sin(time * 1.3) > 0.96;
      nextBlink -= dt;
      const blinking = nextBlink < 0.12;
      if (nextBlink < 0) nextBlink = 2.5 + Math.random() * 3;
      const want = blinking ? frames.blink : flapping ? frames.flap : frames.open;
      if (material.map !== want) { material.map = want; material.needsUpdate = true; }
      sprite.position.y = Math.sin(time * 2.2) * 0.08;
      material.rotation = Math.sin(time * 1.1) * 0.06;
      shadow.position.y = ground - object.position.y + 0.04;
      shadow.material.opacity = 0.18 / (1 + Math.max(0, object.position.y - ground) * 0.4);
    },
  };
}
