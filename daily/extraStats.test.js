import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickMistakes,
  splitMistakeRail,
  MISTAKE_COLLAPSE_CAP,
} from './extraStats.js';

function statsOf({ attempts, wrong = {} }) {
  return { totalAttempts: attempts, perWrongCode: wrong };
}

// ---- pickMistakes ----

test('empty when totalAttempts is 0', () => {
  assert.deepEqual(pickMistakes({ stats: statsOf({ attempts: 0, wrong: { ch: 3 } }) }), []);
});

test('empty when stats is null', () => {
  assert.deepEqual(pickMistakes({ stats: null }), []);
});

test('empty when perWrongCode is missing (old cached response)', () => {
  assert.deepEqual(pickMistakes({ stats: { totalAttempts: 10 } }), []);
});

test('sorted most-clicked → least, alphabetical within a tie', () => {
  const r = pickMistakes({ stats: statsOf({ attempts: 10, wrong: { ua: 4, ru: 7, by: 2, aa: 4 } }) });
  assert.deepEqual(r, [
    { code: 'ru', count: 7 },
    { code: 'aa', count: 4 },
    { code: 'ua', count: 4 },
    { code: 'by', count: 2 },
  ]);
});

test('count-0 entries filtered out', () => {
  const r = pickMistakes({ stats: statsOf({ attempts: 10, wrong: { aa: 0, bb: 3, cc: 0 } }) });
  assert.deepEqual(r, [{ code: 'bb', count: 3 }]);
});

// ---- splitMistakeRail ----

test('collapsed: only repeated (≥2) tiles, capped at 6', () => {
  const mistakes = [
    { code: 'a', count: 5 }, { code: 'b', count: 4 }, { code: 'c', count: 3 },
    { code: 'd', count: 3 }, { code: 'e', count: 2 }, { code: 'f', count: 2 },
    { code: 'g', count: 2 }, // 7th repeated — over the cap
    { code: 'h', count: 1 }, { code: 'i', count: 1 }, // singles
  ];
  const s = splitMistakeRail(mistakes, false);
  assert.equal(s.tiles.length, MISTAKE_COLLAPSE_CAP);
  assert.deepEqual(s.tiles.map((t) => t.code), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(s.totalCount, 9);
  assert.equal(s.repeatedCount, 7);
  assert.equal(s.singlesCount, 2);
});

test('expanded: the whole list, in order', () => {
  const mistakes = [
    { code: 'a', count: 5 }, { code: 'b', count: 2 },
    { code: 'c', count: 1 }, { code: 'd', count: 1 },
  ];
  const s = splitMistakeRail(mistakes, true);
  assert.deepEqual(s.tiles.map((t) => t.code), ['a', 'b', 'c', 'd']);
  assert.equal(s.totalCount, 4);
  assert.equal(s.repeatedCount, 2);
  assert.equal(s.singlesCount, 2);
});

test('no repeated mistakes → repeatedCount 0, no collapsed tiles', () => {
  const mistakes = [{ code: 'a', count: 1 }, { code: 'b', count: 1 }];
  const s = splitMistakeRail(mistakes, false);
  assert.equal(s.repeatedCount, 0);
  assert.equal(s.tiles.length, 0);
  assert.equal(s.singlesCount, 2);
  assert.equal(s.totalCount, 2);
});

test('all repeated, none over the cap → collapsed shows them all, no singles', () => {
  const mistakes = [{ code: 'a', count: 3 }, { code: 'b', count: 2 }, { code: 'c', count: 2 }];
  const s = splitMistakeRail(mistakes, false);
  assert.deepEqual(s.tiles.map((t) => t.code), ['a', 'b', 'c']);
  assert.equal(s.repeatedCount, 3);
  assert.equal(s.singlesCount, 0);
  assert.equal(s.totalCount, 3);
});

test('empty list', () => {
  const s = splitMistakeRail([], false);
  assert.deepEqual(s, { tiles: [], totalCount: 0, repeatedCount: 0, singlesCount: 0 });
});
