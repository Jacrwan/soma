import { test, expect } from '@playwright/test';
import { asProposal } from '../src/lib/proposalWording';

// Reported: "Removed Lab 4: Objects from today at 2–3 PM." sat above a delete
// card that hadn't been accepted, so nothing had been removed.
test('a reply that claims a change is reworded as a suggestion', () => {
  expect(asProposal('Removed Lab 4: Objects from today at 2–3 PM.')).toBe('Suggested: remove Lab 4: Objects from today at 2–3 PM.');
  expect(asProposal('Got it—you read through 4.9. Updated the block.')).toBe('Got it—you read through 4.9. Suggested: update the block.');
  expect(asProposal("I've moved physics to tomorrow.")).toBe('Suggested: move physics to tomorrow.');
  expect(asProposal('Got it — removed the lecture review.')).toBe('Got it — suggested: remove the lecture review.');
  expect(asProposal('Renamed and moved.')).toBe('Suggested: rename and move.');
});

test('suggestions and ordinary sentences are left alone', () => {
  for (const reply of [
    'Moving physics reading to tomorrow.',
    'Extending physics reading to 2 hours and adding 3 hours of CS 61A lecture review after.',
    'You already removed that block yesterday, so there is nothing to change.',
    'Your plan has three blocks left.',
  ]) expect(asProposal(reply)).toBe(reply);
});
