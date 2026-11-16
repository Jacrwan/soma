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
  $('btnMap')?.addEventListener('click', () => on.map?.());
  $('btnSound').addEventListener('click', () => on.sound());
  $('btnSettings')?.addEventListener('click', () => on.settings());
  $('btnPass')?.addEventListener('click', () => on.pass());
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
      ...body.flat().filter((x) => x != null),
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

    /** The deadline bar under the coins. level: 'late' | 'critical' | 'urgent'. Pass null to hide it. */
    alert(info) {
      const node = $('alert');
      node.hidden = !info;
      if (!info) return;
      const key = `${info.level}|${info.id}|${info.text}|${info.more}`;
      if (node.dataset.key === key) return;
      node.dataset.key = key;
      node.className = info.level;
      const label = { late: 'Late', critical: 'Due soon', urgent: 'Due today' }[info.level];
      node.replaceChildren(...[
        el('button', { class: 'alert-main', title: 'Open your Canvas list', onclick: () => on.school() },
          el('b', { text: label }), el('span', { class: 'alert-name', text: info.name }), el('span', { class: 'alert-text', text: info.text }),
          info.more > 0 ? el('em', { text: `+${info.more} more` }) : null),
        info.canIgnore ? el('button', { class: 'alert-ignore', title: 'Nothing to hand in for this one? Stop the warnings and losses.', text: 'Ignore', onclick: () => on.ignore(info.id) }) : null,
      ].filter(Boolean));
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
          el('button', { class: `threat ${t.kind === 'boss' ? 'boss' : ''} ${t.overdue ? 'overdue' : t.soon ? 'soon' : ''} ${t.level || ''} ${t.studying ? 'studying' : ''}`, title: 'Study for this', onclick: () => on.study(t.id) },
            el('i'), el('span', {}, t.name, el('small', { text: `${t.studying ? 'Studying now' : t.kind === 'boss' ? 'Exam' : 'Assignment'} · ${t.course}${t.kind === 'boss' ? ` · ${Math.round((1 - t.studied) * 100)}% armor` : t.studied > 0 ? ` · ${Math.round(t.studied * 100)}% studied` : ''}` })), el('time', { text: t.time }))),
        ...(list.length > 4 ? [el('div', { class: 'threat more', text: `+${list.length - 4} more marching in` })] : []),
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

    wonder({ name, cost, affordable, nextEra, newLand, onBuild }) {
      panel({ title: name, subtitle: `Building this wonder begins the ${nextEra}.` },
        newLand ? el('p', { class: 'note', text: `A new age is a new land. Your people set out for ${newLand}, and the town starts over empty. Your hero, coins, creatures, class halls and villagers come along, and a settler's purse pays for the first homes.` }) : null,
        el('div', { class: 'actions' },
          el('button', { class: 'btn primary', disabled: !affordable, onclick: () => { close(); onBuild(); } },
            el('span', {}, `Build the ${name}`, el('small', { text: newLand ? `Then set out for ${newLand}` : 'New buildings, more land, a new look for your town' })), el('span', { class: 'cost' }, price(cost)))),
        affordable ? null : el('p', { class: 'note', text: 'Keep collecting. Handing in work and opening chests gets you there faster.' }),
      );
    },

    travel({ title, subtitle, label, onGo }) {
      panel({ title, subtitle }, el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: () => { close(); onGo(); } }, el('span', { text: label }))));
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

    school({ source, connected, groups, chests, synced, onDemo, onClear, onStudy, onIgnore }) {
      const describe = { none: 'Not connected', demo: 'Sample semester', soma: 'Soma for Canvas', manual: 'Your own list' }[source];
      const rows = groups.flatMap((g) => [
        el('div', { class: 'course', text: g.course }),
        ...g.items.map((a) => el('div', { class: `row ${a.submitted ? 'done' : ''} ${a.ignored ? 'ignored' : ''} ${a.late ? 'late' : ''}` },
          el('div', {}, a.name, a.kind === 'boss' ? el('span', { class: 'tag', text: 'Boss' }) : null,
            el('small', { text: a.status }),
            a.submitted ? null : el('div', { class: 'bar study', title: 'Studied' }, el('i', { style: `width:${Math.round(a.studied * 100)}%` }))),
          a.submitted ? null : el('div', { class: 'do' },
            a.ignored ? null : el('button', { class: 'btn small', text: a.studied >= 1 ? 'Study more' : 'Study', onclick: () => onStudy(a.id) }),
            el('button', { class: 'btn small', title: a.ignored ? 'Count this assignment again' : 'Nothing to hand in for this one? Stop its warnings and losses.', text: a.ignored ? 'Unignore' : 'Ignore', onclick: () => onIgnore(a.id, !a.ignored) })))),
      ]);
      panel({ title: 'Canvas', subtitle: `${describe}${connected ? ' · extension found' : ''}. Every assignment is a walking book marching on your gate; hand it in on Canvas and it's gone. Late work costs 1% of your coins and some XP every hour until it's in. Ignore anything with nothing to submit. Exams are armored bosses: study to break their armor before exam day. Each posted grade drops a chest.`, wide: true },
        el('p', { class: 'note sync', text: source === 'soma'
          ? 'This is the Canvas data Soma already has for your account. Hand-ins and grades show up here by themselves; there is nothing to type in.'
          : 'This is a sample semester. Connect Canvas in Soma (Deadlines, then Soma for Canvas) and your real due dates, hand-ins and grades replace it by themselves. Nothing to type in.' }),
        chests ? el('p', { class: 'note', style: 'margin:0 0 6px', text: `${chests} chest${chests === 1 ? '' : 's'} waiting on your plaza.` }) : null,
        rows.length ? rows : el('p', { class: 'note', text: 'Nothing due right now.' }),
        el('div', { class: 'source', style: 'margin-top:14px' },
          source === 'soma' ? null : el('button', { class: 'btn small', text: 'Restart the sample semester', onclick: onDemo }),
          source === 'soma' ? el('button', { class: 'btn small', text: 'Sync now', onclick: onClear }) : null,
          source === 'soma' && synced ? el('span', { class: 'synced', text: `Last synced ${synced} ago` }) : null),
      );
    },

    /** The character sheet: level, stats, gear, bag and skills. */
    hero({ level, xp, need, capped, points, stats, gear, bag, bagSize, skills, masteries, characters = [], character, onCharacter, onEquip, onSell, onSkill, onWardrobe, onStyle, onStudy }) {
      const branches = [...new Set(skills.map((k) => k.branch))];
      panel({ title: `Level ${level} hero`, subtitle: 'Experience only comes from school: study sessions, handing work in, grades and exams. Fighting pays coins and gear.', wide: true },
        el('div', { class: 'xp-row' },
          el('div', { class: 'bar xp' }, el('i', { style: `width:${capped ? 100 : Math.min(100, (xp / need) * 100)}%` })),
          el('span', { text: capped ? 'Max level' : `${xp} / ${need} XP to level ${level + 1}` }),
          el('button', { class: 'btn small primary', text: 'Study to level up', onclick: onStudy })),
        el('div', { class: 'stats four' },
          el('div', { class: 'stat' }, el('small', { text: 'Damage' }), el('b', { text: fmt(stats.might) })),
          el('div', { class: 'stat' }, el('small', { text: 'Health' }), el('b', { text: fmt(stats.health) })),
          el('div', { class: 'stat' }, el('small', { text: 'Critical hits' }), el('b', { text: `${Math.round(stats.crit * 100)}%` })),
          el('div', { class: 'stat' }, el('small', { text: 'Study XP' }), el('b', { text: `×${stats.studyXp.toFixed(2)}` }))),
        characters.length ? el('h3', { text: 'Character' }) : null,
        characters.length ? el('div', { class: 'cards characters' }, characters.map((c) => el('button', { class: `card ${c.id === character ? 'on' : ''}`, onclick: () => onCharacter(c.id) }, el('b', { text: c.name }), el('small', { text: c.id === character ? 'Playing' : 'Pick' })))) : null,
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
        el('div', { class: 'source', style: 'margin-top:14px' }, el('button', { class: 'btn small', text: 'Wardrobe', onclick: onWardrobe }), onStyle ? el('button', { class: 'btn small primary', text: 'Style: outfits and town themes', onclick: onStyle }) : null),
      );
    },

    /** The quest log: the story quest, then every piece of schoolwork as a quest. */
    quests({ story, done, total, level, school, onStudy, onPractice }) {
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
          el('div', {}, el('b', {}, a.name, a.kind === 'boss' ? el('span', { class: 'tag', text: 'Exam' }) : null),
            el('small', { text: `${a.course} · ${a.overdue ? a.time : `due in ${a.time}`}` }),
            el('div', { class: 'bar study' }, el('i', { style: `width:${Math.round(a.studied * 100)}%` }))),
          el('div', { class: 'quest-pay' },
            el('small', { text: `Study ${a.goal} min: +${a.studyXp} XP` }),
            el('small', { text: a.kind === 'boss' ? `Armor ${Math.round((1 - a.studied) * 100)}%: break it before exam day` : `Hand in: +${a.handInXp} XP` }),
            el('small', { text: 'Grade posted: chest + XP' }),
            el('button', { class: 'btn small primary', text: 'Study', onclick: () => onStudy(a.id) }),
            onPractice ? el('button', { class: 'btn small', text: 'Practice', onclick: () => onPractice(a.id) }) : null)))
          : el('p', { class: 'note', text: 'Nothing due right now. Free study still gives XP.' }),
      );
    },

    /**
     * A round of AI practice questions. load() resolves { questions, files };
     * finish(right, wrong) pays for the round and returns a line to show.
     */
    practice({ name, course, armor, load, finish, again, onAnswer, title, loading }) {
      const body = el('div', { class: 'practice' }, el('p', { class: 'note loading', text: loading || `Soma is writing questions from your ${course} notes…` }));
      panel({ title: title || `Practice: ${name}`, subtitle: `${course}${armor != null ? ` · armor ${Math.round(armor * 100)}%` : ''}`, wide: true }, body);
      let right = 0, wrong = 0, paid = false;
      const pay = () => { if (!paid && right + wrong) { paid = true; return finish(right, wrong); } return null; };
      // Closing midway still pays for what was answered.
      open.onClose = () => { pay(); };
      load().then(({ questions, files }) => {
        if (!open) return;
        const show = (i) => {
          if (i >= questions.length) {
            const line = pay();
            body.replaceChildren(
              el('div', { class: 'practice-score' }, el('b', { text: `${right} / ${questions.length}` }), el('span', { text: 'right' })),
              line ? el('p', { class: 'note', text: line }) : null,
              el('div', { class: 'actions' },
                el('button', { class: 'btn primary', onclick: () => { close(); again(); } }, el('span', { text: 'Another round' })),
                el('button', { class: 'btn', onclick: close }, el('span', { text: 'Done' }))));
            return;
          }
          const q = questions[i];
          const why = el('p', { class: 'note why', hidden: true });
          const next = el('button', { class: 'btn primary', hidden: true, onclick: () => show(i + 1) }, el('span', { text: i + 1 < questions.length ? 'Next question' : 'See score' }));
          const choices = q.choices.map((text, k) => el('button', { class: 'choice', onclick: () => {
            if (choices.some((c) => c.disabled)) return;
            choices.forEach((c, j) => { c.disabled = true; if (j === q.answer) c.classList.add('right'); });
            if (k === q.answer) right += 1;
            else { wrong += 1; choices[k].classList.add('wrong'); }
            onAnswer?.(q, k === q.answer);
            why.textContent = `${k === q.answer ? 'Right. ' : 'Not quite. '}${q.why || ''}`;
            why.hidden = false;
            next.hidden = false;
          } }, el('i', { text: 'ABCD'[k] }), el('span', { text })));
          body.replaceChildren(
            el('small', { class: 'practice-count', text: `Question ${i + 1} of ${questions.length}${q.from ? ` · missed on ${q.from}` : ''}${files.length ? ` · from ${files.slice(0, 2).join(', ')}${files.length > 2 ? ` +${files.length - 2}` : ''}` : ''}` }),
            el('h3', { class: 'practice-q', text: q.q }),
            el('div', { class: 'choices' }, choices), why, el('div', { class: 'actions' }, next));
        };
        show(0);
      }).catch((error) => {
        if (!open) return;
        body.replaceChildren(el('p', { class: 'note', text: error.message || 'Practice is not available right now.' }), el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: close }, el('span', { text: 'Close' }))));
      });
    },

    /** Settings: sound, music, controls and graphics. Changes apply as you make them. */
    settings({ values, onChange, onHelp }) {
      const v = { ...values };
      const toggle = (key, label, hint) => {
        const b = el('button', { class: `switch ${v[key] !== false ? 'on' : ''}`, role: 'switch', 'aria-checked': String(v[key] !== false), onclick: () => {
          v[key] = v[key] === false;
          b.classList.toggle('on', v[key]);
          b.setAttribute('aria-checked', String(v[key]));
          onChange(key, v[key]);
        } }, el('i'));
        return el('div', { class: 'setting' }, el('div', {}, el('b', { text: label }), hint ? el('small', { text: hint }) : null), b);
      };
      const slider = (key, label, min, max, stepSize, show) => {
        const out = el('em', { text: show(v[key]) });
        const input = el('input', { type: 'range', min, max, step: stepSize, value: v[key] });
        input.addEventListener('input', () => { v[key] = Number(input.value); out.textContent = show(v[key]); onChange(key, v[key]); });
        return el('div', { class: 'setting' }, el('div', {}, el('b', { text: label })), el('div', { class: 'slider' }, input, out));
      };
      const pct = (x) => `${Math.round(x * 100)}%`;
      const quality = el('div', { class: 'segmented' }, [['auto', 'Auto'], [0, 'High'], [1, 'Medium'], [2, 'Low']].map(([val, text]) => {
        const b = el('button', { class: v.quality === val ? 'on' : '', text, onclick: () => {
          v.quality = val;
          quality.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          onChange('quality', val);
        } });
        return b;
      }));
      panel({ title: 'Settings', subtitle: 'Changes save as you make them. Esc or O opens this any time.' },
        el('h3', { text: 'Sound' }),
        (() => {
          // On means muted here, the opposite of the other switches.
          const b = el('button', { class: `switch ${v.muted ? 'on' : ''}`, role: 'switch', 'aria-checked': String(Boolean(v.muted)), onclick: () => { v.muted = !v.muted; b.classList.toggle('on', v.muted); b.setAttribute('aria-checked', String(v.muted)); onChange('muted', v.muted); } }, el('i'));
          return el('div', { class: 'setting' }, el('div', {}, el('b', { text: 'Mute everything' }), el('small', { text: 'Same as pressing M' })), b);
        })(),
        toggle('music', 'Music', 'A calm tune in town, a softer one while you study'),
        slider('musicVol', 'Music volume', 0, 1, 0.05, pct),
        toggle('sfx', 'Sound effects'),
        slider('sfxVol', 'Effects volume', 0, 1, 0.05, pct),
        el('h3', { text: 'Controls' }),
        slider('sensitivity', 'Mouse look speed', 0.3, 2.5, 0.1, (x) => `${x.toFixed(1)}×`),
        el('p', { class: 'note', text: 'Hold right click to look around · scroll to zoom · V locks the mouse' }),
        el('h3', { text: 'Display' }),
        el('div', { class: 'setting' }, el('div', {}, el('b', { text: 'Graphics' }), el('small', { text: 'Auto lowers detail if the game runs slow' })), quality),
        toggle('labels', 'Name tags', 'The labels over assignments, buildings and halls'),
        el('div', { class: 'actions', style: 'margin-top:12px' }, el('button', { class: 'btn', onclick: onHelp }, el('span', { text: 'Controls and how to play' }))),
      );
    },

    /** Talking to a villager: what they say, how they feel, their quest for today. */
    villager({ name, role, mood, friend, line, quest, gift, onClaim, onGift }) {
      const feel = mood >= 70 ? ['Happy', '😊'] : mood >= 45 ? ['Fine', '🙂'] : mood >= 25 ? ['Worried', '😟'] : ['About to leave', '😣'];
      const bond = friend >= 80 ? 'Best friend' : friend >= 50 ? 'Friend' : friend >= 20 ? 'Friendly' : 'New neighbour';
      const ready = quest && !quest.done && quest.have >= quest.need;
      panel({ title: name, subtitle: `${role} · ${bond}` },
        el('blockquote', { class: 'npc-line', text: `“${line}”` }),
        el('div', { class: 'stats' },
          el('div', { class: 'stat' }, el('small', { text: 'Mood' }), el('b', { text: `${feel[1]} ${feel[0]}` }), el('div', { class: 'bar' }, el('i', { style: `width:${mood}%` }))),
          el('div', { class: 'stat' }, el('small', { text: 'Friendship' }), el('b', { text: `${Math.round(friend)} / 100` }), el('div', { class: 'bar xp' }, el('i', { style: `width:${friend}%` })))),
        el('h3', { text: 'Today’s favour' }),
        quest ? el('div', { class: `quest-card ${quest.done ? 'done' : ''}` },
          el('div', {}, el('b', { text: quest.text }),
            el('div', { class: 'bar study' }, el('i', { style: `width:${Math.round((Math.min(quest.have, quest.need) / quest.need) * 100)}%` })),
            el('small', { text: quest.done ? 'Done for today. Come back tomorrow.' : `${Math.min(quest.have, quest.need)} / ${quest.need}` })),
          el('div', { class: 'quest-pay' }, el('small', {}, 'Reward ', price(quest.reward)), el('small', { text: '+ friendship' }),
            ready ? el('button', { class: 'btn small primary', text: 'Hand it over', onclick: onClaim }) : null))
          : el('p', { class: 'note', text: 'Nothing today. Come back tomorrow.' }),
        gift ? el('div', { class: 'actions', style: 'margin-top:10px' }, el('button', { class: 'btn', onclick: onGift }, el('span', {}, 'Accept a gift', el('small', { text: 'Good friends leave you something once a day' })))) : null,
        el('p', { class: 'note', text: mood < 30 ? 'Late work and wrecked buildings wear people down. Hand things in and hold the gate on exam day to keep them here.' : 'Do their favours to become friends. Friends leave gifts, and best friends bring study tea.' }),
      );
    },

    /** The morning report: what happened, what's coming, and today's three quests. */
    morning({ title, away, due, exam, reviews, people, sad, quests, streak, best, lures, onGo }) {
      const lines = [];
      if (away) lines.push(el('li', {}, `While you were away (${away.time}) your town made `, price(away.coins), '.'));
      if (exam) lines.push(el('li', { class: exam.armor > 60 ? 'warn' : '' }, el('b', { text: exam.name }), ` (${exam.course}) reaches your gate in ${exam.time} with `, el('b', { text: `${exam.armor}% armor` }), exam.armor > 20 ? '. Study to break it.' : '. Your gate should hold.'));
      for (const d of due) lines.push(el('li', { class: d.late ? 'warn' : '' }, el('b', { text: d.name }), ` · ${d.course} · ${d.late ? d.time : `due ${d.time}`}`));
      if (reviews) lines.push(el('li', { text: `${reviews} missed question${reviews === 1 ? '' : 's'} waiting by the board.` }));
      if (sad.length) lines.push(el('li', { class: 'warn', text: `${sad.join(' and ')} ${sad.length === 1 ? 'is' : 'are'} thinking of leaving town.` }));
      else if (people) lines.push(el('li', { text: `${people} villager${people === 1 ? '' : 's'} in town, all doing fine.` }));
      if (!lines.length) lines.push(el('li', { text: 'Nothing urgent. A good day to get ahead.' }));
      panel({ title, subtitle: streak ? `🔥 ${streak}-day streak · best ${best}` : 'Finish all three quests to start a streak' },
        el('ul', { class: 'report' }, lines),
        el('h3', { text: 'Today’s quests' }),
        el('div', { class: 'daily-list' }, quests.map((q) => el('div', { class: `daily-row big ${q.have >= q.need ? 'done' : ''}` }, el('i'), el('span', { text: q.text }), el('small', {}, q.have >= q.need ? '✓ ' : `${q.have}/${q.need} · `, price(q.reward))))),
        el('p', { class: 'note', text: `All three keep your streak alive and drop a chest. Days 7, 14 and 30 pay big. You have ${lures} lure${lures === 1 ? '' : 's'} for catching creatures (K).` }),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', style: 'justify-content:center', onclick: onGo }, el('span', { text: 'Let’s go' }))),
      );
    },

    /** The creature book: what you've caught, hints for the rest, and your pet. */
    collection({ lures, pet, list, onPet }) {
      const found = list.filter((c) => c.count).length;
      panel({ title: 'Creatures', subtitle: `${found} of ${list.length} found · ${lures} lure${lures === 1 ? '' : 's'} · every 10 minutes of study earns one`, wide: true },
        el('div', { class: 'gear-row critters' }, list.map((c) => el('div', { class: `gear g-${c.rarity} ${c.count ? '' : 'unknown'} ${pet === c.id ? 'pet' : ''}` },
          el('small', { text: `${c.rarity}${pet === c.id ? ' · your pet' : ''}` }),
          el('b', { text: c.count ? c.name : '???' }),
          el('span', { text: c.count ? `Caught ${c.count} · as a pet: +${c.bonus}% study XP` : c.hint }),
          c.count ? el('div', { class: 'gear-do' }, pet === c.id ? el('button', { class: 'btn small', text: 'Put away', onclick: () => onPet(null) }) : el('button', { class: 'btn small primary', text: 'Make pet', onclick: () => onPet(c.id) })) : null))),
        el('p', { class: 'note', text: 'Find them in the Wilds. Walk up slowly (running scares them) and press E. Owls, moths and the star fox only come out at night, on your real clock.' }),
      );
    },

    /** Soma's Watchtower: syllabus work Canvas doesn't show, the week's plan, and the Oracle. */
    watchtower({ status, readings, hidden, plan, upgrade, onRead, onToggle, onOracle, onAccept }) {
      if (status !== 'plus') {
        const offline = status === 'offline';
        panel({ title: 'Watchtower', subtitle: offline ? 'Open the game from Soma, signed in, to connect it' : 'Soma Plus sees what Canvas doesn’t', wide: true },
          el('div', { class: 'watch-hero' },
            el('b', { text: offline ? 'Your syllabus has more than Canvas shows' : `${hidden} thing${hidden === 1 ? '' : 's'} from your syllabus ${hidden === 1 ? 'is' : 'are'} marching in the fog` }),
            el('p', { text: 'Readings, in-class quizzes and paper work that teachers never post on Canvas. Soma reads them from your syllabus.' })),
          el('div', { class: 'perks' }, [
            ['Shadows revealed', 'Syllabus work Canvas doesn’t show marches in as shadow books you can see, study for and mark read.'],
            ['Your plan is your quests', 'Each day’s tasks from Soma’s AI planner become your daily quests. Check them off here or in Soma.'],
            ['The Oracle', 'Ask it to plan your week around what’s due. You approve every task before it lands in your plan.'],
            ['AI practice', 'Practice questions written from your own course notes. Right answers break exam armor.'],
          ].map(([t, d]) => el('div', { class: 'perk' }, el('b', { text: t }), el('span', { text: d })))),
          offline ? el('p', { class: 'note', text: 'Everything else in the game works without it.' })
            : el('div', { class: 'actions' }, el('button', { class: 'btn primary', style: 'justify-content:center', onclick: () => window.open(upgrade, '_blank') }, el('span', { text: 'See Soma Plus' }))),
        );
        return;
      }
      const oracle = el('div', { class: 'oracle' });
      const ask = el('input', { type: 'text', placeholder: 'Anything to plan around? (optional) e.g. “midterm Thursday, busy weekend”', maxlength: 200 });
      const drawOracle = (state, data) => {
        if (state === 'idle') oracle.replaceChildren(el('div', { class: 'oracle-ask' }, ask, el('button', { class: 'btn primary', onclick: run }, el('span', { text: 'Ask the Oracle' }))));
        else if (state === 'busy') oracle.replaceChildren(el('p', { class: 'note loading', text: 'The Oracle is reading your week…' }));
        else if (state === 'error') oracle.replaceChildren(el('p', { class: 'note', text: data }), el('button', { class: 'btn small', text: 'Try again', onclick: () => drawOracle('idle') }));
        else if (state === 'offer') {
          const picks = data.tasks.map(() => true);
          const list = el('div', { class: 'oracle-list' }, data.tasks.map((t, i) => {
            const box = el('button', { class: 'tick on', onclick: () => { picks[i] = !picks[i]; box.classList.toggle('on', picks[i]); } });
            return el('div', { class: 'oracle-task' }, box, el('span', {}, el('b', { text: t.text }), el('small', { text: `${new Date(`${t.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${t.minutes ? ` · ${t.minutes} min` : ''}${t.course ? ` · ${t.course}` : ''}` })));
          }));
          oracle.replaceChildren(
            data.note ? el('p', { class: 'oracle-note', text: `“${data.note}”` }) : null,
            list,
            el('div', { class: 'actions' },
              el('button', { class: 'btn primary', onclick: async () => {
                const chosen = data.tasks.filter((_, i) => picks[i]);
                if (!chosen.length) return drawOracle('idle');
                drawOracle('busy');
                try { await onAccept(chosen); close(); } catch { drawOracle('error', 'Could not add them to Soma. Try again.'); }
              } }, el('span', { text: 'Add to my Soma plan' })),
              el('button', { class: 'btn', onclick: () => drawOracle('idle') }, el('span', { text: 'Not these' }))),
          );
        }
      };
      async function run() {
        drawOracle('busy');
        try {
          const out = await onOracle(ask.value.trim());
          if (!out.tasks.length) return drawOracle('error', 'The Oracle had nothing to add. Your week looks covered.');
          drawOracle('offer', out);
        } catch (error) { drawOracle('error', error.message); }
      }
      drawOracle('idle');
      panel({ title: 'Watchtower', subtitle: 'Soma Plus · what Canvas doesn’t show, and your plan', wide: true },
        el('h3', { text: `Not on Canvas (${readings.length})` }),
        readings.length ? el('div', { class: 'watch-list' }, readings.map((r) => el('div', { class: `watch-row ${r.late ? 'late' : ''}` },
          el('span', {}, el('b', { text: r.name }), el('small', { text: `${r.course} · ${r.late ? 'behind since' : 'due'} ${new Date(`${r.due}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` })),
          el('button', { class: 'btn small', text: 'Mark read', onclick: () => onRead(r.id) }))))
          : el('p', { class: 'note', text: 'Nothing from your syllabus is coming up. Add a syllabus in Soma and its readings show up here.' }),
        el('h3', { text: 'Your plan this week' }),
        plan.length ? el('div', { class: 'watch-plan' }, plan.map((d) => el('div', { class: 'plan-day' }, el('small', { text: d.label }),
          d.list.map((t) => {
            const tick = el('button', { class: `tick ${t.done ? 'on' : ''}`, onclick: () => { t.done = !t.done; tick.classList.toggle('on', t.done); onToggle(t.id, t.done); } });
            return el('div', { class: 'plan-task' }, tick, el('span', { text: t.text }), t.minutes ? el('em', { text: `${t.minutes}m` }) : null);
          }))))
          : el('p', { class: 'note', text: 'No plan yet. Ask the Oracle below.' }),
        el('h3', { text: 'The Oracle' }),
        oracle,
      );
    },

    /** The Semester Pass: a reward path filled by studying. thumb(reward) resolves to an image. */
    pass({ season, tier, tiers, points, per, premium, rows, thumb, onClaim, onClaimAll }) {
      const into = points - tier * per;
      const img = (reward) => {
        const i = el('img', { class: 'thumb', alt: '' });
        thumb(reward).then((src) => { i.src = src; }).catch(() => {});
        return i;
      };
      const card = (r, t, track) => {
        const reached = t <= tier;
        const locked = track === 'premium' && !premium;
        const ready = reached && !r.claimed && !locked;
        return el('div', { class: `pass-card ${track} ${r.claimed ? 'claimed' : ''} ${ready ? 'ready' : ''} ${reached ? '' : 'ahead'} ${locked ? 'locked' : ''} r-${r.rarity || ''} k-${r.kind}` },
          img(r),
          el('b', { text: r.name }),
          ready ? el('button', { class: 'btn small primary', text: 'Claim', onclick: () => onClaim(t, track) })
            : el('small', { text: r.claimed ? 'Claimed' : locked ? 'Premium' : `Tier ${t}` }));
      };
      const track = el('div', { class: 'pass-track' }, rows.map((row) => el('div', { class: `pass-col ${row.tier <= tier ? 'reached' : ''} ${row.tier === tier + 1 ? 'next' : ''}` },
        el('em', { text: String(row.tier) }),
        card(row.free, row.tier, 'free'),
        card(row.premium, row.tier, 'premium'))));
      const claimable = rows.some((r) => r.tier <= tier && (!r.free.claimed || (premium && !r.premium.claimed)));
      panel({ title: `Semester Pass · ${season}`, subtitle: 'Filled only by studying: a point a minute, plus practice, review and daily quests', wide: true },
        el('div', { class: 'pass-head' },
          el('div', { class: 'pass-tier' }, el('small', { text: 'Tier' }), el('b', { text: `${tier}` }), el('span', { text: `of ${tiers}` })),
          el('div', { class: 'pass-progress' },
            el('div', { class: 'bar xp' }, el('i', { style: `width:${tier >= tiers ? 100 : Math.round((into / per) * 100)}%` })),
            el('small', { text: tier >= tiers ? 'Pass complete' : `${Math.max(0, per - into)} points to tier ${tier + 1} · about ${Math.max(1, per - into)} minutes of study` })),
          claimable ? el('button', { class: 'btn primary', text: 'Claim all', onclick: onClaimAll }) : null),
        el('div', { class: 'pass-rows' }, el('div', { class: 'pass-legend' }, el('span', { text: 'Free' }), el('span', { class: 'prem', text: 'Premium' })), track),
        premium ? null : el('div', { class: 'pass-upsell' },
          el('div', {}, el('b', { text: 'Premium track' }), el('span', { text: 'The Frost Knight, the whole Japanese garden set and a chest at every tier. You still earn it by studying; nothing skips ahead.' })),
          el('button', { class: 'btn', disabled: true }, el('span', {}, 'Coming soon', el('small', { text: 'Payments open soon' })))),
      );
      // Start the track at the next tier.
      requestAnimationFrame(() => { const next = track.querySelector('.pass-col.next') || track.querySelector('.pass-col:last-child'); if (next) track.scrollLeft = next.offsetLeft - 120; });
    },

    /** Style: outfits (try on in the dressing room) and town themes. */
    style({ outfits, themes, thumb, onTry, onWear, onTheme, onPass }) {
      const img = (reward) => { const i = el('img', { class: 'thumb', alt: '' }); thumb(reward).then((src) => { i.src = src; }).catch(() => {}); return i; };
      panel({ title: 'Style', subtitle: 'Outfits and town themes. They only change how things look.', wide: true },
        el('h3', { text: 'Outfits' }),
        el('div', { class: 'style-grid' }, outfits.map((o) => el('div', { class: `style-card ${o.on ? 'on' : ''} ${o.owned ? '' : 'locked'}` },
          img({ kind: 'outfit', id: o.id }),
          el('b', { text: o.name }), el('span', { text: o.text }),
          el('div', { class: 'gear-do' },
            el('button', { class: 'btn small', text: 'Try on', onclick: () => onTry(o.id) }),
            o.owned ? (o.on ? el('em', { text: 'Wearing' }) : el('button', { class: 'btn small primary', text: 'Wear', onclick: () => onWear(o.id) })) : el('small', { text: 'Semester Pass' }))))),
        el('h3', { text: 'Town themes' }),
        el('div', { class: 'style-grid' }, themes.map((t) => el('div', { class: `style-card ${t.on ? 'on' : ''} ${t.owned ? '' : 'locked'}` },
          img({ kind: 'theme', id: t.id }),
          el('b', { text: t.name }), el('span', { text: t.text }),
          el('div', { class: 'gear-do' }, t.owned ? el('button', { class: `btn small ${t.on ? '' : 'primary'}`, text: t.on ? 'Turn off' : 'Turn on', onclick: () => onTheme(t.id) }) : el('small', { text: 'Semester Pass, free track, tier 20' }))))),
        el('div', { class: 'actions', style: 'margin-top:12px' }, el('button', { class: 'btn', onclick: onPass }, el('span', { text: 'Open the Semester Pass (Y)' }))),
      );
    },

    /** The dressing room: the camera circles the hero wearing the outfit. */
    dressing({ name, text, owned, onWear, onBack }) {
      const bar = el('div', { class: 'dressing' },
        el('div', {}, el('small', { text: 'Dressing room' }), el('b', { text: name }), el('span', { text: text })),
        owned ? el('button', { class: 'btn primary', onclick: () => { bar.remove(); onWear(); } }, el('span', { text: 'Wear it' })) : el('em', { text: 'From the Semester Pass' }),
        el('button', { class: 'btn', onclick: () => { bar.remove(); onBack(); } }, el('span', { text: owned ? 'Back' : 'Take it off' })));
      document.body.append(bar);
    },

    /** An assignment's steps: its minions. Finish them one by one. */
    steps({ name, course, due, late, steps, fromSoma, template, onBreak, onDone, onStudy }) {
      const done = steps.filter((x) => x.done).length;
      if (!steps.length) {
        // Not split yet: offer the template, editable.
        const rows = template.map((t) => el('input', { type: 'text', value: t, maxlength: 80 }));
        const list = el('div', { class: 'step-edit' }, rows);
        panel({ title: name, subtitle: `${course} · ${late ? `${due} late` : `due in ${due}`}` },
          el('p', { class: 'note', text: 'Split it into steps. Each step joins it as a small monster; finish a step and that monster goes down. The big one only falls when you hand it in on Canvas.' }),
          list,
          el('div', { class: 'actions', style: 'gap:8px' },
            el('button', { class: 'btn small', text: '+ step', onclick: () => { if (list.children.length < 8) list.append(el('input', { type: 'text', value: '', placeholder: 'Another step', maxlength: 80 })); } }),
            el('button', { class: 'btn primary', onclick: () => onBreak([...list.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean)) }, el('span', { text: 'Split it' })),
            el('button', { class: 'btn', onclick: onStudy }, el('span', { text: 'Just study for it' }))));
        return;
      }
      panel({ title: name, subtitle: `${course} · ${late ? `${due} late` : `due in ${due}`} · ${done} of ${steps.length} steps done${fromSoma ? ' · from your Soma plan' : ''}` },
        el('div', { class: 'step-list' }, steps.map((x, i) => el('div', { class: `step-row ${x.done ? 'done' : ''}` },
          el('em', { text: String(i + 1) }), el('span', { text: x.text }),
          x.done ? el('small', { text: 'Done' }) : el('button', { class: 'btn small primary', text: 'Done', onclick: () => onDone(x.id) })))),
        el('div', { class: 'actions', style: 'margin-top:10px' }, el('button', { class: 'btn', onclick: onStudy }, el('span', { text: 'Start a study session on it' }))),
      );
    },

    /** An exam's weak points: one crystal per topic. */
    exam({ name, course, time, armor, topics, suggestions, plus, onTopics, onStudy, onPractice }) {
      const editing = el('div', { class: 'topic-edit' });
      const drawEdit = () => {
        const field = el('input', { type: 'text', placeholder: 'A topic on this exam, e.g. "Eigenvectors"', maxlength: 60 });
        const add = () => { const v = field.value.trim(); if (v) onTopics([...topics.map((t) => t.name), v]); };
        field.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        const unused = suggestions.filter((sg) => !topics.some((t) => t.name.toLowerCase() === sg.toLowerCase()));
        editing.replaceChildren(...[
          el('div', { class: 'oracle-ask' }, field, el('button', { class: 'btn small primary', text: 'Add', onclick: add })),
          unused.length ? el('div', { class: 'chips' }, el('small', { text: 'From your syllabus:' }), unused.map((sg) => el('button', { class: 'chip', text: `+ ${sg}`, onclick: () => onTopics([...topics.map((t) => t.name), sg]) }))) : null,
        ].filter(Boolean));
      };
      drawEdit();
      panel({ title: name, subtitle: `${course} · reaches town in ${time} · armor ${armor}%`, wide: true },
        topics.length ? el('p', { class: 'note', text: 'Each topic is a glowing crystal on the boss. Study, practice or review a topic to break its crystal (25 minutes each). Topics you skip stay as weak points on exam day.' })
          : el('p', { class: 'note', text: 'What’s on this exam? Add its topics and each becomes a crystal on the boss, so you can see exactly what you haven’t studied yet.' }),
        el('div', { class: 'topic-list' }, topics.map((t) => el('div', { class: `topic-row ${t.pct >= 100 ? 'broken' : ''}` },
          el('i', { class: 'crystal' }),
          el('div', {}, el('b', { text: t.name }), el('div', { class: 'bar' }, el('i', { style: `width:${t.pct}%` }))),
          t.pct >= 100 ? el('small', { text: 'Broken' }) : el('div', { class: 'topic-do' },
            [10, 25].map((m) => el('button', { class: 'btn small', text: `Study ${m}m`, onclick: () => onStudy(t.name, m) })),
            el('button', { class: 'btn small primary', text: 'Practice', title: plus ? 'AI questions on this topic' : 'Needs Soma Plus', onclick: () => onPractice(t.name) })),
          el('button', { class: 'x-small', title: 'Remove', text: '×', onclick: () => onTopics(topics.filter((o) => o.name !== t.name).map((o) => o.name)) })))),
        topics.length < 6 ? editing : null,
      );
    },

    /** The Vault: every collectible by tier, with the real odds and the pity counters. */
    vault({ found, total, sinceEpic, sinceMythic, pityEpic, pityMythic, waiting, table, tiers, thumb, onUse, onOpenChest }) {
      const pct = (x) => (x >= 1 ? `${Math.round(x)}%` : `${x}%`);
      const verb = { hat: 'Wear', aura: 'Equip', pet: 'Make pet', decor: 'Place (B)', trophy: 'On display' };
      const offVerb = { hat: 'Take off', aura: 'Unequip', pet: 'Put away' };
      panel({ title: 'The Vault', subtitle: `${found} of ${total} rare finds · every chest comes from studying`, wide: true },
        el('div', { class: 'vault-head' },
          el('div', { class: 'pity' }, el('small', { text: 'Epic or better' }), el('b', { text: `within ${Math.max(1, pityEpic - sinceEpic)} chests` }), el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((sinceEpic / pityEpic) * 100)}%` }))),
          el('div', { class: 'pity mythic' }, el('small', { text: 'Mythic guaranteed' }), el('b', { text: `within ${Math.max(1, pityMythic - sinceMythic)} chests` }), el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((sinceMythic / pityMythic) * 100)}%` }))),
          el('button', { class: 'btn primary', disabled: !waiting, onclick: onOpenChest }, el('span', {}, waiting ? `Open a chest (${waiting})` : 'No chests waiting', el('small', { text: waiting ? 'The best one first' : 'Study, finish steps, practice' })))),
        tiers.map(({ tier, items }) => el('section', { class: `vault-tier t-${tier}` },
          el('div', { class: 'tier-head' },
            el('b', { text: tier }),
            el('small', { text: `Odds per collectible: ${['common', 'rare', 'epic', 'legendary'].map((r) => `${r} chest ${pct(table[r].odds[tier])}`).join(' · ')}` })),
          el('div', { class: 'vault-grid' }, items.map((it) => {
            const img = el('img', { class: 'thumb', alt: '' });
            thumb(it.id).then((src) => { img.src = src; }).catch(() => {});
            return el('div', { class: `vault-card ${it.count ? 'owned' : 'unknown'} ${it.on ? 'on' : ''}` },
              img,
              el('b', { text: it.count ? it.name : '???' }),
              el('small', { text: it.count ? `${it.kind}${it.count > 1 ? ` · ×${it.count}` : ''}` : it.kind }),
              it.count ? el('span', { text: it.text }) : null,
              it.count && it.kind !== 'trophy' ? el('button', { class: `btn small ${it.on ? '' : 'primary'}`, text: it.on ? offVerb[it.kind] : verb[it.kind], onclick: () => onUse(it.id) }) : null);
          })))),
        el('p', { class: 'note', text: `How chests are earned: study sessions, every 3rd step you finish, hand-ins, grades, perfect practice rounds, learned reviews, broken weak points and streak days. A collectible's tier is rolled with the odds above; duplicates turn into coins. Nothing here can be bought.` }),
      );
    },

    /** The market: today's stock, plus selling what you don't need. */
    market({ coins, offers, junk, onBuy, onSellJunk, showcase = [], onVault }) {
      const label = (o) => o.kind === 'gear' ? o.item.name : o.kind === 'look' ? o.name : o.kind === 'tea' ? 'Study tea' : o.name;
      const picture = (o) => { const i = el('img', { class: 'thumb', alt: '' }); o.picture?.then((src) => { i.src = src; }).catch(() => {}); return i; };
      const detail = (o) => o.kind === 'gear' ? `${o.item.rarity} ${SLOT_NAMES[o.item.slot].toLowerCase()} · level ${o.item.level} · ${gearStat(o.item)}`
        : o.kind === 'look' ? 'A new look for your hero (Wardrobe)'
          : o.kind === 'tea' ? 'Your next study session pays 50% more XP'
            : o.kind === 'chest' ? `Today's chest, bought with coins. Can hold anything from the Vault${o.rarity === 'legendary' ? ', even a mythic' : ''}.` : 'A rare decoration for build mode (B)';
      panel({ title: 'Market', subtitle: `New stock every day · you have ${fmt(coins)} coins`, wide: true },
        el('div', { class: 'gear-row market' }, offers.map((o, i) => el('div', { class: `gear ${o.kind === 'gear' ? `g-${o.item.rarity}` : o.kind === 'chest' ? `g-${o.rarity}` : 'g-rare'} ${o.sold ? 'sold' : ''} k-${o.kind}` },
          picture(o),
          el('small', { text: o.kind === 'gear' ? 'Gear' : o.kind === 'look' ? 'Look' : o.kind === 'tea' ? 'Potion' : o.kind === 'chest' ? 'Chest of the day' : 'Decoration' }),
          el('b', { text: label(o) }),
          el('span', { text: detail(o) }),
          el('div', { class: 'gear-do' }, o.sold ? el('em', { text: 'Sold' })
            : el('button', { class: 'btn small primary', disabled: coins < o.price, onclick: () => onBuy(i) }, 'Buy ', price(o.price)))))),
        showcase.length ? el('div', { class: 'showcase' },
          el('div', { class: 'showcase-head' }, el('b', { text: 'Rarest finds' }), el('small', { text: 'Not for sale. Found only in chests you earn by studying.' }), el('button', { class: 'btn small', text: 'The Vault (U)', onclick: onVault })),
          el('div', { class: 'showcase-row' }, showcase.map((x) => { const img = el('img', { class: 'thumb', alt: '' }); x.src.then((src) => { img.src = src; }).catch(() => {}); return el('div', { class: `show-item t-${x.tier} ${x.owned ? '' : 'unknown'}` }, img, el('b', { text: x.owned ? x.name : '???' }), el('small', { text: `${x.tier} · ${x.odds}` })); }))) : null,
        el('div', { class: 'actions', style: 'margin-top:12px' },
          el('button', { class: 'btn', disabled: !junk.count, onclick: onSellJunk }, el('span', {}, junk.count ? `Sell ${junk.count} weaker piece${junk.count === 1 ? '' : 's'} of gear` : 'Nothing to sell', el('small', { text: junk.count ? `Keeps anything better than what you wear · +${fmt(junk.value)} coins` : 'Gear weaker than what you wear shows up here' })))),
      );
    },

    /** Pick what to study and for how long. */
    study({ items, selected, lengths, chestsLeft, streak, xpRate = 5, onStart, onPractice }) {
      let length = lengths[1] || lengths[0];
      const pick = el('select', {}, el('option', { value: '', text: 'Something else (free study)' }),
        items.map((a) => el('option', { value: a.id, selected: a.id === selected, text: `${a.kind === 'boss' ? 'Exam: ' : ''}${a.name} · ${a.course}` })));
      const info = el('p', { class: 'note study-info' });
      const cards = el('div', { class: 'cards' });
      const go = el('button', { class: 'btn primary', style: 'justify-content:center', onclick: () => { const id = pick.value || null; close(); onStart(id, length.minutes); } });
      const draw = () => {
        const a = items.find((x) => x.id === pick.value);
        info.textContent = !a ? 'Free study still pays XP, coins and a chest. Pick an assignment to wear it down too.'
          : a.studied >= 1 ? 'Fully studied. Extra sessions still pay coins and chests.'
            : a.kind === 'boss' ? `Armor left: ${Math.round((1 - a.studied) * 100)}%. Studying for it breaks its armor, and other study for ${a.course} counts half. Get it under 20% by exam day and your gate holds.`
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
        onPractice ? el('div', { class: 'actions', style: 'margin-top:8px' }, el('button', { class: 'btn', onclick: () => { const id = pick.value || null; if (!id) return; close(); onPractice(id); } }, el('span', {}, 'Practice questions with AI', el('small', { text: 'Soma writes questions from your course notes. Right answers break armor too. (P)' })))) : null,
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

    map({ title, subtitle, canvas, legend }) {
      panel({ title, subtitle, wide: true }, el('div', { class: 'map-wrap' }, canvas), el('div', { class: 'map-legend' }, legend.map(([cls, text]) => el('span', { class: cls, text }))));
    },

    help({ first, onStart, onTutorial }) {
      panel({ title: first ? 'Welcome to Epoch' : 'How to play', subtitle: 'An RPG where your hero is as strong as your studying.', onClose: onStart },
        onTutorial ? el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: onTutorial }, el('span', { text: 'Play the tutorial again' }), el('span', { class: 'cost', text: '10 steps' }))) : null,
        el('div', { class: 'keys' },
          el('span', { class: 'k' }, el('kbd', { text: 'W' }), el('kbd', { text: 'A' }), el('kbd', { text: 'S' }), el('kbd', { text: 'D' })), el('span', { text: 'Walk. Hold Shift to run, Space to jump.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'Ctrl' })), el('span', { text: 'Tap for shift lock: the mouse turns the view without dragging, and your hero faces where you look. Hold Shift to run.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'Right drag' })), el('span', { text: 'Hold right click and move the mouse to look around. Left click swings. Scroll to zoom. V locks the mouse to the view.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'T' })), el('span', { text: 'Start a study session. This is the only way to level up.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'C' }), el('kbd', { text: 'J' })), el('span', { text: 'Your hero (gear and skills) and your quests.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'E' })), el('span', { text: 'Talk to villagers: they move in as your town grows, give a small favour each day, and leave if the town keeps getting wrecked.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'K' })), el('span', { text: 'Creatures: catch them in the Wilds with lures you earn by studying. Pick one as a pet for bonus study XP.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'B' })), el('span', { text: 'Build mode: place fences, lamps, trees and more anywhere in town. The market sells rare pieces.' }),
          el('span', { class: 'k' }, el('kbd', { text: '↗' })), el('span', { text: 'Explore past the town: walk out to the hills. Follow the light beams to hidden caches, each a chest a day.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'P' })), el('span', { text: 'Practice questions from Soma AI, written from your course notes. Right answers break exam armor.' }),
          el('span', { class: 'k' }, el('kbd', { text: 'E' })), el('span', { text: 'Build, upgrade, open chests, pick what to study.' }),
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
          el('li', { text: 'Exams are giant armored books that march on your gate for days. Study to break their armor; on exam day, the armor left decides whether your gate holds or a building gets wrecked. Every grade posted on Canvas drops a chest on your plaza: the better the grade, the rarer the chest.' })),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', style: 'justify-content:center', onclick: close }, el('span', { text: first ? 'Start' : 'Back to the game' }))),
      );
    },
  };
}
