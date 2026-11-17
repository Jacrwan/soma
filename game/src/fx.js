// Juice: particles, coins flying to the player, numbers that float up, labels
// that follow things, and small synthesized sounds.

import * as THREE from 'three';
import { projectBent } from './scenery.js';
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

  let hudAge = 0;
  let hudRects = [];
  // Places node over pos on screen. show: also make it visible (labels decide that themselves).
  function project(pos, node, dy = 0, show = true) {
    v.copy(pos);
    v.y += dy;
    projectBent(v, camera); // labels follow the rolling-log horizon (scenery.js)
    const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
    if (!visible && node.style.display !== 'none') node.style.display = 'none';
    else if (visible && show && node.style.display !== '') node.style.display = '';
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
      // html and kind are compared with what was last set, not with node.innerHTML
      // (the browser rewrites HTML its own way, so that never matched and every
      // call rebuilt the label and measured it again).
      const entry = { node, object, height, html, kind: `label ${kind}`, shown: false };
      labels.add(entry);
      return {
        set(next, nextKind) {
          if (entry.html !== next) { entry.html = next; node.innerHTML = next; entry.size = null; }
          if (nextKind !== undefined && entry.kind !== `label ${nextKind}`) { entry.kind = `label ${nextKind}`; node.className = entry.kind; entry.size = null; }
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
      // Labels never pile up: exam labels and the nearest ones go first, and a
      // label that would overlap one already placed waits until there's room.
      // A label mostly hidden under a HUD card is dropped rather than shown cut off.
      // Where the HUD cards sit: measured twice a second, not every frame.
      hudAge -= dt;
      if (hudAge <= 0) {
        hudAge = 0.5;
        hudRects = [...document.querySelectorAll('#hud .unit, #hud .era-card, #hud .hud-left > :not([hidden]), #hud .tracker, #hud .hud-center, #hud .menu, #hud .hotbar')]
          .map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height)
          .map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom }));
      }
      const hud = hudRects;
      const placed = [];
      const order = [];
      for (const entry of labels) {
        entry.object.getWorldPosition(v);
        const pos = v.clone();
        // Far labels shrink to their name (style.css .label.far); speech stays as is.
        const far = !/npc|step|talk/.test(entry.kind) && camera.position.distanceTo(v) > 24;
        if (entry.node.classList.contains('far') !== far) { entry.node.classList.toggle('far', far); entry.size = null; }
        let shown = Boolean(entry.object.parent);
        for (let o = entry.object; o && shown; o = o.parent) shown = o.visible;
        if (!shown || !project(pos, entry.node, entry.height, false)) { if (entry.node.style.display !== 'none') entry.node.style.display = 'none'; entry.shown = false; continue; }
        order.push({ entry, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, depth: v.z, boss: entry.node.classList.contains('boss') });
      }
      // Labels already on screen keep their place before new ones get a turn, so two
      // overlapping labels don't take turns hiding each other every frame.
      order.sort((a, b) => (b.boss - a.boss) || (b.entry.shown - a.entry.shown) || (a.depth - b.depth));
      for (const it of order) {
        const e = it.entry;
        if (!e.size) {
          if (e.node.style.display === 'none') e.node.style.display = '';
          const w = e.node.offsetWidth, h = e.node.offsetHeight;
          if (w) e.size = { w, h }; // a hidden label measures 0: try again next frame
        }
        if (!e.size) continue;
        const box = { l: it.x - e.size.w / 2 - 3, r: it.x + e.size.w / 2 + 3, t: it.y - e.size.h - 3, b: it.y + 3 };
        const area = (box.r - box.l) * (box.b - box.t);
        const under = hud.some((p) => Math.max(0, Math.min(box.r, p.r) - Math.max(box.l, p.l)) * Math.max(0, Math.min(box.b, p.b) - Math.max(box.t, p.t)) > area * 0.5);
        const hit = under || placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t);
        const want = hit ? 'none' : '';
        if (e.node.style.display !== want) e.node.style.display = want;
        e.shown = !hit;
        if (!hit) placed.push(box);
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

/**
 * Sound effects and background music, all made in code (no audio files).
 * settings() returns { muted, sfx, music, musicVol, sfxVol }: muted silences
 * everything, sfx and music switch each part on or off, the volumes run 0..1.
 */
export function createAudio(settings) {
  let ctx = null;
  let sfxOut = null, musicOut = null;
  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      sfxOut = ctx.createGain();
      sfxOut.connect(ctx.destination);
      musicOut = ctx.createGain();
      musicOut.gain.value = 0;
      // A gentle low-pass keeps the music soft and behind the game.
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 3200;
      musicOut.connect(soft).connect(ctx.destination);
      applyVolumes();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function applyVolumes() {
    if (!ctx) return;
    const s = settings();
    sfxOut.gain.value = s.muted || !s.sfx ? 0 : s.sfxVol;
    musicOut.gain.setTargetAtTime(s.muted || !s.music ? 0 : s.musicVol * 0.55, ctx.currentTime, 0.4);
  }
  const isMuted = () => { const s = settings(); return s.muted || !s.sfx; };
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
    o.connect(g).connect(sfxOut);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + len + 0.02);
  }

  // --- Music ---------------------------------------------------------------
  // A looping folk tune: soft pad chords, a plucked melody from the pentatonic
  // scale, a round bass and a light shaker. 'town' is warm and steady; 'study'
  // is slower and quieter, with no shaker, so it sits under real work.
  const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
  // Music styles, picked in Settings. Each has a town tune and a softer study one.
  // pad / lead: oscillator types; kick: a soft low thump on the beat.
  const STYLES = {
    cozy: {
      town: { bpm: 92, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], scale: [72, 74, 76, 79, 81, 84], shaker: true, pluck: 0.07 },
      study: { bpm: 70, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], scale: [69, 72, 74, 76, 79, 81], shaker: false, pluck: 0.045 },
    },
    lofi: {
      town: { bpm: 78, chords: [[57, 60, 64, 67], [50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59]], scale: [69, 72, 74, 76, 79], pad: 'sine', lead: 'sine', pluck: 0.07, kick: true, shaker: true },
      study: { bpm: 66, chords: [[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 55, 59, 62]], scale: [69, 72, 74, 76, 79], pad: 'sine', lead: 'sine', pluck: 0.05, kick: true },
    },
    adventure: {
      town: { bpm: 112, chords: [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]], scale: [74, 76, 78, 81, 83, 86], lead: 'square', pluck: 0.035, kick: true, shaker: true },
      study: { bpm: 84, chords: [[62, 66, 69], [55, 59, 62], [59, 62, 66], [57, 61, 64]], scale: [74, 76, 78, 81, 83], lead: 'triangle', pluck: 0.045 },
    },
    piano: {
      town: { bpm: 76, chords: [[48, 55, 64], [53, 60, 69], [57, 60, 64], [55, 62, 67]], scale: [72, 74, 76, 79, 81, 84], pad: 'sine', lead: 'sine', pluck: 0.08, long: true },
      study: { bpm: 60, chords: [[48, 55, 64], [57, 60, 64], [53, 60, 69], [55, 62, 67]], scale: [72, 74, 76, 79, 81], pad: 'sine', lead: 'sine', pluck: 0.06, long: true },
    },
    night: {
      town: { bpm: 86, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], scale: [69, 72, 74, 76, 79, 81], pad: 'sawtooth', lead: 'square', pluck: 0.03, padVol: 0.016, kick: true },
      study: { bpm: 68, chords: [[57, 60, 64], [52, 55, 59], [53, 57, 60], [55, 59, 62]], scale: [69, 72, 74, 76], pad: 'sawtooth', lead: 'triangle', pluck: 0.035, padVol: 0.014 },
    },
  };
  const style = () => STYLES[settings().track] || STYLES.cozy;
  const SONGS = STYLES.cozy;
  let mode = 'town';
  let timer = null;
  let nextAt = 0;
  let step = 0;
  let noise = null;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function voice(freq, at, len, type, vol, attack = 0.02, out = musicOut) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.05);
  }
  function shake(at) {
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.05, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    src.connect(f).connect(g).connect(musicOut);
    src.start(at);
    src.stop(at + 0.1);
  }
  let lastNote = 2;
  function schedule() {
    const song = style()[mode];
    const beat = 60 / song.bpm / 2; // eighth notes
    while (nextAt < ctx.currentTime + 0.25) {
      const bar = Math.floor(step / 8) % song.chords.length;
      const inBar = step % 8;
      const chord = song.chords[bar];
      if (inBar === 0) {
        for (const n of chord) voice(NOTE(n), nextAt, beat * 8.4, song.pad || 'triangle', song.padVol || 0.035, 0.5);
        voice(NOTE(chord[0] - 24), nextAt, beat * 3.6, 'sine', 0.13, 0.03);
      }
      if (inBar === 4) voice(NOTE(chord[0] - 24 + (bar % 2 ? 7 : 0)), nextAt, beat * 3.4, 'sine', 0.09, 0.03);
      // The melody wanders the scale in small steps, resting now and then.
      const play = mode === 'study' ? inBar % 2 === 0 && rand() < 0.6 : rand() < (inBar % 2 ? 0.35 : 0.7);
      if (play) {
        lastNote = Math.max(0, Math.min(song.scale.length - 1, lastNote + Math.round((rand() - 0.5) * 3)));
        const fits = chord.some((c) => (song.scale[lastNote] - c) % 12 === 0) || rand() < 0.6;
        if (fits) voice(NOTE(song.scale[lastNote]), nextAt, beat * (song.long ? 4 : mode === 'study' ? 3 : 1.8), song.lead || 'triangle', song.pluck, 0.008);
      }
      if (song.kick && inBar % 4 === 0) voice(55, nextAt, 0.22, 'sine', 0.16, 0.004);
      if (song.shaker && inBar % 2 === 1) shake(nextAt);
      nextAt += beat;
      step += 1;
    }
  }
  function startMusic() {
    const c = ensure();
    if (!c || timer) return;
    nextAt = c.currentTime + 0.1;
    timer = setInterval(() => {
      const s = settings();
      if (s.muted || !s.music || document.visibilityState !== 'visible') { nextAt = ctx.currentTime + 0.1; return; }
      schedule();
    }, 90);
  }
  function setMusic(next) {
    if (!SONGS[next] || next === mode) return;
    mode = next;
    step = 0;
  }
  return {
    unlock: () => { ensure(); startMusic(); },
    applyVolumes,
    setMusic,
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
    tick: () => tone(1750, 0, 0.025, 'square', 0.035),
    card: (i) => { tone(700 + i * 120, 0, 0.1, 'triangle', 0.13, 1.6); tone(1400 + i * 240, 0.07, 0.16, 'square', 0.035); },
    chest: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.12)),
    era: () => [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle', 0.13)),
    alarm: () => { tone(440, 0, 0.16, 'square', 0.06); tone(330, 0.2, 0.2, 'square', 0.06); },
    launch: () => tone(60, 0, 2.4, 'sawtooth', 0.14, 6),
  };
}
