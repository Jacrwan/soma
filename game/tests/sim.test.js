import test from 'node:test';
import assert from 'node:assert';
import * as S from '../src/sim.js';

const NOW = 1_800_000_000_000;
const DAY = 86400000;
const HOUR = 3600000;
const rich = (coins = 1e15) => Object.assign(S.newState(NOW), { coins });

test('a new game can afford its first home and nothing more expensive', () => {
  const s = S.newState(NOW);
  assert.ok(S.build(s, 0, 'home'));
  assert.ok(!S.build(s, 1, 'trade'));
  assert.strictEqual(s.pads.earth[0].tier, 0);
  assert.ok(!S.build(s, 0, 'home'), 'pad is taken');
  assert.ok(!S.build(s, 8, 'home'), 'pad 8 is locked in the Stone Age');
});

test('buildings fill their own store up to a cap, and collecting banks it', () => {
  const s = rich();
  S.build(s, 0, 'work');
  const before = s.coins;
  s.lastTick = NOW;
  S.tick(s, NOW + 3600_000);
  const hour = 5 * 3600 * S.TOWN_SCALE; // a works makes 5 a second before the town scale
  assert.strictEqual(Math.round(s.pads.earth[0].stored), Math.round(hour));
  assert.strictEqual(S.collect(s, 0), Math.floor(hour));
  assert.strictEqual(s.coins, before + Math.floor(hour));
  S.tick(s, NOW + 3600_000 + 100 * 3600_000);
  assert.strictEqual(s.pads.earth[0].stored, S.buildingCap(s, s.pads.earth[0]), 'stops at the cap while away');
  assert.ok(Math.abs(S.buildingCap(s, s.pads.earth[0]) - hour * S.STORE_HOURS) < 1e-6);
});

test('upgrading and gilding raise income; modernizing needs a newer era', () => {
  const s = rich();
  S.build(s, 0, 'home');
  const b = s.pads.earth[0];
  const per = (x) => Math.round((x / S.TOWN_SCALE) * 1000) / 1000;
  assert.strictEqual(per(S.buildingIncome(s, b)), 1);
  S.upgrade(s, 0); S.upgrade(s, 0);
  assert.strictEqual(b.level, 3);
  assert.ok(!S.upgrade(s, 0));
  assert.strictEqual(per(S.buildingIncome(s, b)), 4.5);
  assert.ok(!S.gild(s, 0), 'no token yet');
  s.tokens = 1;
  assert.ok(S.gild(s, 0));
  assert.strictEqual(per(S.buildingIncome(s, b)), 13.5);
  assert.ok(!S.modernize(s, 0), 'already current');
  S.placeDecor(s, 'lamp', 20, 20);
  const coins = s.coins;
  const done = S.buildWonder(s);
  assert.strictEqual(s.era, 1);
  // A new age is a new land: the town starts empty, with a settler's purse.
  assert.ok(done.newLand);
  assert.ok(s.pads.earth.every((p) => p === null));
  assert.strictEqual(s.decor.length, 0);
  assert.strictEqual(done.purse, S.buildCost('home', 1) * 2 + S.buildCost('work', 1));
  assert.strictEqual(s.coins, coins - S.ERAS[0].wonderCost + done.purse + done.decorBack);
  assert.ok(S.build(s, 0, 'home'));
  assert.strictEqual(S.buildingName(s.pads.earth[0]), 'Mudbrick House');
});

test('Season 1: two ages, and the second wonder ends the season with a legendary chest', () => {
  const s = rich(1e30);
  assert.ok(S.buildWonder(s).newLand);
  assert.strictEqual(s.era, 1);
  const finale = S.buildWonder(s);
  assert.ok(finale.finale);
  assert.strictEqual(finale.chest.rarity, 'legendary');
  assert.strictEqual(s.era, 1, 'you stay in the Bronze Age land');
  assert.ok(S.seasonDone(s));
  assert.strictEqual(S.nextWonder(s), null);
  assert.strictEqual(S.buildWonder(s), null);
});

test('later seasons: wonders advance the era in order, the rocket unlocks the moon, and the Star Gate is built there', () => {
  const ages = S.SEASON.ages;
  S.SEASON.ages = 99; // every age open, as a later season will be
  const s = rich(1e30);
  for (let era = 0; era < 6; era++) {
    assert.strictEqual(S.nextWonder(s).scene, 'earth');
    assert.ok(S.buildWonder(s));
  }
  assert.strictEqual(s.era, 6);
  assert.strictEqual(S.padsUnlocked(s, 'earth'), 38);
  assert.strictEqual(S.padsUnlocked(s, 'moon'), 8);
  assert.strictEqual(S.nextWonder(s).name, 'Star Gate');
  assert.strictEqual(S.buildWonder(s), null, 'not from Earth');
  s.scene = 'moon';
  assert.ok(S.build(s, 0, 'trade'));
  assert.strictEqual(S.buildingName(s.pads.moon[0]), 'Orbital Exchange');
  assert.ok(S.buildWonder(s));
  assert.strictEqual(s.era, 7);
  assert.strictEqual(S.nextWonder(s), null);
  S.SEASON.ages = ages;
});

test('numbers are shortened readably', () => {
  assert.deepStrictEqual([0, 999, 1000, 15300, 2.5e6, 7.25e9, 1e13].map(S.fmt), ['0', '999', '1.00K', '15.3K', '2.50M', '7.25B', '10.0T']);
});

const item = (over) => ({ id: 'a', name: 'Homework 1', courseId: 'c', courseName: 'C', dueAt: NOW + DAY, pointsPossible: 20, weight: 10, groupName: 'Homework', submitted: false, score: null, excused: false, ...over });

test('assignments are classified by name and weight', () => {
  assert.deepStrictEqual(S.classify(item({})), { kind: 'invader', size: 1 });
  assert.deepStrictEqual(S.classify(item({ name: 'Essay 2', weight: 30 })), { kind: 'invader', size: 2 });
  assert.deepStrictEqual(S.classify(item({ name: 'Quiz 3' })), { kind: 'invader', size: 2 });
  assert.deepStrictEqual(S.classify(item({ name: 'Midterm 2', pointsPossible: 100, weight: 25 })), { kind: 'boss', size: 3 });
  assert.deepStrictEqual(S.classify(item({ name: 'Final Exam', pointsPossible: 0, weight: 0 })), { kind: 'boss', size: 3 });
});

test('invaders appear ten days out and reach the gate when due', () => {
  assert.strictEqual(S.approach(item({ dueAt: NOW + 11 * DAY }), NOW), null);
  assert.strictEqual(S.approach(item({ dueAt: NOW + 5 * DAY }), NOW), 0.5);
  assert.strictEqual(S.approach(item({ dueAt: NOW - DAY }), NOW), 1);
  assert.strictEqual(S.approach(item({ dueAt: null }), NOW), null);
});

test('first sync is quiet about old hand-ins but still drops a few grade chests', () => {
  const s = rich(0);
  const items = [1, 2, 3, 4, 5].map((n) => item({ id: `g${n}`, submitted: true, score: 19, dueAt: NOW - n * DAY }));
  const events = S.syncSchool(s, items, NOW, { source: 'demo' });
  assert.strictEqual(events.filter((e) => e.type === 'handed-in').length, 0);
  assert.strictEqual(events.filter((e) => e.type === 'chest').length, 3);
  assert.strictEqual(s.coins, 0);
  assert.strictEqual(S.syncSchool(s, items, NOW, { source: 'demo' }).length, 0, 'nothing happens twice');
});

test('handing in pays out once, a posted grade drops a chest by score, overdue work halves income', () => {
  const s = rich(0);
  s.coins = 1e6; S.build(s, 0, 'trade'); s.coins = 0;
  S.syncSchool(s, [item({})], NOW, { source: 'demo' });
  assert.strictEqual(S.threats(s, NOW).length, 1);
  assert.ok(!S.isUnderSiege(s, NOW));
  assert.ok(S.isUnderSiege(s, NOW + 2 * DAY));
  assert.ok(Math.abs(S.totalIncome(s, NOW + 2 * DAY) - 22 * S.TOWN_SCALE * S.SIEGE_MULT) < 1e-9);

  let events = S.syncSchool(s, [item({ submitted: true })], NOW + 2 * DAY);
  assert.deepStrictEqual(events.map((e) => e.type), ['handed-in']);
  const pay = Math.round(Math.max(60, S.wage(s) * 120));
  assert.strictEqual(events[0].reward, pay);
  assert.strictEqual(s.coins, pay);
  assert.ok(!S.isUnderSiege(s, NOW + 2 * DAY));
  assert.strictEqual(S.threats(s, NOW + 2 * DAY).length, 0);

  events = S.syncSchool(s, [item({ submitted: true, score: 17 })], NOW + 3 * DAY);
  assert.deepStrictEqual(events.map((e) => e.type), ['chest']);
  assert.strictEqual(events[0].chest.rarity, 'epic');
  assert.deepStrictEqual([95, 85, 72, 40].map(S.rarityForGrade), ['legendary', 'epic', 'rare', 'common']);

  events = S.syncSchool(s, [item({ submitted: true, score: 17 }), item({ id: 'b', name: 'New one' })], NOW + 3 * DAY);
  assert.deepStrictEqual(events.map((e) => e.type), ['new']);
});

test('chests pay coins and richer chests give relics, cosmetics and tokens', () => {
  const s = rich(0);
  S.grantChest(s, 'legendary', 'test');
  const { loot } = S.openChest(s, s.school.chests[0].id, () => 0, NOW);
  assert.deepStrictEqual(loot.map((l) => l.kind), ['collectible', 'coins', 'relic', 'cosmetic', 'token', 'gear']);
  assert.strictEqual(s.hero.gear.weapon.rarity, 'legendary');
  assert.strictEqual(s.coins, S.CHEST_COINS.legendary * 16000); // a share of the Stone Circle
  assert.strictEqual(s.tokens, 1);
  assert.strictEqual(S.relicMult(s), 1.25);
  assert.strictEqual(s.school.chests.length, 0);
  assert.strictEqual(S.openChest(s, 'nope'), null);
  S.grantChest(s, 'common', 'test');
  assert.deepStrictEqual(S.openChest(s, s.school.chests[0].id, () => 0.99, NOW).loot.map((l) => l.kind), ['collectible', 'coins']);
});

test('power grows with recent hand-ins for that course, not with the age', () => {
  const s = rich(0);
  assert.strictEqual(S.playerPower(s, null, NOW), 10);
  S.syncSchool(s, [item({ id: 'p1', submitted: true, dueAt: NOW - DAY }), item({ id: 'p2', submitted: true, dueAt: NOW - 2 * DAY })], NOW, { source: 'demo' });
  assert.strictEqual(S.playerPower(s, 'c', NOW), 12);
  s.era = 2;
  assert.strictEqual(S.playerPower(s, 'other', NOW), 10);
});

test('exam day: study strips armor, and the armor left decides the gate', () => {
  const exam = (id, dueAt, courseId = 'c') => ({ id, name: 'Midterm exam', courseId, courseName: 'Physics', dueAt, pointsPossible: 100, weight: 30, submitted: false, noSubmit: true });
  const s = rich();
  S.syncSchool(s, [exam('ready', NOW + 2 * DAY), exam('lazy', NOW + 2 * DAY, 'z'), exam('share', NOW + 2 * DAY), exam('half', NOW + 2 * DAY, 'other'), item({ id: 'hw', dueAt: NOW + DAY })], NOW, { source: 'soma' });
  const items = s.school.items;
  // On paper, but an exam still marches.
  assert.ok(!S.isIgnored(s, items.ready));
  assert.strictEqual(S.examArmor(s, items.ready), 1);
  S.startStudy(s, 'ready', 45, NOW); S.finishStudy(s, NOW + 45 * 60_000);
  S.startStudy(s, 'ready', 45, NOW + HOUR); S.finishStudy(s, NOW + HOUR + 45 * 60_000);
  assert.ok(S.examArmor(s, items.ready) < 0.3);
  // Every other session for the course (other exams too) counts half.
  S.startStudy(s, 'hw', 45, NOW + 2 * HOUR); S.finishStudy(s, NOW + 2 * HOUR + 45 * 60_000);
  assert.ok(Math.abs(S.examArmor(s, items.share) - (1 - (45 + 22.5) / 120)) < 1e-9);
  assert.ok(S.examArmor(s, items.ready) <= S.EXAM_HELD);
  S.startStudy(s, 'half', 60, NOW + 3 * HOUR); S.finishStudy(s, NOW + 4 * HOUR);
  assert.strictEqual(S.examOutcome(S.examArmor(s, items.half)), 'dented');

  assert.deepStrictEqual(S.resolveExams(s, NOW + DAY), []);
  assert.strictEqual(S.lateItems(s, NOW + 3 * DAY).some((a) => a.kind === 'boss'), false);
  s.pads.earth[0] = { type: Object.keys(S.BUILDINGS)[0], tier: 0, level: 3, golden: false, stored: 50 };
  const coins = s.coins;
  const events = S.resolveExams(s, NOW + 2 * DAY + 1);
  const by = Object.fromEntries(events.map((e) => [e.item.id, e]));
  assert.strictEqual(by.ready.outcome, 'held');
  assert.strictEqual(by.ready.chest.rarity, 'epic');
  assert.strictEqual(by.half.outcome, 'dented');
  assert.strictEqual(by.lazy.outcome, 'wrecked');
  assert.deepStrictEqual(by.lazy.wrecked, { scene: 'earth', index: 0 });
  assert.strictEqual(s.pads.earth[0].level, 2);
  assert.ok(by.half.coins < 0 && by.lazy.coins < 0);
  assert.ok(s.coins < coins + by.ready.coins);
  assert.strictEqual(s.stats.bossesBeaten, 1);
  // Settled once, and gone from the march.
  assert.deepStrictEqual(S.resolveExams(s, NOW + 3 * DAY), []);
  assert.ok(!S.threats(s, NOW + 2 * DAY + 2).some((x) => x.item.kind === 'boss'));
});

test('an exam first seen after its date costs nothing; its grade pays double', () => {
  const s = rich();
  S.syncSchool(s, [item({ id: 'x', dueAt: NOW - DAY })], NOW, { source: 'soma' });
  const exam = { id: 'm', name: 'Final exam', courseId: 'c', courseName: 'Physics', dueAt: NOW - HOUR, pointsPossible: 100, weight: 30, submitted: false };
  S.syncSchool(s, [exam], NOW, { source: 'soma' });
  const coins = s.coins;
  assert.deepStrictEqual(S.resolveExams(s, NOW), []);
  assert.strictEqual(s.coins, coins);
  const xp = s.hero.xp + s.hero.level * 1000;
  const [event] = S.syncSchool(s, [{ ...exam, score: 90 }], NOW, { source: 'soma' }).filter((e) => e.type === 'chest');
  assert.strictEqual(event.exam, true);
  assert.strictEqual(event.xp, 260);
  assert.ok(event.chest.coins > 0);
});

test('Soma snapshots become assignments', () => {
  const list = S.fromSomaSnapshot({
    kind: 'canvas', host: 'school.instructure.com',
    courses: [{ id: 7, name: 'PHYS 151' }], groups: [{ id: 3, courseId: 7, name: 'Exams', weight: 40 }],
    assignments: [
      { id: 1, courseId: 7, name: 'Midterm', dueAt: '2027-01-10T05:00:00Z', pointsPossible: 100, groupId: 3, submittedAt: null, workflowState: 'unsubmitted', score: null, submissionTypes: ['on_paper'] },
      { id: 2, courseId: 7, name: 'PS1', dueAt: null, pointsPossible: 10, groupId: null, submittedAt: '2027-01-01T00:00:00Z', workflowState: 'graded', score: 9 },
    ],
  });
  assert.strictEqual(list[0].id, 'school.instructure.com:1');
  assert.deepStrictEqual([list[0].courseName, list[0].weight, list[0].groupName, list[0].submitted], ['PHYS 151', 40, 'Exams', false]);
  assert.strictEqual(list[0].dueAt, Date.parse('2027-01-10T05:00:00Z'));
  assert.deepStrictEqual([list[1].submitted, list[1].score, list[1].dueAt], [true, 9, null]);
  assert.deepStrictEqual(S.fromSomaSnapshot({ kind: 'gradescope' }), []);
});

test('the demo semester has work in every state', () => {
  const demo = S.demoSemester(NOW);
  const s = rich(0);
  const events = S.syncSchool(s, demo, NOW, { source: 'demo' });
  assert.strictEqual(events.filter((e) => e.type === 'chest').length, 3);
  const kinds = S.threats(s, NOW).map((t) => t.item.kind);
  assert.ok(kinds.includes('boss') && kinds.includes('invader'));
  assert.ok(!S.isUnderSiege(s, NOW));
});

test('saves round-trip and bad saves start fresh', () => {
  const s = rich(500);
  S.build(s, 2, 'home');
  S.grantChest(s, 'rare', 'x');
  const back = S.deserialize(S.serialize(s), NOW);
  assert.deepStrictEqual(back.pads.earth[2], s.pads.earth[2]);
  assert.strictEqual(back.pads.earth.length, S.EARTH_PADS);
  assert.strictEqual(back.school.chests.length, 1);
  assert.strictEqual(S.deserialize('not json', NOW).coins, 120);
  assert.strictEqual(S.deserialize('{"v":99}', NOW).coins, 120);
});

// Pacing: a student who opens the game three times a day, studies half an hour,
// hands in about one assignment a day and opens two caches, buying the best
// cheap upgrades. Season 1 should fill the first month, with studying paying most.
test('pacing: the Stone Age is about a week and the Bronze Age runs to about week four', () => {
  const s = S.newState(NOW);
  s.tutorial.done = true;
  const H = 3600e3;
  const got = { study: 0, town: 0 };
  const built = [];
  const buy = () => {
    for (let k = 0; k < 30; k++) {
      let best = null;
      const open = S.padsUnlocked(s), tier = S.tierFor(s);
      const free = s.pads.earth.findIndex((b, i) => !b && i < open);
      if (free >= 0) for (const type of S.TYPES) { const c = S.buildCost(type, tier), g = S.BUILDINGS[type].income * 6 ** tier; if (!best || g / c > best.r) best = { r: g / c, c, run: () => S.build(s, free, type) }; }
      s.pads.earth.forEach((b, i) => { if (!b) return; const c = S.upgradeCost(b); if (!Number.isFinite(c)) return; const g = S.BUILDINGS[b.type].income * 6 ** b.tier * (S.LEVEL_MULT[b.level + 1] - S.LEVEL_MULT[b.level]); if (!best || g / c > best.r) best = { r: g / c, c, run: () => S.upgrade(s, i) }; });
      const w = S.nextWonder(s);
      if (!best || best.c > s.coins || (w && best.c > w.cost * 0.15)) break;
      best.run();
    }
  };
  for (let d = 0; d < 45 && !S.seasonDone(s); d++) {
    for (const h of [8, 13, 20]) {
      const t = NOW + d * 24 * H + h * H;
      S.tick(s, t);
      s.pads.earth.forEach((b, i) => { if (b) got.town += S.collect(s, i); });
      if (h === 20) {
        const before = s.coins;
        S.startStudy(s, null, 30, t);
        S.finishStudy(s, t + 30 * 60000);
        got.study += s.coins - before;
        S.addCoins(s, S.handInReward(s, { size: d % 3 === 2 ? 2 : 1 }));
        for (let c = 0; c < 2; c++) { const chest = S.openCache(s, c, t); if (chest) S.openChest(s, chest.id, () => 0.5, t); }
      }
      const w = S.nextWonder(s);
      if (w && s.coins >= w.cost) { S.buildWonder(s); built.push(d + 1); }
      buy();
    }
  }
  console.log('      days to each wonder:', built.join(', '));
  assert.strictEqual(built.length, 2, 'Season 1 can be finished');
  assert.ok(built[0] >= 4 && built[0] <= 10, `Stone Age took ${built[0]} days`);
  assert.ok(built[1] >= 20 && built[1] <= 38, `Bronze Age ended on day ${built[1]}`);
  console.log('      coins from studying vs the town:', Math.round(got.study), Math.round(got.town));
  assert.ok(got.study > got.town, 'studying pays more than the town');
});

test('a full study session pays coins, a chest and a streak day, and doubles the town while it runs', () => {
  const s = rich(0);
  S.syncSchool(s, [{ id: 'a', name: 'Essay', courseId: 'c', courseName: 'English', dueAt: NOW + 3 * DAY, pointsPossible: 10, submitted: false }], NOW, { source: 'soma' });
  const idle = S.totalIncome(s, NOW);
  assert.ok(S.startStudy(s, 'a', 25, NOW));
  assert.ok(!S.startStudy(s, 'a', 10, NOW), 'one session at a time');
  assert.strictEqual(S.totalIncome(s, NOW + 60_000), idle * S.FOCUS_MULT);
  const done = S.finishStudy(s, NOW + 25 * 60_000);
  assert.ok(done.complete);
  assert.strictEqual(done.minutes, 25);
  assert.strictEqual(done.chest.rarity, 'rare');
  assert.strictEqual(done.streak, 1);
  assert.ok(done.coins > 0 && s.coins === done.coins);
  assert.ok(Math.abs(S.studyProgress(s, s.school.items.a) - 25 / 30) < 1e-9);
  assert.strictEqual(S.studyChestsLeft(s, NOW + 25 * 60_000), S.STUDY_CHESTS_PER_DAY - 1);
});

test('quitting a session early pays for the minutes done but drops no chest, and under five minutes pays nothing', () => {
  const s = rich(0);
  S.startStudy(s, null, 25, NOW);
  const early = S.finishStudy(s, NOW + 12 * 60_000);
  assert.ok(!early.complete && early.coins > 0 && early.chest === null && early.streak === 0);
  S.startStudy(s, null, 25, NOW);
  const tiny = S.finishStudy(s, NOW + 2 * 60_000);
  assert.strictEqual(tiny.coins, 0);
  assert.strictEqual(S.finishStudy(s, NOW), null);
});

test('study chests run out for the day', () => {
  const s = rich();
  S.syncSchool(s, [{ id: 'm', name: 'Midterm exam', courseId: 'c', courseName: 'Physics', dueAt: NOW + 2 * DAY, pointsPossible: 100, weight: 30, submitted: false }], NOW, { source: 'soma' });
  let t = NOW;
  const chests = [];
  for (let i = 0; i < 4; i++) {
    S.startStudy(s, 'm', 45, t);
    t += 45 * 60_000;
    chests.push(S.finishStudy(s, t).chest);
  }
  assert.deepStrictEqual(chests.map((c) => c && c.rarity), ['epic', 'epic', 'epic', null]);
  assert.strictEqual(S.studyProgress(s, s.school.items.m), 1);
  assert.strictEqual(S.examArmor(s, s.school.items.m), 0);
});

test('practice answers strip exam armor, capped per day, and pay XP', () => {
  const s = rich();
  S.syncSchool(s, [{ id: 'm', name: 'Midterm exam', courseId: 'c', courseName: 'Physics', dueAt: NOW + 2 * DAY, pointsPossible: 100, weight: 30, submitted: false }], NOW, { source: 'soma' });
  const exam = s.school.items.m;
  const xp = s.hero.xp;
  const r = S.finishPractice(s, 'm', 4, 1, NOW);
  assert.strictEqual(r.minutes, 21);
  assert.ok(r.xp > 0 && s.hero.xp + s.hero.level > xp);
  assert.ok(Math.abs(S.examArmor(s, exam) - (1 - 21 / 120)) < 1e-9);
  S.finishPractice(s, 'm', 5, 0, NOW + 1000);
  const capped = S.finishPractice(s, 'm', 5, 0, NOW + 2000);
  assert.strictEqual(capped.minutes, 0);
  assert.ok(capped.capped);
  assert.strictEqual(S.practiceRoom(s, 'm', NOW + DAY), S.PRACTICE_DAILY_MINUTES);
  // Free practice (no item) pays XP only.
  assert.strictEqual(S.finishPractice(s, null, 3, 0, NOW).minutes, 0);
});

test('missed questions come back after 1, 3 and 7 days and break armor when remembered', () => {
  const s = rich();
  S.syncSchool(s, [{ id: 'm', name: 'Midterm exam', courseId: 'c', courseName: 'Physics', dueAt: NOW + 20 * DAY, pointsPossible: 100, weight: 30, submitted: false }], NOW, { source: 'soma' });
  const q = { q: 'What is F?', choices: ['ma', 'mv', 'm/a', 'a/m'], answer: 0, why: 'Newton' };
  const card = S.addReview(s, s.school.items.m, q, NOW);
  assert.strictEqual(S.addReview(s, s.school.items.m, q, NOW), null); // no duplicates
  assert.strictEqual(S.dueReviews(s, NOW).length, 0);
  assert.strictEqual(S.dueReviews(s, NOW + DAY).length, 1);
  let r = S.answerReview(s, card.id, true, NOW + DAY);
  assert.strictEqual(r.minutes, S.REVIEW_RIGHT_MINUTES);
  assert.ok(S.examArmor(s, s.school.items.m) < 1);
  assert.strictEqual(card.due, NOW + 4 * DAY);
  r = S.answerReview(s, card.id, false, NOW + 4 * DAY);
  assert.strictEqual(card.box, 0);
  assert.strictEqual(card.due, NOW + 5 * DAY);
  S.answerReview(s, card.id, true, NOW + 5 * DAY);
  S.answerReview(s, card.id, true, NOW + 8 * DAY);
  r = S.answerReview(s, card.id, true, NOW + 15 * DAY);
  assert.ok(r.learned);
  assert.strictEqual(s.review.cards.length, 0);
  assert.strictEqual(s.review.learned, 1);
});

test('class halls grow with study for that course', () => {
  const s = rich();
  S.syncSchool(s, [item({ id: 'a', courseId: 'p', courseName: 'Physics' }), item({ id: 'b', courseId: 'w', courseName: 'Writing' })], NOW, { source: 'soma' });
  s.study.courses.p = 60;
  const halls = Object.fromEntries(S.courseHalls(s).map((h) => [h.id, h]));
  assert.strictEqual(halls.p.level, 2);
  assert.strictEqual(halls.w.level, 0);
});

test('the market keeps one stock per day, sells once, and tea boosts the next session', () => {
  const s = rich(1e9);
  const a = S.marketStock(s, NOW);
  assert.deepStrictEqual(S.marketStock(s, NOW + 1000), a);
  assert.ok(a.some((o) => o.kind === 'gear') && a.some((o) => o.kind === 'tea'));
  const chestAt = a.findIndex((o) => o.kind === 'chest');
  assert.ok(chestAt >= 0 && ['rare', 'epic', 'legendary'].includes(a[chestAt].rarity));
  const chests = s.school.chests.length;
  assert.ok(S.buyOffer(s, chestAt, NOW).chest);
  assert.strictEqual(s.school.chests.length, chests + 1);
  assert.strictEqual(S.buyOffer(s, chestAt, NOW), null); // one a day
  const coins = s.coins;
  const tea = a.findIndex((o) => o.kind === 'tea');
  assert.ok(S.buyOffer(s, tea, NOW));
  assert.strictEqual(S.buyOffer(s, tea, NOW), null);
  assert.strictEqual(s.coins, coins - a[tea].price);
  S.startStudy(s, null, 10, NOW);
  const boosted = S.finishStudy(s, NOW + 10 * 60_000);
  assert.ok(boosted.tea);
  S.startStudy(s, null, 10, NOW + DAY);
  const plain = S.finishStudy(s, NOW + DAY + 10 * 60_000);
  assert.ok(!plain.tea);
  const decor = a.findIndex((o) => o.kind === 'decor');
  if (decor >= 0) { S.buyOffer(s, decor, NOW); assert.ok(S.decorAvailable(s).includes(a[decor].id)); }
  assert.notDeepStrictEqual(S.marketStock(s, NOW + 2 * DAY).map((o) => o.price), []);
});

test('decorations cost coins, refund half, and market ones need unlocking', () => {
  const s = rich(1e6);
  const coins = s.coins;
  const piece = S.placeDecor(s, 'lamp', 3, 4, 1);
  assert.ok(piece);
  assert.strictEqual(s.coins, coins - piece.paid);
  assert.strictEqual(S.placeDecor(s, 'fountain', 0, 0), null);
  assert.strictEqual(S.removeDecor(s, piece.id), Math.floor(piece.paid / 2));
  assert.strictEqual(s.decor.length, 0);
  const poor = rich(0);
  assert.strictEqual(S.placeDecor(poor, 'lamp', 0, 0), null);
});

test('selling junk keeps anything better than what is worn', () => {
  const s = rich(0);
  s.hero.gear.weapon = { ...S.rollGear(s, 'epic', () => 0.1, 'weapon'), might: 50 };
  s.hero.bag.push({ ...S.rollGear(s, 'common', () => 0.1, 'weapon'), might: 5 }, { ...S.rollGear(s, 'legendary', () => 0.1, 'weapon'), might: 90 });
  const made = S.sellJunk(s);
  assert.ok(made > 0);
  assert.strictEqual(s.hero.bag.length, 1);
  assert.strictEqual(s.hero.bag[0].might, 90);
});

test('villagers move in as the town grows, one every 6 hours after the first two', () => {
  const s = rich();
  assert.strictEqual(S.villagerRoom(s), 2);
  assert.ok(S.moveIn(s, NOW));
  assert.ok(S.moveIn(s, NOW));
  assert.strictEqual(S.moveIn(s, NOW), null); // full
  // A lovelier town has room for more: one star is two more people.
  ['daisies', 'tulips', 'stump', 'boulder', 'bench', 'lamp'].forEach((t, i) => S.placeDecor(s, t, 10 + i * 3, 10));
  assert.strictEqual(S.townRating(s).stars, 1);
  assert.strictEqual(S.villagerRoom(s), 4);
  assert.strictEqual(S.moveIn(s, NOW + HOUR), null); // too soon
  const third = S.moveIn(s, NOW + 7 * HOUR);
  assert.ok(third);
  assert.strictEqual(new Set(s.villagers.list.map((p) => p.name)).size, 3);
});

test('a wrecked town and late work drive villagers away; they stay gone for 3 days', () => {
  const s = rich();
  S.moveIn(s, NOW); S.moveIn(s, NOW);
  S.syncSchool(s, [item({ id: 'x', dueAt: NOW + HOUR })], NOW, { source: 'soma' });
  assert.deepStrictEqual(S.villagersFeel(s, -30, NOW), []);
  assert.strictEqual(s.villagers.list[0].mood, 40);
  const day = S.villagerDay(s, NOW + 2 * HOUR);
  assert.strictEqual(day.late, 1);
  assert.strictEqual(s.villagers.list[0].mood, 36);
  assert.strictEqual(S.villagerDay(s, NOW + 3 * HOUR), null); // once a day
  const left = S.villagersFeel(s, -100, NOW + 4 * HOUR);
  assert.strictEqual(left.length, 2);
  assert.strictEqual(s.villagers.list.length, 0);
  const gone = new Set(left.map((p) => p.name));
  const next = S.moveIn(s, NOW + DAY);
  assert.ok(next && !gone.has(next.name)); // someone new, not the ones who just left
  s.villagers.list = [];
  s.villagers.lastArrival = 0;
  const back = [S.moveIn(s, NOW + 4 * DAY), S.moveIn(s, NOW + 4 * DAY)].map((p) => p.name);
  assert.ok(back.some((n) => gone.has(n))); // after 3 days they can come back
});

test('villager quests track real progress and pay once; talking and gifts are daily', () => {
  const s = rich();
  S.syncSchool(s, [item({ id: 'a', courseId: 'p', courseName: 'Physics', dueAt: NOW + 3 * DAY })], NOW, { source: 'soma' });
  const p = S.moveIn(s, NOW);
  p.quest = { type: 'studyAny', target: 30, text: 'Study for 30 minutes', day: 'x', done: false, reward: { coins: 500, friend: 12 }, base: s.study.total };
  assert.strictEqual(S.claimVillagerQuest(s, p.name), null);
  S.startStudy(s, null, 30, NOW);
  S.finishStudy(s, NOW + 30 * 60_000);
  assert.strictEqual(S.questProgress(s, p.quest), 30);
  const coins = s.coins;
  assert.deepStrictEqual(S.claimVillagerQuest(s, p.name), { coins: 500, friend: 12 });
  assert.strictEqual(s.coins, coins + 500);
  assert.strictEqual(S.claimVillagerQuest(s, p.name), null);
  assert.ok(S.talkTo(s, p.name, NOW));
  assert.ok(!S.talkTo(s, p.name, NOW + 1000));
  assert.strictEqual(S.villagerGift(s, p.name, NOW), null); // not friends yet
  p.friend = 85;
  assert.deepStrictEqual(S.villagerGift(s, p.name, NOW), { tea: 1 });
  assert.strictEqual(S.villagerGift(s, p.name, NOW), null);
  const q = S.makeVillagerQuest(s, p, NOW);
  assert.ok(q.text && q.target > 0 && q.base >= 0);
});

test('villagers talk about your real situation', () => {
  const s = rich();
  S.syncSchool(s, [item({ id: 'late', name: 'Lab Report', dueAt: NOW - 2 * HOUR }), { id: 'm', name: 'Midterm exam', courseId: 'c', courseName: 'Physics', dueAt: NOW + 2 * DAY, pointsPossible: 100, weight: 30, submitted: false }], NOW - DAY, { source: 'soma' });
  const p = S.moveIn(s, NOW);
  const said = Array.from({ length: 12 }, (_, k) => S.villagerLine(s, p, NOW, k));
  assert.ok(said.some((l) => l.includes('Lab Report')));
  assert.ok(said.some((l) => l.includes('Midterm exam') && l.includes('armor')));
  p.mood = 10;
  assert.ok(S.villagerLine(s, p, NOW, 0).includes('packing'));
});

test('daily quests: three a day, all three grow the streak, a missed day resets it', () => {
  const s = rich();
  S.syncSchool(s, [item({ id: 'a', courseId: 'p', courseName: 'Physics', dueAt: NOW + 3 * DAY })], NOW, { source: 'soma' });
  assert.ok(S.dailyRefresh(s, NOW));
  assert.ok(!S.dailyRefresh(s, NOW + 1000));
  assert.strictEqual(s.daily.quests.length, 3);
  const finishAll = (t) => {
    for (const q of s.daily.quests) {
      if (q.type === 'studyAny' || q.type === 'study') s.study.courses[q.courseId] = (s.study.courses[q.courseId] || 0) + q.target, s.study.total += q.target;
      else if (q.type === 'handin') s.stats.handedIn += 1;
      else if (q.type === 'practice') s.stats.practiceRight = (s.stats.practiceRight || 0) + q.target;
      else if (q.type === 'review') s.stats.reviewed = (s.stats.reviewed || 0) + q.target;
      else if (q.type === 'catch') s.stats.caught = (s.stats.caught || 0) + 1;
      else if (q.type === 'camp') s.stats.campsCleared += 1;
      else if (q.type === 'talk') s.stats.talks = (s.stats.talks || 0) + 2;
    }
    return S.claimDaily(s, t);
  };
  const first = finishAll(NOW);
  assert.strictEqual(first.claimed, 3);
  assert.strictEqual(first.streak, 1);
  assert.ok(first.chest);
  assert.strictEqual(S.claimDaily(s, NOW).claimed, 0);
  S.dailyRefresh(s, NOW + DAY);
  assert.strictEqual(finishAll(NOW + DAY).streak, 2);
  S.dailyRefresh(s, NOW + 3 * DAY); // skipped a day
  assert.strictEqual(s.daily.streak, 0);
  s.daily.streak = 6; s.daily.lastFull = null;
  const seventh = finishAll(NOW + 3 * DAY);
  assert.strictEqual(seventh.milestone, 'epic');
});

test('studying earns lures; catching spends them, fills the book, and a pet boosts study XP', () => {
  const s = rich();
  const start = s.critters.lures;
  S.startStudy(s, null, 25, NOW);
  const r = S.finishStudy(s, NOW + 25 * 60_000);
  assert.strictEqual(r.lures, 2);
  assert.strictEqual(s.critters.lures, start + 2);
  assert.strictEqual(S.tryCatch(s, 'stag', () => 0.9).ok, false); // legendary missed
  const got = S.tryCatch(s, 'stag', () => 0.01);
  assert.ok(got.ok && got.first && got.coins > 0);
  assert.strictEqual(s.critters.pet, 'stag');
  assert.ok(Math.abs(S.heroStats(s).studyXp - 1.12) < 1e-9);
  assert.ok(!S.setPet(s, 'owl'));
  s.critters.lures = 0;
  assert.strictEqual(S.tryCatch(s, 'frog'), null);
  for (let i = 0; i < 50; i++) assert.notStrictEqual(S.CRITTERS[S.rollCritter(true)].time, 'day');
  for (let i = 0; i < 50; i++) assert.notStrictEqual(S.CRITTERS[S.rollCritter(false)].time, 'night');
});

test('buildings can go anywhere: free slots first, more room each age', () => {
  const s = rich();
  assert.strictEqual(S.padsUnlocked(s, 'earth'), 8);
  const i = S.placeBuilding(s, 'home', 30, -12, 1.2);
  assert.strictEqual(i, 0); // Stone Age has no free slots past the fixed spots yet
  assert.deepStrictEqual(s.padSpots.earth[0], { x: 30, z: -12, rot: 1.2 });
  s.era = 2;
  assert.strictEqual(S.padsUnlocked(s, 'earth'), 20);
  const j = S.placeBuilding(s, 'work', -20, 5);
  assert.strictEqual(j, S.FIXED_EARTH_PADS);
  for (let k = 0; k < 30; k++) S.placeBuilding(s, 'home', k, k);
  assert.deepStrictEqual(S.buildingCount(s), { used: 20, room: 20 });
  assert.strictEqual(S.placeBuilding(s, 'home', 0, 0), -1);
  S.newLand(s);
  assert.deepStrictEqual(s.padSpots.earth, {});
});

test('with the Soma plan, planned tasks for today become the daily quests', () => {
  const s = rich();
  S.dailyRefresh(s, NOW);
  const generic = s.daily.quests.map((q) => q.type);
  const today = new Date(NOW);
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todos = [{ id: 't1', text: 'Read 4.1-4.3', date: iso, minutes: 30, done: false }, { id: 't2', text: 'Problem Set 7', date: iso, minutes: 45, done: false }, { id: 't3', text: 'Tomorrow thing', date: '2099-01-01', done: false }];
  S.setSomaPlan(s, { status: 'free', todos }, NOW);
  assert.deepStrictEqual(s.daily.quests.map((q) => q.type), generic); // free: generic quests stay
  S.setSomaPlan(s, { status: 'plus', todos }, NOW);
  assert.deepStrictEqual(s.daily.quests.map((q) => q.id), ['t1', 't2']);
  assert.strictEqual(S.claimDaily(s, NOW).claimed, 0);
  s.soma.done.t1 = true; s.soma.done.t2 = true;
  const r = S.claimDaily(s, NOW);
  assert.strictEqual(r.claimed, 2);
  assert.strictEqual(r.streak, 1);
});

test('the Semester Pass fills only from studying and pays each reward once', () => {
  const s = rich();
  assert.strictEqual(S.passTier(s), 0);
  S.startStudy(s, null, 45, NOW);
  S.finishStudy(s, NOW + 45 * 60_000);
  S.startStudy(s, null, 45, NOW + DAY);
  S.finishStudy(s, NOW + DAY + 45 * 60_000);
  assert.strictEqual(S.passTier(s), 1);
  assert.deepStrictEqual(S.passClaimable(s), [[1, 'free']]);
  const lures = s.critters.lures;
  assert.strictEqual(S.claimPass(s, 1, 'free').n, 3);
  assert.strictEqual(s.critters.lures, lures + 3);
  assert.strictEqual(S.claimPass(s, 1, 'free'), null);
  assert.strictEqual(S.claimPass(s, 1, 'premium'), null); // no pass
  s.pass.premium = true;
  assert.strictEqual(S.claimPass(s, 1, 'premium').id, 'frostknight');
  assert.ok(s.cosmetics.outfits.includes('frostknight'));
  assert.strictEqual(S.claimPass(s, 2, 'free'), null); // not reached
  s.pass.points = S.PASS_TIER_POINTS * 20;
  S.claimPass(s, 20, 'free');
  assert.ok(s.cosmetics.themes.includes('lanterns'));
  S.claimPass(s, 10, 'free');
  assert.strictEqual(s.critters.caught.ghostowl, 1);
  S.claimPass(s, 4, 'premium');
  assert.ok(S.decorAvailable(s).includes('torii'));
  assert.ok(!S.decorAvailable(s).includes('koi'));
  for (let i = 0; i < 200; i++) assert.notStrictEqual(S.rollCritter(i % 2 === 0), 'ghostowl');
});

test('assignments split into steps, from a template or from the Soma plan', () => {
  const s = rich();
  S.syncSchool(s, [item({ id: 'h:42', name: 'Essay 2 Draft', groupName: 'Essays', pointsPossible: 60 }), item({ id: 'h:7', name: 'Problem Set 7', pointsPossible: 30 })], NOW, { source: 'soma' });
  const steps = S.breakDown(s, 'h:42');
  assert.strictEqual(steps[1].text, 'Outline');
  assert.strictEqual(S.breakDown(s, 'h:7').length, 4);
  const r = S.finishStep(s, 'h:42', steps[0].id);
  assert.ok(r.coins > 0 && r.left === 4);
  assert.strictEqual(S.finishStep(s, 'h:42', steps[0].id), null);
  // Soma plan tasks for assignment 7 replace its template steps and follow Soma's done state.
  S.setSomaPlan(s, { status: 'plus', todos: [{ id: 'a', text: 'Problems 1-4', date: '2099-01-01', assignmentId: 7, done: true }, { id: 'b', text: 'Problems 5-8', date: '2099-01-02', assignmentId: 7, done: false }] }, NOW);
  assert.deepStrictEqual(s.steps['h:7'].map((x) => [x.text, x.done]), [['Problems 1-4', true], ['Problems 5-8', false]]);
  S.finishStep(s, 'h:7', s.steps['h:7'][1].id);
  assert.strictEqual(s.soma.done.b, true);
});

test('exam topics are crystals: study, practice and review on a topic break it', () => {
  const s = rich();
  S.syncSchool(s, [{ id: 'm', name: 'Midterm exam', courseId: 'c', courseName: 'Physics', dueAt: NOW + 5 * DAY, pointsPossible: 100, weight: 30, submitted: false }], NOW, { source: 'soma' });
  const exam = s.school.items.m;
  S.setTopics(s, 'm', ['Momentum', 'Energy', 'momentum', '']);
  assert.deepStrictEqual(s.topics.m.map((t) => t.name), ['Momentum', 'Energy']);
  assert.strictEqual(S.crystalsLeft(s, exam), 2);
  assert.strictEqual(S.examArmor(s, exam), 1);
  S.startStudy(s, 'm', 25, NOW, 'Momentum');
  S.finishStudy(s, NOW + 25 * 60_000);
  assert.strictEqual(S.crystalsLeft(s, exam), 1);
  // 25 of 120 general minutes and 1 of 2 crystals: armor 1 - (0.5*25/120 + 0.5*0.5)
  assert.ok(Math.abs(S.examArmor(s, exam) - (1 - (0.5 * 25 / 120 + 0.25))) < 1e-9);
  S.finishPractice(s, 'm', 3, 0, NOW + DAY, 'Energy');
  const card = S.addReview(s, exam, { q: 'E?', choices: ['a', 'b', 'c', 'd'], answer: 0, topic: 'Energy' }, NOW);
  S.answerReview(s, card.id, true, NOW + DAY);
  assert.strictEqual(s.topics.m.find((t) => t.name === 'Energy').minutes, 25);
  assert.strictEqual(S.crystalsLeft(s, exam), 0);
  S.setTopics(s, 'm', ['Energy', 'Waves']);
  assert.strictEqual(s.topics.m[0].minutes, 25); // kept when the list is edited
});

test('collectibles: odds by chest, pity for epic and mythic, duplicates pay coins', () => {
  const s = rich(0);
  for (const r of ['common', 'rare', 'epic', 'legendary']) {
    const sum = S.TIERS.reduce((n, t) => n + S.DROP_TABLE[r].odds[t], 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, r);
  }
  // Every chest gives a collectible. rng 0.5: commons from a common chest... until pity at 10.
  const got = [];
  for (let i = 0; i < S.PITY_EPIC; i++) got.push(S.rollCollectible(s, 'common', () => 0.5));
  assert.deepStrictEqual(got.slice(0, -1).map((c) => c.tier), Array(S.PITY_EPIC - 1).fill('common'));
  const pity = got[S.PITY_EPIC - 1];
  assert.ok(pity.pity && ['epic', 'legendary', 'mythic'].includes(pity.tier));
  s.vault.sinceMythic = S.PITY_MYTHIC - 1;
  const myth = S.rollCollectible(s, 'common', () => 0.99);
  assert.strictEqual(myth.tier, 'mythic');
  assert.strictEqual(s.vault.sinceMythic, 0);
  // Finds unlock things: hats in the wardrobe, decorations in build mode, pets.
  s.vault.owned = {};
  const all = Object.keys(S.COLLECTIBLES);
  let n = 0;
  for (const id of all) { s.vault.sinceMythic = 0; s.vault.sinceEpic = 0; }
  const rng = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 400; i++) S.rollCollectible(s, 'legendary', rng);
  assert.ok(S.vaultFound(s) >= 14);
  assert.ok(s.cosmetics.owned.includes('hat:wizard') || s.cosmetics.owned.includes('hat:deans'));
  const before = s.coins;
  const dupe = S.rollCollectible(s, 'legendary', () => 0.5);
  if (dupe && dupe.dupe) assert.ok(s.coins > before);
});

test('studying drops more chests: steps, perfect practice, learned reviews, broken weak points', () => {
  const s = rich();
  S.syncSchool(s, [item({ id: 'h:1', name: 'Essay 1', groupName: 'Essays' }), { id: 'm', name: 'Midterm exam', courseId: 'c', courseName: 'Physics', dueAt: NOW + 5 * DAY, pointsPossible: 100, weight: 30, submitted: false }], NOW, { source: 'soma' });
  const start = s.school.chests.length;
  const steps = S.breakDown(s, 'h:1');
  for (const st of steps.slice(0, 3)) S.finishStep(s, 'h:1', st.id);
  assert.strictEqual(s.school.chests.length, start + 1);
  S.finishPractice(s, 'm', 5, 0, NOW);
  assert.strictEqual(s.school.chests.at(-1).rarity, 'rare');
  S.setTopics(s, 'm', ['Momentum']);
  S.startStudy(s, 'm', 25, NOW, 'Momentum');
  S.finishStudy(s, NOW + 25 * 60_000);
  assert.ok(s.school.chests.some((c) => c.rarity === 'epic' && /Momentum/.test(c.from)));
});

test('camps and treasure come back the next day, shrines pay once ever', () => {
  const s = rich(0);
  assert.ok(!S.exploreDone(s, 'wilds:camp:0', NOW));
  S.markExplored(s, 'wilds:camp:0', NOW);
  assert.ok(S.exploreDone(s, 'wilds:camp:0', NOW + 3600_000));
  assert.ok(!S.exploreDone(s, 'wilds:camp:0', NOW + DAY));
  const relic = S.useShrine(s, 'wilds:shrine:0', 'Old Stones');
  assert.ok(relic && s.relics.length === 1);
  assert.strictEqual(S.useShrine(s, 'wilds:shrine:0', 'Old Stones'), null);
  assert.ok(S.killReward(s, 2) > S.killReward(s, 0));
  assert.strictEqual(S.maxHealth(s), 100);
});

test('experience only comes from school: studying, handing in, grades and test bosses', () => {
  const s = rich(0);
  assert.strictEqual(s.hero.level, 1);
  S.killReward(s, 2);
  S.noteExplore(s, 'camp', 'wilds');
  assert.strictEqual(s.hero.xp, 0);
  S.startStudy(s, null, 25, NOW);
  const done = S.finishStudy(s, NOW + 25 * 60_000);
  assert.strictEqual(done.xp, 125);
  assert.strictEqual(done.levels, 1);
  assert.strictEqual(s.hero.level, 2);
  assert.strictEqual(s.hero.points, 1);
  S.syncSchool(s, [item({})], NOW, { source: 'soma' });
  const events = S.syncSchool(s, [item({ submitted: true, score: 19 })], NOW, { source: 'soma' });
  assert.deepStrictEqual(events.map((e) => e.xp), [40, 135]);
  assert.ok(s.hero.level >= 3);
});

test('levels, skills and gear make the hero stronger; a level gap bends the fight', () => {
  const s = rich(0);
  const base = S.heroStats(s);
  assert.deepStrictEqual([base.might, base.health], [10, 100]);
  S.addXp(s, S.xpToNext(1) + S.xpToNext(2));
  assert.strictEqual(s.hero.level, 3);
  assert.ok(!S.spendSkill(s, 'nope'));
  assert.ok(S.spendSkill(s, 'heavy') && S.spendSkill(s, 'tough'));
  assert.ok(!S.spendSkill(s, 'keen'));
  const sword = S.rollGear(s, 'rare', () => 0, 'weapon');
  assert.ok(S.addGear(s, sword).equipped);
  const worse = S.rollGear(s, 'common', () => 0, 'weapon');
  assert.ok(!S.addGear(s, worse).equipped);
  assert.strictEqual(s.hero.bag.length, 1);
  const now = S.heroStats(s);
  assert.ok(now.might > 16 + sword.might && now.health > 144);
  assert.ok(S.equipGear(s, worse.id));
  assert.strictEqual(s.hero.gear.weapon.id, worse.id);
  assert.strictEqual(S.sellGear(s, sword.id), S.sellValue(sword));
  assert.strictEqual(s.hero.bag.length, 0);
  assert.ok(S.enemyStats(10, 2).hp > S.enemyStats(10, 0).hp * 10);
  assert.ok(S.levelEdge(1, 8).deal < 0.4 && S.levelEdge(1, 8).take > 2);
  assert.ok(S.levelEdge(12, 4).deal > 1.4 && S.levelEdge(12, 4).take < 0.6);
  for (let i = 0; i < 30; i++) S.addGear(s, S.rollGear(s, 'common', () => 0.5));
  assert.ok(s.hero.bag.length <= S.BAG_SIZE);
});

test('the story pays out one quest at a time and old saves keep their studied minutes', () => {
  const s = rich(0);
  // Projects come from people and are taken on by talking to them: never pushed.
  assert.deepStrictEqual(S.acceptedProjects(s), []);
  const offer = S.projectFrom(s, 'Librarian');
  assert.strictEqual(offer.title, 'A roof over your head');
  assert.strictEqual(offer.accepted, false);
  assert.strictEqual(S.turnInProject(s, offer.id), null, 'not done yet');
  assert.ok(S.acceptProject(s, offer.id));
  s.coins = 1e9;
  assert.ok(S.placeBuilding(s, 'home', 30, 30) >= 0);
  assert.ok(S.projectFrom(s, 'Librarian').ready);
  assert.strictEqual(S.turnInProject(s, offer.id, () => 0).coins, 200);
  assert.strictEqual(S.projectFrom(s, 'Librarian').title, 'First lesson');
  // A villager's project waits until they've moved in.
  assert.strictEqual(S.projectFrom(s, 'Bram'), null);
  s.villagers.list.push({ name: 'Mira', role: 'Herbalist', friend: 0, mood: 70 });
  assert.strictEqual(S.projectFrom(s, 'Mira').title, 'Start a creature log');
  // Older saves keep the projects they had already finished.
  const older = JSON.parse(S.serialize(S.newState(NOW)));
  delete older.projects;
  older.quest.step = 2;
  assert.strictEqual(S.deserialize(JSON.stringify(older), NOW).projects.done.length, 2);
  const old = JSON.parse(S.serialize(S.newState(NOW)));
  delete old.hero;
  old.study.total = 100;
  assert.ok(S.deserialize(JSON.stringify(old), NOW).hero.level > 3);
});

test('late work costs coins and experience every hour, up to two days, and ignoring it stops that', () => {
  const s = rich(0);
  s.coins = 1000;
  S.addXp(s, 50);
  S.syncSchool(s, [item({ id: 'hw', dueAt: NOW + 2 * 3600_000 })], NOW, { source: 'soma' });
  assert.strictEqual(S.deadlineLevel(s, s.school.items.hw, NOW), 'critical');
  assert.deepStrictEqual(S.newWarnings(s, NOW).map((w) => w.level), ['critical']);
  assert.deepStrictEqual(S.newWarnings(s, NOW), []);
  const late = NOW + 5 * 3600_000; // three hours late
  assert.strictEqual(S.deadlineLevel(s, s.school.items.hw, late), 'late');
  assert.ok(S.isUnderSiege(s, late));
  const lost = S.chargeLate(s, late);
  assert.ok(Math.abs(lost.coins - 1000 * (1 - 0.99 ** 3)) < 0.01);
  assert.strictEqual(lost.xp, 9);
  assert.strictEqual(S.chargeLate(s, late).coins, 0);
  // Stops after two days late.
  S.chargeLate(s, NOW + 100 * 3600_000);
  const total = S.lateCost(s, s.school.items.hw, NOW + 100 * 3600_000);
  assert.ok(total.stopped && total.coins < 1000 * (1 - 0.99 ** 48) + 0.01);
  // Ignored: no siege, no losses, no invader.
  S.setIgnored(s, 'hw', true, NOW + 100 * 3600_000);
  assert.ok(!S.isUnderSiege(s, NOW + 100 * 3600_000));
  assert.deepStrictEqual(S.threats(s, NOW + 100 * 3600_000), []);
});

test('work found already late on the first sync costs nothing, and paper work is ignored by itself', () => {
  const s = rich(0);
  s.coins = 1000;
  S.syncSchool(s, [item({ id: 'old', dueAt: NOW - 3600_000 }), item({ id: 'paper', dueAt: NOW - 3600_000, noSubmit: true })], NOW, { source: 'soma' });
  assert.strictEqual(S.chargeLate(s, NOW).coins, 0);
  assert.deepStrictEqual(S.lateItems(s, NOW).map((a) => a.id), ['old']);
  assert.ok(S.chargeLate(s, NOW + 2 * 3600_000).coins > 0);
  S.setIgnored(s, 'paper', false, NOW + 2 * 3600_000);
  assert.deepStrictEqual(S.lateItems(s, NOW + 2 * 3600_000).map((a) => a.id).sort(), ['old', 'paper']);
  assert.strictEqual(S.fromSomaSnapshot({ kind: 'canvas', host: 'h', courses: [], groups: [], assignments: [{ id: 1, courseId: 1, name: 'Lab', submissionTypes: ['on_paper'] }] })[0].noSubmit, true);
});

test('market prices and study pay follow the age, and neither crashes in a new age', () => {
  const s = S.newState(NOW);
  assert.strictEqual(S.wage(s), 16000 / S.WAGE_DIV); // rewards follow the age's wonder, not the town
  s.coins = 1e9;
  S.buildWonder(s);
  assert.strictEqual(s.era, 1);
  assert.strictEqual(S.baseIncome(s), 0);
  assert.strictEqual(S.wage(s), (600000 * S.AGE_PACE[1]) / S.WAGE_DIV); // and rise with the age, even with an empty town
  const chest = S.marketStock(s, NOW).find((o) => o.kind === 'chest');
  assert.strictEqual(chest.price, Math.round(S.ERAS[1].wonderCost * S.CHEST_PRICE[chest.rarity]));
  // A bought chest always costs more than the coins inside it.
  for (const r of ['rare', 'epic', 'legendary']) assert.ok(S.CHEST_PRICE[r] > 2 * S.CHEST_COINS[r]);
  // A 25 minute study session pays the age's study rate for each minute.
  const t = S.newState(NOW);
  const before = t.coins;
  S.startStudy(t, null, 25, NOW);
  S.finishStudy(t, NOW + 25 * 60000);
  assert.strictEqual(t.coins - before, 25 * Math.round(16000 * S.STUDY_SHARE[0]));
});

test('hidden caches give a chest once a day each, and refill the next day', () => {
  const s = S.newState(NOW);
  const chest = S.openCache(s, 0, NOW);
  assert.ok(['common', 'rare'].includes(chest.rarity));
  assert.strictEqual(chest.from, 'A hidden cache');
  assert.strictEqual(S.openCache(s, 0, NOW + 1000), null);
  assert.ok(S.openCache(s, 1, NOW));
  assert.ok(S.openCache(s, 0, NOW + DAY));
  s.era = 1;
  assert.ok(S.openCache(s, 1, NOW + DAY)); // a new land has its own caches
});

test('landmarks pay once, all of them give a chest; the map reveals where you walk', () => {
  const s = S.newState(NOW);
  const first = S.discover(s, 'cave', 2);
  assert.strictEqual(first.coins, Math.round(S.ERAS[0].wonderCost * S.LANDMARK_SHARE));
  assert.strictEqual(S.discover(s, 'cave', 2), null);
  const last = S.discover(s, 'mammoth', 2);
  assert.strictEqual(last.chest.rarity, 'rare');
  assert.ok(S.revealMap(s, 0, 0));
  assert.ok(S.mapSeenAt(s, S.MAP_N / 2, S.MAP_N / 2));
  assert.ok(!S.mapSeenAt(s, 0, 0));
  assert.strictEqual(S.revealMap(s, 0, 0), false);
});

test('the week: study 150 minutes and hand in what is due for an epic chest; four weeks in a row, legendary', () => {
  const s = S.newState(NOW);
  const mon = S.weekStart(NOW);
  S.syncSchool(s, [item({ id: 'hw', dueAt: mon + 3 * DAY })], mon + DAY, { source: 'demo' });
  const study = (t, m) => { S.startStudy(s, null, m, t); S.finishStudy(s, t + m * 60000); };
  study(mon + DAY, 60); study(mon + 2 * DAY, 90);
  let w = S.weekStatus(s, mon + 2 * DAY + 2 * 3600e3);
  assert.strictEqual(w.minutes, 150);
  assert.strictEqual(w.due, 1);
  assert.strictEqual(w.done, false, 'homework still due');
  assert.strictEqual(S.claimWeek(s, mon + 2 * DAY + 2 * 3600e3), null);
  S.syncSchool(s, [item({ id: 'hw', dueAt: mon + 3 * DAY, submitted: true })], mon + 2 * DAY + 3 * 3600e3);
  const got = S.claimWeek(s, mon + 2 * DAY + 4 * 3600e3);
  assert.strictEqual(got.chest.rarity, 'epic');
  assert.strictEqual(S.claimWeek(s, mon + 2 * DAY + 5 * 3600e3), null, 'once a week');
  for (let k = 1; k <= 3; k++) { study(mon + k * 7 * DAY + DAY, 150); const r = S.claimWeek(s, mon + k * 7 * DAY + DAY + 4 * 3600e3); assert.strictEqual(r.streak, k + 1); if (k === 3) assert.strictEqual(r.chest.rarity, 'legendary'); }
});

test('the village builder: pieces unlock with hours studied, paths paint and erase, the rating counts stars', () => {
  const s = rich();
  assert.ok(S.decorLock(s, 'tulips').ok);
  assert.deepStrictEqual(S.decorLock(s, 'maple'), { ok: false, need: 5 });
  assert.strictEqual(S.placeDecor(s, 'maple', 5, 5), null, 'locked until 5 hours');
  s.study.total = 5 * 60;
  assert.ok(S.placeDecor(s, 'maple', 5, 5));
  assert.strictEqual(S.decorLock(s, 'fountain').need, 'market');
  assert.ok(Object.values(S.DECOR).every((d) => S.DECOR_SETS.some((x) => x.id === d.set)), 'every piece is in a set');
  assert.ok(Object.keys(S.DECOR).length >= 70);
  assert.strictEqual(S.paintPath(s, 0, 0, 1, 1), 5);
  assert.strictEqual(S.paintPath(s, 0, 0, 1, 1), 0, 'already that');
  assert.strictEqual(S.paintPath(s, 0, 0, -1, 0), 1);
  assert.strictEqual(S.paintPath(s, 3, 3, 3, 0), 0, 'boardwalk needs 8 hours');
  const empty = S.townRating(S.newState(NOW));
  assert.strictEqual(empty.stars, 0);
  assert.ok(empty.tips.length > 0);
});

test('homework and tests talk back, depending on the clock and how much you studied', () => {
  const s = S.newState(NOW);
  S.syncSchool(s, [item({ id: 'hw', name: 'Problem Set 3', courseName: 'Physics', dueAt: NOW + 5 * DAY })], NOW, { source: 'demo' });
  const hw = s.school.items.hw;
  const lines = [0, 1, 2, 3, 4].map((k) => S.taunt(s, hw, NOW, k));
  assert.ok(lines.every((l) => typeof l === 'string' && l.length > 10 && !/[{}]/.test(l)));
  assert.notStrictEqual(lines[0], lines[1], 'more than one line');
  assert.ok(lines.some((l) => l.includes('Physics') || l.includes('days')));
  assert.ok(S.taunt(s, hw, NOW + 6 * DAY, 0).length > 10, 'overdue lines');
  const exam = { ...hw, id: 'ex', kind: 'boss', name: 'Midterm' };
  assert.ok(!/[{}]/.test(S.taunt(s, exam, NOW, 4)));
});

test('mythic chests open with legendary pools and more inside; the weekly streak reaches one at twelve', () => {
  const s = rich(0);
  S.grantChest(s, 'mythic', 'test');
  const tokens = s.tokens;
  const { loot } = S.openChest(s, s.school.chests[0].id, () => 0.1, NOW);
  assert.ok(loot.some((l) => l.kind === 'collectible' && ['epic', 'legendary', 'mythic'].includes(l.tier)));
  assert.ok(loot.some((l) => l.kind === 'gear' && l.item.rarity === 'legendary'));
  assert.strictEqual(s.tokens - tokens, 3);
  assert.deepStrictEqual(S.CHEST_TIERS.map((t) => t.id), ['common', 'rare', 'epic', 'legendary', 'mythic']);
});

// --- classify.js: exams, quizzes, projects and plain work ---

test('classify: the before/after table', () => {
  const c = (over) => S.classify(item(over));
  assert.deepStrictEqual(c({ name: 'Midterm Exam', pointsPossible: 100, weight: 25, groupName: 'Exams' }), { kind: 'boss', size: 3 });
  assert.deepStrictEqual(c({ name: 'Test 2', pointsPossible: 100, weight: 30, groupName: 'Tests' }), { kind: 'boss', size: 3 });
  assert.deepStrictEqual(c({ name: 'Coding Problem 4', pointsPossible: 100, weight: 0, groupName: 'Coding Problems' }), { kind: 'invader', size: 2 });
  assert.deepStrictEqual(c({ name: 'Lab 9 - Matrix Operations', pointsPossible: 10, weight: 20, groupName: 'Labs' }), { kind: 'invader', size: 2 });
  assert.deepStrictEqual(c({ name: 'L18-Warm Up Quiz (ICA Nov 9)', pointsPossible: 10, weight: 5, groupName: 'In-Class Activities' }), { kind: 'invader', size: 1 });
  assert.deepStrictEqual(c({ name: 'Final Project', pointsPossible: 100, weight: 0, groupName: 'Projects' }), { kind: 'invader', size: 2 });
  assert.deepStrictEqual(c({ name: 'Exam1', pointsPossible: 100, weight: 0, groupName: 'Assignments' }), { kind: 'boss', size: 3 });
});

test('classify: final projects, papers and presentations are not exams', () => {
  for (const name of ['Final Project', 'Final Paper', 'Final Presentation', 'Final Lab Report', 'Midterm Paper', 'Final Draft']) {
    const r = S.classify(item({ name, pointsPossible: 150, weight: 25, groupName: 'Assignments' }));
    assert.strictEqual(r.kind, 'invader', name);
  }
  assert.strictEqual(S.classify(item({ name: 'Final', pointsPossible: 200, weight: 30 })).kind, 'boss');
  assert.strictEqual(S.classify(item({ name: 'Final Exam Review', pointsPossible: 5, weight: 5 })).kind, 'invader');
});

test('classify: exams under other names become bosses', () => {
  for (const name of ['Unit 3 Assessment', 'Prelim 1', 'Exam II', 'Hour Exam', 'Test #2', 'Exam_2', 'Midterm1']) {
    assert.strictEqual(S.classify(item({ name, pointsPossible: 100, weight: 0, groupName: 'Assignments' })).kind, 'boss', name);
  }
  assert.strictEqual(S.classify(item({ name: 'Write test cases', pointsPossible: 100 })).kind, 'invader');
  // A tiny weekly "test" is a big invader, not a boss.
  assert.deepStrictEqual(S.classify(item({ name: 'Test 3', pointsPossible: 10, weight: 5 })), { kind: 'invader', size: 2 });
});

test('classify: quizzes are sized by weight, and labels say what they are', () => {
  assert.deepStrictEqual(S.classify(item({ name: 'Quiz 4 (in class)', pointsPossible: 10, weight: 10 })), { kind: 'invader', size: 1 });
  assert.deepStrictEqual(S.classify(item({ name: 'Quiz 5', pointsPossible: 50, weight: 15, groupName: 'Quizzes' })), { kind: 'invader', size: 2 });
  const s = S.newState(NOW);
  S.syncSchool(s, [item({ id: 'q', name: 'Quiz 1' }), item({ id: 'p', name: 'Final Project', pointsPossible: 100 }), item({ id: 'e', name: 'Exam 1', pointsPossible: 100 })], NOW, { source: 'demo' });
  assert.deepStrictEqual(['q', 'p', 'e'].map((id) => s.school.items[id].label), ['quiz', 'project', 'exam']);
});

test('classify: Canvas quiz types and proctoring count without words in the name', () => {
  const list = S.fromSomaSnapshot({
    kind: 'canvas', host: 'h', courses: [{ id: 1, name: 'Bio' }], groups: [{ id: 9, name: 'Weekly', weight: 10 }],
    assignments: [
      { id: 1, courseId: 1, groupId: 9, name: 'Chapter 4', pointsPossible: 10, submissionTypes: ['online_quiz'] },
      { id: 2, courseId: 1, groupId: 9, name: 'Unit 2', pointsPossible: 120, submissionTypes: ['online_quiz'] },
      { id: 3, courseId: 1, groupId: 9, name: 'Checkpoint', pointsPossible: 60, description: 'Requires Respondus LockDown Browser.' },
    ],
  });
  assert.strictEqual(list[0].isQuiz, true);
  assert.strictEqual(list[2].proctored, true);
  assert.strictEqual('description' in list[2], false);
  assert.deepStrictEqual(list.map((a) => S.classify(a)), [{ kind: 'invader', size: 1 }, { kind: 'boss', size: 3 }, { kind: 'boss', size: 3 }]);
});

test('setKind: the student overrides the guess, and old saves still load', () => {
  const s = S.newState(NOW);
  assert.deepStrictEqual(s.school.kinds, {});
  S.syncSchool(s, [item({ id: 'x', name: 'Checkpoint 3', pointsPossible: 30 })], NOW, { source: 'demo' });
  assert.strictEqual(s.school.items.x.kind, 'invader');
  assert.ok(S.setKind(s, 'x', 'boss'));
  assert.deepStrictEqual([s.school.items.x.kind, s.school.items.x.size, s.school.items.x.label], ['boss', 3, 'exam']);
  // It sticks through the next sync and a save.
  S.syncSchool(s, [item({ id: 'x', name: 'Checkpoint 3', pointsPossible: 30 })], NOW + 1, { source: 'demo' });
  assert.strictEqual(s.school.items.x.kind, 'boss');
  const back = S.deserialize(S.serialize(s), NOW);
  assert.strictEqual(back.school.kinds.x, 'boss');
  // A boss guess turned into an assignment, then back to the guess.
  S.syncSchool(s, [item({ id: 'm', name: 'Midterm 1', pointsPossible: 100 })], NOW + 2, { source: 'demo' });
  S.setKind(s, 'm', 'assignment');
  assert.deepStrictEqual([s.school.items.m.kind, s.school.items.m.label], ['invader', 'assignment']);
  S.setKind(s, 'm', 'quiz');
  assert.strictEqual(s.school.items.m.label, 'quiz');
  S.setKind(s, 'm', null);
  assert.strictEqual(s.school.items.m.kind, 'boss');
  assert.strictEqual(S.setKind(s, 'm', 'dragon'), false);
  // A save from before overrides existed.
  const old = JSON.parse(S.serialize(S.newState(NOW)));
  delete old.school.kinds;
  assert.deepStrictEqual(S.deserialize(JSON.stringify(old), NOW).school.kinds, {});
});

test('the sample semester never costs anything: open work rolls a week on, and sample exams never hit the gate', () => {
  const s = S.newState();
  const t0 = Date.UTC(2026, 10, 16, 12);
  S.syncSchool(s, S.demoSemester(t0), t0, { source: 'demo' });
  const coins = (s.coins = 1000);
  const later = t0 + 3 * 86400000;
  assert.ok(S.rollDemo(s, later));
  assert.strictEqual(S.lateItems(s, later).length, 0);
  assert.strictEqual(S.chargeLate(s, later).coins, 0);
  assert.strictEqual(s.coins, coins);
  for (const a of Object.values(s.school.items)) if (!a.submitted) assert.ok(a.dueAt > later + 2 * 3600000, `${a.name} moved past now`);
  assert.deepStrictEqual(S.resolveExams(s, later + 30 * 86400000).filter((e) => S.isSample(e.item)), []);
});

test('selling a building gives back half of everything spent on it, plus what is stored inside', () => {
  const s = S.newState();
  s.coins = 1e9;
  const i = S.placeBuilding(s, 'home', 30, 30);
  assert.ok(i >= 0);
  const b = s.pads.earth[i];
  const base = S.buildCost('home', b.tier);
  assert.strictEqual(S.buildingPaid(b), base);
  const up = S.upgradeCost(b);
  assert.ok(S.upgrade(s, i, 'earth'));
  assert.strictEqual(S.buildingPaid(b), base + up);
  b.stored = 40;
  const before = s.coins;
  const back = S.sellBuilding(s, i, 'earth');
  assert.strictEqual(back, Math.floor((base + up) / 2) + 40);
  assert.strictEqual(s.coins, before + back);
  assert.strictEqual(s.pads.earth[i], null);
  assert.strictEqual(s.padSpots.earth[i], undefined);
  // Old saves (no record of what was paid) still sell for half the build plus upgrades.
  assert.strictEqual(S.buildingPaid({ type: 'home', tier: 0, level: 2 }), S.buildCost('home', 0) * 3);
});

test('the country opens one area at a time through the Librarian\'s expansion projects', () => {
  const s = S.newState();
  s.coins = 1e9;
  assert.deepStrictEqual(S.openAreas(s), ['meadow']);
  assert.strictEqual(S.nextArea(s).zone, 'orchard');
  assert.strictEqual(S.areaProject('orchard').title, 'The orchard path');
  // Work through the Librarian's list: a hut, a first lesson, then the orchard path.
  const next = () => S.projectFrom(s, 'Librarian');
  S.acceptProject(s, next().id); S.placeBuilding(s, 'home', 30, 30); S.turnInProject(s, next().id, () => 0);
  S.acceptProject(s, next().id); s.study.total = 40; S.turnInProject(s, next().id, () => 0);
  assert.strictEqual(next().id, 'the-orchard-path');
  S.acceptProject(s, next().id);
  assert.deepStrictEqual(S.updateLandOpen(s), []);
  S.turnInProject(s, 'the-orchard-path', () => 0);
  assert.deepStrictEqual(S.updateLandOpen(s).map((a) => a.zone), ['orchard']);
  assert.deepStrictEqual(S.openAreas(s), ['meadow', 'orchard']);
  s.era = 1;
  assert.strictEqual(S.openAreas(s).length, 5, 'later lands come fully open');
});
