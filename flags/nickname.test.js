import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADJECTIVES,
  NOUNS,
  fnv1a,
  defaultNickname,
  displayNickname,
} from './nickname.js';

// ---------------------------------------------------------------------------
// Pool integrity — guards the deterministic contract
// ---------------------------------------------------------------------------

test('ADJECTIVES + NOUNS each have at least 50 entries (pool size sanity)', () => {
  // Sub-50 = a stray comma or accidental delete shrank the pool, which
  // would re-key every default name. Loud test on purpose.
  assert.ok(ADJECTIVES.length >= 50, `got ${ADJECTIVES.length} adjectives`);
  assert.ok(NOUNS.length >= 50, `got ${NOUNS.length} nouns`);
});

test('pools contain only non-empty single-word strings (no spaces, no empties)', () => {
  for (const word of [...ADJECTIVES, ...NOUNS]) {
    assert.ok(typeof word === 'string' && word.length > 0, `bad entry: ${JSON.stringify(word)}`);
    assert.ok(!/\s/.test(word), `entry contains whitespace: ${word}`);
  }
});

test('pools are frozen (defends determinism against accidental .push/.sort)', () => {
  assert.throws(() => {
    /** @type {any} */ (ADJECTIVES).push('Newish');
  });
  assert.throws(() => {
    /** @type {any} */ (NOUNS).sort();
  });
});

// ---------------------------------------------------------------------------
// fnv1a — deterministic 32-bit unsigned hash
// ---------------------------------------------------------------------------

test('fnv1a: same input always returns the same value', () => {
  assert.equal(fnv1a('abc'), fnv1a('abc'));
  assert.equal(fnv1a(''), fnv1a(''));
});

test('fnv1a: different inputs (almost) always return different values', () => {
  // Spot check — different characters at different positions should
  // diverge. Not an exhaustive collision audit, just a sanity check.
  assert.notEqual(fnv1a('abc'), fnv1a('abd'));
  assert.notEqual(fnv1a('abc'), fnv1a('cba'));
});

test('fnv1a: returns an unsigned 32-bit integer', () => {
  const h = fnv1a('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.ok(Number.isInteger(h));
  assert.ok(h >= 0 && h <= 0xffffffff, `out of u32 range: ${h}`);
});

// ---------------------------------------------------------------------------
// defaultNickname — deterministic, well-formed
// ---------------------------------------------------------------------------

test('defaultNickname: deterministic per deviceId', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(defaultNickname(id), defaultNickname(id));
});

test('defaultNickname: always returns a single space between two pool words', () => {
  const name = defaultNickname('any-old-id-12345678');
  const parts = name.split(' ');
  assert.equal(parts.length, 2, `expected "Adjective Noun", got ${JSON.stringify(name)}`);
  assert.ok(ADJECTIVES.includes(parts[0]), `unknown adjective: ${parts[0]}`);
  assert.ok(NOUNS.includes(parts[1]), `unknown noun: ${parts[1]}`);
});

test('defaultNickname: produces good spread across deviceIds (no near-collisions on close inputs)', () => {
  // Two UUIDs that differ only in the last character should usually
  // pick different (adj, noun) combos. Not a hard guarantee, but
  // FNV-1a's avalanche means a near-tie is rare across the sample.
  const a = defaultNickname('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee0');
  const b = defaultNickname('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1');
  const c = defaultNickname('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2');
  // At least two of the three should differ from each other.
  const distinct = new Set([a, b, c]).size;
  assert.ok(distinct >= 2, `expected ≥2 distinct names from 3 close ids, got ${distinct}: ${a}/${b}/${c}`);
});

test('defaultNickname: empty / non-string input still returns a valid two-word name (defensive)', () => {
  for (const input of ['', /** @type {any} */ (null), /** @type {any} */ (undefined), /** @type {any} */ (42)]) {
    const name = defaultNickname(input);
    const parts = name.split(' ');
    assert.equal(parts.length, 2, `bad name for input ${JSON.stringify(input)}: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// displayNickname — saved-or-default resolver
// ---------------------------------------------------------------------------

test('displayNickname: a non-empty saved value wins over the default', () => {
  assert.equal(displayNickname('any-id-12345678', 'Alice'), 'Alice');
});

test('displayNickname: saved value is trimmed before display (matches the server-side validator)', () => {
  assert.equal(displayNickname('any-id-12345678', '  Alice  '), 'Alice');
});

test('displayNickname: null saved → default', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(displayNickname(id, null), defaultNickname(id));
});

test('displayNickname: undefined saved → default', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(displayNickname(id, undefined), defaultNickname(id));
});

test('displayNickname: empty / whitespace-only saved → default (matches null === clear)', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(displayNickname(id, ''), defaultNickname(id));
  assert.equal(displayNickname(id, '   '), defaultNickname(id));
});
