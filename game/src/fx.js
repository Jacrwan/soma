// Juice: particles, coins flying to the player, numbers that float up, labels
// that follow things, and small synthesized sounds.

import * as THREE from 'three';
import { mat, makeCoin } from './art.js';

export function createFx(scene, camera) {
  const layer = document.getElementById('labels');
  const particles = [];
  const coins = [];
  const floats = [];
  const labels = new Set();
  const rings = [];
  const cube = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const v = new THREE.Vector3();

  function project(pos, node, dy = 0) {
    v.copy(pos);
    v.y += dy;
    v.project(camera);
    const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
    node.style.display = visible ? '' : 'none';
    if (visible) node.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    return visible;
  }

  return {
    burst(pos, color, count = 14, speed = 6, up = 6) {
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(cube, mat(color));
        m.position.copy(pos);
        m.position.y += 0.6;
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.4 + Math.random() * 0.7);
        scene.add(m);
        particles.push({ m, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * s, life: 0.7 + Math.random() * 0.5, spin: Math.random() * 8 });
      }
    },

    /** Coins arc from a spot to the player; onLand runs once, when the first arrives. */
    coinsTo(from, target, count, onLand) {
      const n = Math.max(1, Math.min(14, count));
      for (let i = 0; i < n; i++) {
        const m = makeCoin();
        m.position.copy(from);
        m.position.y += 1 + Math.random() * 1.5;
        scene.add(m);
        coins.push({ m, start: m.position.clone(), target, t: -i * 0.035, lift: 2 + Math.random() * 2.5, side: (Math.random() - 0.5) * 3, onLand: i === 0 ? onLand : null });
      }
    },

    float(pos, text, kind = '') {
      const node = document.createElement('div');
      node.className = `float ${kind}`;
      node.textContent = text;
      layer.append(node);
      floats.push({ node, pos: pos.clone(), life: 1.1 });
    },

    /** A label pinned above an object until removed. */
    label(object, height, html, kind = '') {
      const node = document.createElement('div');
      node.className = `label ${kind}`;
      node.innerHTML = html;
      layer.append(node);
      const entry = { node, object, height };
      labels.add(entry);
      return {
        set(next, nextKind) {
          if (node.innerHTML !== next) node.innerHTML = next;
          if (nextKind !== undefined) node.className = `label ${nextKind}`;
        },
        remove() {
          node.remove();
          labels.delete(entry);
        },
      };
    },

    /** A circle on the ground that fills in, warning of a hit. Returns a handle with .done. */
    ring(pos, radius, seconds, color = 0xef6b5e) {
      const outer = new THREE.Mesh(new THREE.RingGeometry(radius - 0.18, radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }));
      for (const m of [outer, fill]) {
        m.rotation.x = -Math.PI / 2;
        m.position.set(pos.x, pos.y + 0.08, pos.z);
        scene.add(m);
      }
      fill.scale.setScalar(0.01);
      const entry = { outer, fill, t: 0, seconds, done: false };
      rings.push(entry);
      return entry;
    },

    clearLabels() {
      for (const entry of [...labels]) {
        entry.node.remove();
        labels.delete(entry);
      }
    },

    update(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.vy -= 18 * dt;
        p.m.position.x += p.vx * dt;
        p.m.position.y = Math.max(0.1, p.m.position.y + p.vy * dt);
        p.m.position.z += p.vz * dt;
        p.m.rotation.x += p.spin * dt;
        p.m.rotation.y += p.spin * dt;
        p.m.scale.setScalar(Math.max(0.01, Math.min(1, p.life * 2)));
        if (p.life <= 0) {
          scene.remove(p.m);
          particles.splice(i, 1);
        }
      }
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.t += dt * 1.9;
        if (c.t < 0) continue;
        const t = Math.min(1, c.t);
        const e = t * t * (3 - 2 * t);
        c.m.position.lerpVectors(c.start, c.target.position, e);
        c.m.position.y += Math.sin(t * Math.PI) * c.lift + 1.1 * e;
        c.m.position.x += Math.sin(t * Math.PI) * c.side;
        c.m.rotation.y += dt * 12;
        if (t >= 1) {
          scene.remove(c.m);
          coins.splice(i, 1);
          if (c.onLand) c.onLand();
        }
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.life -= dt;
        f.pos.y += dt * 1.8;
        if (project(f.pos, f.node)) f.node.style.opacity = String(Math.min(1, f.life * 2.2));
        if (f.life <= 0) {
          f.node.remove();
          floats.splice(i, 1);
        }
      }
      for (const entry of labels) {
        entry.object.getWorldPosition(v);
        const pos = v.clone();
        project(pos, entry.node, entry.height);
        let shown = Boolean(entry.object.parent);
        for (let o = entry.object; o && shown; o = o.parent) shown = o.visible;
        if (!shown) entry.node.style.display = 'none';
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        r.fill.scale.setScalar(Math.min(1, r.t / r.seconds));
        if (r.t >= r.seconds) {
          r.done = true;
          scene.remove(r.outer, r.fill);
          rings.splice(i, 1);
        }
      }
    },
  };
}

// --- Sound: tiny synthesized blips, no audio files ---------------------------------

export function createAudio(isMuted) {
  let ctx = null;
  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(freq, start, len, type = 'triangle', vol = 0.12, slide = 0) {
    const c = ensure();
    if (!c || isMuted()) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + start + len);
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + len);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + len + 0.02);
  }
  return {
    unlock: ensure,
    coin: () => { tone(988, 0, 0.07, 'square', 0.05); tone(1319, 0.06, 0.12, 'square', 0.05); },
    build: () => { tone(196, 0, 0.12, 'triangle', 0.16); tone(294, 0.09, 0.14, 'triangle', 0.14); tone(392, 0.19, 0.2, 'triangle', 0.12); },
    swing: () => tone(520, 0, 0.09, 'sawtooth', 0.04, 0.4),
    hit: () => { tone(180, 0, 0.1, 'square', 0.1, 0.5); tone(90, 0.02, 0.12, 'triangle', 0.14, 0.6); },
    hurt: () => tone(220, 0, 0.3, 'sawtooth', 0.1, 0.35),
    pop: () => tone(300, 0, 0.18, 'triangle', 0.16, 2.2),
    deny: () => { tone(160, 0, 0.1, 'square', 0.06); tone(120, 0.1, 0.14, 'square', 0.06); },
    thud: () => tone(110, 0, 0.16, 'triangle', 0.2, 0.5),
    rattle: (n) => { tone(240 + n * 80, 0, 0.07, 'square', 0.06); tone(300 + n * 80, 0.08, 0.07, 'square', 0.06); tone(360 + n * 80, 0.16, 0.09, 'square', 0.06); tone(90 + n * 25, 0, 0.3, 'sawtooth', 0.05, 2.2); },
    burst: (tier) => {
      tone(60, 0, 0.55, 'sawtooth', 0.18, 0.4);
      tone(1800, 0, 0.35, 'triangle', 0.05, 0.25);
      [523, 659, 784, 1047, 1319, 1568].slice(0, 3 + tier).forEach((f, i) => tone(f, 0.04 + i * 0.07, 0.5, 'triangle', 0.12));
    },
    card: (i) => { tone(700 + i * 120, 0, 0.1, 'triangle', 0.13, 1.6); tone(1400 + i * 240, 0.07, 0.16, 'square', 0.035); },
    chest: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.12)),
    era: () => [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle', 0.13)),
    alarm: () => { tone(440, 0, 0.16, 'square', 0.06); tone(330, 0.2, 0.2, 'square', 0.06); },
    launch: () => tone(60, 0, 2.4, 'sawtooth', 0.14, 6),
  };
}
