import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareText } from './shareGrid.js';

const URL = 'https://www.yetanotherquiz.com/daily/';

test('all found, 5 answers — single full-green row', () => {
  const text = buildShareText({
    titleLine: 'Yet Another Quiz — Daily #1 — 5/5',
    answerCodes: ['a', 'b', 'c', 'd', 'e'],
    foundCodes: ['a', 'b', 'c', 'd', 'e'],
    url: URL,
  });
  assert.equal(
    text,
    `Yet Another Quiz — Daily #1 — 5/5\n\n🟩🟩🟩🟩🟩\n\n${URL}`,
  );
});

test('all missed, 5 answers — single full-black row', () => {
  const text = buildShareText({
    titleLine: 'Yet Another Quiz — Daily #1 — 0/5',
    answerCodes: ['a', 'b', 'c', 'd', 'e'],
    foundCodes: [],
    url: URL,
  });
  assert.equal(
    text,
    `Yet Another Quiz — Daily #1 — 0/5\n\n⬛⬛⬛⬛⬛\n\n${URL}`,
  );
});

test('mix, 10 answers — exact 2 rows of 5', () => {
  const text = buildShareText({
    titleLine: 'Yet Another Quiz — Daily #9 — 8/10',
    answerCodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    foundCodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    url: URL,
  });
  assert.equal(
    text,
    `Yet Another Quiz — Daily #9 — 8/10\n\n🟩🟩🟩🟩🟩\n🟩🟩🟩⬛⬛\n\n${URL}`,
  );
});

test('mix, 7 answers — ragged last row of 2', () => {
  const text = buildShareText({
    titleLine: 'Yet Another Quiz — Daily #3 — 4/7',
    answerCodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    foundCodes: ['a', 'c', 'e', 'g'],
    url: URL,
  });
  assert.equal(
    text,
    `Yet Another Quiz — Daily #3 — 4/7\n\n🟩⬛🟩⬛🟩\n⬛🟩\n\n${URL}`,
  );
});

test('mix, 15 answers — exact 3 rows', () => {
  const text = buildShareText({
    titleLine: 'Yet Another Quiz — Daily #5 — 12/15',
    answerCodes: 'abcdefghijklmno'.split(''),
    foundCodes: 'abcdefghijkl'.split(''),
    url: URL,
  });
  assert.equal(
    text,
    `Yet Another Quiz — Daily #5 — 12/15\n\n🟩🟩🟩🟩🟩\n🟩🟩🟩🟩🟩\n🟩🟩⬛⬛⬛\n\n${URL}`,
  );
});

test('order is canonical answer-set order, not foundCodes order', () => {
  // foundCodes provided in shuffled order — output should still mark
  // slots by their canonical position in answerCodes.
  const text = buildShareText({
    titleLine: 'T',
    answerCodes: ['a', 'b', 'c', 'd', 'e'],
    foundCodes: ['e', 'a', 'c'],
    url: URL,
  });
  assert.equal(text, `T\n\n🟩⬛🟩⬛🟩\n\n${URL}`);
});

test('foundCodes contains entries not in answerCodes — those are ignored', () => {
  // Defensive: a caller passing wrongCodes by mistake shouldn't
  // produce 🟩 cells for nonexistent slots.
  const text = buildShareText({
    titleLine: 'T',
    answerCodes: ['a', 'b', 'c'],
    foundCodes: ['a', 'x', 'y'],
    url: URL,
  });
  assert.equal(text, `T\n\n🟩⬛⬛\n\n${URL}`);
});

test('titleLine and url are passed through unchanged (no template)', () => {
  // The renderer takes pre-formed strings — i18n + URL are the
  // caller's responsibility. Confirm we don't try to template either.
  const text = buildShareText({
    titleLine: 'Custom title with — em dashes and 🇬🇧 emoji',
    answerCodes: ['a'],
    foundCodes: ['a'],
    url: 'https://other.example.com/x?y=1',
  });
  assert.equal(
    text,
    'Custom title with — em dashes and 🇬🇧 emoji\n\n🟩\n\nhttps://other.example.com/x?y=1',
  );
});
