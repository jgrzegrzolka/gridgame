const { test } = require('node:test');
const assert = require('node:assert/strict');
const { puzzleDateIso, isReleased } = require('./puzzleDate');

test('puzzleDateIso: anchor N=12 → 2026-06-17', () => {
  assert.equal(puzzleDateIso(12), '2026-06-17');
});

test('puzzleDateIso: N=1 → launch date 2026-06-06', () => {
  assert.equal(puzzleDateIso(1), '2026-06-06');
});

test('puzzleDateIso: backlog entries walk forward', () => {
  assert.equal(puzzleDateIso(13), '2026-06-18');
  assert.equal(puzzleDateIso(72), '2026-08-16');
});

test('isReleased: past puzzle is released', () => {
  assert.equal(isReleased(11, '2026-06-17'), true);
});

test('isReleased: today\'s puzzle is released', () => {
  assert.equal(isReleased(12, '2026-06-17'), true);
});

test('isReleased: tomorrow\'s puzzle is not released today', () => {
  assert.equal(isReleased(13, '2026-06-17'), false);
});

test('isReleased: far-future puzzle is not released', () => {
  assert.equal(isReleased(72, '2026-06-17'), false);
});
