// The chest opening: the chest drops onto a full-screen stage, rattles, and
// bursts open. Then a reel of items rolls past a marker, each with its rarity
// colour, slows down and lands on what you won; the loot follows card by card.
// The reel's filler is drawn with the chest's real odds, and the spin is the
// same length whatever you won, so the reel never fakes a near miss.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeChest, makeCoin, RARITY_COLORS, C } from './art.js';
import { fmt } from './sim.js';

const RATTLES = { common: 2, rare: 2, epic: 2, legendary: 2 };
const REEL_TILES = 48; // tiles on the strip
const REEL_WIN = 40; // the winning tile's place
const SPIN = 5.4; // seconds the reel rolls
const TIER_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const CONFETTI = { common: 50, rare: 80, epic: 110, legendary: 170 };
const ICONS = {
  relic: '<svg viewBox="0 0 48 48"><path d="M14 8h20l9 12-19 21L5 20z" fill="currentColor" opacity=".9"/><path d="M5 20h38M14 8l5 12 5 21 5-21 5-12M19 20l5-12 5 12" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  hat: '<svg viewBox="0 0 48 48"><path d="M15 31c0-11 3-19 9-19s9 8 9 19z" fill="currentColor"/><ellipse cx="24" cy="32" rx="19" ry="5.5" fill="currentColor"/><path d="M15 27c5 2 13 2 18 0v4c-5 2-13 2-18 0z" fill="#000" fill-opacity=".3"/></svg>',
  token: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="currentColor"/><circle cx="24" cy="24" r="14.5" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.6"/><path d="m24 12 3.5 7.6 8.3.9-6.2 5.6 1.8 8.1-7.4-4.2-7.4 4.2 1.8-8.1-6.2-5.6 8.3-.9z" fill="#fff" fill-opacity=".9"/></svg>',
};

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const outBack = (x) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
function outBounce(x) {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

function div(className, parent, tag = 'div') {
  const node = document.createElement(tag);
  node.className = className;
  parent.append(node);
  return node;
}

function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#000');
  grad.addColorStop(0.35, '#1a1a1a');
  grad.addColorStop(0.75, '#555');
  grad.addColorStop(1, '#fff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

export function createOpening() {
  const root = div('', document.body);
  root.id = 'opening';
  root.hidden = true;
  const confettiCanvas = div('op-confetti', root, 'canvas');
  const column = div('op-column', root);
  const top = div('op-top', column);
  const rarityText = div('op-rarity', top);
  const fromText = div('op-from', top);
  const stage = div('op-stage', column);
  div('op-rays', stage);
  div('op-glow', stage);
  const view = div('op-view', stage, 'canvas');
  const reel = div('op-reel', column);
  const strip = div('op-strip', reel);
  div('op-marker', reel);
  const cards = div('op-cards', column);
  const claim = div('op-claim', column, 'button');
  claim.type = 'button';
  claim.textContent = 'Claim';
  const hint = div('op-hint', root);
  const flash = div('op-flash', root);

  // --- The 3D chest, on its own small renderer --------------------------------
  let three = null;
  function ensureThree() {
    if (three) return three;
    const renderer = new THREE.WebGLRenderer({ canvas: view, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environmentIntensity = 0.75;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    camera.position.set(0, 2.5, 6.4);
    camera.lookAt(0, 0.95, 0);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(2.5, 5, 4);
    const inner = new THREE.PointLight(0xffffff, 0, 9, 1.6);
    inner.position.set(0, 0.9, 0.2);
    const rig = new THREE.Group();
    scene.add(key, inner, rig);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 0.42, 6, 32, 1, true),
      new THREE.MeshBasicMaterial({ map: shaftTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    shaft.position.y = 3.55;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.64;
    const heap = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), new THREE.MeshStandardMaterial({ color: C.gold, metalness: 0.85, roughness: 0.28, emissive: 0xb8770a, emissiveIntensity: 0.35 }));
    mound.scale.set(1.08, 0.3, 0.7);
    mound.position.y = 0.6;
    heap.add(mound);
    for (let i = 0; i < 9; i++) {
      const coin = makeCoin();
      coin.position.set(Math.sin(i * 2.4) * 0.42, 0.7 + (i % 3) * 0.035, Math.cos(i * 1.7) * 0.24);
      coin.rotation.set(Math.PI / 2 + Math.sin(i * 5) * 0.5, 0, i);
      heap.add(coin);
    }
    three = { renderer, scene, camera, rig, inner, shaft, pool, heap, chest: null, coins: [] };
    return three;
  }

  function resize() {
    if (!three) return;
    const size = stage.clientWidth;
    three.renderer.setSize(size, size, false);
    confettiCanvas.width = innerWidth;
    confettiCanvas.height = innerHeight;
  }
  addEventListener('resize', () => { if (!root.hidden) resize(); });

  // --- One run ------------------------------------------------------------------
  let run = null;

  function card(item, { names, colors, rarityColor, collectibles, thumb }) {
    const node = document.createElement('div');
    node.className = 'op-card';
    let color = hex(C.gold), icon, title, sub, tag;
    if (item.kind === 'collectible') {
      const c = collectibles[item.id];
      color = hex(RARITY_COLORS[item.tier]);
      icon = '<img class="op-thumb" alt="">';
      title = c.name;
      sub = item.dupe ? `Duplicate · +${fmt(item.coins)} coins` : `${c.kind === 'hat' ? 'New hat' : c.kind === 'aura' ? 'New aura' : c.kind === 'pet' ? 'New pet' : c.kind === 'decor' ? 'New decoration' : 'New trophy'}${item.pity ? ' · pity' : ''}`;
      tag = item.tier;
      node.classList.add(`op-${item.tier}-card`);
      thumb?.(item.id).then((src) => { const img = node.querySelector('.op-thumb'); if (img) img.src = src; }).catch(() => {});
    } else if (item.kind === 'coins') {
      icon = '<span class="op-coins"><i></i><i></i><i></i></span>';
      title = `+${fmt(item.amount)}`;
      sub = 'Coins';
      tag = 'Coins';
    } else if (item.kind === 'relic') {
      color = rarityColor;
      icon = ICONS.relic;
      title = item.name;
      sub = `+${Math.round(item.bonus * 100)}% earnings, for good`;
      tag = 'Relic';
    } else if (item.kind === 'cosmetic') {
      const isColor = item.id.startsWith('color:');
      color = isColor ? hex(colors[item.id] ?? 0xa35be0) : '#c58cf2';
      icon = isColor ? '<span class="op-swatch"></span>' : ICONS.hat;
      title = names[item.id] || item.id;
      sub = isColor ? 'New outfit colour' : 'New hat';
      tag = 'Wardrobe';
    } else if (item.kind === 'gear') {
      const g = item.item;
      color = { common: '#b9c0c9', rare: '#4a90e2', epic: '#a35be0', legendary: '#f2c14e' }[g.rarity];
      icon = ICONS.relic;
      title = g.name;
      sub = `${g.slot === 'weapon' ? `+${g.might} damage` : g.slot === 'armor' ? `+${g.health} health` : `+${g.crit}% crit, +${g.might} damage`}${item.equipped ? ' · equipped' : ' · in your bag'}`;
      tag = `${g.rarity} ${g.slot}`;
    } else {
      icon = ICONS.token;
      title = 'Golden token';
      sub = 'Triples one building';
      tag = 'Token';
    }
    node.style.setProperty('--c', color);
    node.innerHTML = `<em>${tag}</em><div class="op-icon">${icon}</div><b></b><small></small>`;
    node.querySelector('b').textContent = title;
    node.querySelector('small').textContent = sub;
    return node;
  }

  function reelTile(entry, { collectibles, thumb }) {
    const node = document.createElement('div');
    node.className = `op-tile t-${entry.tier}`;
    node.style.setProperty('--c', entry.tier === 'coins' ? '#8d93a6' : hex(RARITY_COLORS[entry.tier]));
    node.innerHTML = `<em></em>${entry.id ? '<img alt="">' : '<span class="op-coins"><i></i><i></i><i></i></span>'}<b></b>`;
    node.querySelector('em').textContent = entry.tier === 'coins' ? 'coins' : entry.tier;
    node.querySelector('b').textContent = entry.id ? collectibles[entry.id]?.name || '' : entry.amount ? `+${fmt(entry.amount)}` : 'Coins';
    if (entry.id) thumb?.(entry.id).then((src) => { node.querySelector('img').src = src; }).catch(() => {});
    return node;
  }

  /** One filler tile, rolled with the chest's real odds. */
  function fillerEntry(drop, collectibles) {
    if (!drop || Math.random() > drop.chance) return { tier: 'coins' };
    const total = TIER_ORDER.reduce((n, t) => n + (drop.odds[t] || 0), 0);
    let r = Math.random() * total, tier = 'common';
    for (const t of TIER_ORDER) { r -= drop.odds[t] || 0; if (r <= 0) { tier = t; break; } }
    const pool = Object.keys(collectibles).filter((id) => collectibles[id].tier === tier);
    return pool.length ? { tier, id: pool[Math.floor(Math.random() * pool.length)] } : { tier: 'coins' };
  }

  function burstConfetti(count, colors) {
    const box = stage.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height * 0.52;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const s = (0.35 + Math.random() * 0.75) * Math.min(innerHeight, 900) * 1.5;
      run.confetti.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, color: colors[i % colors.length], life: 1.6 + Math.random() * 1.4 });
    }
  }

  function drawConfetti(dt) {
    const g = confettiCanvas.getContext('2d');
    g.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (let i = run.confetti.length - 1; i >= 0; i--) {
      const p = run.confetti[i];
      p.life -= dt;
      p.vy += 1500 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.1 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      if (p.life <= 0 || p.y > innerHeight + 30) { run.confetti.splice(i, 1); continue; }
      g.save();
      g.globalAlpha = clamp01(p.life * 2);
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.scale(1, Math.cos(p.r * 1.7));
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
  }

  function spawnCoins(n) {
    for (let i = 0; i < n; i++) {
      const coin = makeCoin();
      coin.position.set((Math.random() - 0.5) * 0.7, 0.8, (Math.random() - 0.5) * 0.3);
      three.rig.add(coin);
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2.4;
      three.coins.push({ m: coin, vx: Math.cos(a) * s, vy: 5.5 + Math.random() * 4.5, vz: Math.sin(a) * s * 0.6 + 0.6, spin: 6 + Math.random() * 10, life: 1.7 });
    }
  }

  function frame(now) {
    if (!run) return;
    const dt = Math.min(0.05, (now - run.last) / 1000);
    run.last = now;
    run.t += dt;
    const t = run.t;
    for (const event of run.events) {
      if (!event.fired && t >= event.at) {
        event.fired = true;
        event.fn();
      }
    }

    const { chest, rig, inner, shaft, pool, heap } = three;
    const lid = chest.userData.lid;
    // Drop in.
    const drop = clamp01(t / 0.5);
    let y = (1 - outBounce(drop)) * 3.2;
    let tilt = 0, squash = 1, lidAngle = 0;
    // Rattles, each bigger than the last.
    const build = clamp01((t - 0.5) / (run.burstAt - 0.5));
    if (t < run.burstAt) {
      for (let k = 0; k < run.rattles; k++) {
        const local = (t - run.rattleAt[k]) / 0.34;
        if (local < 0 || local > 1) continue;
        const power = 0.07 + 0.075 * k;
        const fade = Math.sin(local * Math.PI);
        tilt = Math.sin(local * Math.PI * 6) * power * fade;
        squash = 1 + Math.sin(local * Math.PI * 2) * 0.07 * (1 + k * 0.4);
        y += fade * 0.1 * (k + 1);
        lidAngle = -fade * 0.05 * (k + 1);
      }
      inner.intensity = build * build * 14;
      rig.scale.setScalar(outBack(clamp01(t / 0.35)) * (1 + build * 0.1));
      shaft.material.opacity = 0;
      pool.material.opacity = 0;
      heap.visible = false;
    } else {
      const since = t - run.burstAt;
      const open = clamp01(since / 0.32);
      lidAngle = -outBack(open) * 1.95;
      y += Math.sin(clamp01(since / 0.4) * Math.PI) * 0.45;
      squash = 1 + Math.sin(clamp01(since / 0.3) * Math.PI) * 0.16;
      inner.intensity = 26 + Math.sin(t * 5) * 4;
      rig.scale.setScalar(1.1 - 0.06 * clamp01(since / 0.5));
      shaft.material.opacity = clamp01(since / 0.2) * (0.4 + Math.sin(t * 3.1) * 0.07);
      shaft.rotation.y = t * 0.6;
      pool.material.opacity = 0.85;
      heap.visible = true;
      tilt = Math.sin(t * 1.6) * 0.025;
      y += Math.sin(t * 2.2) * 0.04;
    }
    chest.position.y = y;
    chest.rotation.z = tilt;
    chest.rotation.y = -0.38 + Math.sin(t * 0.9) * 0.06 + tilt * 0.6;
    chest.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    lid.rotation.x = lidAngle;
    stage.style.setProperty('--build', build.toFixed(3));

    for (let i = three.coins.length - 1; i >= 0; i--) {
      const c = three.coins[i];
      c.life -= dt;
      c.vy -= 16 * dt;
      c.m.position.x += c.vx * dt;
      c.m.position.y += c.vy * dt;
      c.m.position.z += c.vz * dt;
      c.m.rotation.x += c.spin * dt;
      c.m.rotation.z += c.spin * 0.6 * dt;
      c.m.scale.setScalar(clamp01(c.life * 3));
      if (c.life <= 0) {
        three.rig.remove(c.m);
        three.coins.splice(i, 1);
      }
    }
    if (run.reel && t >= run.reel.start) {
      const r = run.reel;
      if (!r.measured) {
        // Measure once the reel is on screen.
        const first = strip.children[0].getBoundingClientRect();
        const second = strip.children[1].getBoundingClientRect();
        r.tile = first.width;
        r.step = second.left - first.left;
        r.width = reel.clientWidth;
        r.target = REEL_WIN * r.step + r.tile / 2 - r.width / 2 + r.jitter * r.tile;
        r.measured = true;
      }
      const p = clamp01((t - r.start) / SPIN);
      const eased = 1 - (1 - p) ** 4;
      const x = eased * r.target;
      strip.style.transform = `translate3d(${-x}px, 0, 0)`;
      const under = Math.floor((x + r.width / 2) / r.step);
      if (under !== r.under) {
        r.under = under;
        if (!run.silent && p < 1 && now - r.lastTick > 28) { r.lastTick = now; run.audio.tick?.(); }
      }
    }
    three.renderer.render(three.scene, three.camera);
    drawConfetti(dt);
    run.raf = requestAnimationFrame(frame);
  }

  function skip() {
    // The reel always plays out: skipping only hurries the cards after it lands.
    if (!run || run.done || run.t < run.landAt + 0.2) return;
    run.silent = true;
    run.t = Math.max(run.t, run.doneAt);
    root.classList.add('op-skipped');
  }

  function finish() {
    if (!run || !run.done || run.closing) return;
    run.closing = true;
    const { onDone } = run;
    root.classList.add('op-out');
    setTimeout(() => {
      cancelAnimationFrame(run.raf);
      strip.replaceChildren();
      strip.style.transform = '';
      for (const c of three.coins) three.rig.remove(c.m);
      three.coins.length = 0;
      three.rig.remove(three.chest);
      run = null;
      root.hidden = true;
      root.className = '';
      onDone?.();
    }, 220);
  }

  function press() {
    if (!run) return;
    if (run.done) finish();
    else skip();
  }
  root.addEventListener('pointerdown', (event) => {
    if (event.target === claim) return;
    if (run && !run.done) skip();
  });
  claim.addEventListener('click', finish);
  addEventListener('keydown', (event) => {
    if (!run) return;
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (['Enter', ' ', 'e', 'E', 'Escape'].includes(event.key)) {
      event.preventDefault();
      press();
    }
  }, true);

  return {
    isOpen: () => Boolean(run),

    play({ rarity, from, percent, loot, names, colors, audio, onDone, collectibles = {}, thumb, best, drop }) {
      if (run) return;
      const t3 = ensureThree();
      const color = RARITY_COLORS[rarity];
      const rarityColor = hex(color);
      const light = `#${new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHexString()}`;

      root.className = `op-${rarity}`;
      root.style.setProperty('--rc', rarityColor);
      root.style.setProperty('--rl', light);
      root.hidden = false;
      rarityText.textContent = rarity;
      fromText.textContent = percent != null ? `${from} · ${percent}%` : from;
      hint.textContent = '';
      claim.disabled = true;
      cards.replaceChildren(...loot.map((item) => card(item, { names, colors, rarityColor, collectibles, thumb })));
      // A legendary or mythic find gets its own moment.
      const jackpot = best === 'legendary' || best === 'mythic' ? best : null;

      t3.chest = makeChest(rarity);
      t3.chest.remove(t3.chest.getObjectByName('beam'));
      t3.chest.add(t3.pool, t3.heap);
      t3.rig.add(t3.chest, t3.shaft);
      t3.inner.color.set(color);
      t3.shaft.material.color.set(color);
      t3.pool.material.color.set(light);
      resize();

      // The reel: filler on both sides, what you won at REEL_WIN.
      const won = loot.find((l) => l.kind === 'collectible');
      const coinLoot = loot.find((l) => l.kind === 'coins');
      const winEntry = won ? { tier: won.tier, id: won.id } : { tier: 'coins', amount: coinLoot?.amount };
      const entries = Array.from({ length: REEL_TILES }, (_, i) => (i === REEL_WIN ? winEntry : fillerEntry(drop, collectibles)));
      strip.replaceChildren(...entries.map((e) => reelTile(e, { collectibles, thumb })));
      strip.style.transform = '';
      const winTile = strip.children[REEL_WIN];

      const rattles = RATTLES[rarity];
      const rattleAt = Array.from({ length: rattles }, (_, k) => 0.62 + k * 0.5);
      const burstAt = 0.62 + rattles * 0.5 + 0.12;
      const reelStart = burstAt + 0.6;
      const landAt = reelStart + SPIN;
      const firstCard = landAt + 0.9 + (jackpot ? 0.6 : 0);
      const doneAt = firstCard + loot.length * 0.3 + 0.25;
      const winTier = winEntry.tier;
      const say = (fn) => { if (!run.silent) fn(); };
      const events = [
        { at: 0.42, fn: () => say(() => audio.thud()) },
        ...rattleAt.map((at, k) => ({ at, fn: () => say(() => audio.rattle(k)) })),
        {
          at: burstAt,
          fn: () => {
            root.classList.add('op-burst');
            say(() => audio.burst(1));
            spawnCoins(rarity === 'legendary' ? 26 : 16);
            burstConfetti(CONFETTI[rarity], [rarityColor, light, '#ffffff', hex(C.gold)]);
          },
        },
        { at: burstAt + 0.35, fn: () => root.classList.add('op-reeling') },
        {
          at: landAt,
          fn: () => {
            root.classList.add('op-landed');
            hint.textContent = 'Click to skip';
            winTile.classList.add('win');
            const rank = TIER_ORDER.indexOf(winTier);
            say(() => audio.burst(Math.max(0, rank)));
            if (rank >= 2) {
              const wc = hex(RARITY_COLORS[winTier]);
              burstConfetti(rank >= 3 ? 70 : 40, [wc, '#ffffff']);
            }
            if (jackpot) {
              root.classList.add('op-jackpot', `op-jackpot-${jackpot}`);
              const jc = hex(RARITY_COLORS[jackpot]);
              burstConfetti(jackpot === 'mythic' ? 260 : 160, jackpot === 'mythic' ? ['#ff4fd8', '#7fd3ff', '#fff2a0', '#b48cff', '#ffffff'] : [jc, '#fff2c0', '#ffffff']);
              say(() => audio.era());
            }
          },
        },
        ...loot.map((item, i) => ({
          at: firstCard + i * 0.3,
          fn: () => {
            cards.children[i].classList.add('in');
            say(() => audio.card(i));
          },
        })),
        {
          at: doneAt,
          fn: () => {
            run.done = true;
            claim.disabled = false;
            root.classList.add('op-done');
            hint.textContent = 'Space or click Claim';
          },
        },
      ];
      run = { t: 0, last: performance.now(), raf: 0, events, rattles, rattleAt, burstAt, doneAt, landAt, confetti: [], done: false, silent: false, closing: false, onDone, audio,
        reel: { start: reelStart, jitter: (Math.random() - 0.5) * 0.7, measured: false, under: -1, lastTick: 0 } };
      void flash.offsetWidth;
      run.raf = requestAnimationFrame(frame);
    },
  };
}
