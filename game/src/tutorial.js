// The tutorial coach: Owl says what to do next in a bubble over its head (one
// thing at a time, no list of steps), a gold arrow
// bobbing over the place to go, and a pointer on screen (at the edge when the
// place is out of view) with how far it is. The steps themselves live in
// game.js, since each one waits for something real to happen in the game.

import * as THREE from 'three';

const ARROW_SVG = '<svg viewBox="0 0 24 24"><path d="M12 22 3 10h5.5V2h7v8H21z"/></svg>';

export function createCoach({ scene, camera, onSkip, onQuit, onNext }) {
  const card = document.createElement('div');
  card.id = 'owlSay';
  card.hidden = true;
  card.innerHTML = `
    <b class="coach-title">The Librarian</b>
    <p class="coach-text"></p>
    <div class="coach-keys"></div>
    <div class="coach-actions">
      <button type="button" class="coach-next">Got it</button>
    </div>`;
  document.body.append(card);
  const quit = document.createElement('button');
  quit.id = 'owlSkip';
  quit.type = 'button';
  quit.hidden = true;
  quit.textContent = 'Skip tutorial';
  document.body.append(quit);
  const $ = (s) => card.querySelector(s);
  $('.coach-next').addEventListener('click', () => onNext());
  quit.addEventListener('click', () => onQuit());
  void onSkip;
  const bubbleAt = new THREE.Vector3();

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
    show(step) {
      shown = true;
      card.hidden = false;
      quit.hidden = false;
      card.classList.remove('coach-done');
      card.classList.remove('coach-in');
      void card.offsetWidth;
      card.classList.add('coach-in');
      $('.coach-text').textContent = step.text;
      $('.coach-keys').replaceChildren(...(step.keys || []).map((k) => Object.assign(document.createElement('kbd'), { textContent: k })));
      $('.coach-next').hidden = !step.manual;
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
      quit.hidden = true;
      marker.hidden = true;
      pin.visible = false;
      glow(null);
    },
    /** Hides everything while a panel is open; shows it again after. */
    setVisible(on) {
      card.hidden = !shown || !on;
      quit.hidden = !shown || !on;
      if (!on) { marker.hidden = true; pin.visible = false; }
    },
    /** Keeps the bubble in one place: top centre, under the HUD. */
    pin() {
      if (card.hidden) return;
      card.style.transform = `translate(${innerWidth / 2}px, 96px) translate(-50%, 0)`;
      card.classList.add('pinned');
    },
    /** True when a point in the world is on screen (not behind the camera). */
    inView(pos) {
      bubbleAt.copy(pos).add(new THREE.Vector3(0, 2.4, 0)).project(camera);
      return bubbleAt.z < 1 && Math.abs(bubbleAt.x) < 0.9 && bubbleAt.y < 0.9 && bubbleAt.y > -0.6;
    },
    /** Keeps the bubble over a point in the world. */
    follow(owlPos) {
      if (card.hidden) return;
      bubbleAt.copy(owlPos).add(new THREE.Vector3(0, 2.4, 0)).project(camera);
      card.classList.remove('pinned');
      const x = Math.max(170, Math.min(innerWidth - 170, (bubbleAt.x * 0.5 + 0.5) * innerWidth));
      const y = Math.max(90, Math.min(innerHeight - 160, (-bubbleAt.y * 0.5 + 0.5) * innerHeight));
      card.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
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
      const box = { l: 70, r: innerWidth - (wide ? 330 : 70), t: wide ? 300 : 260, b: innerHeight - 200 }; // clear of the E prompt too
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
