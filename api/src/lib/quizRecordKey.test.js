const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIG_KEY_RE,
  CONFIG_KEY_MAX,
  lowerWinsFromConfigKey,
  maxScoreForConfigKey,
  MAX_COUNT_MODE_SCORE,
} = require('./quizRecordKey');

test('still accepts every legacy 3-part combo (cached clients keep sending these)', () => {
  const variants = ['countries', 'europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'];
  const modes = ['60s', 'all'];
  for (const v of variants) {
    for (const m of modes) {
      for (const ia of [false, true]) {
        const k = `${v}:${m}:${ia ? 'all' : 'sov'}`;
        assert.match(k, CONFIG_KEY_RE, `should accept ${k}`);
        assert.ok(k.length <= CONFIG_KEY_MAX, `${k} exceeds cap`);
      }
    }
  }
});

// Feature V Phase 1a: the scope segment is going away, so the key becomes
// "<variant>:<mode>". Both shapes must be accepted at once — a browser with
// cached JS keeps POSTing the 3-part shape long after the deploy, and those
// writes have to keep landing.
test('accepts the 2-part shape, including the three new decks', () => {
  for (const k of ['countries:60s', 'countries:all', 'europe:60s', 'weird:60s', 'outlines:60s', 'facts:60s']) {
    assert.match(k, CONFIG_KEY_RE, `should accept ${k}`);
    assert.ok(k.length <= CONFIG_KEY_MAX, `${k} exceeds cap`);
  }
});

test('rejects an unknown scope suffix', () => {
  assert.doesNotMatch('countries:60s:wat', CONFIG_KEY_RE);
});

test('rejects missing segments', () => {
  assert.doesNotMatch('countries', CONFIG_KEY_RE);
  assert.doesNotMatch(':60s:sov', CONFIG_KEY_RE);
  assert.doesNotMatch('countries::sov', CONFIG_KEY_RE);
  assert.doesNotMatch(':60s', CONFIG_KEY_RE);
  assert.doesNotMatch('countries:', CONFIG_KEY_RE);
});

test('still rejects a fourth segment', () => {
  assert.doesNotMatch('countries:60s:sov:extra', CONFIG_KEY_RE);
});

test('rejects uppercase and whitespace', () => {
  assert.doesNotMatch('Countries:60s:sov', CONFIG_KEY_RE);
  assert.doesNotMatch('countries: 60s:sov', CONFIG_KEY_RE);
  assert.doesNotMatch(' countries:60s:sov', CONFIG_KEY_RE);
});

test('rejects oversized variant segment', () => {
  const tooLong = 'a'.repeat(21);
  assert.doesNotMatch(`${tooLong}:60s:sov`, CONFIG_KEY_RE);
});

test('CONFIG_KEY_MAX leaves headroom past current keys', () => {
  assert.ok(CONFIG_KEY_MAX >= 'south-america:60s:sov'.length);
});

test('lowerWinsFromConfigKey: 60s mode → false (higher score wins)', () => {
  assert.equal(lowerWinsFromConfigKey('countries:60s:sov'), false);
  assert.equal(lowerWinsFromConfigKey('europe:60s:all'), false);
});

test('lowerWinsFromConfigKey: all mode → true (fewer mistakes wins)', () => {
  assert.equal(lowerWinsFromConfigKey('countries:all:sov'), true);
  assert.equal(lowerWinsFromConfigKey('africa:all:all'), true);
});

test('lowerWinsFromConfigKey: unknown mode → null', () => {
  assert.equal(lowerWinsFromConfigKey('countries:newmode:sov'), null);
});

// Phase 1a: mode stays at index 1 in both shapes, so the derivation is the
// same; only the length gate moves.
test('lowerWinsFromConfigKey: 2-part keys derive from the same mode segment', () => {
  assert.equal(lowerWinsFromConfigKey('countries:60s'), false);
  assert.equal(lowerWinsFromConfigKey('countries:all'), true);
  assert.equal(lowerWinsFromConfigKey('weird:60s'), false);
  assert.equal(lowerWinsFromConfigKey('facts:60s'), false);
});

test('lowerWinsFromConfigKey: unknown mode → null in the 2-part shape too', () => {
  assert.equal(lowerWinsFromConfigKey('countries:newmode'), null);
});

// The Statistics deck's fixed-count mode. This module enumerates MODES even
// though it deliberately doesn't enumerate variants, so a client-side mode that
// never lands here has its submissions rejected as `unknown_mode` — which is
// the guard working, but it means shipping a mode is a two-repo change.
test('lowerWinsFromConfigKey: 20q is a count mode → true (fewer mistakes wins)', () => {
  assert.equal(lowerWinsFromConfigKey('facts:20q'), true);
});

test('maxScoreForConfigKey: 20q is bounded by the pool, not the clock — an untimed round can run as long as it likes', () => {
  assert.equal(maxScoreForConfigKey('facts:20q', 30_000), MAX_COUNT_MODE_SCORE);
  // Duration must not shrink the bound the way it does for 60s: a player who
  // takes ten minutes over 20 questions is playing normally, not cheating.
  assert.equal(maxScoreForConfigKey('facts:20q', 600_000), MAX_COUNT_MODE_SCORE);
});

test('CONFIG_KEY_RE accepts the 20q mode segment', () => {
  assert.ok(CONFIG_KEY_RE.test('facts:20q'));
});

test('lowerWinsFromConfigKey: malformed key → null', () => {
  assert.equal(lowerWinsFromConfigKey(''), null);
  assert.equal(lowerWinsFromConfigKey('countries'), null);
  assert.equal(lowerWinsFromConfigKey('countries::sov'), null);
  assert.equal(lowerWinsFromConfigKey('a:b:c:d'), null);
});

// A 60s round's score is bounded by TIME, not by the pool: you cannot answer
// more questions than you can physically get through. This is the gap that let
// a scripted submission store 189 correct answers in a 60-second round on
// 2026-07-07 (the best real score in the whole container is 49) and collect
// three skill badges off it. A pool-based cap would never have caught it —
// 189 < the 195-flag countries pool.
test('maxScoreForConfigKey: 60s is time-derived, and rejects the impossible', () => {
  // Full 60s budget → 2 answers/sec is already ~2.4x the human record.
  assert.equal(maxScoreForConfigKey('countries:60s', 60_000), 120);
  assert.ok(maxScoreForConfigKey('countries:60s', 60_000) < 189, 'must reject the observed bot score');
  // Finishing early shrinks the bound with the clock.
  assert.equal(maxScoreForConfigKey('oceania:60s', 20_000), 40);
});

test('maxScoreForConfigKey: every real score on record still fits', () => {
  // The top runs actually in prod, with room to spare.
  assert.ok(49 <= maxScoreForConfigKey('countries:60s', 60_000));
  assert.ok(45 <= maxScoreForConfigKey('europe:60s', 53_500));
  assert.ok(14 <= maxScoreForConfigKey('oceania:60s', 25_000));
});

test('maxScoreForConfigKey: all-mode is pool-derived (mistakes <= target)', () => {
  // Endurance runs for hours, so a time bound is meaningless. `page.js` keeps
  // mistakes <= target, and target <= the largest pool (countries, 195).
  assert.equal(maxScoreForConfigKey('countries:all', 3_600_000), 250);
  assert.equal(maxScoreForConfigKey('countries:all', 1_000), 250);
});

test('maxScoreForConfigKey: legacy 3-part keys bound identically', () => {
  assert.equal(maxScoreForConfigKey('countries:60s:sov', 60_000), 120);
  assert.equal(maxScoreForConfigKey('countries:all:all', 60_000), 250);
});

test('maxScoreForConfigKey: unknown mode or shape → null (caller rejects)', () => {
  assert.equal(maxScoreForConfigKey('countries:newmode', 60_000), null);
  assert.equal(maxScoreForConfigKey('countries', 60_000), null);
  assert.equal(maxScoreForConfigKey('countries:60s', -5), null);
  assert.equal(maxScoreForConfigKey('countries:60s', 'oops'), null);
});
