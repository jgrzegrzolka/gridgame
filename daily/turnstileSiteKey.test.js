import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickTurnstileSiteKey } from './turnstileSiteKey.js';

const PROD = '0x4AAAAAADhdZ-XDzVHaLk9R';
const TEST = '2x00000000000000000000AB';

test('prod hostname → prod key', () => {
  assert.equal(pickTurnstileSiteKey('www.yetanotherquiz.com'), PROD);
  assert.equal(pickTurnstileSiteKey('yetanotherquiz.com'), PROD);
});

test('localhost → CF test key', () => {
  assert.equal(pickTurnstileSiteKey('localhost'), TEST);
});

test('127.0.0.1 → CF test key', () => {
  assert.equal(pickTurnstileSiteKey('127.0.0.1'), TEST);
});

test('IPv6 loopback (::1) → CF test key', () => {
  assert.equal(pickTurnstileSiteKey('::1'), TEST);
});

test('lookalike hostnames are NOT treated as local', () => {
  // 'localhost.com' is a real registered domain — must NOT match.
  // Substring/heuristic matching here would let an attacker host a
  // page on localhost.example.com and bypass real Turnstile checks.
  assert.equal(pickTurnstileSiteKey('localhost.com'), PROD);
  assert.equal(pickTurnstileSiteKey('mylocalhost'), PROD);
  assert.equal(pickTurnstileSiteKey('127.0.0.10'), PROD);
});

test('empty / unknown hostname falls back to prod key', () => {
  // Defensive default — better to load the prod key (which fails
  // visibly on an unrecognised origin) than silently use the test
  // key in some unexpected environment.
  assert.equal(pickTurnstileSiteKey(''), PROD);
});
