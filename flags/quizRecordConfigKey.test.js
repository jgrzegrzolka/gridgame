import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quizRecordConfigKey } from './quizRecordConfigKey.js';

test('sovereign-only countries / 60s', () => {
  assert.equal(quizRecordConfigKey('countries', '60s', false), 'countries:60s:sov');
});

test('with-territories countries / 60s', () => {
  assert.equal(quizRecordConfigKey('countries', '60s', true), 'countries:60s:all');
});

test('continent variant with hyphen survives the join', () => {
  assert.equal(quizRecordConfigKey('north-america', 'all', false), 'north-america:all:sov');
  assert.equal(quizRecordConfigKey('south-america', '60s', true), 'south-america:60s:all');
});

test('all 7 variants × 2 modes × 2 includeAll produce distinct keys', () => {
  const variants = ['countries', 'europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'];
  const modes = ['60s', 'all'];
  const seen = new Set();
  for (const v of variants) {
    for (const m of modes) {
      for (const ia of [false, true]) {
        seen.add(quizRecordConfigKey(v, m, ia));
      }
    }
  }
  assert.equal(seen.size, variants.length * modes.length * 2);
});
