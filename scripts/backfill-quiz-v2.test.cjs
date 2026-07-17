const test = require('node:test');
const assert = require('node:assert/strict');

const { planRow, classify, TARGET_VERSION } = require('./backfill-quiz-v2.cjs');

const sub = (score, durationMs, attempts, submittedAt = 1000, lastPlayedAt = 1000) =>
  ({ score, durationMs, submittedAt, attempts, lastPlayedAt });

test('classify: the two live shapes and the junk', () => {
  assert.deepEqual(classify('europe:60s'), { slot: 'europe:60s', kind: 'current' });
  assert.deepEqual(classify('europe:60s:sov'), { slot: 'europe:60s', kind: 'sov' });
  assert.deepEqual(classify('europe:60s:all'), { slot: 'europe:60s', kind: 'all' });
  assert.equal(classify('europe'), null);
  assert.equal(classify('europe:60s:wat'), null);
  assert.equal(classify('a:b:c:d'), null);
  assert.equal(classify(':60s:sov'), null);
});

test('renames :sov to the 2-part key, PB untouched', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', records: { 'europe:60s:sov': sub(45, 54566, 3) }, v: 1 });
  assert.equal(plan.action, 'migrate');
  assert.deepEqual(Object.keys(plan.next.records), ['europe:60s']);
  // Same 195-flag pool before and after — the score means exactly what it did.
  assert.equal(plan.next.records['europe:60s'].score, 45);
  assert.equal(plan.next.records['europe:60s'].durationMs, 54566);
  assert.equal(plan.next.records['europe:60s'].attempts, 3);
  assert.equal(plan.next.v, TARGET_VERSION);
});

// The reason this backfill needs real merge logic: 1b writes 2-part keys while
// pre-1c docs still hold the 3-part ones, so a slot can carry both.
test('collision: :sov + current merge, better 60s score wins, attempts sum', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'europe:60s:sov': sub(30, 60000, 2, 100, 100),
    'europe:60s': sub(44, 59000, 1, 200, 200),
  } });
  const e = plan.next.records['europe:60s'];
  assert.equal(Object.keys(plan.next.records).length, 1);
  assert.equal(e.score, 44, '60s: higher wins');
  assert.equal(e.durationMs, 59000);
  assert.equal(e.submittedAt, 200, 'submittedAt follows the winning PB');
  assert.equal(e.attempts, 3, 'both sets of attempts are real');
  assert.equal(e.lastPlayedAt, 200);
});

test('collision: endurance mode inverts the comparator (fewer mistakes wins)', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'countries:all:sov': sub(2, 90000, 1, 100, 100),
    'countries:all': sub(9, 50000, 1, 200, 200),
  } });
  const e = plan.next.records['countries:all'];
  assert.equal(e.score, 2, 'all-mode: LOWER wins — 9 mistakes must not displace 2');
  assert.equal(e.attempts, 2);
});

test('collision: equal score → faster time wins (the documented tiebreak)', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'asia:60s:sov': sub(20, 60000, 1),
    'asia:60s': sub(20, 42000, 1),
  } });
  assert.equal(plan.next.records['asia:60s'].durationMs, 42000);
});

// The heart of the migration: :all measured the 269-flag pool that no longer
// exists. Its score is not comparable; its attempts are still real plays.
test(':all PB is discarded but its attempts fold into the sibling', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'countries:60s:sov': sub(31, 60000, 4, 100, 100),
    'countries:60s:all': sub(99, 10000, 6, 500, 500),
  } });
  const e = plan.next.records['countries:60s'];
  assert.equal(Object.keys(plan.next.records).length, 1);
  assert.equal(e.score, 31, 'the 269-pool score must NOT win, however high');
  assert.equal(e.durationMs, 60000);
  assert.equal(e.submittedAt, 100, 'PB provenance stays with the sovereign run');
  assert.equal(e.attempts, 10, '4 + 6 — the player really played all ten');
  assert.equal(e.lastPlayedAt, 500, 'they did last play then');
  assert.equal(plan.stats.foldedAttempts, 6);
  assert.equal(plan.stats.droppedSlots, 0);
});

// The trap. Keeping the attempts here would leave an entry with no score, and
// isPersonalBest compares `candidate.score > incumbent.score` — against
// undefined that is false forever, so the slot could never take a PB again.
test(':all-only slot is dropped whole, never left score-less', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'oceania:60s:all': sub(12, 60000, 2),
  } });
  assert.deepEqual(plan.next.records, {}, 'slot is gone, not half-alive');
  assert.equal(plan.stats.droppedSlots, 1);
  assert.equal(plan.stats.droppedAttempts, 2, 'the loss is counted, not silent');
});

test(':all-only drop leaves other slots untouched', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'oceania:60s:all': sub(12, 60000, 2),
    'europe:60s:sov': sub(40, 60000, 5),
  } });
  assert.deepEqual(Object.keys(plan.next.records), ['europe:60s']);
  assert.equal(plan.next.records['europe:60s'].score, 40);
  assert.equal(plan.stats.droppedSlots, 1);
});

test('no migrated entry is ever score-less (the poisoned-slot invariant)', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'countries:60s:all': sub(50, 60000, 3),
    'countries:60s:sov': sub(20, 60000, 1),
    'europe:60s:all': sub(9, 60000, 1),
    'oceania:60s:all': sub(4, 60000, 1),
  } });
  for (const [k, e] of Object.entries(plan.next.records)) {
    assert.equal(typeof e.score, 'number', `${k} must carry a numeric score`);
    assert.equal(typeof e.durationMs, 'number', `${k} must carry a numeric durationMs`);
  }
});

test('idempotent: a v:2 doc with only current keys is skipped', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 2, records: { 'europe:60s': sub(45, 5, 1) } });
  assert.equal(plan.action, 'skip');
});

test('re-running the migration output is a no-op', () => {
  const once = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'europe:60s:sov': sub(45, 54566, 3),
    'europe:60s:all': sub(50, 1000, 2),
  } });
  const twice = planRow(once.next);
  assert.equal(twice.action, 'skip', 'second pass must find nothing to do');
});

test('a v:1 doc with only current keys still gets its version bumped', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: { 'europe:60s': sub(45, 5, 1) } });
  assert.equal(plan.action, 'migrate');
  assert.equal(plan.next.v, 2);
});

test('unknown-shape keys are kept verbatim, never guessed at or deleted', () => {
  const junk = { score: 1, durationMs: 1, attempts: 1 };
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {
    'europe:60s:sov': sub(45, 5, 1),
    'weird-legacy-thing': junk,
  } });
  assert.deepEqual(plan.next.records['weird-legacy-thing'], junk);
  assert.equal(plan.stats.unknownKeys, 1);
});

test('system fields are stripped before upsert', () => {
  const plan = planRow({
    id: 'd', deviceId: 'd', v: 1, _rid: 'x', _self: 'y', _etag: 'z', _attachments: 'a', _ts: 1,
    records: { 'europe:60s:sov': sub(45, 5, 1) },
  });
  for (const f of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
    assert.equal(plan.next[f], undefined, `${f} must not be upserted back`);
  }
  assert.equal(plan.next.id, 'd');
  assert.equal(plan.next.deviceId, 'd');
});

test('does NOT set backfilled:true — nothing analytical was defaulted', () => {
  // Per infra/operations.md the marker means "this value was defaulted in,
  // treat it as 'we never asked'". A rename + delete defaults nothing, and
  // marking it would poison every future "exclude backfilled rows" analytic.
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: { 'europe:60s:sov': sub(45, 5, 1) } });
  assert.equal(plan.next.backfilled, undefined);
});

test('an empty records map still migrates to v:2 without inventing anything', () => {
  const plan = planRow({ id: 'd', deviceId: 'd', v: 1, records: {} });
  assert.equal(plan.action, 'migrate');
  assert.deepEqual(plan.next.records, {});
  assert.equal(plan.next.v, 2);
});
