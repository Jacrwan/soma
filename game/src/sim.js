// Epoch: game rules with no rendering. Everything here is plain data and
// functions so it can be tested in Node and trusted by the 3D layer.

export const SAVE_KEY = 'epoch-save-v1';

// era: the age your civilization is in. Building wonder N moves you from
// era N to era N + 1. Era 6 is reached by launching the rocket.
export const ERAS = [
  { name: 'Stone Age', short: 'Stone', wonder: 'Stone Circle', wonderCost: 16000 },
  { name: 'Bronze Age', short: 'Bronze', wonder: 'Great Pyramid', wonderCost: 600000 },
  { name: 'Medieval Age', short: 'Medieval', wonder: 'Grand Cathedral', wonderCost: 2e7 },
  { name: 'Industrial Age', short: 'Industrial', wonder: 'Iron Tower', wonderCost: 5.4e8 },
  { name: 'Modern Age', short: 'Modern', wonder: 'Sky Spire', wonderCost: 1.6e10 },
  { name: 'Space Age', short: 'Space', wonder: 'Moon Rocket', wonderCost: 4.8e11 },
  { name: 'Lunar Age', short: 'Lunar', wonder: 'Star Gate', wonderCost: 3.6e13 },
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

export const EARTH_PADS = 40; // building slots on Earth; the first 16 have fixed spots, the rest go wherever you place them
export const FIXED_EARTH_PADS = 16;
export const MOON_PADS = 8;

export function padsUnlocked(state, scene = state.scene) {
  if (scene === 'moon') return state.era >= MOON_TIER ? MOON_PADS : 0;
  return Math.min(EARTH_PADS - 2, 8 + 6 * Math.min(state.era, LAST_EARTH_TIER));
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
    padSpots: { earth: {}, moon: {} }, // index -> { x, z, rot } for buildings placed by hand
    wonders: [],
    relics: [],
    tokens: 0,
    cosmetics: { owned: ['hat:none', 'color:clay'], hat: 'hat:none', color: 'color:clay', character: 'barbarian', outfits: [], outfit: null, themes: [], theme: null },
    school: { source: 'none', items: {}, seen: {}, chests: [], ignored: {}, penalty: {}, warned: {} },
    explore: { day: null, done: {}, shrines: {} },
    study: { active: null, minutes: {}, courses: {}, log: [], practice: {}, streak: 0, lastDay: null, chestDay: null, chestsToday: 0, total: 0 },
    hero: { level: 1, xp: 0, points: 0, skills: {}, gear: { weapon: null, armor: null, charm: null }, bag: [], nextId: 1 },
    quest: { step: 0 },
    stats: { collected: 0, raidersBeaten: 0, bossesBeaten: 0, chestsOpened: 0, handedIn: 0, campsCleared: 0, treasures: 0, realmBosses: {} },
    settings: { muted: false, music: true, sfx: true, musicVol: 0.6, sfxVol: 0.8, sensitivity: 1, quality: 'auto', labels: true },
    review: { cards: [], nextId: 1, learned: 0 },
    market: { day: null, offers: [] },
    decor: [],
    decorNext: 1,
    decorUnlocked: [],
    villagers: { list: [], away: {}, lastArrival: 0, day: null },
    daily: { day: null, quests: [], streak: 0, best: 0, lastFull: null, bonus: false, reported: null },
    critters: { lures: 3, caught: {}, pet: null },
    soma: { status: 'offline', todos: [], readings: [], done: {} },
    steps: {}, // itemId -> [{ id, text, done, somaId? }]
    vault: { owned: {}, sinceEpic: 0, sinceMythic: 0, showcase: [], aura: null },
    topics: {}, // exam itemId -> [{ name, minutes }]
    pass: { season: 'Fall 2026', points: 0, premium: false, freeClaimed: [], premiumClaimed: [] },
    tutorial: { step: 0, done: false },
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
  // Exams are usually sat in person, so Canvas's "on paper" says nothing about them.
  return typeof choice === 'boolean' ? choice : Boolean(item.noSubmit) && item.kind !== 'boss';
}

export function setIgnored(state, id, on, now = Date.now()) {
  state.school.ignored[id] = Boolean(on);
  // Coming back from ignored starts the clock again now, not from the due date.
  const p = state.school.penalty[id];
  if (p) p.at = now;
}

/** Work that is past due, not handed in, and not ignored. */
export function lateItems(state, now = Date.now()) {
  // An exam is never "late": exam day settles it instead (resolveExams).
  return Object.values(state.school.items).filter((a) => a.kind !== 'boss' && !a.submitted && !a.excused && a.dueAt && a.dueAt < now && !isIgnored(state, a));
}

/** 'late', 'critical', 'urgent' or null. */
export function deadlineLevel(state, item, now = Date.now()) {
  if (item.submitted || item.excused || !item.dueAt || isIgnored(state, item)) return null;
  const left = item.dueAt - now;
  if (left < 0) return item.kind === 'boss' ? null : 'late';
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

/** Coins per second from every building, ignoring any siege. */
export function baseIncome(state) {
  let sum = 0;
  for (const scene of ['earth', 'moon']) for (const b of state.pads[scene]) sum += buildingIncome(state, b);
  return sum;
}

/**
 * What a second is worth in coins right now. Every reward and market price is
 * counted in seconds of this. It is the town's income, but never less than a
 * fresh town in your age makes (a home and a works), so prices and pay don't
 * crash when a new age starts with an empty town and full pockets.
 */
export function wage(state) {
  const fresh = (BUILDINGS.home.income + BUILDINGS.work.income) * INCOME_PER_TIER ** tierFor(state, state.era >= MOON_TIER ? 'moon' : 'earth');
  return Math.max(baseIncome(state), fresh);
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

/**
 * Builds wherever you choose (build mode). Uses a free slot, preferring the
 * ones without a fixed spot. Returns the slot index, or -1 if it can't.
 */
export function placeBuilding(state, type, x, z, rot = 0, scene = 'earth') {
  if (!BUILDINGS[type]) return -1;
  const open = padsUnlocked(state, scene);
  const pads = state.pads[scene];
  let index = -1;
  for (let i = scene === 'earth' ? FIXED_EARTH_PADS : 0; i < open && index < 0; i++) if (!pads[i]) index = i;
  for (let i = 0; i < Math.min(open, scene === 'earth' ? FIXED_EARTH_PADS : open) && index < 0; i++) if (!pads[i]) index = i;
  if (index < 0) return -1;
  if (!build(state, index, type, scene)) return -1;
  state.padSpots[scene][index] = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot: Math.round(rot * 100) / 100 };
  return index;
}

/** How many buildings are standing, and how many this age allows. */
export function buildingCount(state, scene = 'earth') {
  return { used: state.pads[scene].filter(Boolean).length, room: padsUnlocked(state, scene) };
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
  // A wonder on Earth ends the age: the town moves to a new landscape and
  // starts empty. Hero, coins, school, creatures and villagers come along;
  // the old buildings stay behind, decorations are sold for half, and a
  // settler's purse pays for a first home and works in the new age.
  // (The Moon Rocket is the exception: you fly from Space Age land.)
  if (wonder.scene === 'earth' && wonder.index < MOON_TIER - 1) {
    const out = newLand(state);
    return { ...wonder, ...out };
  }
  return wonder;
}

/** Empties the town for a fresh start in the next age. Returns { purse, decorBack }. */
export function newLand(state) {
  state.pads.earth = state.pads.earth.map(() => null);
  state.padSpots.earth = {};
  let decorBack = 0;
  for (const d of state.decor) decorBack += Math.floor((d.paid || 0) / 2);
  state.decor = [];
  const tier = tierFor(state, 'earth');
  const purse = buildCost('home', tier) * 2 + buildCost('work', tier);
  addCoins(state, purse + decorBack);
  state.stats.lands = (state.stats.lands || 1) + 1;
  return { purse, decorBack, newLand: true };
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
        // An exam's grade is the big payday: double XP and coins on top of the chest.
        const exam = item.kind === 'boss';
        if (exam && !first) {
          chest.coins = Math.round(Math.max(300, wage(state) * 900) * (percent / 100));
          addCoins(state, chest.coins);
        }
        events.push({ type: 'chest', chest, exam, ...addXp(state, first ? 0 : (40 + percent) * (exam ? 2 : 1)) });
      }
    }
  }
  school.items = next;
  return events;
}

export function handInReward(state, item) {
  const seconds = [0, 120, 300, 900][item.size || 1];
  return Math.round(Math.max(60 * (item.size || 1), wage(state) * seconds) * (1 + STUDIED_BONUS * studyProgress(state, item)));
}

// --- Studying: a real timer you run while you do the work ---------------------------

export const STUDY_PAY = 90; // each minute studied pays this many seconds of town income
export const FOCUS_MULT = 2; // the town earns this much more while a session runs
export const STUDY_LENGTHS = [{ minutes: 10, rarity: 'common' }, { minutes: 25, rarity: 'rare' }, { minutes: 45, rarity: 'epic' }];
export const STUDY_GOAL = [0, 30, 60, 120]; // minutes that fully prepare an item, by size
export const STUDY_CHESTS_PER_DAY = 3;
export const STUDIED_BONUS = 0.5; // extra hand-in reward for a fully studied item
const MIN_SESSION = 5; // minutes; shorter than this earns nothing

const dayOf = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function isStudying(state, now = Date.now()) {
  const a = state.study?.active;
  return Boolean(a && now < a.endsAt);
}

export const EXAM_COURSE_SHARE = 0.5; // other study for the same course counts half toward an exam
export const EXAM_PREP_DAYS = 10; // ...if it was done in this many days before the exam

/**
 * 0 to 1: how prepared you are for this item. For an exam, sessions on the
 * exam itself count in full and other sessions for the same course in the
 * days before it count half.
 */
export function studyProgress(state, item) {
  if (!item) return 0;
  let minutes = state.study?.minutes[item.id] || 0;
  if (item.kind === 'boss' && item.dueAt) {
    for (const s of state.study?.log || []) {
      if (s.itemId !== item.id && s.courseId === item.courseId && s.at <= item.dueAt && s.at > item.dueAt - EXAM_PREP_DAYS * DAY) minutes += s.minutes * EXAM_COURSE_SHARE;
    }
  }
  if (item.kind === 'boss') minutes *= 1 + 0.15 * skillRank(state, 'exam');
  return Math.min(1, minutes / STUDY_GOAL[item.size || 1]);
}

/** 0 to 1: the armor an exam boss still wears. Studying strips it. */
export const examArmor = (state, item) => {
  // With topics set, half the armor is general study and half is the topics'
  // crystals, so studying the wrong things leaves weak points standing.
  const topics = state.topics?.[item.id];
  if (!topics || !topics.length) return 1 - studyProgress(state, item);
  return 1 - Math.min(1, 0.5 * studyProgress(state, item) + 0.5 * topicProgress(state, item));
};

export function studyChestsLeft(state, now = Date.now()) {
  return state.study.chestDay === dayOf(now) ? Math.max(0, STUDY_CHESTS_PER_DAY - state.study.chestsToday) : STUDY_CHESTS_PER_DAY;
}

/** Starts a session on an item (or on nothing in particular, with itemId null). */
export function startStudy(state, itemId, minutes, now = Date.now(), topic = null) {
  if (state.study.active || !(minutes > 0)) return null;
  state.study.active = { itemId: itemId ?? null, minutes, startedAt: now, endsAt: now + minutes * 60000, ...(topic ? { topic } : {}) };
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
  if (item && a.topic) addTopicMinutes(state, item.id, a.topic, minutes);
  // Every 10 minutes studied earns a lure for catching creatures in the Wilds.
  study.lureBank = (study.lureBank || 0) + minutes;
  result.lures = Math.floor(study.lureBank / LURE_MINUTES);
  study.lureBank -= result.lures * LURE_MINUTES;
  state.critters.lures += result.lures;
  study.log = [...(study.log || []), { at: now, itemId: item ? item.id : null, courseId: item ? item.courseId : null, minutes }].slice(-400);
  result.coins = Math.round(wage(state) * STUDY_PAY * minutes);
  passPoints(state, minutes);
  addCoins(state, result.coins);
  // A cup of study tea from the market makes this session pay half again.
  const tea = study.tea > 0 ? (study.tea -= 1, 1 + TEA_BOOST) : 1;
  result.tea = tea > 1;
  Object.assign(result, addXp(state, minutes * XP_PER_MINUTE * (complete ? XP_FULL_SESSION : 1) * heroStats(state).studyXp * tea));
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

// --- Practice questions (written by Soma's AI from the course notes) ----------
// A right answer counts as a few minutes of study for that item, so practice
// strips an exam's armor too. Capped per item per day, so it can't be farmed.
export const PRACTICE_RIGHT_MINUTES = 5;
export const PRACTICE_WRONG_MINUTES = 1; // a wrong answer still teaches something
export const PRACTICE_DAILY_MINUTES = 40;
export const PRACTICE_XP = 8; // per right answer

/** Minutes of study credit practice can still give this item today. */
export function practiceRoom(state, itemId, now = Date.now()) {
  const p = state.study.practice?.[itemId];
  return Math.max(0, PRACTICE_DAILY_MINUTES - (p && p.day === dayOf(now) ? p.minutes : 0));
}

/** Pays for one practice round. Returns { minutes, xp, levels, prepared, capped }. */
export function finishPractice(state, itemId, right, wrong, now = Date.now(), topic = null) {
  const item = itemId ? state.school.items[itemId] || null : null;
  const room = item ? practiceRoom(state, itemId, now) : 0;
  const minutes = Math.min(room, right * PRACTICE_RIGHT_MINUTES + wrong * PRACTICE_WRONG_MINUTES);
  const result = { minutes, prepared: false, capped: Boolean(item) && minutes < right * PRACTICE_RIGHT_MINUTES + wrong * PRACTICE_WRONG_MINUTES };
  state.stats.practiceRight = (state.stats.practiceRight || 0) + right;
  // Practice on one topic chips that topic's crystal, outside the daily practice cap.
  if (itemId && topic) addTopicMinutes(state, itemId, topic, right * PRACTICE_RIGHT_MINUTES);
  passPoints(state, right * 3);
  // A perfect round (5 of 5) drops a rare chest.
  result.chest = right >= 5 && wrong === 0 ? grantChest(state, 'rare', 'A perfect practice round') : null;
  // A good practice round (3+ right) also earns a lure.
  result.lures = right >= 3 ? 1 : 0;
  state.critters.lures += result.lures;
  if (item && minutes > 0) {
    const before = studyProgress(state, item);
    const study = state.study;
    study.practice = study.practice || {};
    const p = study.practice[itemId] && study.practice[itemId].day === dayOf(now) ? study.practice[itemId] : { day: dayOf(now), minutes: 0 };
    p.minutes += minutes;
    study.practice[itemId] = p;
    study.minutes[item.id] = (study.minutes[item.id] || 0) + minutes;
    study.courses[item.courseId] = (study.courses[item.courseId] || 0) + minutes;
    study.log = [...(study.log || []), { at: now, itemId: item.id, courseId: item.courseId, minutes }].slice(-400);
    result.prepared = before < 1 && studyProgress(state, item) >= 1;
  }
  return Object.assign(result, addXp(state, right * PRACTICE_XP * heroStats(state).studyXp));
}

/** What the gate looks like right now: who is marching, who is sieging. */
export function threats(state, now = Date.now()) {
  const out = [];
  for (const item of Object.values(state.school.items)) {
    if (item.submitted || item.excused || isIgnored(state, item)) continue;
    const seen = state.school.seen[item.id];
    if (item.kind === 'boss' && seen && (seen.exam || seen.boss)) continue;
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
export const CHEST_COINS = { common: 0.008, rare: 0.02, epic: 0.05, legendary: 0.12 }; // shares of this age's wonder

/** Opens a chest: returns what was inside and applies it to the state. rng returns 0..1. */
export function openChest(state, chestId, rng = Math.random, now = Date.now()) {
  const i = state.school.chests.findIndex((c) => c.id === chestId);
  if (i < 0) return null;
  const [chest] = state.school.chests.splice(i, 1);
  const loot = [];
  const coins = Math.round(ageCost(state) * CHEST_COINS[chest.rarity]);
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
  const found = rollCollectible(state, chest.rarity, rng);
  if (found) loot.unshift({ kind: 'collectible', ...found });
  state.stats.chestsOpened += 1;
  return { chest, loot, best: found ? found.tier : null };
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

/**
 * Hidden caches in the country around town: each gives a chest once a day.
 * A new age is a new land, with its own caches. One in five is rare.
 */
export const cacheKey = (state, i) => `cache:${state.era}:${i}`;
export function openCache(state, i, now = Date.now()) {
  const key = cacheKey(state, i);
  if (exploreDone(state, key, now)) return null;
  markExplored(state, key, now);
  state.stats.caches = (state.stats.caches || 0) + 1;
  const roll = seededRng([...`${dayOf(now)}${key}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7))();
  return grantChest(state, roll < 0.2 ? 'rare' : 'common', 'A hidden cache');
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
  const reward = Math.round(Math.max([15, 45, 600][tier], wage(state) * [25, 80, 900][tier]));
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
  if (courseId !== null) prep += (state.study?.courses[courseId] || 0) / 60;
  return Math.round(heroStats(state).might * (1 + Math.min(prep, 8) * 0.1));
}

// --- Exam day -------------------------------------------------------------------
// An exam marches on the town for days. Nobody fights it: studying strips its
// armor, and on exam day it reaches the gate and the armor left decides what
// happens. The real grade, when it comes in, pays the reward (syncSchool).

export const EXAM_HELD = 0.2; // armor at or under this: the gate holds
export const EXAM_DENTED = 0.6; // at or under this: the walls take a hit; over it, a building is wrecked

export function examOutcome(armor) {
  return armor <= EXAM_HELD ? 'held' : armor <= EXAM_DENTED ? 'dented' : 'wrecked';
}

/**
 * Settles every exam whose day has come (or that was handed in online).
 * Returns one event per exam: { type: 'exam', item, outcome, armor, coins, chest, wrecked }.
 * An exam first seen after its date is settled quietly, with nothing lost.
 */
export function resolveExams(state, now = Date.now()) {
  const events = [];
  for (const item of Object.values(state.school.items)) {
    if (item.kind !== 'boss' || !item.dueAt) continue;
    const seen = state.school.seen[item.id];
    if (!seen || seen.exam || seen.boss) continue;
    if (item.excused || isIgnored(state, item)) continue;
    if (!(item.dueAt <= now || item.submitted)) continue;
    const armor = examArmor(state, item);
    if ((seen.at || now) >= item.dueAt) {
      seen.exam = { outcome: 'unseen', armor, at: now };
      continue;
    }
    const outcome = examOutcome(armor);
    const event = { type: 'exam', item, outcome, armor, coins: 0, chest: null, wrecked: null };
    if (outcome === 'held') {
      state.stats.bossesBeaten += 1;
      event.coins = Math.max(500, Math.round(wage(state) * 1200));
      addCoins(state, event.coins);
      event.chest = grantChest(state, 'epic', `Held the gate: ${item.name}`);
    } else {
      event.coins = -Math.floor(state.coins * (outcome === 'dented' ? 0.05 : 0.1));
      state.coins += event.coins;
      if (outcome === 'wrecked') event.wrecked = wreckBuilding(state);
    }
    seen.exam = { outcome, armor, at: now };
    event.left = villagersFeel(state, { held: 10, dented: -12, wrecked: -30 }[outcome], now);
    events.push(event);
  }
  return events;
}

/** The town's best building loses a level (or its stored coins at level 1). Returns { scene, index } or null. */
function wreckBuilding(state) {
  let best = null;
  state.pads.earth.forEach((b, index) => {
    if (b && (!best || buildingIncome(state, b) > buildingIncome(state, best.b))) best = { b, index };
  });
  if (!best) return null;
  if (best.b.level > 1) best.b.level -= 1;
  best.b.stored = 0;
  return { scene: 'earth', index: best.index };
}

// --- The hero: an RPG character whose levels come from school ----------------------
// Fighting pays coins and gear. Experience only comes from studying, handing
// work in, grades and test bosses, so the way to get stronger is to do the work.

export const XP_PER_MINUTE = 4;
export const XP_FULL_SESSION = 1.25; // a session that runs its full length pays this much more
export const XP_HAND_IN = [0, 40, 80, 160]; // by assignment size
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
  exam: { branch: 'Scholar', name: 'Exam Nerves', max: 3, text: 'Study counts 15% more toward exams' },
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
    studyXp: (1 + 0.06 * skillRank(state, 'worm')) * (1 + petBonus(state)),
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
  { title: 'Exam season', text: 'Study enough that an exam boss breaks on your gate', need: 1, have: (s) => s.stats.bossesBeaten, reward: { gear: 'epic', slot: 'charm' } },
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

// --- Review: missed practice questions come back (spaced repetition) ---------
// A question you got wrong is saved and asked again 1, 3 and 7 days later.
// Right on the last one and it is learned. A miss sends it back to day 1.
export const REVIEW_GAPS = [1, 3, 7]; // days
export const REVIEW_RIGHT_MINUTES = 10; // twice a practice answer: remembering is what counts
export const REVIEW_MAX = 150;

/** Saves a missed question for review. q: { q, choices, answer, why }. */
export function addReview(state, item, q, now = Date.now()) {
  const cards = state.review.cards;
  if (cards.some((c) => c.q === q.q)) return null;
  const card = { id: `r${state.review.nextId++}`, itemId: item?.id || null, courseId: item?.courseId || null, course: item?.courseName || '', from: item?.name || '', q: q.q, choices: q.choices, answer: q.answer, why: q.why || '', box: 0, due: now + REVIEW_GAPS[0] * DAY, ...(q.topic ? { topic: q.topic } : {}) };
  cards.push(card);
  if (cards.length > REVIEW_MAX) cards.splice(0, cards.length - REVIEW_MAX);
  return card;
}

export const dueReviews = (state, now = Date.now()) => state.review.cards.filter((c) => c.due <= now);

/**
 * Answers one review card. Right moves it to the next gap (or retires it);
 * wrong starts it over. Right answers count as study for the item they came
 * from, which breaks an exam's armor. Returns { learned, minutes, xp, ... }.
 */
export function answerReview(state, cardId, right, now = Date.now()) {
  const cards = state.review.cards;
  const i = cards.findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  const card = cards[i];
  const out = { learned: false, minutes: 0, prepared: false };
  state.stats.reviewed = (state.stats.reviewed || 0) + 1;
  if (right) passPoints(state, 4);
  if (right) {
    card.box += 1;
    if (card.box >= REVIEW_GAPS.length) {
      cards.splice(i, 1);
      out.learned = true;
      state.review.learned += 1;
      out.chest = grantChest(state, 'common', 'A question learned for good');
    } else card.due = now + REVIEW_GAPS[card.box] * DAY;
    const item = card.itemId ? state.school.items[card.itemId] : null;
    if (item) {
      const before = studyProgress(state, item);
      const study = state.study;
      out.minutes = REVIEW_RIGHT_MINUTES;
      study.minutes[item.id] = (study.minutes[item.id] || 0) + out.minutes;
      study.courses[item.courseId] = (study.courses[item.courseId] || 0) + out.minutes;
      study.log = [...(study.log || []), { at: now, itemId: item.id, courseId: item.courseId, minutes: out.minutes }].slice(-400);
      out.prepared = before < 1 && studyProgress(state, item) >= 1;
      if (card.topic) addTopicMinutes(state, item.id, card.topic, REVIEW_RIGHT_MINUTES);
    } else if (card.courseId) {
      state.study.courses[card.courseId] = (state.study.courses[card.courseId] || 0) + REVIEW_RIGHT_MINUTES;
    }
  } else {
    card.box = 0;
    card.due = now + REVIEW_GAPS[0] * DAY;
  }
  return Object.assign(out, addXp(state, right ? 2 * PRACTICE_XP * heroStats(state).studyXp : 0));
}

// --- Class halls: one building per course, growing with study --------------
// Floors come from course mastery (15, 60, 135... minutes studied).

/** Every course the game knows, with the floors its hall has. */
export function courseHalls(state) {
  const seen = new Map();
  for (const a of Object.values(state.school.items)) if (a.courseId && !seen.has(a.courseId)) seen.set(a.courseId, a.courseName || 'Course');
  return [...seen].map(([id, name]) => ({ id, name, level: mastery(state, id), minutes: Math.round(state.study.courses[id] || 0) }));
}

// --- Market -----------------------------------------------------------------
// New stock every day: gear, a look, a study tea, and a rare decoration.

function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const price = (state, seconds) => Math.round(wage(state) * seconds);

/**
 * The market prices everything as a share of this age's wonder, so a chest
 * is always a real choice against moving on: a rare chest is a twentieth of
 * the wonder, a legendary one nearly a third. (Hours of income would not
 * work: income grows so fast inside an age that it outruns the wonder.)
 */
export function ageCost(state) {
  const era = ERAS[state.era];
  return Number.isFinite(era?.wonderCost) ? era.wonderCost : ERAS[MOON_TIER].wonderCost * 30;
}
const share = (state, part) => Math.round(ageCost(state) * part);
export const TEA_BOOST = 0.5; // the next study session pays 50% more XP

/** Today's stock. Rolled once a day and kept, so it doesn't change on reload. */
export function marketStock(state, now = Date.now()) {
  const day = dayOf(now);
  const m = state.market;
  if (m.day === day && m.offers.length) {
    // Stock from before chests were sold gets today's chest added.
    if (!m.offers.some((o) => o.kind === 'chest')) m.offers.push(marketChest(state, day));
    return m.offers;
  }
  const rng = seededRng([...day].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 17) ^ (state.hero.level * 7919));
  const offers = [];
  const gearRarity = () => (rng() < 0.15 ? 'legendary' : rng() < 0.5 ? 'epic' : 'rare');
  for (const slot of SLOTS) {
    const rarity = gearRarity();
    const item = rollGear(state, rarity, rng, slot);
    offers.push({ kind: 'gear', item, price: share(state, { rare: 0.025, epic: 0.06, legendary: 0.15 }[rarity]), sold: false });
  }
  const looks = COSMETICS.filter((c) => !state.cosmetics.owned.includes(c));
  for (let k = 0; k < 2 && looks.length; k++) {
    const id = looks.splice(Math.floor(rng() * looks.length), 1)[0];
    offers.push({ kind: 'look', id, price: share(state, 0.03), sold: false });
  }
  offers.push({ kind: 'tea', price: share(state, 0.01), sold: false });
  const rare = Object.keys(DECOR).filter((k) => DECOR[k].market && !state.decorUnlocked.includes(k));
  if (rare.length) offers.push({ kind: 'decor', id: rare[Math.floor(rng() * rare.length)], price: share(state, 0.04), sold: false });
  offers.push(marketChest(state, day));
  m.day = day;
  m.offers = offers;
  return offers;
}

// One chest a day, bought with coins (which only come from playing and
// studying, never from real money). Most days rare, some epic, now and then legendary.
// Priced well above the coins inside (CHEST_COINS), so buying chests never pays for itself.
export const CHEST_PRICE = { rare: 0.05, epic: 0.12, legendary: 0.3 };
function marketChest(state, day) {
  const r = seededRng([...day].reduce((h, ch) => (h * 33 + ch.charCodeAt(0)) >>> 0, 5))();
  const rarity = r < 0.06 ? 'legendary' : r < 0.32 ? 'epic' : 'rare';
  return { kind: 'chest', rarity, price: share(state, CHEST_PRICE[rarity]), sold: false };
}

/** Buys offer i. Returns what was bought, or null if it can't be. */
export function buyOffer(state, i, now = Date.now()) {
  const offer = marketStock(state, now)[i];
  if (!offer || offer.sold || state.coins < offer.price) return null;
  state.coins -= offer.price;
  offer.sold = true;
  if (offer.kind === 'gear') return { offer, ...addGear(state, { ...offer.item, id: `g${state.hero.nextId++}` }) };
  if (offer.kind === 'look') state.cosmetics.owned.push(offer.id);
  else if (offer.kind === 'tea') state.study.tea = (state.study.tea || 0) + 1;
  else if (offer.kind === 'decor') state.decorUnlocked.push(offer.id);
  else if (offer.kind === 'chest') return { offer, chest: grantChest(state, offer.rarity, 'The market') };
  return { offer };
}

/** Sells every bag item weaker than what is worn in its slot. Returns coins made. */
export function sellJunk(state) {
  const hero = state.hero;
  let coins = 0;
  for (const item of [...hero.bag]) {
    if (gearScore(item) <= gearScore(hero.gear[item.slot])) {
      coins += sellValue(item);
      hero.bag.splice(hero.bag.indexOf(item), 1);
    }
  }
  addCoins(state, coins);
  return coins;
}

// --- Decorations: build mode, placed anywhere in town ------------------------
// cost is in seconds of town income (see wage); market ones are unlocked
// by buying them once at the market.
export const DECOR = {
  fence: { name: 'Fence', seconds: 20, floor: 20, solid: 0.6 },
  path: { name: 'Path stones', seconds: 15, floor: 15, solid: 0 },
  flowers: { name: 'Flower bed', seconds: 30, floor: 30, solid: 0 },
  bush: { name: 'Bush', seconds: 30, floor: 30, solid: 0.7 },
  tree: { name: 'Tree', seconds: 60, floor: 60, solid: 0.8 },
  rocks: { name: 'Rocks', seconds: 40, floor: 40, solid: 0.9 },
  lamp: { name: 'Lamp post', seconds: 90, floor: 90, solid: 0.4 },
  bench: { name: 'Bench', seconds: 90, floor: 90, solid: 0.8 },
  banner: { name: 'Banner', seconds: 120, floor: 120, solid: 0.3 },
  crates: { name: 'Crates', seconds: 60, floor: 60, solid: 0.9 },
  well: { name: 'Well', seconds: 300, floor: 300, solid: 1.3 },
  statue: { name: 'Statue', seconds: 600, floor: 600, solid: 1.1 },
  hedge: { name: 'Hedge', seconds: 40, floor: 40, solid: 0.7 },
  wall: { name: 'Stone wall', seconds: 60, floor: 60, solid: 0.9 },
  arch: { name: 'Archway', seconds: 400, floor: 400, solid: 0 },
  pond: { name: 'Pond', seconds: 500, floor: 500, solid: 2.0 },
  tower: { name: 'Watchtower', seconds: 800, floor: 800, solid: 1.3 },
  windmill: { name: 'Windmill', seconds: 1200, floor: 1200, solid: 1.8 },
  // The Japanese garden set (Semester Pass).
  toro: { name: 'Stone lantern', seconds: 200, floor: 200, solid: 0.5, pass: true, set: 'garden' },
  bamboo: { name: 'Bamboo grove', seconds: 150, floor: 150, solid: 0.8, pass: true, set: 'garden' },
  torii: { name: 'Torii gate', seconds: 900, floor: 900, solid: 0, pass: true, set: 'garden' },
  koi: { name: 'Koi pond', seconds: 1200, floor: 1200, solid: 2.2, pass: true, set: 'garden' },
  bridge: { name: 'Arched bridge', seconds: 900, floor: 900, solid: 0, pass: true, set: 'garden' },
  sakura: { name: 'Cherry tree', seconds: 600, floor: 600, solid: 0.9, pass: true, set: 'garden' },
  // Vault finds (from chests).
  mushrooms: { name: 'Mushroom ring', seconds: 60, floor: 60, solid: 0, pass: true },
  owlstatue: { name: 'Owl statue', seconds: 300, floor: 300, solid: 0.9, pass: true },
  crystallamp: { name: 'Crystal lamp', seconds: 600, floor: 600, solid: 0.6, pass: true },
  obelisk: { name: 'Starfall obelisk', seconds: 1200, floor: 1200, solid: 1.2, pass: true },
  fountain: { name: 'Fountain', seconds: 1500, floor: 1500, solid: 2.2, market: true },
  totem: { name: 'Totem', seconds: 1200, floor: 1200, solid: 0.8, market: true },
  gold: { name: 'Golden statue', seconds: 2400, floor: 2400, solid: 1.1, market: true },
  tent: { name: 'Tent', seconds: 900, floor: 900, solid: 1.8, market: true },
};
export const DECOR_MAX = 160;

export const decorCost = (state, type) => price(state, DECOR[type].seconds);
export const decorAvailable = (state) => Object.keys(DECOR).filter((k) => !(DECOR[k].market || DECOR[k].pass) || state.decorUnlocked.includes(k));

/** Places a decoration; costs coins. Returns the piece, or null. */
export function placeDecor(state, type, x, z, rot = 0) {
  if (!DECOR[type] || !decorAvailable(state).includes(type) || state.decor.length >= DECOR_MAX) return null;
  const cost = decorCost(state, type);
  if (state.coins < cost) return null;
  state.coins -= cost;
  const piece = { id: state.decorNext++, type, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot: Math.round(rot * 100) / 100, paid: cost };
  state.decor.push(piece);
  return piece;
}

/** Takes a decoration back for half what it cost. */
export function removeDecor(state, id) {
  const i = state.decor.findIndex((d) => d.id === id);
  if (i < 0) return 0;
  const [piece] = state.decor.splice(i, 1);
  const back = Math.floor((piece.paid || 0) / 2);
  addCoins(state, back);
  return back;
}

// --- Villagers --------------------------------------------------------------
// People move in as the town grows, walk around, talk about your real
// schoolwork, give a small quest each day, and pack up and leave if the town
// keeps getting wrecked on exam day or work keeps going late.

export const VILLAGERS = [
  { name: 'Mira', role: 'Herbalist', look: 'rogue' },
  { name: 'Tobin', role: 'Smith', look: 'barbarian' },
  { name: 'Odo', role: 'Scholar', look: 'mage' },
  { name: 'Wren', role: 'Bard', look: 'hooded' },
  { name: 'Bram', role: 'Guard', look: 'knight' },
  { name: 'Juna', role: 'Baker', look: 'rogue' },
  { name: 'Pell', role: 'Farmer', look: 'barbarian' },
  { name: 'Sela', role: 'Merchant', look: 'hooded' },
];
export const VILLAGER_MAX = VILLAGERS.length;
const MOVE_IN_GAP = 6 * 3600000; // one arrival every 6 hours at most (the first two come at once)

/** How many people the town can hold: two to start, one more per building and per class hall with a floor. */
export function villagerRoom(state) {
  const built = state.pads.earth.filter(Boolean).length;
  const halls = courseHalls(state).filter((h) => h.level > 0).length;
  return Math.min(VILLAGER_MAX, 2 + built + halls);
}

/** Moves someone in if there's room. Returns the newcomer or null. */
export function moveIn(state, now = Date.now()) {
  const v = state.villagers;
  if (v.list.length >= villagerRoom(state)) return null;
  if (v.list.length >= 2 && now - (v.lastArrival || 0) < MOVE_IN_GAP) return null;
  const taken = new Set(v.list.map((p) => p.name));
  const pick = VILLAGERS.find((p) => !taken.has(p.name) && !(v.away[p.name] > now));
  if (!pick) return null;
  const person = { ...pick, mood: 70, friend: 0, joined: now, talked: null, gift: null, quest: null };
  person.quest = makeVillagerQuest(state, person, now);
  v.list.push(person);
  v.lastArrival = now;
  return person;
}

/** Everyone's mood moves by delta. Anyone who hits 0 leaves (and won't come back for 3 days). Returns who left. */
export function villagersFeel(state, delta, now = Date.now()) {
  const v = state.villagers;
  if (!v) return [];
  const left = [];
  for (const p of [...v.list]) {
    p.mood = Math.max(0, Math.min(100, p.mood + delta));
    if (p.mood <= 0) {
      v.list.splice(v.list.indexOf(p), 1);
      v.away[p.name] = now + 3 * DAY;
      left.push(p);
    }
  }
  return left;
}

/**
 * Once a day: late work wears everyone down (4 mood per late piece), a
 * clean day cheers them up, and each person gets a fresh quest.
 * Returns { left: [...], day } or null if today was already done.
 */
export function villagerDay(state, now = Date.now()) {
  const v = state.villagers;
  const today = dayOf(now);
  if (v.day === today) return null;
  v.day = today;
  const late = lateItems(state, now).length;
  const left = villagersFeel(state, late ? -4 * late : 5, now);
  for (const p of v.list) if (!p.quest || p.quest.day !== today) p.quest = makeVillagerQuest(state, p, now);
  return { left, late };
}

const statNow = {
  study: (state, q) => state.study.courses[q.courseId] || 0,
  studyAny: (state) => state.study.total || 0,
  handin: (state) => state.stats.handedIn || 0,
  review: (state) => state.stats.reviewed || 0,
  practice: (state) => state.stats.practiceRight || 0,
  build: (state, q) => state.decor.filter((d) => d.type === q.decor).length,
  camp: (state) => state.stats.campsCleared || 0,
};

/** A small quest that fits the person and what's on your plate today. */
export function makeVillagerQuest(state, person, now = Date.now()) {
  const next = threats(state, now).map((t) => t.item).sort((a, b) => a.dueAt - b.dueAt);
  const exam = next.find((a) => a.kind === 'boss');
  const work = next.find((a) => a.kind !== 'boss');
  const pay = Math.round(Math.max(120, wage(state) * 240));
  const options = [];
  if (exam) options.push({ type: 'study', courseId: exam.courseId, courseName: exam.courseName, target: 25, text: `Study ${exam.courseName} for 25 minutes. ${exam.name} is coming.` });
  if (work) options.push({ type: 'study', courseId: work.courseId, courseName: work.courseName, target: 20, text: `Put 20 minutes into ${work.courseName}.` });
  if (state.review.cards.length) options.push({ type: 'review', target: 5, text: 'Go over 5 missed questions by the board.' });
  if (next.length) options.push({ type: 'handin', target: 1, text: 'Hand in one thing on Canvas.' });
  options.push({ type: 'practice', target: 4, text: 'Get 4 practice questions right (P).' });
  options.push({ type: 'studyAny', target: 30, text: 'Study for 30 minutes, anything at all.' });
  const decor = { Herbalist: 'flowers', Smith: 'lamp', Farmer: 'bush', Baker: 'bench', Guard: 'fence', Bard: 'banner', Merchant: 'crates', Scholar: 'statue' }[person.role];
  if (decor) options.push({ type: 'build', decor, target: decor === 'fence' ? 3 : 1, text: `Build ${decor === 'fence' ? '3 fences' : `a ${DECOR[decor].name.toLowerCase()}`} somewhere in town (B).` });
  if (person.role === 'Guard') options.push({ type: 'camp', target: 1, text: 'Clear a camp out in the Wilds.' });
  // Each person leans toward their kind of task; the Scholar always pushes study.
  const leaning = { Scholar: ['study', 'practice', 'review'], Smith: ['build', 'studyAny'], Guard: ['camp', 'handin'], Herbalist: ['build', 'review'], Bard: ['practice', 'studyAny'], Baker: ['build', 'handin'], Farmer: ['build', 'study'], Merchant: ['handin', 'build'] }[person.role] || [];
  const seed = [...`${person.name}${dayOf(now)}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 3);
  const preferred = options.filter((o) => leaning.includes(o.type));
  const pool = preferred.length && seed % 3 !== 0 ? preferred : options;
  const q = { ...pool[seed % pool.length], day: dayOf(now), done: false, reward: { coins: pay, friend: 12 } };
  q.base = statNow[q.type](state, q);
  return q;
}

export function questProgress(state, q) {
  if (!q) return 0;
  return Math.max(0, Math.min(q.target, Math.floor(statNow[q.type](state, q) - q.base)));
}

/** Talking: once a day it's worth a little friendship. Returns true the first time today. */
export function talkTo(state, name, now = Date.now()) {
  const p = state.villagers.list.find((x) => x.name === name);
  if (!p || p.talked === dayOf(now)) return false;
  p.talked = dayOf(now);
  p.friend = Math.min(100, p.friend + 2);
  state.stats.talks = (state.stats.talks || 0) + 1;
  return true;
}

/** Hands in a finished villager quest. Returns { coins, friend, mood } or null. */
export function claimVillagerQuest(state, name) {
  const p = state.villagers.list.find((x) => x.name === name);
  if (!p || !p.quest || p.quest.done || questProgress(state, p.quest) < p.quest.target) return null;
  p.quest.done = true;
  p.friend = Math.min(100, p.friend + p.quest.reward.friend);
  p.mood = Math.min(100, p.mood + 8);
  addCoins(state, p.quest.reward.coins);
  return { coins: p.quest.reward.coins, friend: p.quest.reward.friend };
}

/** Good friends (50+) leave a small gift once a day: coins, or study tea at 80+. */
export function villagerGift(state, name, now = Date.now()) {
  const p = state.villagers.list.find((x) => x.name === name);
  if (!p || p.friend < 50 || p.gift === dayOf(now)) return null;
  p.gift = dayOf(now);
  if (p.friend >= 80) {
    state.study.tea = (state.study.tea || 0) + 1;
    return { tea: 1 };
  }
  const coins = Math.round(Math.max(200, wage(state) * 600));
  addCoins(state, coins);
  return { coins };
}

export function giftReady(state, name, now = Date.now()) {
  const p = state.villagers.list.find((x) => x.name === name);
  return Boolean(p && p.friend >= 50 && p.gift !== dayOf(now));
}

const ago = (ms) => (ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} minutes` : ms < DAY ? `${Math.round(ms / 3600000)} hours` : `${Math.round(ms / DAY)} days`);

/**
 * Something this person would say right now, from your real school
 * situation. k picks among the things that apply, so lines vary.
 */
export function villagerLine(state, person, now = Date.now(), k = 0) {
  const lines = [];
  const late = lateItems(state, now);
  const next = threats(state, now).map((t) => t.item).sort((a, b) => a.dueAt - b.dueAt);
  const exam = next.find((a) => a.kind === 'boss');
  const soon = next.find((a) => a.kind !== 'boss' && a.dueAt > now && a.dueAt - now < DAY);
  if (person.mood < 30) lines.push(person.mood < 15 ? "I've started packing. One more bad day and I'm gone." : "Honestly? This town's been rough lately. I'm thinking about leaving.");
  if (late.length) lines.push(late.length === 1 ? `${late[0].name} has been chasing you around for ${ago(now - late[0].dueAt)}. Just hand it in.` : `${late.length} late things are stomping around town. It's getting loud.`);
  if (soon) lines.push(`${soon.name} is due in ${ago(soon.dueAt - now)}. It's already inside the walls, you know.`);
  if (exam) {
    const armor = Math.round(examArmor(state, exam) * 100);
    lines.push(armor > 60 ? `${exam.name} still has ${armor}% of its armor. If it hits the gate like that, it's taking a building with it.`
      : armor > 20 ? `${exam.name} is down to ${armor}% armor. A bit more studying and the gate holds.`
        : `${exam.name} is barely armored now. Whatever you did, keep doing it.`);
  }
  if (state.study.streak >= 2) lines.push(`${state.study.streak} days of studying in a row. The whole town noticed.`);
  if (state.review.cards.some((c) => c.due <= now)) lines.push('Those pale books by the board are your missed questions. They want a rematch.');
  const halls = courseHalls(state);
  const tall = [...halls].sort((a, b) => b.level - a.level)[0];
  const low = [...halls].sort((a, b) => a.level - b.level)[0];
  if (tall && tall.level >= 2) lines.push(`The ${tall.name} hall keeps getting taller. You can see it from the fields.`);
  if (low && low.level === 0 && halls.length > 1) lines.push(`The ${low.name} hall is still scaffolding. Just saying.`);
  if (person.quest && !person.quest.done) lines.push(questProgress(state, person.quest) >= person.quest.target ? 'You did it! Come talk to me.' : `Don't forget: ${person.quest.text.charAt(0).toLowerCase()}${person.quest.text.slice(1)}`);
  const flavor = {
    Herbalist: ['Chamomile helps before exams. So does actually studying.', 'The flowers do better when you study. I have no proof. I believe it.'],
    Smith: ['Every floor on those halls, I forged the nails for.', 'A lamp or two by the road would help at night.'],
    Scholar: ['Twenty-five minutes, then a break. Works every time.', "Practice questions are how you find out what you don't know."],
    Bard: ["I'm writing a song about the time the gate held. Make it happen.", 'Every grade that comes in, I add a verse.'],
    Guard: ["I can hold the wall against raiders. Exams? That's on you.", 'Stay off the road when the books come through.'],
    Baker: ['Fresh bread for anyone who finishes a full session.', 'Smells like a study day. I can tell.'],
    Farmer: ["Crops don't grow overnight. Neither do grades.", 'Quiet out in the fields today.'],
    Merchant: ['New stock at the market today. Prices fair, mostly.', 'Coins are nice. Coins and a good grade, better.'],
  }[person.role] || ['Nice day.'];
  lines.push(...flavor);
  return lines[((k % lines.length) + lines.length) % lines.length];
}

// --- Daily quests and the streak ---------------------------------------------
// Three small quests a day. Finish all three to keep the streak; days 7, 14
// and 30 pay big. Miss a day and the streak starts over.
export const STREAK_MILESTONES = { 7: 'epic', 14: 'legendary', 30: 'legendary' };

const dailyStat = {
  ...statNow,
  talk: (state) => state.stats.talks || 0,
  plan: (state, q) => (state.soma?.done?.[q.id] ? 1 : 0),
  catch: (state) => state.stats.caught || 0,
};

function dailyOptions(state, now) {
  const next = threats(state, now).map((t) => t.item).sort((a, b) => a.dueAt - b.dueAt);
  const exam = next.find((a) => a.kind === 'boss');
  const study = exam
    ? { type: 'study', courseId: exam.courseId, courseName: exam.courseName, target: 25, text: `Study ${exam.courseName} for 25 minutes` }
    : { type: 'studyAny', target: 25, text: 'Study for 25 minutes' };
  const school = [];
  if (next.some((a) => a.kind !== 'boss')) school.push({ type: 'handin', target: 1, text: 'Hand in one thing on Canvas' });
  if (state.review.cards.some((c) => c.due <= now + DAY)) school.push({ type: 'review', target: 5, text: 'Review 5 missed questions' });
  school.push({ type: 'practice', target: 5, text: 'Get 5 practice questions right' });
  const life = [{ type: 'catch', target: 1, text: 'Catch a creature in the Wilds' }, { type: 'camp', target: 1, text: 'Clear a camp in the Wilds' }];
  if (state.villagers.list.length >= 2) life.push({ type: 'talk', target: 2, text: 'Talk to 2 villagers' });
  return { study, school, life };
}

/** Starts a new day if needed: three fresh quests, and the streak checked. Returns true when a new day began. */
export function dailyRefresh(state, now = Date.now()) {
  const d = state.daily;
  const today = dayOf(now);
  if (d.day === today) return false;
  if (d.lastFull !== dayOf(now - DAY) && d.lastFull !== today) d.streak = 0;
  const { study, school, life } = dailyOptions(state, now);
  const seed = [...today].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 11);
  const pay = Math.round(Math.max(150, wage(state) * 300));
  d.quests = [study, school[seed % school.length], life[(seed >>> 3) % life.length]].map((q) => ({ ...q, base: dailyStat[q.type](state, q), reward: pay, claimed: false }));
  d.day = today;
  d.bonus = false;
  return true;
}

export const dailyProgress = (state, q) => Math.max(0, Math.min(q.target, Math.floor(dailyStat[q.type](state, q) - q.base)));

/**
 * Pays any finished daily quests. When all three are done the streak grows
 * and a chest drops (better on milestone days). Returns what was paid.
 */
export function claimDaily(state, now = Date.now()) {
  const d = state.daily;
  const out = { coins: 0, claimed: 0, streak: d.streak, chest: null, milestone: null };
  for (const q of d.quests) {
    if (q.claimed || dailyProgress(state, q) < q.target) continue;
    q.claimed = true;
    out.claimed += 1;
    out.coins += q.reward;
    passPoints(state, 15);
  }
  addCoins(state, out.coins);
  if (!d.bonus && d.quests.length && d.quests.every((q) => q.claimed)) {
    d.bonus = true;
    d.streak += 1;
    d.lastFull = dayOf(now);
    d.best = Math.max(d.best || 0, d.streak);
    out.streak = d.streak;
    out.milestone = STREAK_MILESTONES[d.streak] || null;
    out.chest = grantChest(state, out.milestone || (d.streak >= 3 ? 'epic' : 'rare'), `Day ${d.streak} streak`);
    state.critters.lures += out.milestone ? 5 : 1;
  }
  return out;
}

// --- Creatures: caught in the Wilds with lures earned by studying -------------
export const LURE_MINUTES = 10;
export const CRITTERS = {
  bunny: { name: 'Meadow bunny', rarity: 'common', time: 'day', hint: 'Hops around the meadows in daylight' },
  frog: { name: 'Pond frog', rarity: 'common', time: 'any', hint: 'Anywhere, any time' },
  hedgehog: { name: 'Hedgehog', rarity: 'rare', time: 'any', hint: 'Rare, any time' },
  fox: { name: 'Red fox', rarity: 'rare', time: 'day', hint: 'Rare, out in the day' },
  owl: { name: 'Night owl', rarity: 'epic', time: 'night', hint: 'Only after dark' },
  ghostowl: { name: 'Ghost owl', rarity: 'epic', time: 'never', hint: 'A Semester Pass reward', pass: true },
  goldfox: { name: 'Golden fox', rarity: 'legendary', time: 'never', hint: 'A legendary find in chests', pass: true },
  phoenix: { name: 'Phoenix', rarity: 'legendary', time: 'never', hint: 'A mythic find in chests', pass: true },
  moth: { name: 'Glow moth', rarity: 'epic', time: 'night', hint: 'Only after dark, it glows' },
  stag: { name: 'White stag', rarity: 'legendary', time: 'day', hint: 'Very rare, in daylight' },
  starfox: { name: 'Star fox', rarity: 'legendary', time: 'night', hint: 'Very rare, only at night' },
};
export const CATCH_CHANCE = { common: 0.9, rare: 0.6, epic: 0.38, legendary: 0.22 };
const SPAWN_WEIGHT = { common: 60, rare: 26, epic: 10, legendary: 3 };
const PET_BONUS = { common: 0.02, rare: 0.04, epic: 0.07, legendary: 0.12 };

/** Picks a species to spawn. night is true after dark. rng returns 0..1. */
export function rollCritter(night, rng = Math.random) {
  const pool = Object.entries(CRITTERS).filter(([, c]) => !c.pass && (c.time === 'any' || (c.time === 'night') === night));
  const total = pool.reduce((n, [, c]) => n + SPAWN_WEIGHT[c.rarity], 0);
  let r = rng() * total;
  for (const [id, c] of pool) { r -= SPAWN_WEIGHT[c.rarity]; if (r <= 0) return id; }
  return pool[0][0];
}

/** Tries to catch one: spends a lure. Returns { ok, first, coins } or null with no lures. */
export function tryCatch(state, species, rng = Math.random) {
  const c = state.critters;
  if (c.lures < 1 || !CRITTERS[species]) return null;
  c.lures -= 1;
  if (rng() >= CATCH_CHANCE[CRITTERS[species].rarity]) return { ok: false };
  const first = !c.caught[species];
  c.caught[species] = (c.caught[species] || 0) + 1;
  state.stats.caught = (state.stats.caught || 0) + 1;
  const coins = first ? Math.round(Math.max(300, wage(state) * { common: 300, rare: 900, epic: 2400, legendary: 6000 }[CRITTERS[species].rarity])) : 0;
  addCoins(state, coins);
  if (first && !c.pet) c.pet = species;
  return { ok: true, first, coins };
}

export function setPet(state, species) {
  if (species && !state.critters.caught[species]) return false;
  state.critters.pet = species || null;
  return true;
}

/** Your pet's bonus to study XP, by rarity. */
export function petBonus(state) {
  const pet = state.critters?.pet;
  return pet && CRITTERS[pet] ? PET_BONUS[CRITTERS[pet].rarity] : 0;
}

// --- Soma: the plan and the syllabus -------------------------------------------
// With Soma's plan, today's tasks from Soma's AI planner replace the generic
// daily quests, and syllabus readings Canvas never shows march as shadows.

/** Takes a fresh copy of the plan from Soma. todos: [{ id, text, date, minutes, done }]. */
export function setSomaPlan(state, { status, todos = [], readings = [] }, now = Date.now()) {
  const soma = state.soma;
  soma.status = status;
  soma.todos = todos;
  soma.readings = readings;
  for (const t of todos) soma.done[t.id] = Boolean(t.done);
  stepsFromSoma(state, todos);
  applyPlanQuests(state, now);
}

/** With Soma's plan, today's planned tasks (up to 5) become the day's quests. */
export function applyPlanQuests(state, now = Date.now()) {
  const soma = state.soma;
  const d = state.daily;
  if (soma.status !== 'plus') return false;
  const today = dayOf(now);
  const todays = soma.todos.filter((t) => t.date === isoDay(now)).slice(0, 5);
  if (!todays.length) return false;
  if (d.day !== today) dailyRefresh(state, now);
  const kept = new Map(d.quests.filter((q) => q.type === 'plan').map((q) => [q.id, q]));
  const pay = Math.round(Math.max(150, wage(state) * 300));
  d.quests = todays.map((t) => kept.get(t.id) || { type: 'plan', id: t.id, text: t.text, target: 1, base: 0, reward: pay, claimed: false, minutes: t.minutes });
  d.fromPlan = true;
  return true;
}
const isoDay = (now) => {
  const x = new Date(now);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Reading a syllabus item (marked read from the game): small pay and pass points. */
export function readingDone(state, id) {
  const soma = state.soma;
  const i = soma.readings.findIndex((r) => r.id === id);
  if (i < 0) return null;
  soma.readings.splice(i, 1);
  state.stats.readings = (state.stats.readings || 0) + 1;
  const coins = Math.round(Math.max(80, wage(state) * 120));
  addCoins(state, coins);
  passPoints(state, 10);
  return { coins, ...addXp(state, 15) };
}

// --- The Semester Pass ----------------------------------------------------------
// 40 tiers over the semester, filled only by studying: a point per minute,
// plus practice, review and daily quests. Nothing on it can be bought with
// coins, and nothing on it changes how fast you learn.
export const PASS_TIERS = 40;
export const PASS_TIER_POINTS = 60;
export const OUTFITS = {
  frostknight: { name: 'Frost Knight', base: 'knight', palette: 'frost', trail: 'frost', text: 'Ice-blue plate, a frozen cape, frost where you step' },
};
export const THEMES = {
  lanterns: { name: 'Lantern Festival', text: 'Paper lanterns over every road, sky lanterns rising at night' },
};

/** Rewards by tier: free track for everyone, premium track with the pass. */
export const PASS_REWARDS = Array.from({ length: PASS_TIERS }, (_, i) => {
  const t = i + 1;
  const free = { 1: { kind: 'lures', n: 3 }, 3: { kind: 'decor', id: 'toro' }, 5: { kind: 'chest', rarity: 'rare' }, 8: { kind: 'lures', n: 5 },
    10: { kind: 'pet', id: 'ghostowl' }, 14: { kind: 'chest', rarity: 'epic' }, 17: { kind: 'decor', id: 'bamboo' }, 20: { kind: 'theme', id: 'lanterns' },
    25: { kind: 'lures', n: 8 }, 30: { kind: 'chest', rarity: 'legendary' }, 35: { kind: 'lures', n: 10 }, 40: { kind: 'chest', rarity: 'legendary' } }[t]
    || { kind: 'coins', seconds: 300 + t * 40 };
  const premium = { 1: { kind: 'outfit', id: 'frostknight' }, 4: { kind: 'decor', id: 'torii' }, 7: { kind: 'decor', id: 'koi' }, 10: { kind: 'decor', id: 'bridge' },
    13: { kind: 'decor', id: 'sakura' }, 20: { kind: 'chest', rarity: 'legendary' }, 30: { kind: 'chest', rarity: 'legendary' }, 40: { kind: 'chest', rarity: 'legendary' } }[t]
    || (t % 3 === 0 ? { kind: 'lures', n: 4 } : { kind: 'chest', rarity: t > 20 ? 'epic' : 'rare' });
  return { tier: t, free, premium };
});

export function passPoints(state, n) {
  if (!state.pass || !(n > 0)) return;
  state.pass.points += n;
}
export const passTier = (state) => Math.min(PASS_TIERS, Math.floor((state.pass?.points || 0) / PASS_TIER_POINTS));

/** Claims one reward. track: 'free' | 'premium'. Returns what was given, or null. */
export function claimPass(state, tier, track) {
  const p = state.pass;
  const list = track === 'premium' ? p.premiumClaimed : p.freeClaimed;
  if (tier > passTier(state) || list.includes(tier) || (track === 'premium' && !p.premium)) return null;
  const reward = PASS_REWARDS[tier - 1][track];
  list.push(tier);
  const out = { ...reward };
  if (reward.kind === 'lures') state.critters.lures += reward.n;
  else if (reward.kind === 'coins') { out.coins = Math.round(Math.max(200, wage(state) * reward.seconds)); addCoins(state, out.coins); }
  else if (reward.kind === 'chest') out.chest = grantChest(state, reward.rarity, `Semester Pass tier ${tier}`);
  else if (reward.kind === 'decor') { if (!state.decorUnlocked.includes(reward.id)) state.decorUnlocked.push(reward.id); }
  else if (reward.kind === 'pet') { state.critters.caught[reward.id] = (state.critters.caught[reward.id] || 0) + 1; }
  else if (reward.kind === 'theme') { if (!state.cosmetics.themes.includes(reward.id)) state.cosmetics.themes.push(reward.id); }
  else if (reward.kind === 'outfit') { if (!state.cosmetics.outfits.includes(reward.id)) state.cosmetics.outfits.push(reward.id); }
  return out;
}

/** Everything claimable right now, as [tier, track] pairs. */
export function passClaimable(state) {
  const out = [];
  for (let t = 1; t <= passTier(state); t++) {
    if (!state.pass.freeClaimed.includes(t)) out.push([t, 'free']);
    if (state.pass.premium && !state.pass.premiumClaimed.includes(t)) out.push([t, 'premium']);
  }
  return out;
}

// --- Steps: big work split into pieces you can finish one at a time -----------
// An assignment arrives as a pack: the leader is the assignment itself (it
// only goes when it's handed in on Canvas), and each step is a minion.
// Steps come from Soma's plan when it has tasks for that assignment;
// otherwise the student splits it from a template that fits the work.
export function stepTemplate(item) {
  const name = `${item.name} ${item.groupName || ''}`.toLowerCase();
  if (/essay|paper|response|draft|report|reflection|write/.test(name)) return ['Read the prompt and plan', 'Outline', 'First draft', 'Sources and citations', 'Edit and proofread'];
  if (/lab/.test(name)) return ['Pre-lab reading', 'Collect the data', 'Analysis', 'Write it up'];
  if (/problem|homework|hw|set|worksheet|webassign|exercise/.test(name)) {
    const n = Math.max(3, Math.min(6, Math.round((item.pointsPossible || 20) / 8)));
    return Array.from({ length: n }, (_, i) => `Problems, part ${i + 1} of ${n}`);
  }
  if (/project|presentation|poster/.test(name)) return ['Pick the topic', 'Research', 'Build it', 'Practice and polish'];
  if (/read|chapter/.test(name)) return ['First half', 'Second half', 'Notes'];
  return ['Get started', 'Do the main part', 'Check it over'];
}

/** Splits an item into steps (from a template or a given list). Returns the steps. */
export function breakDown(state, itemId, texts = null) {
  const item = state.school.items[itemId];
  if (!item) return null;
  const list = (texts && texts.length ? texts : stepTemplate(item)).slice(0, 8);
  state.steps[itemId] = list.map((text, i) => ({ id: `${itemId}#${i}`, text, done: false }));
  return state.steps[itemId];
}

/** Soma's plan tasks for an assignment become its steps (done state follows Soma). */
export function stepsFromSoma(state, todos) {
  const byAssignment = new Map();
  for (const t of todos) if (t.assignmentId != null) {
    if (!byAssignment.has(t.assignmentId)) byAssignment.set(t.assignmentId, []);
    byAssignment.get(t.assignmentId).push(t);
  }
  for (const item of Object.values(state.school.items)) {
    const canvasId = String(item.id).split(':').pop();
    const tasks = byAssignment.get(Number(canvasId)) || byAssignment.get(canvasId);
    if (!tasks || !tasks.length) continue;
    state.steps[item.id] = tasks.slice(0, 8).map((t) => ({ id: `soma:${t.id}`, somaId: t.id, text: t.text, done: Boolean(state.soma.done[t.id] ?? t.done) }));
  }
}

/** Finishes one step: a little pay now, and the pack visibly shrinks. */
export function finishStep(state, itemId, stepId) {
  const step = state.steps[itemId]?.find((x) => x.id === stepId);
  const item = state.school.items[itemId];
  if (!step || step.done || !item) return null;
  step.done = true;
  if (step.somaId) state.soma.done[step.somaId] = true;
  state.stats.steps = (state.stats.steps || 0) + 1;
  // Every few steps leaves a small chest.
  const chest = state.stats.steps % 3 === 0 ? grantChest(state, 'common', `Steps on ${item.name}`) : null;
  const coins = Math.round(handInReward(state, item) * 0.2);
  addCoins(state, coins);
  passPoints(state, 5);
  return { step, coins, chest, left: state.steps[itemId].filter((x) => !x.done).length, ...addXp(state, 8) };
}

// --- Exam weak points: one crystal per topic --------------------------------------
// Each topic on an exam is a glowing crystal on the boss. Study sessions,
// practice and reviews aimed at a topic chip its crystal; 25 minutes breaks it.
export const TOPIC_GOAL = 25;
export const TOPIC_MAX = 6;

export function setTopics(state, itemId, names) {
  const old = new Map((state.topics[itemId] || []).map((t) => [t.name.toLowerCase(), t]));
  const seen = new Set();
  const clean = names.map((n) => String(n).trim()).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, TOPIC_MAX);
  state.topics[itemId] = clean.map((name) => old.get(name.toLowerCase()) || { name, minutes: 0 });
  return state.topics[itemId];
}

export function addTopicMinutes(state, itemId, topic, minutes) {
  const t = (state.topics[itemId] || []).find((x) => x.name === topic);
  if (!t || !(minutes > 0)) return null;
  const before = t.minutes;
  t.minutes += minutes;
  const broke = before < TOPIC_GOAL && t.minutes >= TOPIC_GOAL;
  // Breaking a weak point drops an epic chest.
  return { topic: t, broke, chest: broke ? grantChest(state, 'epic', `Broke ${t.name}`) : null };
}

export function topicProgress(state, item) {
  const list = state.topics[item.id] || [];
  if (!list.length) return 0;
  return list.reduce((sum, t) => sum + Math.min(1, t.minutes / TOPIC_GOAL), 0) / list.length;
}
export const crystalsLeft = (state, item) => (state.topics[item.id] || []).filter((t) => t.minutes < TOPIC_GOAL).length;

/** Topic ideas for an exam: Soma's exam study list, else syllabus readings before it. */
export function suggestTopics(state, item) {
  const readings = (state.soma.readings || []).filter((r) => r.course && item.courseName && r.course.toLowerCase() === item.courseName.toLowerCase());
  const exams = readings.filter((r) => r.exam);
  const pick = (exams.length ? exams : readings.filter((r) => !item.dueAt || Date.parse(`${r.due}T12:00:00`) <= item.dueAt)).slice(-TOPIC_MAX);
  return pick.map((r) => (r.title ? r.title : r.label));
}

// --- Collectibles and the Vault ---------------------------------------------------
// Rare things to find in chests, from common to mythic. Chests only come from
// studying (sessions, steps, hand-ins, grades, practice, weak points, streaks),
// so every find is earned; none of this is sold. Odds are shown in the Vault.
export const TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic'];
export const COLLECTIBLES = {
  crane: { tier: 'common', kind: 'trophy', name: 'Paper crane', text: 'Folded from an old study plan' },
  'hat:leaf': { tier: 'common', kind: 'hat', name: 'Leaf crown', text: 'Woven from library ivy' },
  quill: { tier: 'common', kind: 'trophy', name: 'Ink quill', text: 'Still wet, somehow' },
  mushrooms: { tier: 'common', kind: 'decor', name: 'Mushroom ring', text: 'Glows a little after dark' },
  'hat:gradcap': { tier: 'rare', kind: 'hat', name: 'Graduation cap', text: 'Gold tassel included' },
  sparkle: { tier: 'rare', kind: 'aura', name: 'Stardust aura', text: 'Motes of light drift around you' },
  telescope: { tier: 'rare', kind: 'trophy', name: 'Brass telescope', text: 'For seeing exams coming' },
  owlstatue: { tier: 'rare', kind: 'decor', name: 'Owl statue', text: 'Keeps watch over your town' },
  'hat:wizard': { tier: 'epic', kind: 'hat', name: 'Wizard hat', text: 'Starry, pointy, very wise' },
  ember: { tier: 'epic', kind: 'aura', name: 'Ember aura', text: 'Sparks rise wherever you stand' },
  goldbook: { tier: 'epic', kind: 'trophy', name: 'Golden book', text: 'Every page you ever studied' },
  crystallamp: { tier: 'epic', kind: 'decor', name: 'Crystal lamp', text: 'A floating crystal on a stone stand' },
  aurora: { tier: 'legendary', kind: 'aura', name: 'Aurora', text: 'Ribbons of northern light circle you' },
  goldfox: { tier: 'legendary', kind: 'pet', name: 'Golden fox', text: 'A fox cast in living gold' },
  'hat:deans': { tier: 'legendary', kind: 'hat', name: 'Dean’s List crown', text: 'Gold laurels and a ruby' },
  globe: { tier: 'legendary', kind: 'trophy', name: 'Celestial globe', text: 'A small sky in a brass cage' },
  'hat:halo': { tier: 'mythic', kind: 'hat', name: 'Scholar’s halo', text: 'Only the most dedicated ever see one' },
  phoenix: { tier: 'mythic', kind: 'pet', name: 'Phoenix', text: 'Reborn every exam season' },
  galaxy: { tier: 'mythic', kind: 'aura', name: 'Galaxy', text: 'A whole galaxy turning around you' },
  obelisk: { tier: 'mythic', kind: 'decor', name: 'Starfall obelisk', text: 'Fallen stars orbit its peak' },
};
/** Chance a chest holds a collectible, and the odds of each tier, by chest rarity. */
export const DROP_TABLE = {
  common: { chance: 1, odds: { common: 70, rare: 24, epic: 5, legendary: 0.9, mythic: 0.1 } },
  rare: { chance: 1, odds: { common: 45, rare: 38, epic: 13, legendary: 3.5, mythic: 0.5 } },
  epic: { chance: 1, odds: { common: 20, rare: 40, epic: 28, legendary: 10, mythic: 2 } },
  legendary: { chance: 1, odds: { common: 0, rare: 30, epic: 40, legendary: 25, mythic: 5 } },
};
export const PITY_EPIC = 10; // a collectible of epic or better at least this often
export const PITY_MYTHIC = 120; // and a mythic at least this often

function rollTier(chestRarity, rng) {
  const odds = DROP_TABLE[chestRarity].odds;
  const total = TIERS.reduce((n, t) => n + odds[t], 0);
  let r = rng() * total;
  for (const t of TIERS) { r -= odds[t]; if (r <= 0) return t; }
  return 'common';
}

/** Rolls a chest's collectible (with pity). Returns { id, tier, dupe, coins, pity } or null. */
export function rollCollectible(state, chestRarity, rng = Math.random) {
  const v = state.vault;
  v.sinceEpic += 1;
  v.sinceMythic += 1;
  let tier = null;
  let pity = false;
  if (v.sinceMythic >= PITY_MYTHIC) { tier = 'mythic'; pity = true; }
  else if (v.sinceEpic >= PITY_EPIC) { tier = rollTier(chestRarity, rng); if (TIERS.indexOf(tier) < 2) tier = 'epic'; pity = true; }
  else if (rng() < DROP_TABLE[chestRarity].chance) tier = rollTier(chestRarity, rng);
  if (!tier) return null;
  if (TIERS.indexOf(tier) >= 2) v.sinceEpic = 0;
  if (tier === 'mythic') v.sinceMythic = 0;
  // Prefer something not owned yet within the tier.
  const pool = Object.keys(COLLECTIBLES).filter((id) => COLLECTIBLES[id].tier === tier);
  const fresh = pool.filter((id) => !v.owned[id]);
  const from = fresh.length && rng() < 0.75 ? fresh : pool;
  const id = from[Math.floor(rng() * from.length) % from.length];
  const dupe = Boolean(v.owned[id]);
  v.owned[id] = (v.owned[id] || 0) + 1;
  const c = COLLECTIBLES[id];
  // What owning it unlocks elsewhere in the game.
  if (!dupe) {
    if (c.kind === 'hat' && !state.cosmetics.owned.includes(id)) state.cosmetics.owned.push(id);
    if (c.kind === 'decor' && !state.decorUnlocked.includes(id)) state.decorUnlocked.push(id);
    if (c.kind === 'pet') state.critters.caught[id] = (state.critters.caught[id] || 0) + 1;
    if (c.kind === 'trophy' && v.showcase.length < 8) v.showcase.push(id);
  }
  // A duplicate is still worth something.
  const coins = dupe ? Math.round(Math.max(100, wage(state) * 120) * (1 + TIERS.indexOf(tier) * 2)) : 0;
  if (coins) addCoins(state, coins);
  return { id, tier, dupe, coins, pity };
}

export const vaultFound = (state) => Object.keys(COLLECTIBLES).filter((id) => state.vault.owned[id]).length;

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
    state.padSpots = { earth: {}, moon: {}, ...(saved.padSpots || {}) };
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
    state.review = { ...fresh.review, ...(saved.review || {}) };
    state.market = { ...fresh.market, ...(saved.market || {}) };
    state.villagers = { ...fresh.villagers, ...(saved.villagers || {}) };
    state.daily = { ...fresh.daily, ...(saved.daily || {}) };
    state.critters = { ...fresh.critters, ...(saved.critters || {}) };
    state.soma = { ...fresh.soma, ...(saved.soma || {}), status: 'offline' };
    // Saves from before the tutorial: anyone who saw the old welcome has played already.
    state.tutorial = saved.tutorial || { step: 0, done: Boolean(saved.settings?.seenHelp) };
    state.pass = { ...fresh.pass, ...(saved.pass || {}) };
    state.steps = saved.steps || {};
    state.vault = { ...fresh.vault, ...(saved.vault || {}) };
    state.topics = saved.topics || {};
    return state;
  } catch {
    return fresh;
  }
}
