const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQuizRecordDoc, isPersonalBest, mergeQuizRecord } = require('./quizRecordDoc');

const NOW = 1_717_920_000_000;
const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('buildQuizRecordDoc: fresh doc has id = deviceId and one record', () => {
  const doc = buildQuizRecordDoc({
    deviceId: DEVICE,
    configKey: 'countries:60s:sov',
    entry: { score: 50, durationMs: 60_000 },
    now: NOW,
  });
  assert.equal(doc.id, DEVICE);
  assert.equal(doc.deviceId, DEVICE);
  assert.equal(doc.updatedAt, NOW);
  assert.deepEqual(doc.records, {
    'countries:60s:sov': {
      score: 50, durationMs: 60_000, submittedAt: NOW,
      attempts: 1, lastPlayedAt: NOW,
    },
  });
});

test('buildQuizRecordDoc: sets schema version v: 1 on the doc', () => {
  const doc = buildQuizRecordDoc({
    deviceId: DEVICE, configKey: 'countries:60s:sov',
    entry: { score: 50, durationMs: 60_000 }, now: NOW,
  });
  assert.equal(doc.v, 1);
});

test('isPersonalBest: no incumbent → always wins', () => {
  assert.equal(isPersonalBest(null, { score: 0, durationMs: 60_000 }, false), true);
  assert.equal(isPersonalBest(undefined, { score: 0, durationMs: 60_000 }, true), true);
});

test('isPersonalBest: lowerWins (count mode) — fewer mistakes wins', () => {
  const incumbent = { score: 5, durationMs: 90_000 };
  assert.equal(isPersonalBest(incumbent, { score: 4, durationMs: 100_000 }, true), true);
  assert.equal(isPersonalBest(incumbent, { score: 6, durationMs: 50_000 }, true), false);
});

test('isPersonalBest: higherWins (timed mode) — more correct wins', () => {
  const incumbent = { score: 50, durationMs: 60_000 };
  assert.equal(isPersonalBest(incumbent, { score: 51, durationMs: 60_000 }, false), true);
  assert.equal(isPersonalBest(incumbent, { score: 49, durationMs: 30_000 }, false), false);
});

test('isPersonalBest: equal score → lower durationMs wins (tiebreak)', () => {
  const incumbent = { score: 50, durationMs: 60_000 };
  assert.equal(isPersonalBest(incumbent, { score: 50, durationMs: 55_000 }, false), true);
  assert.equal(isPersonalBest(incumbent, { score: 50, durationMs: 60_001 }, false), false);
  assert.equal(isPersonalBest(incumbent, { score: 50, durationMs: 60_000 }, false), false);
});

test('mergeQuizRecord: no existing doc → builds fresh and reports changed', () => {
  const out = mergeQuizRecord({
    existing: null, deviceId: DEVICE, configKey: 'africa:all:sov',
    entry: { score: 2, durationMs: 90_000 }, lowerWins: true, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.equal(out.doc.records['africa:all:sov'].score, 2);
  assert.equal(out.doc.records['africa:all:sov'].attempts, 1);
  assert.equal(out.doc.records['africa:all:sov'].lastPlayedAt, NOW);
  assert.equal(out.doc.v, 1);
});

test('mergeQuizRecord: beats existing PB → merges into records, preserves other configKeys', () => {
  const existing = {
    id: DEVICE, deviceId: DEVICE,
    records: {
      'countries:60s:sov': { score: 50, durationMs: 60_000, submittedAt: 1, attempts: 7, lastPlayedAt: 10 },
      'africa:all:sov':    { score: 5,  durationMs: 90_000, submittedAt: 2, attempts: 3, lastPlayedAt: 11 },
    },
    updatedAt: 2, v: 1,
  };
  const out = mergeQuizRecord({
    existing, deviceId: DEVICE, configKey: 'africa:all:sov',
    entry: { score: 3, durationMs: 85_000 }, lowerWins: true, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.deepEqual(out.doc.records['africa:all:sov'], {
    score: 3, durationMs: 85_000, submittedAt: NOW,
    attempts: 4, lastPlayedAt: NOW,
  });
  // Other configKey untouched.
  assert.deepEqual(out.doc.records['countries:60s:sov'], existing.records['countries:60s:sov']);
  assert.equal(out.doc.updatedAt, NOW);
  assert.equal(out.doc.v, 1);
});

test('mergeQuizRecord (F5): not a PB → still writes; attempts+lastPlayedAt bumped, PB fields KEPT', () => {
  const existing = {
    id: DEVICE, deviceId: DEVICE,
    records: {
      'countries:60s:sov': { score: 50, durationMs: 60_000, submittedAt: 1, attempts: 4, lastPlayedAt: 5 },
    },
    updatedAt: 1, v: 1,
  };
  const out = mergeQuizRecord({
    existing, deviceId: DEVICE, configKey: 'countries:60s:sov',
    entry: { score: 40, durationMs: 60_000 }, // worse than incumbent
    lowerWins: false, now: NOW,
  });
  assert.equal(out.changed, true);
  // PB-frozen fields stay at the incumbent's values.
  assert.equal(out.doc.records['countries:60s:sov'].score, 50);
  assert.equal(out.doc.records['countries:60s:sov'].durationMs, 60_000);
  assert.equal(out.doc.records['countries:60s:sov'].submittedAt, 1);
  // Engagement fields advance.
  assert.equal(out.doc.records['countries:60s:sov'].attempts, 5);
  assert.equal(out.doc.records['countries:60s:sov'].lastPlayedAt, NOW);
});

test('mergeQuizRecord (F5): pre-F5 sub-entry (no attempts field) → treated as 0, becomes 1 on first F5 finish', () => {
  // Captures the race window between F5 deploy and the backfill: a sub-entry
  // could be missing `attempts`. We treat missing as 0 in the code; the
  // backfill bumps stale sub-entries to 1 to fix the off-by-one. This test
  // documents the code-side behaviour.
  const existing = {
    id: DEVICE, deviceId: DEVICE,
    records: {
      'countries:60s:sov': { score: 50, durationMs: 60_000, submittedAt: 1 }, // pre-F5 shape
    },
    updatedAt: 1,
  };
  const out = mergeQuizRecord({
    existing, deviceId: DEVICE, configKey: 'countries:60s:sov',
    entry: { score: 40, durationMs: 60_000 }, lowerWins: false, now: NOW,
  });
  assert.equal(out.doc.records['countries:60s:sov'].attempts, 1);
  assert.equal(out.doc.records['countries:60s:sov'].lastPlayedAt, NOW);
});

test('mergeQuizRecord: first-ever configKey on a doc that has other entries → added without clobber', () => {
  const existing = {
    id: DEVICE, deviceId: DEVICE,
    records: {
      'countries:60s:sov': { score: 50, durationMs: 60_000, submittedAt: 1, attempts: 1, lastPlayedAt: 1 },
    },
    updatedAt: 1, v: 1,
  };
  const out = mergeQuizRecord({
    existing, deviceId: DEVICE, configKey: 'europe:all:sov',
    entry: { score: 0, durationMs: 30_000 }, lowerWins: true, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.deepEqual(out.doc.records['europe:all:sov'], {
    score: 0, durationMs: 30_000, submittedAt: NOW,
    attempts: 1, lastPlayedAt: NOW,
  });
  assert.deepEqual(out.doc.records['countries:60s:sov'], existing.records['countries:60s:sov']);
});

test('mergeQuizRecord: does not mutate the existing doc passed in', () => {
  const existing = {
    id: DEVICE, deviceId: DEVICE,
    records: {
      'countries:60s:sov': { score: 50, durationMs: 60_000, submittedAt: 1, attempts: 3, lastPlayedAt: 5 },
    },
    updatedAt: 1, v: 1,
  };
  const snapshot = JSON.parse(JSON.stringify(existing));
  mergeQuizRecord({
    existing, deviceId: DEVICE, configKey: 'countries:60s:sov',
    entry: { score: 60, durationMs: 60_000 }, lowerWins: false, now: NOW,
  });
  assert.deepEqual(existing, snapshot, 'existing must not be mutated');
});

test('mergeQuizRecord: stamps v: 1 on the doc on every merge (even into a pre-v:1 row)', () => {
  const existing = {
    id: DEVICE, deviceId: DEVICE,
    records: { 'countries:60s:sov': { score: 50, durationMs: 60_000, submittedAt: 1 } },
    updatedAt: 1,
    // no v field — pre-F5 row
  };
  const out = mergeQuizRecord({
    existing, deviceId: DEVICE, configKey: 'countries:60s:sov',
    entry: { score: 30, durationMs: 60_000 }, lowerWins: false, now: NOW,
  });
  assert.equal(out.doc.v, 1);
});
