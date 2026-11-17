import test from 'node:test';
import assert from 'node:assert';
import { addDeck, dueCards, rateCard, deleteDeck, BOX_DAYS } from '../src/studyhall.js';

const NOW = Date.UTC(2026, 10, 16, 15);
const DAY = 86400000;

test('flashcard decks: new cards are due now, and good answers push them further out', () => {
  const s = {};
  const deck = addDeck(s, { title: 'Eigenvectors', course: 'Linear Algebra', cards: [{ front: 'Av = λv means', back: 'v is an eigenvector of A' }, { front: 'det(A - λI) = 0', back: 'the characteristic equation' }] }, NOW);
  assert.strictEqual(dueCards(s, NOW).length, 2);
  const [a, b] = deck.cards;
  rateCard(s, deck.id, a.id, 'good', NOW);
  assert.strictEqual(a.box, 1);
  assert.strictEqual(a.due, NOW + BOX_DAYS[1] * DAY);
  rateCard(s, deck.id, b.id, 'easy', NOW);
  assert.strictEqual(b.box, 2);
  assert.strictEqual(dueCards(s, NOW + 1000).length, 0);
  assert.strictEqual(dueCards(s, NOW + 1 * DAY).length, 1, 'the good one is due tomorrow');
  rateCard(s, deck.id, a.id, 'again', NOW + DAY);
  assert.strictEqual(a.box, 0, 'forgetting sends it back to the start');
  assert.ok(a.due <= NOW + DAY + 60000);
  deleteDeck(s, deck.id);
  assert.strictEqual(dueCards(s, NOW + 10 * DAY).length, 0);
});

test('decks stay bounded', () => {
  const s = {};
  for (let i = 0; i < 65; i++) addDeck(s, { title: `d${i}`, cards: [{ front: 'a', back: 'b' }] }, NOW + i);
  assert.strictEqual(Object.keys(s.decks).length, 60);
  const big = addDeck(s, { title: 'big', cards: Array.from({ length: 200 }, (_, i) => ({ front: `f${i}`, back: 'b' })) }, NOW);
  assert.strictEqual(big.cards.length, 80);
});

import { addKit, deleteKit, kitText, kitMade, addCards, KIT_MAX } from '../src/studyhall.js';

test('study kits: material is kept apart from the save, and nothing is made until asked', () => {
  const s = {};
  const kit = addKit(s, { title: 'Cell respiration', overview: 'How cells make ATP.', topics: ['Glycolysis', 'Krebs cycle'], source: { kind: 'pdf', name: 'bio.pdf' } }, 'Glycolysis splits glucose into two pyruvate...', NOW);
  assert.strictEqual(kitText(kit.id), 'Glycolysis splits glucose into two pyruvate...');
  assert.ok(!JSON.stringify(s).includes('splits glucose'), 'the save holds no material');
  assert.strictEqual(kit.deckId, null);
  assert.strictEqual(kit.questions, null);
  assert.strictEqual(kit.guide, null);
  assert.strictEqual(kitMade(s, kit), 'Nothing made yet');
  kit.deckId = addDeck(s, { title: kit.title, cards: [{ front: 'ATP from glycolysis', back: '2 net' }] }, NOW).id;
  addCards(s, kit.deckId, [{ front: 'Where is the Krebs cycle', back: 'Mitochondrial matrix' }], NOW);
  assert.strictEqual(s.decks[kit.deckId].cards.length, 2);
  assert.match(kitMade(s, kit), /2/);
  deleteKit(s, kit.id);
  assert.strictEqual(s.kits[kit.id], undefined);
  assert.strictEqual(s.decks[kit.deckId], undefined, 'its deck goes with it');
  assert.strictEqual(kitText(kit.id), '');
});

test('study kits stay bounded', () => {
  const s = {};
  for (let i = 0; i < KIT_MAX + 5; i++) addKit(s, { title: `Kit ${i}` }, `text ${i}`, NOW + i);
  assert.strictEqual(Object.keys(s.kits).length, KIT_MAX);
});

import { parseLine } from '../src/practice.js';

test('kit lines: LaTeX survives whether or not the model doubled its backslashes', () => {
  assert.strictEqual(parseLine(String.raw`{"front":"\\(\\frac{a}{b}\\)"}`).front, String.raw`\(\frac{a}{b}\)`);
  const loose = parseLine(String.raw`{"front":"\(\frac{1}{2}\theta + \nabla \beta\)","back":"two\nlines \times \text{x} \ce{H2O}"}`);
  assert.strictEqual(loose.front, String.raw`\(\frac{1}{2}\theta + \nabla \beta\)`);
  assert.strictEqual(loose.back, 'two\nlines ' + String.raw`\times \text{x} \ce{H2O}`);
  assert.strictEqual(parseLine('not json'), null);
  assert.strictEqual(parseLine('```json'), null);
});
