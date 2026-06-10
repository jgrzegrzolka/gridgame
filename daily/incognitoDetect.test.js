import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isLikelyIncognitoFromQuota } from './incognitoDetect.js';

test('returns false when quota is null or undefined (API unavailable)', () => {
  assert.equal(isLikelyIncognitoFromQuota(null), false);
  assert.equal(isLikelyIncognitoFromQuota(undefined), false);
});

test('returns false when quota is not a number', () => {
  // @ts-expect-error — exercising defensive non-number input
  assert.equal(isLikelyIncognitoFromQuota('120000000'), false);
  // @ts-expect-error
  assert.equal(isLikelyIncognitoFromQuota({}), false);
});

test('returns false when quota is zero or negative (treats as unknown)', () => {
  assert.equal(isLikelyIncognitoFromQuota(0), false);
  assert.equal(isLikelyIncognitoFromQuota(-1), false);
});

test('returns false on non-finite numbers (Infinity, NaN)', () => {
  assert.equal(isLikelyIncognitoFromQuota(Infinity), false);
  assert.equal(isLikelyIncognitoFromQuota(NaN), false);
});

test('returns true for typical Chrome/Edge incognito quota (~110 MB)', () => {
  assert.equal(isLikelyIncognitoFromQuota(110 * 1024 * 1024), true);
});

test('returns true for typical Firefox private quota (~5 MB)', () => {
  assert.equal(isLikelyIncognitoFromQuota(5 * 1024 * 1024), true);
});

test('returns false for typical regular-browser quota (multiple GB)', () => {
  assert.equal(isLikelyIncognitoFromQuota(5 * 1024 * 1024 * 1024), false);
  assert.equal(isLikelyIncognitoFromQuota(50 * 1024 * 1024 * 1024), false);
});

test('boundary: just under 120 MB → incognito; at-or-above → regular', () => {
  const ONE_TWENTY_MB = 120 * 1024 * 1024;
  assert.equal(isLikelyIncognitoFromQuota(ONE_TWENTY_MB - 1), true);
  assert.equal(isLikelyIncognitoFromQuota(ONE_TWENTY_MB), false);
  assert.equal(isLikelyIncognitoFromQuota(ONE_TWENTY_MB + 1), false);
});
