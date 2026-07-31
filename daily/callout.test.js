import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCallout } from './callout.js';

const T = ['us', 'jp', 'br', 'de', 'gd']; // 5 targets

function statsOf({ attempts, finds = {} }) {
  return { totalAttempts: attempts, perCodeFinds: finds };
}

test('none: no stats', () => {
  assert.deepEqual(pickCallout({ stats: null, targetCodes: T }), { kind: 'none' });
});

test('none: zero attempts', () => {
  assert.deepEqual(
    pickCallout({ stats: statsOf({ attempts: 0 }), targetCodes: T }),
    { kind: 'none' },
  );
});

test('none: empty targets', () => {
  assert.deepEqual(
    pickCallout({ stats: statsOf({ attempts: 10, finds: { us: 5 } }), targetCodes: [] }),
    { kind: 'none' },
  );
});

test('spread: both ends unique — easiest is the highest %, hardest the lowest', () => {
  const finds = { us: 71, jp: 40, br: 30, de: 20, gd: 0 };
  const c = pickCallout({ stats: statsOf({ attempts: 100, finds }), targetCodes: T });
  assert.equal(c.kind, 'spread');
  assert.deepEqual(c.easiest, { codes: ['us'], pct: 71 });
  assert.deepEqual(c.hardest, { codes: ['gd'], pct: 0 });
});

test('spread: codes absent from perCodeFinds count as 0% (the hardest end)', () => {
  const finds = { us: 50, jp: 30 }; // br, de, gd default to 0
  const c = pickCallout({ stats: statsOf({ attempts: 100, finds }), targetCodes: T });
  assert.equal(c.kind, 'spread');
  assert.deepEqual(c.easiest, { codes: ['us'], pct: 50 });
  // Three flags tie at 0% → all surface, alphabetical.
  assert.deepEqual(c.hardest, { codes: ['br', 'de', 'gd'], pct: 0 });
});

test('spread: tie on the easiest end only — every tied flag, alphabetical', () => {
  const finds = { us: 71, jp: 71, br: 71, de: 20, gd: 0 };
  const c = pickCallout({ stats: statsOf({ attempts: 100, finds }), targetCodes: T });
  assert.equal(c.kind, 'spread');
  assert.deepEqual(c.easiest, { codes: ['br', 'jp', 'us'], pct: 71 });
  assert.deepEqual(c.hardest, { codes: ['gd'], pct: 0 });
});

test('spread: tie on both ends, each decided independently', () => {
  const finds = { us: 71, jp: 71, br: 30, de: 0, gd: 0 };
  const c = pickCallout({ stats: statsOf({ attempts: 100, finds }), targetCodes: T });
  assert.equal(c.kind, 'spread');
  assert.deepEqual(c.easiest, { codes: ['jp', 'us'], pct: 71 });
  assert.deepEqual(c.hardest, { codes: ['de', 'gd'], pct: 0 });
});

test('allEqual: every flag at the same % → one end, all flags, shared %', () => {
  const finds = Object.fromEntries(T.map((c) => [c, 40]));
  const c = pickCallout({ stats: statsOf({ attempts: 100, finds }), targetCodes: T });
  assert.equal(c.kind, 'allEqual');
  assert.equal(c.pct, 40);
  assert.deepEqual(c.codes, ['br', 'de', 'gd', 'jp', 'us']);
});

test('allEqual: everyone found every flag (all 100%)', () => {
  const finds = Object.fromEntries(T.map((c) => [c, 100]));
  const c = pickCallout({ stats: statsOf({ attempts: 100, finds }), targetCodes: T });
  assert.equal(c.kind, 'allEqual');
  assert.equal(c.pct, 100);
  assert.deepEqual(c.codes.length, 5);
});

test('rounding: near-equal raw counts that round to the same percent tie', () => {
  // 7/9 = 77.78 → 78, 7/9 again → 78: a tie on the rounded %.
  const finds = { us: 7, jp: 7, br: 3, de: 3, gd: 1 };
  const c = pickCallout({ stats: statsOf({ attempts: 9, finds }), targetCodes: T });
  assert.equal(c.kind, 'spread');
  assert.deepEqual(c.easiest.codes, ['jp', 'us']);
  assert.equal(c.easiest.pct, 78);
});
