import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { indexUniversities, searchUniversities } from '../src/lib/universities';

const list = indexUniversities(JSON.parse(readFileSync('src/data/universities.json', 'utf8')));

// Students search the way they talk about their school, so the first result
// has to be right for abbreviations and half-typed names, and a made-up name
// must find nothing (the picker only accepts rows from the list).
test('students find their school by the name they actually use', () => {
  const first = (q: string) => searchUniversities(list, q, 'US')[0]?.name;

  expect(first('UCLA')).toBe('University of California, Los Angeles');
  expect(first('mit')).toBe('Massachusetts Institute of Technology');
  expect(first('NYU')).toBe('New York University');
  expect(first('UC Berkeley')).toBe('University of California, Berkeley');
  expect(first('stanf')).toBe('Stanford University');
  expect(first('univ of toronto')).toBe('University of Toronto');
  expect(first('Harvard')).toBe('Harvard University');
});

test('a made-up school finds nothing', () => {
  expect(searchUniversities(list, 'Hogwarts School of Witchcraft')).toEqual([]);
  expect(searchUniversities(list, 'asdfghjkl')).toEqual([]);
  expect(searchUniversities(list, '   ')).toEqual([]);
});
