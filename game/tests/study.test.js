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
