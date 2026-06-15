import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isOffensiveNickname, BLOCKED } from './nicknameModeration.js';

const require = createRequire(import.meta.url);
const server = require('../api/src/lib/blockedNicknames.js');

test('isOffensiveNickname: empty / whitespace / non-string is not offensive', () => {
  assert.equal(isOffensiveNickname(''), false);
  assert.equal(isOffensiveNickname('   '), false);
  // @ts-ignore — intentional bad input
  assert.equal(isOffensiveNickname(null), false);
  // @ts-ignore
  assert.equal(isOffensiveNickname(undefined), false);
  // @ts-ignore
  assert.equal(isOffensiveNickname(42), false);
});

test('isOffensiveNickname: plain bad words flag true', () => {
  assert.equal(isOffensiveNickname('fuck'), true);
  assert.equal(isOffensiveNickname('chuj'), true);
});

test('isOffensiveNickname: case-insensitive', () => {
  assert.equal(isOffensiveNickname('CHUJ'), true);
  assert.equal(isOffensiveNickname('Fuck'), true);
});

test('isOffensiveNickname: substring match (e.g. compound)', () => {
  assert.equal(isOffensiveNickname('mrfuckface'), true);
  assert.equal(isOffensiveNickname('chujek'), true);
});

test('isOffensiveNickname: punctuation strips for substring match', () => {
  // After stripping non-alphanumerics, these collapse to a blocked
  // term. "Real" leetspeak (5h1t, phuck) is documented as not covered.
  assert.equal(isOffensiveNickname('s.h.i.t'), true);
  assert.equal(isOffensiveNickname('shi.t'), true);
  assert.equal(isOffensiveNickname('f.u.c.k'), true);
});

test('isOffensiveNickname: accent folding strips Polish diacritics', () => {
  // Polish entries are stored without diacritics; the normaliser strips
  // them before match, so a user typing the accented form is still flagged.
  assert.equal(isOffensiveNickname('jebać'), true);   // → jebac
  assert.equal(isOffensiveNickname('spierdalaj'), true);
});

test('isOffensiveNickname: innocent strings pass through', () => {
  assert.equal(isOffensiveNickname('Alice'), false);
  assert.equal(isOffensiveNickname('Jan'), false);
  assert.equal(isOffensiveNickname('ChessKid42'), false);
});

test('parity: client BLOCKED list matches server BLOCKED list exactly', () => {
  // Pinning drift: if either side adds / removes an entry without
  // updating the other, this test fails loudly. The two files must be
  // edited together — see the module-header note in either file.
  assert.deepEqual([...BLOCKED], [...server.BLOCKED]);
});

test('parity: same input flags the same on both sides', () => {
  const samples = [
    '',
    'Alice',
    'chuj',
    'F.U.C.K',
    'jebać',
    'mrcuntface',
    'Łukasz',
  ];
  for (const s of samples) {
    assert.equal(
      isOffensiveNickname(s),
      server.isOffensiveNickname(s),
      `mismatch on "${s}"`,
    );
  }
});
