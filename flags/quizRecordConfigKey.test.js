import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quizRecordConfigKey } from './quizRecordConfigKey.js';

test('countries / 60s', () => {
  assert.equal(quizRecordConfigKey('countries', '60s'), 'countries:60s');
});

test('continent variant with hyphen survives the join', () => {
  assert.equal(quizRecordConfigKey('north-america', 'all'), 'north-america:all');
  assert.equal(quizRecordConfigKey('south-america', '60s'), 'south-america:60s');
});

// Feature V: the scope segment died with the include-territories toggle, and
// `weird` is a variant like any other rather than a flag on an existing one.
test('the weird deck is an ordinary variant in the key', () => {
  assert.equal(quizRecordConfigKey('weird', '60s'), 'weird:60s');
  assert.equal(quizRecordConfigKey('weird', 'all'), 'weird:all');
});

test('no scope segment survives, even from a stale 3-arg caller', () => {
  // @ts-expect-error — the old signature took includeAll third
  assert.equal(quizRecordConfigKey('countries', '60s', true), 'countries:60s');
});

test('all 8 variants × 2 modes produce distinct keys', () => {
  const variants = ['countries', 'europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania', 'weird'];
  const modes = ['60s', 'all'];
  const seen = new Set();
  for (const v of variants) {
    for (const m of modes) seen.add(quizRecordConfigKey(v, m));
  }
  assert.equal(seen.size, variants.length * modes.length);
});

// The server gate (api/src/lib/quizRecordKey.js) must accept everything this
// builder emits. Phase 1a widened it to take both shapes; this pins that the
// client's half of that contract is the 2-part one, and that the decks Phases
// 3 and 4 add need no further server change.
test('every emitted key matches the server shape gate', () => {
  const RE = /^[a-z0-9-]{1,20}:[a-z0-9-]{1,10}(:(sov|all))?$/;
  for (const v of ['countries', 'north-america', 'weird', 'outlines', 'facts']) {
    for (const m of ['60s', 'all']) {
      const k = quizRecordConfigKey(v, m);
      assert.match(k, RE, `server would reject ${k}`);
      assert.equal(k.split(':').length, 2, `${k} should be 2-part`);
    }
  }
});
