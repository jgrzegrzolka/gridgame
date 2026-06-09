const test = require('node:test');
const assert = require('node:assert/strict');

const { CONFIG_KEY_RE, CONFIG_KEY_MAX } = require('./quizRecordKey');

test('accepts every real (variant, mode, includeAll) combo the client produces', () => {
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

test('rejects unknown includeAll suffix', () => {
  assert.doesNotMatch('countries:60s:wat', CONFIG_KEY_RE);
});

test('rejects missing segments', () => {
  assert.doesNotMatch('countries:60s', CONFIG_KEY_RE);
  assert.doesNotMatch('countries', CONFIG_KEY_RE);
  assert.doesNotMatch(':60s:sov', CONFIG_KEY_RE);
  assert.doesNotMatch('countries::sov', CONFIG_KEY_RE);
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
