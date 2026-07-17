const test = require('node:test');
const assert = require('node:assert/strict');

const { CONFIG_KEY_RE, CONFIG_KEY_MAX, lowerWinsFromConfigKey } = require('./quizRecordKey');

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

test('lowerWinsFromConfigKey: malformed key → null', () => {
  assert.equal(lowerWinsFromConfigKey(''), null);
  assert.equal(lowerWinsFromConfigKey('countries'), null);
  assert.equal(lowerWinsFromConfigKey('countries::sov'), null);
  assert.equal(lowerWinsFromConfigKey('a:b:c:d'), null);
});
