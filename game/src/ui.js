// Everything drawn with HTML: the HUD, menus, toasts and banners.
// It only shows what it's given and reports clicks back; no game rules here.

import { fmt } from './sim.js';
import { createOpening } from './opening.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  work: '<svg viewBox="0 0 24 24"><path d="M3 20V10l6 4V10l6 4V6h6v14z"/><path d="M7 20v-3M12 20v-3M17 20v-3"/></svg>',
  trade: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>',
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}
const price = (n) => el('span', {}, el('span', { class: 'coin sm' }), fmt(n));

export function timeLeft(ms) {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
  return ms < 0 ? `${text} late` : text;
}

export function createUI(on) {
  let open = null;
  let lastCoins = null;
  let questOpen = null;
  const badge = (id, n) => {
    $(id).hidden = !n;
    $(id).textContent = n || '';
  };
  const SLOT_NAMES = { weapon: 'Weapon', armor: 'Armor', charm: 'Charm' };
  const gearStat = (g) => (g.slot === 'weapon' ? `+${g.might} damage` : g.slot === 'armor' ? `+${g.health} health` : `+${g.crit}% crit · +${g.might} damage`);
  const opening = createOpening();

  $('btnSchool').addEventListener('click', () => on.school());
  $('btnStudy').addEventListener('click', () => on.study(null));
  $('focusEnd').addEventListener('click', () => on.endStudy());
  $('btnHero').addEventListener('click', () => on.hero());
  $('heroPlate').addEventListener('click', () => on.hero());
  $('btnQuests').addEventListener('click', () => on.quests());
  $('quest').addEventListener('click', () => questOpen && questOpen());
  $('btnHelp').addEventListener('click', () => on.help());
  $('btnSound').addEventListener('click', () => on.sound());
  $('prompt').addEventListener('click', () => on.interact());
  $('scrim').addEventListener('pointerdown', (event) => { if (event.target === $('scrim')) close(); });

  function close() {
    if (!open) return;
    $('scrim').hidden = true;
    $('panel').replaceChildren();
    const done = open.onClose;
    open = null;
    if (done) done();
  }

  function panel({ title, subtitle, wide = false, onClose, canClose = true }, ...body) {
    open = { onClose };
    const p = $('panel');
    p.className = wide ? 'wide' : '';
    p.replaceChildren(
      el('div', { class: 'panel-head' },
        el('div', {}, el('h2', { text: title }), subtitle ? el('p', { text: subtitle }) : null),
        canClose ? el('button', { class: 'x', 'aria-label': 'Close', text: '✕', onclick: close }) : null),
      ...body.flat(),
    );
    $('scrim').hidden = false;
    p.scrollTop = 0;
  }

  return {
    isOpen: () => Boolean(open) || opening.isOpen(),
    close,

    hud({ coins, income, era, eraName, goal, progress, siege, chests, muted }) {
      const node = $('coins');
      node.textContent = fmt(coins);
      if (lastCoins !== null && coins > lastCoins + 0.5) {
        const wrap = node.parentElement;
        wrap.classList.remove('pop');
        void wrap.offsetWidth;
        wrap.classList.add('pop');
      }
      lastCoins = coins;
      $('income').textContent = `+${fmt(income)} / sec${siege ? '  (halved)' : ''}`;
      $('eraIndex').textContent = ROMAN[era] || String(era + 1);
      $('eraName').textContent = eraName;
      $('eraGoal').textContent = goal;
      $('eraBar').style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
      const s = $('siege');
      s.hidden = !siege;
      if (siege) s.innerHTML = `<b>Under siege.</b> ${siege} is overdue. Income is halved until it's handed in.`;
      badge('schoolDot', chests);
      $('btnSound').classList.toggle('muted', Boolean(muted));
    },

    /** Health and the two moves on a timer. dodge and slam are 0 when ready. */
    vitals({ hp, max, dodge, slam, level, xp, need, points, capped }) {
      $('heroLevel').textContent = level;
      $('xpBar').style.width = `${capped ? 100 : Math.min(100, (xp / need) * 100)}%`;
      $('xpText').textContent = capped ? 'Max level' : `${xp} / ${need} XP`;
      $('heroPlate').classList.toggle('points', points > 0);
      badge('heroDot', points);
      $('hpBar').style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`;
      $('hpText').textContent = `${Math.max(0, Math.ceil(hp))} / ${max}`;
      $('vitals').classList.toggle('low', hp / max < 0.35);
      $('skDodge').classList.toggle('wait', dodge > 0);
      $('skSlam').classList.toggle('wait', slam > 0);
      $('skSlam').style.setProperty('--left', `${Math.round(slam * 100)}%`);
    },

    /** A red flash at the edges when the player is hit. */
    hurt() {
      const node = $('hurt');
      node.classList.remove('on');
      void node.offsetWidth;
      node.classList.add('on');
    },

    /** What is left to do in the place being explored. Pass null in town. */
    quest(info) {
      const node = $('quest');
      node.hidden = !info;
      questOpen = info?.onOpen || null;
      node.classList.toggle('link', Boolean(questOpen));
      if (!info) return;
      const html = `<b>${info.title}</b>${info.parts.map((p) => `<span>${p}</span>`).join('')}`;
      if (node.innerHTML !== html) node.innerHTML = html;
    },

    threats(list, source = 'none', away = false) {
      $('threats').hidden = away;
      if (away) return;
      const from = { none: 'not connected', demo: 'sample semester', soma: 'your classes', manual: 'your list' }[source];
      $('threats').replaceChildren(
        el('button', { class: 'threats-head', onclick: () => on.school() }, el('b', { text: 'Canvas' }), el('span', { text: list.length ? `${list.length} due · ${from}` : from })),
        ...list.slice(0, 4).map((t) =>
          el('button', { class: `threat ${t.kind === 'boss' ? 'boss' : ''} ${t.overdue ? 'overdue' : t.soon ? 'soon' : ''} ${t.studying ? 'studying' : ''}`, title: 'Study for this', onclick: () => on.study(t.id) },
            el('i'), el('span', {}, t.name, el('small', { text: `${t.studying ? 'Studying now' : t.kind === 'boss' ? 'Test (boss)' : 'Assignment'} · ${t.course}${t.studied > 0 ? ` · ${Math.round(t.studied * 100)}% studied` : ''}` })), el('time', { text: t.time }))),
        list.length > 4 ? el('div', { class: 'threat more', text: `+${list.length - 4} more marching in` }) : null,
      );
    },

    prompt(text, key = 'E') {
      $('prompt').hidden = !text;
      if (text) {
        $('promptText').textContent = text;
        $('promptKey').textContent = key;
      }
    },

    toast(text, kind = '') {
      const node = el('div', { class: `toast ${kind}`, text });
      $('toasts').append(node);
      while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
      setTimeout(() => node.classList.add('out'), 3600);
      setTimeout(() => node.remove(), 4000);
    },

    banner(small, big) {
      const b = $('banner');
      b.hidden = true;
      void b.offsetWidth;
      $('bannerSmall').textContent = small;
      $('bannerBig').textContent = big;
      b.hidden = false;
      setTimeout(() => { b.hidden = true; }, 3500);
    },

    fade(onDark) {
      $('fade').classList.add('on');
      setTimeout(() => {
        onDark();
        setTimeout(() => $('fade').classList.remove('on'), 250);
      }, 750);
    },

    boss(info) {
      $('bossHud').hidden = !info;
      if (!info) return;
      $('bossName').textContent = info.name;
      $('bossBar').style.width = `${Math.max(0, (info.hp / info.max) * 100)}%`;
      $('hearts').replaceChildren(...Array.from({ length: info.maxHearts }, (_, i) => el('i', { class: i < info.hearts ? '' : 'off' })));
    },

    build({ eraName, options, onPick }) {
      panel({ title: 'Build here', subtitle: `${eraName} buildings. Each one earns coins by itself, and you collect by walking past.` },
        el('div', { class: 'cards' }, options.map((o) =>
          el('button', { class: 'card', disabled: !o.affordable, onclick: () => { close(); onPick(o.type); } },
            el('span', { class: 'glyph', html: ICONS[o.type] }),
            el('b', { text: o.name }),
            el('small', { text: `+${fmt(o.income)} / sec` }),
            el('span', { class: `price ${o.affordable ? '' : 'no'}` }, price(o.cost))))),
      );
    },

    building({ name, level, maxLevel, income, stored, cap, golden, upgrade, modernize, gild, tokens, onUpgrade, onModernize, onGild }) {
      const actions = [];
      if (upgrade) actions.push(el('button', { class: 'btn primary', disabled: !upgrade.affordable, onclick: () => { close(); onUpgrade(); } },
        el('span', {}, `Upgrade to level ${level + 1}`, el('small', { text: `Earns +${fmt(upgrade.income)} / sec` })), el('span', { class: 'cost' }, price(upgrade.cost))));
      if (modernize) actions.push(el('button', { class: `btn ${upgrade ? '' : 'primary'}`, disabled: !modernize.affordable, onclick: () => { close(); onModernize(); } },
        el('span', {}, `Rebuild as ${modernize.name}`, el('small', { text: `Earns +${fmt(modernize.income)} / sec at level 1` })), el('span', { class: 'cost' }, price(modernize.cost))));
      if (gild) actions.push(el('button', { class: 'btn', disabled: tokens < 1, onclick: () => { close(); onGild(); } },
        el('span', {}, 'Make it golden', el('small', { text: 'Triples what it earns, for good' })), el('span', { class: 'cost', text: `${tokens} token${tokens === 1 ? '' : 's'}` })));
      panel({ title: `${golden ? 'Golden ' : ''}${name}`, subtitle: `Level ${level} of ${maxLevel}` },
        el('div', { class: 'stats' },
          el('div', { class: 'stat' }, el('small', { text: 'Earns' }), el('b', { text: `+${fmt(income)} / sec` })),
          el('div', { class: 'stat' }, el('small', { text: 'Waiting' }), el('b', { text: fmt(stored) })),
          el('div', { class: 'stat' }, el('small', { text: 'Holds up to' }), el('b', { text: fmt(cap) }))),
        el('div', { class: 'actions' }, actions.length ? actions : el('p', { class: 'note', text: 'Fully upgraded for this age. Reach the next age to rebuild it.' })),
      );
    },

    wonder({ name, cost, affordable, nextEra, onBuild }) {
      panel({ title: name, subtitle: `Building this wonder begins the ${nextEra}.` },
        el('div', { class: 'actions' },
          el('button', { class: 'btn primary', disabled: !affordable, onclick: () => { close(); onBuild(); } },
            el('span', {}, `Build the ${name}`, el('small', { text: 'New buildings, more land, a new look for your town' })), el('span', { class: 'cost' }, price(cost)))),
        affordable ? null : el('p', { class: 'note', text: 'Keep collecting. Handing in work and opening chests gets you there faster.' }),
      );
    },

    travel({ title, subtitle, label, onGo }) {
      panel({ title, subtitle }, el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: () => { close(); onGo(); } }, el('span', { text: label }))));
    },

    bossIntro({ name, course, level, heroLevel, hp, power, time, studied, onFight, onStudy }) {
      panel({ title: `${name} · level ${level}`, subtitle: `${course} · due in ${time} · you are level ${heroLevel}` },
        el('div', { class: 'stats' },
          el('div', { class: 'stat' }, el('small', { text: 'Boss health' }), el('b', { text: fmt(hp) })),
          el('div', { class: 'stat' }, el('small', { text: 'Your hit' }), el('b', { text: fmt(power) })),
          el('div', { class: 'stat' }, el('small', { text: 'Your hearts' }), el('b', { text: '5' }))),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: () => { close(); onFight(); } }, el('span', {}, 'Fight', el('small', { text: 'Step out of the red circles. Hit with F or a click.' })))),
        el('div', { class: 'actions', style: 'margin-top:8px' }, el('button', { class: 'btn', onclick: () => { close(); onStudy(); } }, el('span', {}, 'Study for it first', el('small', { text: `Studied ${Math.round(studied * 100)}%. Study time cuts its health, down to half.` })))),
        el('p', { class: 'note', text: `About ${Math.max(1, Math.ceil(hp / Math.max(1, power)))} hits to win. Studying levels you up, and work handed in for this course makes your hits stronger. Losing costs nothing, and you can try again.` }),
      );
    },

    loot({ onDone, ...reveal }) {
      opening.play({ ...reveal, onDone });
    },

    wardrobe({ owned, hat, color, names, colors, all, onPick }) {
      const section = (prefix, current) => el('div', { class: 'swatches' }, all.filter((id) => id.startsWith(prefix)).map((id) =>
        el('button', { class: `swatch ${id === current ? 'on' : ''}`, disabled: !owned.includes(id), onclick: () => onPick(id) },
          prefix === 'color:' ? el('i', { style: `background:#${colors[id].toString(16).padStart(6, '0')}` }) : null,
          owned.includes(id) ? names[id] : 'Locked')));
      panel({ title: 'Wardrobe', subtitle: 'New looks come from chests. Better grades drop better chests.' },
        el('h3', { text: 'Colour' }), section('color:', color), el('h3', { text: 'Hat' }), section('hat:', hat));
    },

    school({ source, connected, groups, chests, onDemo, onClear, onStudy }) {
      const describe = { none: 'Not connected', demo: 'Sample semester', soma: 'Soma for Canvas', manual: 'Your own list' }[source];
      const rows = groups.flatMap((g) => [
        el('div', { class: 'course', text: g.course }),
        ...g.items.map((a) => el('div', { class: `row ${a.submitted ? 'done' : ''}` },
          el('div', {}, a.name, a.kind === 'boss' ? el('span', { class: 'tag', text: 'Boss' }) : null,
            el('small', { text: a.status }),
            a.submitted ? null : el('div', { class: 'bar study', title: 'Studied' }, el('i', { style: `width:${Math.round(a.studied * 100)}%` }))),
          a.submitted ? null : el('div', { class: 'do' }, el('button', { class: 'btn small', text: a.studied >= 1 ? 'Study more' : 'Study', onclick: () => onStudy(a.id) })))),
      ]);
      panel({ title: 'Canvas', subtitle: `${describe}${connected ? ' · extension found' : ''}. Every Canvas assignment is a walking book marching on your gate. Tests are bosses. Each posted grade drops a chest: 90%+ legendary, 80%+ epic, 70%+ rare.`, wide: true },
        el('p', { class: 'note sync', text: source === 'soma'
          ? 'This is the Canvas data Soma already has for your account. Hand-ins and grades show up here by themselves; there is nothing to type in.'
          : 'This is a sample semester. Connect Canvas in Soma (Deadlines, then Soma for Canvas) and your real due dates, hand-ins and grades replace it by themselves. Nothing to type in.' }),
        chests ? el('p', { class: 'note', style: 'margin:0 0 6px', text: `${chests} chest${chests === 1 ? '' : 's'} waiting on your plaza.` }) : null,
        rows.length ? rows : el('p', { class: 'note', text: 'Nothing due right now.' }),
        el('div', { class: 'source', style: 'margin-top:14px' },
          source === 'soma' ? null : el('button', { class: 'btn small', text: 'Restart the sample semester', onclick: onDemo }),
          source === 'soma' ? el('button', { class: 'btn small', text: 'Sync again', onclick: onClear }) : null),
      );
    },

    /** The character sheet: level, stats, gear, bag and skills. */
    hero({ level, xp, need, capped, points, stats, gear, bag, bagSize, skills, masteries, onEquip, onSell, onSkill, onWardrobe, onStudy }) {
      const branches = [...new Set(skills.map((k) => k.branch))];
      panel({ title: `Level ${level} hero`, subtitle: 'Experience only comes from school: study sessions, handing work in, grades and test bosses. Fighting pays coins and gear.', wide: true },
        el('div', { class: 'xp-row' },
          el('div', { class: 'bar xp' }, el('i', { style: `width:${capped ? 100 : Math.min(100, (xp / need) * 100)}%` })),
          el('span', { text: capped ? 'Max level' : `${xp} / ${need} XP to level ${level + 1}` }),
          el('button', { class: 'btn small primary', text: 'Study to level up', onclick: onStudy })),
        el('div', { class: 'stats four' },
          el('div', { class: 'stat' }, el('small', { text: 'Damage' }), el('b', { text: fmt(stats.might) })),
          el('div', { class: 'stat' }, el('small', { text: 'Health' }), el('b', { text: fmt(stats.health) })),
          el('div', { class: 'stat' }, el('small', { text: 'Critical hits' }), el('b', { text: `${Math.round(stats.crit * 100)}%` })),
          el('div', { class: 'stat' }, el('small', { text: 'Study XP' }), el('b', { text: `×${stats.studyXp.toFixed(2)}` }))),
        el('h3', { text: 'Wearing' }),
        el('div', { class: 'gear-row' }, gear.map(({ slot, item }) => el('div', { class: `gear ${item ? `g-${item.rarity}` : 'empty'}` },
          el('small', { text: SLOT_NAMES[slot] }),
          el('b', { text: item ? item.name : 'Nothing yet' }),
          el('span', { text: item ? `Level ${item.level} · ${gearStat(item)}` : 'Chests and elite enemies drop gear' })))),
        el('h3', { text: `Bag ${bag.length} / ${bagSize}` }),
        bag.length ? el('div', { class: 'gear-row bag' }, bag.map(({ item, better, value }) => el('div', { class: `gear g-${item.rarity}` },
          el('small', { text: `${SLOT_NAMES[item.slot]}${better ? ' · better' : ''}` }),
          el('b', { text: item.name }),
          el('span', { text: `Level ${item.level} · ${gearStat(item)}` }),
          el('div', { class: 'gear-do' },
            el('button', { class: 'btn small', text: 'Equip', onclick: () => onEquip(item.id) }),
            el('button', { class: 'btn small', onclick: () => onSell(item.id) }, 'Sell ', price(value))))))
          : el('p', { class: 'note', text: 'Empty. Gear you are not wearing lands here.' }),
        el('h3', {}, 'Skills', el('span', { class: `points ${points ? 'on' : ''}`, text: points ? `${points} point${points === 1 ? '' : 's'} to spend` : 'One point per level' })),
        el('div', { class: 'branches' }, branches.map((branch) => el('div', { class: 'branch' }, el('h4', { text: branch }),
          skills.filter((k) => k.branch === branch).map((k) => el('button', { class: `skill ${k.rank >= k.max ? 'max' : ''}`, disabled: points < 1 || k.rank >= k.max, onclick: () => onSkill(k.id) },
            el('span', {}, el('b', { text: k.name }), el('small', { text: `${k.text} each` })),
            el('em', { text: `${k.rank} / ${k.max}` })))))),
        masteries.length ? el('h3', { text: 'Course mastery' }) : null,
        masteries.length ? el('div', { class: 'stats' }, masteries.map((m) => el('div', { class: 'stat' }, el('small', { text: m.name }), el('b', { text: `Level ${m.level}` }), el('small', { text: `${m.minutes} min studied · +${m.level}% damage` })))) : null,
        el('div', { class: 'source', style: 'margin-top:14px' }, el('button', { class: 'btn small', text: 'Wardrobe', onclick: onWardrobe })),
      );
    },

    /** The quest log: the story quest, then every piece of schoolwork as a quest. */
    quests({ story, done, total, level, school, onStudy }) {
      const reward = (r) => [r.coins ? `${fmt(r.coins)} coins` : null, r.gear ? `${r.gear} ${r.slot}` : null].filter(Boolean).join(' + ');
      panel({ title: 'Quests', subtitle: `Story ${done} of ${total} done · you are level ${level}`, wide: true },
        el('h3', { text: 'Story' }),
        story ? el('div', { class: 'quest-card main' },
          el('div', {}, el('b', { text: story.title }), el('small', { text: story.text }),
            el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((story.have / story.need) * 100)}%` }))),
          el('div', { class: 'quest-pay' }, el('em', { text: `${story.have} / ${story.need}` }), el('small', { text: `Reward: ${reward(story.reward)}` })))
          : el('p', { class: 'note', text: 'The story is finished. You beat the last guardian.' }),
        el('h3', { text: 'School quests' }),
        school.length ? school.map((a) => el('div', { class: `quest-card ${a.overdue ? 'late' : ''}` },
          el('div', {}, el('b', {}, a.name, a.kind === 'boss' ? el('span', { class: 'tag', text: `Boss · level ${a.bossLevel}` }) : null),
            el('small', { text: `${a.course} · ${a.overdue ? a.time : `due in ${a.time}`}` }),
            el('div', { class: 'bar study' }, el('i', { style: `width:${Math.round(a.studied * 100)}%` }))),
          el('div', { class: 'quest-pay' },
            el('small', { text: `Study ${a.goal} min: +${a.studyXp} XP` }),
            el('small', { text: a.kind === 'boss' ? 'Beat it: +250 XP, epic chest' : `Hand in: +${a.handInXp} XP` }),
            el('small', { text: 'Grade posted: chest + XP' }),
            el('button', { class: 'btn small primary', text: 'Study', onclick: () => onStudy(a.id) }))))
          : el('p', { class: 'note', text: 'Nothing due right now. Free study still gives XP.' }),
      );
    },

    /** Pick what to study and for how long. */
    study({ items, selected, lengths, chestsLeft, streak, xpRate = 5, onStart }) {
      let length = lengths[1] || lengths[0];
      const pick = el('select', {}, el('option', { value: '', text: 'Something else (free study)' }),
        items.map((a) => el('option', { value: a.id, selected: a.id === selected, text: `${a.kind === 'boss' ? 'Test: ' : ''}${a.name} · ${a.course}` })));
      const info = el('p', { class: 'note study-info' });
      const cards = el('div', { class: 'cards' });
      const go = el('button', { class: 'btn primary', style: 'justify-content:center', onclick: () => { const id = pick.value || null; close(); onStart(id, length.minutes); } });
      const draw = () => {
        const a = items.find((x) => x.id === pick.value);
        info.textContent = !a ? 'Free study still pays XP, coins and a chest. Pick an assignment to wear it down too.'
          : a.studied >= 1 ? 'Fully studied. Extra sessions still pay coins and chests.'
            : a.kind === 'boss' ? `Studied ${Math.round(a.minutes)} of ${a.goal} minutes. Every minute shrinks this boss before you fight it, down to half health.`
              : `Studied ${Math.round(a.minutes)} of ${a.goal} minutes. Fully studied work pays 50% more when you hand it in.`;
        cards.replaceChildren(...lengths.map((l) => el('button', { class: `card ${l === length ? 'on' : ''}`, onclick: () => { length = l; draw(); } },
          el('b', { text: `${l.minutes} min` }),
          el('small', { text: `+${Math.round(l.minutes * xpRate)} XP` }),
          el('small', { class: chestsLeft ? `r-${l.rarity}` : '', text: chestsLeft ? `${l.rarity} chest` : 'no chest left today' }))));
        go.replaceChildren(el('span', { text: `Start ${length.minutes} minutes` }));
      };
      pick.addEventListener('change', draw);
      draw();
      panel({ title: 'Study session', subtitle: 'This is how your hero levels up. Start the timer, then go do the work: every minute is experience.' },
        el('div', { class: 'form one' }, pick), info, cards,
        el('div', { class: 'stats', style: 'margin-top:12px' },
          el('div', { class: 'stat' }, el('small', { text: 'Town income' }), el('b', { text: '×2 while studying' })),
          el('div', { class: 'stat' }, el('small', { text: 'Study chests left today' }), el('b', { text: String(chestsLeft) })),
          el('div', { class: 'stat' }, el('small', { text: 'Streak' }), el('b', { text: `${streak} day${streak === 1 ? '' : 's'}` }))),
        el('div', { class: 'actions' }, go),
        el('p', { class: 'note', text: 'You can switch tabs: the timer keeps running and shows in the tab title. Ending early still pays for the minutes you did, after the first five.' }),
      );
    },

    /** The timer shown while a session runs. Pass null to hide it. */
    focus(info) {
      const node = $('focus');
      node.hidden = !info;
      if (!info) return;
      $('focusTime').textContent = info.time;
      $('focusName').textContent = info.name;
      $('focusBar').style.width = `${Math.round(info.progress * 100)}%`;
    },

    help({ first, onStart }) {
      panel({ title: first ? 'Welcome to Epoch' : 'How to play', subtitle: 'An RPG where your hero is as strong as your studying.', onClose: onStart },
        el('div', { class: 'keys' },
          el('span', { class: 'k' }, el('kbd', { text: 'W' }), el('kbd', { text: 'A' }), el('kbd', { text: 'S' }), el('kbd', { text: 'D' })), el('span', { text: 'Walk. Hold Shift to run, Space to jump.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'Drag' })), el('span', { text: 'Look around with either mouse button. Scroll to zoom in and out. V locks the mouse to the view.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'T' })), el('span', { text: 'Start a study session. This is the only way to level up.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'C' }), el('kbd', { text: 'J' })), el('span', { text: 'Your hero (gear and skills) and your quests.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'E' })), el('span', { text: 'Build, upgrade, open chests, start a boss fight.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'F' })), el('span', { text: 'Swing (or click). Three swings in a row end in a combo hit.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'Q' })), el('span', { text: 'Dodge. Nothing can hit you mid-dash.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'R' })), el('span', { text: 'Ground slam: hits everything around you.' })),
        el('ol', { class: 'steps' },
          el('li', { text: 'Your hero levels up only from school: study sessions, handing work in, grades and beating tests. Each level makes you stronger and gives a skill point.' }),
          el('li', { text: 'Enemies have fixed levels. If they are too strong, study, then come back. Chests and elite enemies drop gear.' }),
          el('li', { text: 'Walk to a glowing pad and build. Buildings earn coins while you are away.' }),
          el('li', { text: 'Walk past buildings to collect. Upgrade them, then build the wonder to reach the next age.' }),
          el('li', { text: 'Your Canvas assignments are the walking books marching on the gate. Hand one in on Canvas and it is gone, with a coin reward. Late ones halve your income.' }),
          el('li', { text: 'Walk up to a book and start a study session, then go do the work. The town fires on the book while the timer runs, earns double, and a chest drops when you finish.' }),
          el('li', { text: 'Take the trail through the eastern pass to the Wilds: clear monster camps for chests, dig up treasure, find shrines and hunt the Alpha. After the Moon, the Star Gate opens a whole new world.' }),
          el('li', { text: 'Tests are giant book bosses you can fight. Every grade posted on Canvas drops a chest on your plaza: the better the grade, the rarer the chest.' })),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', style: 'justify-content:center', onclick: close }, el('span', { text: first ? 'Start' : 'Back to the game' }))),
      );
    },
  };
}
