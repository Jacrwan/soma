// Epoch: game rules with no rendering. Everything here is plain data and
// functions so it can be tested in Node and trusted by the 3D layer.

export const SAVE_KEY = 'epoch-save-v1';

// era: the age your civilization is in. Building wonder N moves you from
// era N to era N + 1. Era 6 is reached by launching the rocket.
export const ERAS = [
  { name: 'Stone Age', short: 'Stone', wonder: 'Stone Circle', wonderCost: 4000 },
  { name: 'Bronze Age', short: 'Bronze', wonder: 'Great Pyramid', wonderCost: 120000 },
  { name: 'Medieval Age', short: 'Medieval', wonder: 'Grand Cathedral', wonderCost: 3.2e6 },
  { name: 'Industrial Age', short: 'Industrial', wonder: 'Iron Tower', wonderCost: 9e7 },
  { name: 'Modern Age', short: 'Modern', wonder: 'Sky Spire', wonderCost: 2.6e9 },
  { name: 'Space Age', short: 'Space', wonder: 'Moon Rocket', wonderCost: 8e10 },
  { name: 'Lunar Age', short: 'Lunar', wonder: 'Star Gate', wonderCost: 6e12 },
  { name: 'Interstellar Age', short: 'Interstellar', wonder: null, wonderCost: Infinity },
];
export const LAST_EARTH_TIER = 5;
export const MOON_TIER = 6;

export const TYPES = ['home', 'work', 'trade'];
export const BUILDINGS = {
  home: {
    label: 'Homes',
    income: 1,
    cost: 40,
    names: ['Hide Hut', 'Mudbrick House', 'Timber Cottage', 'Brick Rowhouse', 'Apartment Block', 'Eco Habitat', 'Lunar Dome'],
  },
  work: {
    label: 'Works',
    income: 5,
    cost: 320,
    names: ['Flint Pit', 'Bronze Forge', 'Blacksmith', 'Steam Factory', 'Office Tower', 'Robotics Lab', 'Helium Mine'],
  },
  trade: {
    label: 'Trade',
    income: 22,
    cost: 2200,
    names: ['Trading Post', 'Bazaar', 'Market Hall', 'Rail Depot', 'Shopping Mall', 'Cargo Port', 'Orbital Exchange'],
  },
};

const INCOME_PER_TIER = 6;
const COST_PER_TIER = 10;
export const LEVEL_MULT = [0, 1, 2.2, 4.5];
const LEVEL_COST = [0, 1, 2, 5]; // multiples of the building's base cost
export const MAX_LEVEL = 3;
export const GOLDEN_MULT = 3;
export const STORE_HOURS = 2;
export const SIEGE_MULT = 0.5;

export const EARTH_PADS = 16;
export const MOON_PADS = 8;

export function padsUnlocked(state, scene = state.scene) {
  if (scene === 'moon') return state.era >= MOON_TIER ? MOON_PADS : 0;
  return Math.min(EARTH_PADS, 6 + 2 * Math.min(state.era, LAST_EARTH_TIER));
}

/** The tier a new or modernized building gets in a scene right now. */
export function tierFor(state, scene = state.scene) {
  return scene === 'moon' ? MOON_TIER : Math.min(state.era, LAST_EARTH_TIER);
}

export function newState(now = Date.now()) {
  return {
    v: 1,
    coins: 120,
    lifetime: 0,
    era: 0,
    scene: 'earth',
    pads: { earth: Array(EARTH_PADS).fill(null), moon: Array(MOON_PADS).fill(null) },
    wonders: [],
    relics: [],
    tokens: 0,
    cosmetics: { owned: ['hat:none', 'color:clay'], hat: 'hat:none', color: 'color:clay' },
    school: { source: 'none', items: {}, seen: {}, chests: [], ignored: {}, penalty: {}, warned: {} },
    explore: { day: null, done: {}, shrines: {} },
    study: { active: null, minutes: {}, courses: {}, streak: 0, lastDay: null, chestDay: null, chestsToday: 0, total: 0 },
    hero: { level: 1, xp: 0, points: 0, skills: {}, gear: { weapon: null, armor: null, charm: null }, bag: [], nextId: 1 },
    quest: { step: 0 },
    stats: { collected: 0, raidersBeaten: 0, bossesBeaten: 0, chestsOpened: 0, handedIn: 0, campsCleared: 0, treasures: 0, realmBosses: {} },
    settings: { muted: false },
    createdAt: now,
    lastTick: now,
  };
}

export function relicMult(state) {
  return state.relics.reduce((m, r) => m * (1 + r.bonus), 1);
}

export function isUnderSiege(state, now = Date.now()) {
  return lateItems(state, now).length > 0;
}

// --- Deadlines: warnings, late losses, and work with nothing to hand in --------------

const HOUR = 3600000;
export const URGENT_HOURS = 24; // due within a day: urgent
export const CRITICAL_HOURS = 3; // due within three hours: critical
export const LATE_COIN_RATE = 0.01; // share of coins lost every hour, for each late assignment
export const LATE_XP_RATE = 3; // experience lost every hour, for each late assignment
export const LATE_MAX_HOURS = 48; // after two days late, an assignment stops costing more

/**
 * Work the student said needs nothing handed in, or that Canvas marks as on
 * paper or with no submission, is left alone: no warnings, no losses, no
 * invader. The student's own choice wins over Canvas's.
 */
export function isIgnored(state, item) {
  const choice = state.school.ignored?.[item.id];
  return typeof choice === 'boolean' ? choice : Boolean(item.noSubmit);
}

export function setIgnored(state, id, on, now = Date.now()) {
  state.school.ignored[id] = Boolean(on);
  // Coming back from ignored starts the clock again now, not from the due date.
  const p = state.school.penalty[id];
  if (p) p.at = now;
}

/** Work that is past due, not handed in, and not ignored. */
export function lateItems(state, now = Date.now()) {
  return Object.values(state.school.items).filter((a) => !a.submitted && !a.excused && a.dueAt && a.dueAt < now && !isIgnored(state, a));
}

/** 'late', 'critical', 'urgent' or null. */
export function deadlineLevel(state, item, now = Date.now()) {
  if (item.submitted || item.excused || !item.dueAt || isIgnored(state, item)) return null;
  const left = item.dueAt - now;
  if (left < 0) return 'late';
  if (left < CRITICAL_HOURS * HOUR) return 'critical';
  if (left < URGENT_HOURS * HOUR) return 'urgent';
  return null;
}

/**
 * Takes what late work has cost since it was last charged: a share of coins
 * every hour, and some experience (never below the start of the current
 * level). The clock starts at the due date, or when the game first saw the
 * work if that was later, so old missing work found on the first sync costs
 * nothing. Returns what was lost.
 */
export function chargeLate(state, now = Date.now()) {
  const school = state.school;
  const out = { coins: 0, xp: 0 };
  for (const item of lateItems(state, now)) {
    const seenAt = school.seen[item.id]?.at || 0;
    const p = school.penalty[item.id] || (school.penalty[item.id] = { at: 0, coins: 0, xp: 0, bank: 0 });
    const from = Math.max(p.at, item.dueAt, seenAt);
    const to = Math.min(now, item.dueAt + LATE_MAX_HOURS * HOUR);
    p.at = Math.max(p.at, now);
    if (to <= from) continue;
    const hours = (to - from) / HOUR;
    const coins = state.coins * (1 - (1 - LATE_COIN_RATE) ** hours);
    state.coins -= coins;
    p.coins += coins;
    out.coins += coins;
    p.bank += hours * LATE_XP_RATE;
    const whole = Math.floor(p.bank);
    p.bank -= whole;
    const xp = Math.min(whole, state.hero.xp);
    state.hero.xp -= xp;
    p.xp += xp;
    out.xp += xp;
  }
  return out;
}

/** What one late assignment is costing right now, per hour, and has cost so far. */
export function lateCost(state, item, now = Date.now()) {
  const p = state.school.penalty[item.id];
  const stopped = item.dueAt && now > item.dueAt + LATE_MAX_HOURS * HOUR;
  return { perHour: stopped ? 0 : state.coins * LATE_COIN_RATE, xpPerHour: stopped ? 0 : LATE_XP_RATE, coins: p?.coins || 0, xp: p?.xp || 0, stopped };
}

/**
 * Deadlines that crossed into a more pressing level since the last check:
 * urgent, critical, late. Each item is announced once per level.
 */
export function newWarnings(state, now = Date.now()) {
  const rank = { urgent: 1, critical: 2, late: 3 };
  const out = [];
  for (const item of Object.values(state.school.items)) {
    const level = deadlineLevel(state, item, now);
    if (!level) continue;
    if ((state.school.warned[item.id] || 0) >= rank[level]) continue;
    state.school.warned[item.id] = rank[level];
    out.push({ item, level });
  }
  return out.sort((a, b) => rank[b.level] - rank[a.level]);
}

export function buildingName(b) {
  return BUILDINGS[b.type].names[b.tier];
}

/** Coins per second for one building, before siege. */
export function buildingIncome(state, b) {
  if (!b) return 0;
  return BUILDINGS[b.type].income * INCOME_PER_TIER ** b.tier * LEVEL_MULT[b.level] * (b.golden ? GOLDEN_MULT : 1) * relicMult(state);
}

export function buildingCap(state, b) {
  return buildingIncome(state, b) * STORE_HOURS * 3600;
}

/** Coins per second from every building, ignoring any siege. Rewards are sized from this. */
export function baseIncome(state) {
  let sum = 0;
  for (const scene of ['earth', 'moon']) for (const b of state.pads[scene]) sum += buildingIncome(state, b);
  return sum;
}

export function totalIncome(state, now = Date.now()) {
  return baseIncome(state) * (isUnderSiege(state, now) ? SIEGE_MULT : 1) * (isStudying(state, now) ? FOCUS_MULT : 1);
}

export function buildCost(type, tier) {
  return Math.round(BUILDINGS[type].cost * COST_PER_TIER ** tier);
}

export function upgradeCost(b) {
  if (b.level >= MAX_LEVEL) return Infinity;
  return Math.round(buildCost(b.type, b.tier) * LEVEL_COST[b.level + 1]);
}

/** Rebuilding an old building in the current era's style costs a new one, less a third. */
export function modernizeCost(state, b, scene = state.scene) {
  const tier = tierFor(state, scene);
  if (b.tier >= tier) return Infinity;
  return Math.round(buildCost(b.type, tier) * 0.67);
}

function spend(state, cost) {
  if (!(cost <= state.coins)) return false;
  state.coins -= cost;
  return true;
}

export function build(state, index, type, scene = state.scene) {
  if (index >= padsUnlocked(state, scene) || state.pads[scene][index] || !BUILDINGS[type]) return false;
  const tier = tierFor(state, scene);
  if (!spend(state, buildCost(type, tier))) return false;
  state.pads[scene][index] = { type, tier, level: 1, golden: false, stored: 0 };
  return true;
}

export function upgrade(state, index, scene = state.scene) {
  const b = state.pads[scene][index];
  if (!b || b.level >= MAX_LEVEL || !spend(state, upgradeCost(b))) return false;
  b.level += 1;
  return true;
}

export function modernize(state, index, scene = state.scene) {
  const b = state.pads[scene][index];
  if (!b) return false;
  const cost = modernizeCost(state, b, scene);
  if (!Number.isFinite(cost) || !spend(state, cost)) return false;
  b.tier = tierFor(state, scene);
  b.level = 1;
  return true;
}

export function gild(state, index, scene = state.scene) {
  const b = state.pads[scene][index];
  if (!b || b.golden || state.tokens < 1) return false;
  state.tokens -= 1;
  b.golden = true;
  return true;
}

/** Moves a building's stored coins to the player. Returns how many. */
export function collect(state, index, scene = state.scene) {
  const b = state.pads[scene][index];
  if (!b || b.stored < 1) return 0;
  const amount = Math.floor(b.stored);
  b.stored -= amount;
  addCoins(state, amount);
  state.stats.collected += amount;
  return amount;
}

export function addCoins(state, amount) {
  state.coins += amount;
  state.lifetime += amount;
}

/** The wonder you can build now, or null. Earth wonders are built on Earth, the Star Gate on the moon. */
export function nextWonder(state) {
  const era = ERAS[state.era];
  if (!era || !era.wonder) return null;
  return { index: state.era, name: era.wonder, cost: era.wonderCost, scene: state.era >= MOON_TIER ? 'moon' : 'earth' };
}

export function buildWonder(state) {
  const wonder = nextWonder(state);
  if (!wonder || wonder.scene !== state.scene || !spend(state, wonder.cost)) return null;
  state.wonders.push(wonder.index);
  state.era += 1;
  return wonder;
}

/** Advances production. Buildings fill their own stores up to a cap; walking by collects them. */
export function tick(state, now = Date.now()) {
  const dt = Math.max(0, (now - state.lastTick) / 1000);
  state.lastTick = now;
  if (dt === 0) return 0;
  // A focus session doubles the town for as long as it ran inside this stretch of time.
  const active = state.study?.active;
  const focused = active ? Math.max(0, Math.min(now, active.endsAt) - Math.max(now - dt * 1000, active.startedAt)) / 1000 : 0;
  const siege = (isUnderSiege(state, now) ? SIEGE_MULT : 1) * (1 + (FOCUS_MULT - 1) * Math.min(1, focused / dt));
  let produced = 0;
  for (const scene of ['earth', 'moon']) {
    for (const b of state.pads[scene]) {
      if (!b) continue;
      const room = buildingCap(state, b) - b.stored;
      if (room <= 0) continue;
      const gain = Math.min(room, buildingIncome(state, b) * siege * dt);
      b.stored += gain;
      produced += gain;
    }
  }
  return produced;
}

export function storedTotal(state) {
  let sum = 0;
  for (const scene of ['earth', 'moon']) for (const b of state.pads[scene]) if (b) sum += b.stored;
  return sum;
}

const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
export function fmt(n) {
  if (!Number.isFinite(n)) return '∞';
  if (n < 1000) return String(Math.floor(n));
  let unit = 0;
  while (n >= 1000 && unit < UNITS.length - 1) {
    n /= 1000;
    unit += 1;
  }
  return `${n >= 100 ? Math.floor(n) : n >= 10 ? n.toFixed(1) : n.toFixed(2)}${UNITS[unit]}`;
}

// --- School: assignments become invaders, tests become bosses, grades become chests ---

const DAY = 86400000;
export const APPROACH_DAYS = 10; // an invader is visible this long before it is due
const TEST_WORDS = /\b(exam|midterm|final|test|quiz)\b/i;

/** What an assignment is in the game. weight is the share of the course grade its group carries, 0 to 100. */
export function classify(a) {
  const points = a.pointsPossible || 0;
  const looksLikeTest = TEST_WORDS.test(a.name || '') || TEST_WORDS.test(a.groupName || '');
  const heavy = (a.weight || 0) >= 20 || points >= 100;
  if (looksLikeTest && (heavy || /\b(exam|midterm|final)\b/i.test(a.name || ''))) return { kind: 'boss', size: 3 };
  if (heavy || points >= 50) return { kind: 'invader', size: 2 };
  if (looksLikeTest) return { kind: 'invader', size: 2 };
  return { kind: 'invader', size: 1 };
}

/** 0 at the edge of the map (far from due), 1 at your gate (due now). null when not visible yet. */
export function approach(a, now = Date.now()) {
  if (!a.dueAt) return null;
  const left = (a.dueAt - now) / DAY;
  if (left > APPROACH_DAYS) return null;
  return Math.max(0, Math.min(1, 1 - left / APPROACH_DAYS));
}

export function rarityForGrade(percent) {
  if (percent >= 90) return 'legendary';
  if (percent >= 80) return 'epic';
  if (percent >= 70) return 'rare';
  return 'common';
}

/**
 * Brings the game in line with the latest school data. items is the full
 * list from the source. Returns what just happened, for the 3D layer to show:
 *   { type: 'handed-in', item, reward } | { type: 'chest', chest } | { type: 'new', item }
 * The first sync of a source is quiet about the past: old hand-ins give no
 * reward, though grades already posted still drop chests (capped).
 */
export function syncSchool(state, items, now = Date.now(), { source = state.school.source, firstSyncChests = 3 } = {}) {
  const school = state.school;
  const first = school.source !== source || Object.keys(school.seen).length === 0;
  school.source = source;
  const events = [];
  const next = {};
  let firstChests = 0;

  for (const raw of items) {
    const item = { ...raw, ...classify(raw) };
    next[item.id] = item;
    const seen = school.seen[item.id] || (school.seen[item.id] = { submitted: false, graded: false, boss: false, at: now });
    const known = Boolean(school.items[item.id]);
    if (!known && !first && !item.submitted) events.push({ type: 'new', item });

    if (item.submitted && !seen.submitted) {
      seen.submitted = true;
      if (!first) {
        const reward = handInReward(state, item);
        addCoins(state, reward);
        state.stats.handedIn += 1;
        events.push({ type: 'handed-in', item, reward, ...addXp(state, XP_HAND_IN[item.size || 1]) });
      }
    }
    const graded = typeof item.score === 'number' && item.pointsPossible > 0;
    if (graded && !seen.graded) {
      seen.graded = true;
      if (!first || firstChests < firstSyncChests) {
        if (first) firstChests += 1;
        const percent = (item.score / item.pointsPossible) * 100;
        const chest = { id: `grade:${item.id}`, rarity: rarityForGrade(percent), from: item.name, percent: Math.round(percent) };
        school.chests.push(chest);
        events.push({ type: 'chest', chest, ...addXp(state, first ? 0 : 40 + percent) });
      }
    }
  }
  school.items = next;
  return events;
}

export function handInReward(state, item) {
  const seconds = [0, 120, 300, 900][item.size || 1];
  return Math.round(Math.max(60 * (item.size || 1), baseIncome(state) * seconds) * (1 + STUDIED_BONUS * studyProgress(state, item)));
}

// --- Studying: a real timer you run while you do the work ---------------------------

export const FOCUS_MULT = 2; // the town earns this much more while a session runs
export const STUDY_LENGTHS = [{ minutes: 10, rarity: 'common' }, { minutes: 25, rarity: 'rare' }, { minutes: 45, rarity: 'epic' }];
export const STUDY_GOAL = [0, 30, 60, 120]; // minutes that fully prepare an item, by size
export const STUDY_CHESTS_PER_DAY = 3;
export const STUDIED_BONUS = 0.5; // extra hand-in reward for a fully studied item
export const BOSS_STUDY_CUT = 0.5; // share of a boss's health that full study removes
const MIN_SESSION = 5; // minutes; shorter than this earns nothing

const dayOf = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function isStudying(state, now = Date.now()) {
  const a = state.study?.active;
  return Boolean(a && now < a.endsAt);
}

/** 0 to 1: how prepared you are for this item. */
export function studyProgress(state, item) {
  if (!item) return 0;
  return Math.min(1, (state.study?.minutes[item.id] || 0) / STUDY_GOAL[item.size || 1]);
}

export function studyChestsLeft(state, now = Date.now()) {
  return state.study.chestDay === dayOf(now) ? Math.max(0, STUDY_CHESTS_PER_DAY - state.study.chestsToday) : STUDY_CHESTS_PER_DAY;
}

/** Starts a session on an item (or on nothing in particular, with itemId null). */
export function startStudy(state, itemId, minutes, now = Date.now()) {
  if (state.study.active || !(minutes > 0)) return null;
  state.study.active = { itemId: itemId ?? null, minutes, startedAt: now, endsAt: now + minutes * 60000 };
  return state.study.active;
}

/**
 * Ends the running session, early or on time, and pays for the minutes done.
 * A session that ran its full length drops a chest (a few a day) and counts
 * toward the daily streak. Returns null when nothing was running.
 */
export function finishStudy(state, now = Date.now()) {
  const study = state.study;
  const a = study.active;
  if (!a) return null;
  study.active = null;
  const complete = now >= a.endsAt;
  const minutes = Math.min(a.minutes, Math.floor(((now - a.startedAt) / 60000) * 100) / 100);
  const item = a.itemId ? state.school.items[a.itemId] || null : null;
  const result = { complete, minutes, item, coins: 0, xp: 0, levels: 0, chest: null, streak: study.streak, prepared: false };
  if (!complete && minutes < MIN_SESSION) return result;

  if (item) {
    const before = studyProgress(state, item);
    study.minutes[item.id] = (study.minutes[item.id] || 0) + minutes;
    study.courses[item.courseId] = (study.courses[item.courseId] || 0) + minutes;
    result.prepared = before < 1 && studyProgress(state, item) >= 1;
  }
  study.total += minutes;
  result.coins = Math.round(Math.max(12 * minutes, baseIncome(state) * 20 * minutes));
  addCoins(state, result.coins);
  Object.assign(result, addXp(state, minutes * XP_PER_MINUTE * (complete ? XP_FULL_SESSION : 1) * heroStats(state).studyXp));
  if (!complete) return result;

  const today = dayOf(now);
  if (study.lastDay !== today) {
    study.streak = study.lastDay === dayOf(now - DAY) ? study.streak + 1 : 1;
    study.lastDay = today;
  }
  result.streak = study.streak;
  if (study.chestDay !== today) {
    study.chestDay = today;
    study.chestsToday = 0;
  }
  if (study.chestsToday < STUDY_CHESTS_PER_DAY) {
    study.chestsToday += 1;
    const length = [...STUDY_LENGTHS].reverse().find((l) => a.minutes >= l.minutes) || STUDY_LENGTHS[0];
    result.chest = grantChest(state, a.minutes >= STUDY_LENGTHS[0].minutes ? length.rarity : 'common', `${a.minutes} minutes of ${item ? item.name : 'study'}`);
  }
  return result;
}

/** What the gate looks like right now: who is marching, who is sieging. */
export function threats(state, now = Date.now()) {
  const out = [];
  for (const item of Object.values(state.school.items)) {
    if (item.submitted || item.excused || isIgnored(state, item)) continue;
    const t = approach(item, now);
    if (t === null) continue;
    out.push({ item, t, overdue: item.dueAt < now });
  }
  return out.sort((a, b) => b.t - a.t);
}

// --- Loot -------------------------------------------------------------------

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const RELICS = {
  rare: [['Lucky Coin', 0.05], ['Old Map', 0.05], ['Bronze Scale', 0.06]],
  epic: [['Merchant Seal', 0.1], ['Royal Charter', 0.12], ['Clockwork Heart', 0.1]],
  legendary: [['Philosopher Stone', 0.25], ['Crown of Ages', 0.3], ['Star Compass', 0.25]],
};
export const COSMETICS = [
  'hat:straw', 'hat:crown', 'hat:helm', 'hat:top', 'hat:cap', 'hat:astro',
  'color:moss', 'color:ocean', 'color:plum', 'color:ember', 'color:snow', 'color:gold',
];
const COIN_MINUTES = { common: 10, rare: 30, epic: 75, legendary: 180 };

/** Opens a chest: returns what was inside and applies it to the state. rng returns 0..1. */
export function openChest(state, chestId, rng = Math.random, now = Date.now()) {
  const i = state.school.chests.findIndex((c) => c.id === chestId);
  if (i < 0) return null;
  const [chest] = state.school.chests.splice(i, 1);
  const loot = [];
  const coins = Math.max({ common: 150, rare: 500, epic: 1500, legendary: 5000 }[chest.rarity], Math.round(baseIncome(state) * COIN_MINUTES[chest.rarity] * 60));
  addCoins(state, coins);
  loot.push({ kind: 'coins', amount: coins });

  const relicChance = { common: 0, rare: 0.35, epic: 1, legendary: 1 }[chest.rarity];
  if (rng() < relicChance) {
    const pool = RELICS[chest.rarity];
    const [name, bonus] = pool[Math.floor(rng() * pool.length) % pool.length];
    state.relics.push({ name, bonus });
    loot.push({ kind: 'relic', name, bonus });
  }
  const cosmeticChance = { common: 0.1, rare: 0.25, epic: 0.5, legendary: 1 }[chest.rarity];
  if (rng() < cosmeticChance) {
    const missing = COSMETICS.filter((c) => !state.cosmetics.owned.includes(c));
    if (missing.length) {
      const id = missing[Math.floor(rng() * missing.length) % missing.length];
      state.cosmetics.owned.push(id);
      loot.push({ kind: 'cosmetic', id });
    }
  }
  if (chest.rarity === 'legendary' || (chest.rarity === 'epic' && rng() < 0.3)) {
    state.tokens += 1;
    loot.push({ kind: 'token' });
  }
  if (rng() < { common: 0.6, rare: 1, epic: 1, legendary: 1 }[chest.rarity]) {
    const got = addGear(state, rollGear(state, chest.rarity, rng));
    loot.push({ kind: 'gear', item: got.item, equipped: got.equipped });
  }
  state.stats.chestsOpened += 1;
  return { chest, loot };
}

export function grantChest(state, rarity, from) {
  const chest = { id: `bonus:${Date.now()}:${Math.floor(Math.random() * 1e6)}`, rarity, from };
  state.school.chests.push(chest);
  return chest;
}

// --- Exploring: the Wilds and the far planet -----------------------------------------

/** Health for fights out in the world. */
export const maxHealth = (state) => heroStats(state).health;

/** Camps, buried treasure and realm bosses come back once a day. */
export function exploreDone(state, key, now = Date.now()) {
  return state.explore.day === dayOf(now) && Boolean(state.explore.done[key]);
}
export function markExplored(state, key, now = Date.now()) {
  const e = state.explore;
  if (e.day !== dayOf(now)) {
    e.day = dayOf(now);
    e.done = {};
  }
  e.done[key] = true;
}

/** A shrine gives a small lasting boost, once ever. */
export function useShrine(state, key, name) {
  if (state.explore.shrines[key]) return null;
  state.explore.shrines[key] = true;
  const relic = { name, bonus: 0.04 };
  state.relics.push(relic);
  return relic;
}

/** Coins for beating a wild enemy. tier: 0 normal, 1 elite, 2 boss. */
export function killReward(state, tier = 0) {
  const reward = Math.round(Math.max([15, 45, 600][tier], baseIncome(state) * [25, 80, 900][tier]));
  addCoins(state, reward);
  return reward;
}

// --- Bosses and power ---------------------------------------------------------

/** Damage per hit: the hero's might, plus recent hand-ins and study for that course (prep). */
export function playerPower(state, courseId = null, now = Date.now()) {
  let prep = 0;
  if (courseId !== null) {
    for (const item of Object.values(state.school.items)) {
      if (item.courseId === courseId && item.submitted && item.dueAt && now - item.dueAt < 14 * DAY) prep += 1;
    }
  }
  // Every hour studied for the course is worth one more hand-in of prep.
  if (courseId !== null) prep += (state.study?.courses[courseId] || 0) / 60;
  return Math.round(heroStats(state).might * (1 + Math.min(prep, 8) * 0.1) * (courseId !== null ? 1 + 0.15 * skillRank(state, 'exam') : 1));
}

export function bossHp(state, item) {
  return Math.round(enemyStats(bossLevel(item), 2).hp * (1 - BOSS_STUDY_CUT * studyProgress(state, item)));
}

export function bossWon(state, item) {
  const seen = state.school.seen[item.id] || (state.school.seen[item.id] = { submitted: false, graded: false, boss: false });
  if (seen.boss) return null;
  seen.boss = true;
  state.stats.bossesBeaten += 1;
  const reward = Math.max(500, Math.round(baseIncome(state) * 1200));
  addCoins(state, reward);
  return { reward, chest: grantChest(state, 'epic', `Beat ${item.name}`), ...addXp(state, XP_BOSS) };
}

// --- The hero: an RPG character whose levels come from school ----------------------
// Fighting pays coins and gear. Experience only comes from studying, handing
// work in, grades and test bosses, so the way to get stronger is to do the work.

export const XP_PER_MINUTE = 4;
export const XP_FULL_SESSION = 1.25; // a session that runs its full length pays this much more
export const XP_HAND_IN = [0, 40, 80, 160]; // by assignment size
export const XP_BOSS = 250;
export const MAX_HERO_LEVEL = 40;
export const BAG_SIZE = 18;
export const SLOTS = ['weapon', 'armor', 'charm'];
export const xpToNext = (level) => 60 + 30 * (level - 1);

export const SKILLS = {
  heavy: { branch: 'Might', name: 'Heavy Hands', max: 5, text: '+8% damage' },
  keen: { branch: 'Might', name: 'Keen Eye', max: 5, text: '+4% critical hits' },
  whirl: { branch: 'Might', name: 'Whirlwind', max: 3, text: '+25% combo finisher' },
  tough: { branch: 'Guard', name: 'Thick Skin', max: 5, text: '+10% health' },
  wind: { branch: 'Guard', name: 'Second Wind', max: 3, text: 'Health returns 1 second sooner' },
  step: { branch: 'Guard', name: 'Quick Step', max: 3, text: 'Dodge ready 15% sooner' },
  worm: { branch: 'Scholar', name: 'Bookworm', max: 5, text: '+6% experience from studying' },
  quake: { branch: 'Scholar', name: 'Aftershock', max: 3, text: 'Ground slam ready 1 second sooner' },
  exam: { branch: 'Scholar', name: 'Exam Nerves', max: 3, text: '+15% damage to test bosses' },
};

export const skillRank = (state, id) => state.hero.skills[id] || 0;

/** Adds experience and levels up as far as it goes. A level gives a skill point. */
export function addXp(state, amount) {
  const hero = state.hero;
  const gained = Math.max(0, Math.round(amount));
  let levels = 0;
  hero.xp += gained;
  while (hero.level < MAX_HERO_LEVEL && hero.xp >= xpToNext(hero.level)) {
    hero.xp -= xpToNext(hero.level);
    hero.level += 1;
    hero.points += 1;
    levels += 1;
  }
  if (hero.level >= MAX_HERO_LEVEL) hero.xp = 0;
  return { xp: gained, levels, level: hero.level };
}

export function spendSkill(state, id) {
  const skill = SKILLS[id];
  if (!skill || state.hero.points < 1 || skillRank(state, id) >= skill.max) return false;
  state.hero.points -= 1;
  state.hero.skills[id] = skillRank(state, id) + 1;
  return true;
}

/** Every 15, 60, 135... minutes studied for a course is a mastery level: +1% damage each. */
export const mastery = (state, courseId) => Math.floor(Math.sqrt((state.study.courses[courseId] || 0) / 15));
const masteryTotal = (state) => Object.keys(state.study.courses).reduce((sum, id) => sum + mastery(state, id), 0);

export function heroStats(state) {
  const hero = state.hero;
  const worn = SLOTS.map((slot) => hero.gear[slot]).filter(Boolean);
  const sum = (key) => worn.reduce((n, item) => n + (item[key] || 0), 0);
  const level = hero.level;
  return {
    level,
    might: Math.round((10 + 3 * (level - 1) + sum('might')) * (1 + 0.08 * skillRank(state, 'heavy')) * (1 + 0.01 * masteryTotal(state))),
    health: Math.round((100 + 22 * (level - 1) + sum('health')) * (1 + 0.1 * skillRank(state, 'tough'))),
    crit: Math.min(0.6, 0.08 + 0.04 * skillRank(state, 'keen') + sum('crit') / 100),
    studyXp: 1 + 0.06 * skillRank(state, 'worm'),
    finisher: 2 * (1 + 0.25 * skillRank(state, 'whirl')),
    regenDelay: 4 - skillRank(state, 'wind'),
    dodgeTime: 0.85 * (1 - 0.15 * skillRank(state, 'step')),
    slamTime: 7 - skillRank(state, 'quake'),
  };
}

// Enemies have their own fixed levels. tier: 0 normal, 1 elite, 2 boss.
export function enemyStats(level, tier = 0) {
  return { hp: Math.round((22 + 12 * level) * [1, 2.6, 16][tier]), damage: Math.round((6 + 3 * level) * [1, 1.5, 2.2][tier]) };
}

/** How a level gap bends a fight: what you deal and what you take, as multipliers. */
export function levelEdge(heroLevel, enemyLevel) {
  const gap = enemyLevel - heroLevel;
  if (gap > 0) return { deal: Math.max(0.25, 1 - 0.1 * gap), take: 1 + 0.15 * gap };
  return { deal: Math.min(1.6, 1 - 0.06 * gap), take: Math.max(0.4, 1 + 0.06 * gap) };
}

export const raiderLevel = (state, scene = state.scene) => (scene === 'moon' ? 20 : 1 + state.era * 3);
/** A test's level comes from how much of the grade it is worth. */
export const bossLevel = (item) => Math.max(3, Math.min(15, 3 + Math.round(Math.min(item.weight || 20, 60) / 5)));

// --- Gear ---
const RARITY_MULT = { common: 1, rare: 1.3, epic: 1.7, legendary: 2.3 };
const GEAR_NAMES = {
  weapon: { common: ['Worn Club', 'Flint Axe', 'Bone Spear'], rare: ['Bronze Sword', 'Iron Mace', 'Hunter Blade'], epic: ['Knight Sword', 'Storm Sabre', 'Rune Axe'], legendary: ['Sunblade', 'Star Cleaver', 'Edge of Ages'] },
  armor: { common: ['Hide Vest', 'Padded Coat'], rare: ['Chain Shirt', 'Scale Coat'], epic: ['Knight Plate', 'Warden Mail'], legendary: ['Aegis of Ages', 'Scholar Mantle'] },
  charm: { common: ['Lucky Pebble', 'Bone Charm'], rare: ['Silver Ring', 'Owl Feather'], epic: ['Sage Amulet', 'Hourglass Pendant'], legendary: ['Honor Roll Medal', 'Philosopher Ring'] },
};

/** Makes a piece of gear. Its level follows the hero's, so later drops beat earlier ones. */
export function rollGear(state, rarity, rng = Math.random, slot = null, level = state.hero.level) {
  const hero = state.hero;
  const kind = slot || SLOTS[Math.floor(rng() * SLOTS.length) % SLOTS.length];
  const names = GEAR_NAMES[kind][rarity];
  const mult = RARITY_MULT[rarity];
  const item = { id: `g${hero.nextId++}`, slot: kind, name: names[Math.floor(rng() * names.length) % names.length], rarity, level, might: 0, health: 0, crit: 0 };
  if (kind === 'weapon') {
    item.might = Math.round((3 + 1.6 * level) * mult);
    item.look = Math.min(6, Math.floor(level / 5) + (rarity === 'common' ? 0 : 1));
  } else if (kind === 'armor') item.health = Math.round((12 + 7 * level) * mult);
  else {
    item.crit = { common: 3, rare: 5, epic: 8, legendary: 12 }[rarity];
    item.might = Math.round((1 + 0.5 * level) * mult);
  }
  return item;
}

export const gearScore = (item) => (item ? item.might * 3 + item.health * 0.5 + item.crit * 4 : -1);
export const sellValue = (item) => Math.round((20 + 12 * item.level) * RARITY_MULT[item.rarity]);

/**
 * Takes a new piece of gear. It is worn straight away when it beats what is in
 * that slot; otherwise it goes in the bag. A full bag sells its weakest piece.
 */
export function addGear(state, item) {
  const hero = state.hero;
  const out = { item, equipped: false, sold: null };
  if (gearScore(item) > gearScore(hero.gear[item.slot])) {
    if (hero.gear[item.slot]) hero.bag.push(hero.gear[item.slot]);
    hero.gear[item.slot] = item;
    out.equipped = true;
  } else hero.bag.push(item);
  if (hero.bag.length > BAG_SIZE) {
    const weakest = hero.bag.reduce((a, b) => (sellValue(b) < sellValue(a) ? b : a));
    hero.bag.splice(hero.bag.indexOf(weakest), 1);
    addCoins(state, sellValue(weakest));
    out.sold = weakest;
  }
  return out;
}

export function equipGear(state, id) {
  const hero = state.hero;
  const i = hero.bag.findIndex((g) => g.id === id);
  if (i < 0) return false;
  const [item] = hero.bag.splice(i, 1);
  if (hero.gear[item.slot]) hero.bag.push(hero.gear[item.slot]);
  hero.gear[item.slot] = item;
  return true;
}

export function sellGear(state, id) {
  const hero = state.hero;
  const i = hero.bag.findIndex((g) => g.id === id);
  if (i < 0) return 0;
  const [item] = hero.bag.splice(i, 1);
  addCoins(state, sellValue(item));
  return sellValue(item);
}

/** What a beaten enemy leaves behind besides coins: sometimes a piece of gear. */
export function rollDrop(state, tier, level, rng = Math.random) {
  if (rng() >= [0.05, 0.3, 0][tier]) return null;
  return addGear(state, rollGear(state, tier === 1 && rng() < 0.35 ? 'rare' : 'common', rng, null, Math.min(level, state.hero.level + 2)));
}

// --- The story: one quest at a time, from the first lesson to the far planet ---------
export const STORY = [
  { title: 'First lesson', text: 'Finish a study session of 10 minutes or more', need: 1, have: (s) => (s.study.total >= 10 ? 1 : 0), reward: { gear: 'rare', slot: 'weapon' } },
  { title: 'Into the Wilds', text: 'Take the east trail and clear a camp in the Wilds', need: 1, have: (s) => s.stats.campsCleared, reward: { coins: 300, gear: 'common', slot: 'armor' } },
  { title: 'Getting stronger', text: 'Reach level 3 by studying', need: 3, have: (s) => s.hero.level, reward: { gear: 'rare', slot: 'armor' } },
  { title: 'Treasure hunter', text: 'Dig up 3 buried treasures', need: 3, have: (s) => s.stats.treasures, reward: { gear: 'rare', slot: 'charm' } },
  { title: 'Trained', text: 'Spend 3 skill points', need: 3, have: (s) => Object.values(s.hero.skills).reduce((a, b) => a + b, 0), reward: { coins: 800 } },
  { title: 'Hand it in', text: 'Hand in 3 assignments on Canvas', need: 3, have: (s) => s.stats.handedIn, reward: { gear: 'epic', slot: 'weapon' } },
  { title: 'Pack leader', text: 'Reach level 8, then beat the Alpha in the Wilds', need: 1, have: (s) => (s.stats.realmBosses.wilds ? 1 : 0), reward: { gear: 'epic', slot: 'armor' } },
  { title: 'Exam season', text: 'Beat a test boss at your gate', need: 1, have: (s) => s.stats.bossesBeaten, reward: { gear: 'epic', slot: 'charm' } },
  { title: 'Honor roll', text: 'Reach level 14', need: 14, have: (s) => s.hero.level, reward: { gear: 'legendary', slot: 'weapon' } },
  { title: 'To the stars', text: 'Build the Star Gate on the Moon', need: 1, have: (s) => (s.wonders.includes(6) ? 1 : 0), reward: { gear: 'legendary', slot: 'armor' } },
  { title: 'The last guardian', text: 'Beat the Core Guardian on Kepler Reach', need: 1, have: (s) => (s.stats.realmBosses.nova ? 1 : 0), reward: { gear: 'legendary', slot: 'charm', coins: 50000 } },
];

export function storyStatus(state) {
  const quest = STORY[state.quest.step];
  if (!quest) return null;
  const have = Math.min(quest.need, quest.have(state) || 0);
  return { step: state.quest.step, total: STORY.length, title: quest.title, text: quest.text, have, need: quest.need, done: have >= quest.need, reward: quest.reward };
}

/** Pays out the current quest if it is finished and moves to the next one. */
export function claimStory(state, rng = Math.random) {
  const status = storyStatus(state);
  if (!status || !status.done) return null;
  state.quest.step += 1;
  const out = { title: status.title, coins: status.reward.coins || 0, gear: null };
  if (out.coins) addCoins(state, out.coins);
  if (status.reward.gear) out.gear = addGear(state, rollGear(state, status.reward.gear, rng, status.reward.slot, state.hero.level + 1));
  return out;
}

/** Counts what was done out exploring, for quests. kind: 'camp', 'treasure' or 'boss'. */
export function noteExplore(state, kind, realm) {
  if (kind === 'camp') state.stats.campsCleared += 1;
  else if (kind === 'treasure') state.stats.treasures += 1;
  else if (kind === 'boss') state.stats.realmBosses[realm] = true;
}

// --- School data sources -------------------------------------------------------

/** Turns a "Soma for Canvas" snapshot into the game's assignment list. */
export function fromSomaSnapshot(snapshot) {
  if (!snapshot || snapshot.kind !== 'canvas' || !Array.isArray(snapshot.assignments)) return [];
  const courses = new Map((snapshot.courses || []).map((c) => [c.id, c.name || 'Course']));
  const groups = new Map((snapshot.groups || []).map((g) => [g.id, g]));
  const done = new Set(['submitted', 'graded', 'pending_review', 'complete']);
  return snapshot.assignments.map((a) => {
    const group = groups.get(a.groupId);
    const paper = Array.isArray(a.submissionTypes) && a.submissionTypes.some((t) => t === 'on_paper' || t === 'none');
    return {
      id: `${snapshot.host}:${a.id}`,
      name: a.name || 'Assignment',
      courseId: `${snapshot.host}:${a.courseId}`,
      courseName: courses.get(a.courseId) || 'Course',
      dueAt: a.dueAt ? Date.parse(a.dueAt) : null,
      pointsPossible: a.pointsPossible || 0,
      weight: group ? group.weight || 0 : 0,
      groupName: group ? group.name : '',
      submitted: Boolean(a.submittedAt) || done.has(a.workflowState) || (paper && typeof a.score === 'number'),
      score: typeof a.score === 'number' ? a.score : null,
      excused: Boolean(a.excused),
      // Handed in on paper, or nothing to hand in: Canvas never shows these as submitted.
      noSubmit: paper,
    };
  });
}

/** A made-up semester around "now", so the game can be played without connecting anything. */
export function demoSemester(now = Date.now()) {
  const h = 3600000;
  const mk = (id, courseId, courseName, name, dueIn, pointsPossible, weight, groupName, extra = {}) => ({
    id: `demo:${id}`, name, courseId: `demo:${courseId}`, courseName, dueAt: now + dueIn, pointsPossible, weight, groupName, submitted: false, score: null, excused: false, ...extra,
  });
  return [
    mk(1, 'phys', 'Physics 151', 'Problem Set 6', -2 * DAY, 20, 15, 'Homework', { submitted: true, score: 19 }),
    mk(2, 'math', 'Linear Algebra', 'Quiz 4', -3 * DAY, 25, 10, 'Quizzes', { submitted: true, score: 21 }),
    mk(3, 'writ', 'Writing Seminar', 'Reading Response 5', -1 * DAY, 10, 10, 'Responses', { submitted: true, score: 7 }),
    mk(4, 'phys', 'Physics 151', 'Problem Set 7', 9 * h, 20, 15, 'Homework'),
    mk(5, 'math', 'Linear Algebra', 'Homework 9', 1.5 * DAY, 30, 20, 'Homework'),
    mk(6, 'math', 'Linear Algebra', 'Midterm 2', 2.5 * DAY, 100, 25, 'Exams'),
    mk(7, 'writ', 'Writing Seminar', 'Essay 2 Draft', 4 * DAY, 60, 30, 'Essays'),
    mk(8, 'phys', 'Physics 151', 'Lab Report 4', 5.5 * DAY, 40, 20, 'Labs'),
    mk(9, 'phys', 'Physics 151', 'Problem Set 8', 7 * DAY, 20, 15, 'Homework'),
    mk(10, 'writ', 'Writing Seminar', 'Reading Response 6', 8.5 * DAY, 10, 10, 'Responses'),
    mk(11, 'phys', 'Physics 151', 'Final Exam', 16 * DAY, 200, 30, 'Exams'),
  ];
}

// --- Saving ---------------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

/** Loads a save, filling in anything a newer version added. Returns a fresh state if the save is unusable. */
export function deserialize(text, now = Date.now()) {
  const fresh = newState(now);
  try {
    const saved = JSON.parse(text);
    if (!saved || saved.v !== 1) return fresh;
    const state = { ...fresh, ...saved };
    state.pads = { earth: [...(saved.pads?.earth || [])], moon: [...(saved.pads?.moon || [])] };
    state.pads.earth.length = EARTH_PADS;
    state.pads.moon.length = MOON_PADS;
    for (const scene of ['earth', 'moon']) state.pads[scene] = Array.from(state.pads[scene], (b) => b || null);
    state.school = { ...fresh.school, ...(saved.school || {}) };
    // Work seen before late losses existed starts its clock now, not at its due date.
    for (const seen of Object.values(state.school.seen)) if (!seen.at) seen.at = now;
    state.study = { ...fresh.study, ...(saved.study || {}) };
    state.explore = { ...fresh.explore, ...(saved.explore || {}) };
    state.cosmetics = { ...fresh.cosmetics, ...(saved.cosmetics || {}) };
    state.stats = { ...fresh.stats, ...(saved.stats || {}) };
    state.hero = { ...fresh.hero, ...(saved.hero || {}) };
    state.hero.gear = { ...fresh.hero.gear, ...(saved.hero?.gear || {}) };
    state.quest = { ...fresh.quest, ...(saved.quest || {}) };
    // A save from before heroes existed: the minutes already studied still count.
    if (!saved.hero && state.study.total > 0) addXp(state, state.study.total * XP_PER_MINUTE);
    state.settings = { ...fresh.settings, ...(saved.settings || {}) };
    return state;
  } catch {
    return fresh;
  }
}
