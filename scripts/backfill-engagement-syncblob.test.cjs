const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  planRow,
  computeEngagementSection,
  stripSystemFields,
  SHARE_SURFACES,
} = require('./backfill-engagement-syncblob.cjs');

// ---------------------------------------------------------------------------
// computeEngagementSection — pure event-aggregator. Matches the shape the
// pre-Phase-4 engagementCompute + Phase-3 migration produced when a client
// migrated via dailyMe, so the post-backfill blob is indistinguishable from
// a client-side migration result.
// ---------------------------------------------------------------------------

test('computeEngagementSection: empty input → all zeros, v:1 envelope', () => {
  assert.deepEqual(computeEngagementSection([]), {
    v: 1,
    shares: { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 },
    coffeeClickCount: 0,
    quiz60sDayLog: [],
  });
});

test('computeEngagementSection: null / undefined input → same as empty array', () => {
  assert.deepEqual(computeEngagementSection(null), computeEngagementSection([]));
  assert.deepEqual(computeEngagementSection(undefined), computeEngagementSection([]));
});

test('computeEngagementSection: share events count per surface, closed list defended', () => {
  const events = [
    { kind: 'share', payload: { surface: 'daily' } },
    { kind: 'share', payload: { surface: 'daily' } },
    { kind: 'share', payload: { surface: 'flagquiz' } },
    { kind: 'share', payload: { surface: 'findflag' } },
    { kind: 'share', payload: { surface: 'ttt' } },
    { kind: 'share', payload: { surface: 'pinterest' } }, // unknown — dropped
  ];
  const r = computeEngagementSection(events);
  assert.deepEqual(r.shares, { daily: 2, flagquiz: 1, findflag: 1, ttt: 1 });
});

test('computeEngagementSection: coffee_click → coffeeClickCount:1 regardless of how many', () => {
  // Pre-Phase-3 the server only knew "at least one click" as a boolean,
  // so the backfill collapses any multi-click history to 1 — same
  // semantic the Phase-3 client migration produces.
  const r1 = computeEngagementSection([{ kind: 'coffee_click', payload: {} }]);
  const r2 = computeEngagementSection([
    { kind: 'coffee_click', payload: {} },
    { kind: 'coffee_click', payload: {} },
    { kind: 'coffee_click', payload: {} },
  ]);
  assert.equal(r1.coffeeClickCount, 1);
  assert.equal(r2.coffeeClickCount, 1);
});

test('computeEngagementSection: no coffee events → coffeeClickCount:0', () => {
  const r = computeEngagementSection([{ kind: 'share', payload: { surface: 'daily' } }]);
  assert.equal(r.coffeeClickCount, 0);
});

test('computeEngagementSection: quiz_play 60s → sorted+deduped day log', () => {
  const events = [
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 19003 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 19000 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 19000 }, // dup
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 19001 },
  ];
  assert.deepEqual(computeEngagementSection(events).quiz60sDayLog, [19000, 19001, 19003]);
});

test('computeEngagementSection: quiz_play "all" mode is silently dropped (no consumer)', () => {
  const events = [
    { kind: 'quiz_play', payload: { mode: 'all' }, dayId: 19000 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 19001 },
  ];
  assert.deepEqual(computeEngagementSection(events).quiz60sDayLog, [19001]);
});

test('computeEngagementSection: daily_start / findflag_play silently dropped (pure analytics, no consumer)', () => {
  const events = [
    { kind: 'daily_start', payload: { puzzleId: 5 } },
    { kind: 'findflag_play', payload: { filter: 'europe', mode: 'random' } },
    { kind: 'share', payload: { surface: 'daily' } },
  ];
  const r = computeEngagementSection(events);
  assert.equal(r.shares.daily, 1);
  // No fields leaked for the dropped kinds.
  assert.deepEqual(Object.keys(r).sort(), ['coffeeClickCount', 'quiz60sDayLog', 'shares', 'v']);
});

test('computeEngagementSection: malformed rows skipped (no crash)', () => {
  const events = [
    null,
    undefined,
    'not an object',
    { /* no kind */ payload: { surface: 'daily' } },
    { kind: 'share' /* no payload */ },
    { kind: 'share', payload: null },
    { kind: 'share', payload: { /* no surface */ } },
    { kind: 'quiz_play', payload: { mode: '60s' } /* no dayId */ },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 'oops' },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: -1 },
    { kind: 'quiz_play', payload: { mode: '60s' }, dayId: 1.5 },
    // One valid row at the end so we know the loop didn't bail.
    { kind: 'share', payload: { surface: 'daily' } },
  ];
  const r = computeEngagementSection(events);
  assert.equal(r.shares.daily, 1);
});

test('SHARE_SURFACES list matches flags/engagementCounters.js closed list (cross-file pin)', () => {
  // Drift between this script's surface list and the client's would
  // mean a backfilled count goes into a field the client doesn't track
  // — silent data loss. The lists must stay in sync.
  assert.deepEqual(SHARE_SURFACES, ['daily', 'flagquiz', 'findflag', 'ttt']);
});

// ---------------------------------------------------------------------------
// planRow — decide skip vs populate per profile.
// ---------------------------------------------------------------------------

test('planRow: profile with populated engagement → skip (never overwrite client-canonical state)', () => {
  const profile = {
    id: 'dev-1', deviceId: 'dev-1',
    syncBlob: { v: 1, engagement: { v: 1, shares: { daily: 5 }, coffeeClickCount: 1, quiz60sDayLog: [] } },
  };
  const r = planRow(profile, [{ kind: 'share', payload: { surface: 'daily' } }]);
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /already populated/);
});

test('planRow: profile with no syncBlob at all → populate, hadEvents reflects input', () => {
  const profile = { id: 'dev-1', deviceId: 'dev-1', nickname: 'Alice', createdAt: 100, linkedAt: null };
  const r = planRow(profile, [{ kind: 'share', payload: { surface: 'daily' } }]);
  assert.equal(r.action, 'populate');
  assert.equal(r.hadEvents, true);
  // Existing fields preserved
  assert.equal(r.next.nickname, 'Alice');
  assert.equal(r.next.createdAt, 100);
  // syncBlob populated
  assert.equal(r.next.syncBlob.v, 1);
  assert.equal(r.next.syncBlob.engagement.shares.daily, 1);
});

test('planRow: profile with no events → populate with empty engagement (still upserts so field exists)', () => {
  const profile = { id: 'dev-1', deviceId: 'dev-1' };
  const r = planRow(profile, []);
  assert.equal(r.action, 'populate');
  assert.equal(r.hadEvents, false);
  assert.deepEqual(r.next.syncBlob.engagement.shares, { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 });
});

test('planRow: profile.syncBlob exists but no engagement key (future Phase-5 attempts-only blob) → populate, preserve other sections', () => {
  // Forward-compat: a profile that already has, say, `attempts` from
  // Phase 5 but never got an engagement section should get one added
  // without clobbering attempts. We preserve any sibling keys.
  const profile = {
    id: 'dev-1', deviceId: 'dev-1',
    syncBlob: { v: 1, attempts: { quiz60s: 100, lastMigratedAt: 1750_000_000_000 } },
  };
  const r = planRow(profile, [{ kind: 'share', payload: { surface: 'daily' } }]);
  assert.equal(r.action, 'populate');
  assert.equal(r.next.syncBlob.attempts.quiz60s, 100, 'attempts section preserved');
  assert.equal(r.next.syncBlob.engagement.shares.daily, 1, 'engagement section added');
});

test('planRow: Cosmos system fields stripped on the next doc (never echoed back to upsert)', () => {
  const profile = {
    id: 'dev-1', deviceId: 'dev-1',
    _rid: 'X', _self: 'Y', _etag: 'Z', _attachments: 'W', _ts: 1700000000,
  };
  const r = planRow(profile, []);
  assert.equal(r.action, 'populate');
  assert.equal(r.next._rid, undefined);
  assert.equal(r.next._etag, undefined);
  assert.equal(r.next._ts, undefined);
});

// ---------------------------------------------------------------------------
// stripSystemFields — pinned because planRow inlines it; if the list ever
// changes we want a unit test failure, not a quiet schema drift.
// ---------------------------------------------------------------------------

test('stripSystemFields: removes the five known Cosmos system fields', () => {
  const r = stripSystemFields({
    id: 'x', _rid: 'a', _self: 'b', _etag: 'c', _attachments: 'd', _ts: 1, _custom: 'kept',
  });
  assert.deepEqual(r, { id: 'x', _custom: 'kept' });
});
