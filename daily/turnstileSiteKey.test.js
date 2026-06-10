import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isLocalHostname, PROD_SITE_KEY } from './turnstileSiteKey.js';

test('PROD_SITE_KEY exports the registered yetanotherquiz.com key', () => {
  // Pinned so a stray edit (typo, accidental rotate-without-update)
  // is caught before it ships. Update this test alongside any real
  // CF dashboard rotation.
  assert.equal(PROD_SITE_KEY, '0x4AAAAAADhdZ-XDzVHaLk9R');
});

test('isLocalHostname is true for localhost', () => {
  assert.equal(isLocalHostname('localhost'), true);
});

test('isLocalHostname is true for 127.0.0.1', () => {
  assert.equal(isLocalHostname('127.0.0.1'), true);
});

test('isLocalHostname is true for IPv6 loopback (::1)', () => {
  assert.equal(isLocalHostname('::1'), true);
});

test('isLocalHostname is false for prod hostnames', () => {
  assert.equal(isLocalHostname('www.yetanotherquiz.com'), false);
  assert.equal(isLocalHostname('yetanotherquiz.com'), false);
});

test('isLocalHostname is false for lookalike hostnames', () => {
  // 'localhost.com' is a real registered domain — must NOT match.
  // Substring/heuristic matching here would let an attacker host a
  // page on localhost.example.com and bypass real Turnstile checks.
  assert.equal(isLocalHostname('localhost.com'), false);
  assert.equal(isLocalHostname('mylocalhost'), false);
  assert.equal(isLocalHostname('127.0.0.10'), false);
});

test('isLocalHostname is false for empty / unknown hostnames (fail-safe)', () => {
  // Defensive default — better to attempt real Turnstile (which fails
  // visibly on an unrecognised origin) than silently bypass in some
  // unexpected environment.
  assert.equal(isLocalHostname(''), false);
});
