// The tutorial coach: a card that gives one step at a time, a gold arrow
// bobbing over the place to go, and a pointer on screen (at the edge when the
// place is out of view) with how far it is. The steps themselves live in
// game.js, since each one waits for something real to happen in the game.

import * as THREE from 'three';

const ARROW_SVG = '<svg viewBox="0 0 24 24"><path d="M12 22 3 10h5.5V2h7v8H21z"/></svg>';

export function createCoach({ scene, camera, onSkip, onQuit, onNext }) {
  const card = document.createElement('div');
  card.id = 'coach';
  card.hidden = true;
  card.innerHTML = `
    <div class="coach-top"><small class="coach-step"></small><div class="coach-dots"></div></div>
    <b class="coach-title"></b>
    <p class="coach-text"></p>
    <div class="coach-keys"></div>
    <div class="coach-actions">
      <button type="button" class="coach-next">Got it</button>
      <button type="button" class="coach-skip">Skip step</button>
      <button type="button" class="coach-quit">End tutorial</button>
    </div>`;
  document.body.append(card);
  const $ = (s) => card.querySelector(s);
  $('.coach-next').addEventListener('click', () => onNext());
  $('.coach-skip').addEventListener('click', () => onSkip());
  $('.coach-quit').addEventListener('click', () => onQuit());

  const marker = document.createElement('div');
  marker.id = 'coachMarker';
  marker.hidden = true;
  marker.innerHTML = `<i>${ARROW_SVG}</i><span></span>`;
  document.body.append(marker);
  const arrowEl = marker.querySelector('i');
  const distEl = marker.querySelector('span');

  // The arrow in the world, over the target.
  const pin = new THREE.Group();
  const gold = new THREE.MeshBasicMaterial({ color: 0xffd04a });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), gold);
  cone.rotation.x = Math.PI;
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 0.34), gold);
  stem.position.y = 0.9;
  const head = new THREE.Group();
  head.add(cone, stem);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.9, 40), new THREE.MeshBasicMaterial({ color: 0xffd04a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  pin.add(head, ring);
  pin.visible = false;
  scene.add(pin);

  let shown = false;
  let glowing = null;
  const v = new THREE.Vector3();

  function glow(id) {
    glowing?.classList.remove('tut-glow');
    glowing = id ? document.getElementById(id) : null;
    glowing?.classList.add('tut-glow');
  }

  return {
    show(step, index, total) {
      shown = true;
      card.hidden = false;
      card.classList.remove('coach-done');
      card.classList.remove('coach-in');
      void card.offsetWidth;
      card.classList.add('coach-in');
      $('.coach-step').textContent = `Step ${index + 1} of ${total}`;
      $('.coach-dots').innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < index ? 'on' : i === index ? 'now' : ''}"></i>`).join('');
      $('.coach-title').textContent = step.title;
      $('.coach-text').textContent = step.text;
      $('.coach-keys').replaceChildren(...(step.keys || []).map((k) => Object.assign(document.createElement('kbd'), { textContent: k })));
      $('.coach-next').hidden = !step.manual;
      $('.coach-skip').hidden = Boolean(step.manual);
      glow(step.glow);
    },
    /** A tick and a flash before the next step. */
    complete() {
      card.classList.add('coach-done');
      pin.visible = false;
      marker.hidden = true;
      glow(null);
    },
    hide() {
      shown = false;
      card.hidden = true;
      marker.hidden = true;
      pin.visible = false;
      glow(null);
    },
    /** Hides everything while a panel is open; shows it again after. */
    setVisible(on) {
      card.hidden = !shown || !on;
      if (!on) { marker.hidden = true; pin.visible = false; }
    },
    /** Points at target (a Vector3, or null for nothing to point at) every frame. */
    point(target, from, time) {
      if (!shown || card.hidden || !target) { marker.hidden = true; pin.visible = false; return; }
      pin.visible = true;
      pin.position.copy(target);
      head.position.y = 3.4 + Math.sin(time * 4) * 0.35;
      head.rotation.y = time * 1.6;
      ring.scale.setScalar(1 + (time % 1.2) * 0.4);
      ring.material.opacity = 0.75 * (1 - (time % 1.2) / 1.2);

      const dist = Math.hypot(target.x - from.x, target.z - from.z);
      v.copy(target).add(new THREE.Vector3(0, 4.6, 0)).project(camera);
      const behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * innerWidth;
      let y = (-v.y * 0.5 + 0.5) * innerHeight;
      if (behind) { x = innerWidth - x; y = innerHeight - y; }
      // The open part of the screen: clear of the side panels, the coach card and the hotbar.
      const wide = innerWidth > 900;
      const box = { l: 70, r: innerWidth - (wide ? 310 : 70), t: wide ? 300 : 260, b: innerHeight - 130 };
      const onScreen = !behind && x > box.l && x < box.r && y > box.t && y < box.b;
      marker.hidden = dist < 3;
      distEl.textContent = `${Math.round(dist)} m`;
      if (onScreen) {
        marker.classList.remove('edge');
        marker.style.transform = `translate(${x}px, ${y}px)`;
        arrowEl.style.transform = 'rotate(0deg)';
      } else {
        // Pin it to the screen edge, pointing the way.
        const cx = (box.l + box.r) / 2, cy = (box.t + box.b) / 2;
        let dx = x - cx, dy = y - cy;
        if (behind && Math.abs(dy) < 1) dy = 1;
        const k = Math.min((box.r - box.l) / 2 / Math.max(1e-3, Math.abs(dx)), (box.b - box.t) / 2 / Math.max(1e-3, Math.abs(dy)));
        marker.classList.add('edge');
        marker.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px)`;
        arrowEl.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI - 90}deg)`;
      }
    },
  };
}
