import test from 'node:test';
import assert from 'node:assert';
import * as S from '../src/sim.js';

const NOW = 1_800_000_000_000;
const DAY = 86400000;
const rich = (coins = 1e15) => Object.assign(S.newState(NOW), { coins });

test('a new game can afford its first home and nothing more expensive', () => {
  const s = S.newState(NOW);
  assert.ok(S.build(s, 0, 'home'));
  assert.ok(!S.build(s, 1, 'trade'));
  assert.strictEqual(s.pads.earth[0].tier, 0);
  assert.ok(!S.build(s, 0, 'home'), 'pad is taken');
  assert.ok(!S.build(s, 6, 'home'), 'pad 6 is locked in the Stone Age');
});

test('buildings fill their own store up to a cap, and collecting banks it', () => {
  const s = rich();
  S.build(s, 0, 'work');
  const before = s.coins;
  s.lastTick = NOW;
  S.tick(s, NOW + 60_000);
  assert.strictEqual(Math.round(s.pads.earth[0].stored), 300);
  assert.strictEqual(S.collect(s, 0), 300);
  assert.strictEqual(s.coins, before + 300);
  S.tick(s, NOW + 60_000 + 100 * 3600_000);
  assert.strictEqual(s.pads.earth[0].stored, S.buildingCap(s, s.pads.earth[0]), 'stops at the cap while away');
  assert.strictEqual(S.buildingCap(s, s.pads.earth[0]), 5 * S.STORE_HOURS * 3600);
});

test('upgrading and gilding raise income; modernizing needs a newer era', () => {
  const s = rich();
  S.build(s, 0, 'home');
  const b = s.pads.earth[0];
  assert.strictEqual(S.buildingIncome(s, b), 1);
  S.upgrade(s, 0); S.upgrade(s, 0);
  assert.strictEqual(b.level, 3);
  assert.ok(!S.upgrade(s, 0));
  assert.strictEqual(S.buildingIncome(s, b), 4.5);
  assert.ok(!S.gild(s, 0), 'no token yet');
  s.tokens = 1;
  assert.ok(S.gild(s, 0));
  assert.strictEqual(S.buildingIncome(s, b), 13.5);
  assert.ok(!S.modernize(s, 0), 'already current');
  S.buildWonder(s);
  assert.strictEqual(s.era, 1);
  assert.ok(S.modernize(s, 0));
  assert.deepStrictEqual([b.tier, b.level, b.golden], [1, 1, true]);
  assert.strictEqual(S.buildingName(b), 'Mudbrick House');
});

test('wonders advance the era in order, the rocket unlocks the moon, and the Star Gate is built there', () => {
  const s = rich(1e30);
  for (let era = 0; era < 6; era++) {
    assert.strictEqual(S.nextWonder(s).scene, 'earth');
    assert.ok(S.buildWonder(s));
  }
  assert.strictEqual(s.era, 6);
  assert.strictEqual(S.padsUnlocked(s, 'earth'), 16);
  assert.strictEqual(S.padsUnlocked(s, 'moon'), 8);
  assert.strictEqual(S.nextWonder(s).name, 'Star Gate');
  assert.strictEqual(S.buildWonder(s), null, 'not from Earth');
  s.scene = 'moon';
  assert.ok(S.build(s, 0, 'trade'));
  assert.strictEqual(S.buildingName(s.pads.moon[0]), 'Orbital Exchange');
  assert.ok(S.buildWonder(s));
  assert.strictEqual(s.era, 7);
  assert.strictEqual(S.nextWonder(s), null);
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
  assert.strictEqual(S.totalIncome(s, NOW + 2 * DAY), 11);

  let events = S.syncSchool(s, [item({ submitted: true })], NOW + 2 * DAY);
  assert.deepStrictEqual(events.map((e) => e.type), ['handed-in']);
  assert.strictEqual(events[0].reward, 22 * 120);
  assert.strictEqual(s.coins, 22 * 120);
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
  assert.deepStrictEqual(loot.map((l) => l.kind), ['coins', 'relic', 'cosmetic', 'token', 'gear']);
  assert.strictEqual(s.hero.gear.weapon.rarity, 'legendary');
  assert.strictEqual(s.coins, 5000);
  assert.strictEqual(s.tokens, 1);
  assert.strictEqual(S.relicMult(s), 1.25);
  assert.strictEqual(s.school.chests.length, 0);
  assert.strictEqual(S.openChest(s, 'nope'), null);
  S.grantChest(s, 'common', 'test');
  assert.deepStrictEqual(S.openChest(s, s.school.chests[0].id, () => 0.99, NOW).loot.map((l) => l.kind), ['coins']);
});

test('power grows with recent hand-ins for that course, not with the age; a boss pays out once', () => {
  const s = rich(0);
  assert.strictEqual(S.playerPower(s, null, NOW), 10);
  S.syncSchool(s, [item({ id: 'p1', submitted: true, dueAt: NOW - DAY }), item({ id: 'p2', submitted: true, dueAt: NOW - 2 * DAY }), item({ id: 'boss', name: 'Midterm', dueAt: NOW + DAY, weight: 30 })], NOW, { source: 'demo' });
  assert.strictEqual(S.playerPower(s, 'c', NOW), 12);
  s.era = 2;
  assert.strictEqual(S.playerPower(s, 'other', NOW), 10);
  const boss = s.school.items.boss;
  assert.strictEqual(boss.kind, 'boss');
  assert.ok(S.bossHp(s, boss) > 400);
  const win = S.bossWon(s, boss);
  assert.strictEqual(win.chest.rarity, 'epic');
  assert.ok(win.reward >= 500);
  assert.strictEqual(S.bossWon(s, boss), null);
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
  assert.strictEqual(back.pads.earth.length, 16);
  assert.strictEqual(back.school.chests.length, 1);
  assert.strictEqual(S.deserialize('not json', NOW).coins, 120);
  assert.strictEqual(S.deserialize('{"v":99}', NOW).coins, 120);
});

// Pacing: a player who always buys the best thing they can afford, collecting constantly.
test('pacing: each era takes longer than the last, and the first takes minutes not hours', () => {
  const s = S.newState(NOW);
  let t = NOW;
  const reached = [];
  const bestBuy = () => {
    const options = [];
    const tier = S.tierFor(s);
    s.pads.earth.forEach((b, i) => {
      if (i >= S.padsUnlocked(s)) return;
      if (!b) for (const type of S.TYPES) options.push({ cost: S.buildCost(type, tier), gain: S.BUILDINGS[type].income * 6 ** tier, run: () => S.build(s, i, type) });
      else {
        if (b.level < 3) options.push({ cost: S.upgradeCost(b), gain: S.buildingIncome(s, { ...b, level: b.level + 1 }) - S.buildingIncome(s, b), run: () => S.upgrade(s, i) });
        if (b.tier < tier) options.push({ cost: S.modernizeCost(s, b), gain: S.buildingIncome(s, { ...b, tier, level: 1 }) - S.buildingIncome(s, b), run: () => S.modernize(s, i) });
      }
    });
    return options.filter((o) => o.gain > 0).sort((a, b) => a.cost / a.gain - b.cost / b.gain)[0];
  };
  while (s.era < 6 && t < NOW + 2000 * 3600_000) {
    t += s.era < 2 ? 5000 : 60000;
    S.tick(s, t);
    s.pads.earth.forEach((_, i) => S.collect(s, i));
    const wonder = S.nextWonder(s);
    for (let guard = 0; guard < 50; guard++) {
      const buy = bestBuy();
      const income = S.totalIncome(s, t);
      if (wonder && s.coins >= wonder.cost && (!buy || wonder.cost < income * 600 || buy.cost / buy.gain > 900)) {
        S.buildWonder(s);
        reached.push((t - NOW) / 60000);
        break;
      }
      if (!buy || buy.cost > s.coins) break;
      buy.run();
    }
  }
  console.log('      hours of constant play to reach each new era:', reached.map((m) => (m / 60).toFixed(1)).join(', '));
  assert.strictEqual(reached.length, 6, 'reaches the Space launch');
  assert.ok(reached[0] >= 4 && reached[0] <= 25, `first era took ${reached[0]} min`);
  for (let i = 2; i < reached.length; i++) assert.ok(reached[i] - reached[i - 1] > reached[i - 1] - reached[i - 2], 'eras get longer');
  assert.ok(reached[5] < 60 * 600, 'the rocket is reachable');
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

test('studying for a test shrinks the boss and study chests run out for the day', () => {
  const s = rich();
  S.syncSchool(s, [{ id: 'm', name: 'Midterm exam', courseId: 'c', courseName: 'Physics', dueAt: NOW + 2 * DAY, pointsPossible: 100, weight: 30, submitted: false }], NOW, { source: 'soma' });
  const boss = s.school.items.m;
  const full = S.bossHp(s, boss);
  const power = S.playerPower(s, 'c', NOW);
  let t = NOW;
  const chests = [];
  for (let i = 0; i < 4; i++) {
    S.startStudy(s, 'm', 45, t);
    t += 45 * 60_000;
    chests.push(S.finishStudy(s, t).chest);
  }
  assert.deepStrictEqual(chests.map((c) => c && c.rarity), ['epic', 'epic', 'epic', null]);
  assert.strictEqual(S.studyProgress(s, boss), 1);
  assert.strictEqual(S.bossHp(s, boss), Math.round(full * (1 - S.BOSS_STUDY_CUT)));
  assert.ok(S.playerPower(s, 'c', t) > power);
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
  assert.strictEqual(S.storyStatus(s).title, 'First lesson');
  assert.strictEqual(S.claimStory(s), null);
  s.study.total = 25;
  const paid = S.claimStory(s, () => 0);
  assert.strictEqual(paid.gear.item.slot, 'weapon');
  assert.strictEqual(S.storyStatus(s).title, 'Into the Wilds');
  S.noteExplore(s, 'camp', 'wilds');
  assert.ok(S.storyStatus(s).done);
  const old = JSON.parse(S.serialize(S.newState(NOW)));
  delete old.hero;
  old.study.total = 100;
  assert.ok(S.deserialize(JSON.stringify(old), NOW).hero.level > 3);
});
