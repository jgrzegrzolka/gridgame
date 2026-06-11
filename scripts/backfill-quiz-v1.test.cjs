const test = require('node:test');
const assert = require('node:assert/strict');
const { planRow, stripSystemFields, TARGET_VERSION } = require('./backfill-quiz-v1.cjs');

const PRE_F5_ROW = {
  id: 'dev-a', deviceId: 'dev-a',
  records: {
    'countries:60s:sov': { score: 50, durationMs: 60_000, submittedAt: 100 },
    'africa:60s:sov':    { score: 5,  durationMs: 60_000, submittedAt: 200 },
  },
  updatedAt: 200,
  _rid: 'X', _self: 'Y', _etag: 'Z', _attachments: 'A', _ts: 200,
};

const POST_F5_ROW = {
  id: 'dev-b', deviceId: 'dev-b',
  records: {
    'countries:60s:sov': {
      score: 50, durationMs: 60_000, submittedAt: 100,
      attempts: 7, lastPlayedAt: 500,
    },
  },
  updatedAt: 500, v: 1,
};

const PARTIAL_ROW = {
  // Race-window case: one sub-entry is post-F5 (the one the user finished after
  // the deploy), the other is still pre-F5. Backfill must fill the stale one.
  id: 'dev-c', deviceId: 'dev-c',
  records: {
    'countries:60s:sov': {
      score: 50, durationMs: 60_000, submittedAt: 100,
      attempts: 1, lastPlayedAt: 999,
    },
    'africa:60s:sov': { score: 5, durationMs: 60_000, submittedAt: 200 },
  },
  updatedAt: 999, v: 1,
};

test('planRow: pre-F5 row → migrate; both sub-entries get attempts:1 + lastPlayedAt:submittedAt; doc gets v:1 + backfilled:true', () => {
  const plan = planRow(PRE_F5_ROW);
  assert.equal(plan.action, 'migrate');
  assert.equal(plan.analyticalDefaulted, true);
  assert.equal(plan.next.v, 1);
  assert.equal(plan.next.backfilled, true);
  assert.deepEqual(plan.next.records['countries:60s:sov'], {
    score: 50, durationMs: 60_000, submittedAt: 100, attempts: 1, lastPlayedAt: 100,
  });
  assert.deepEqual(plan.next.records['africa:60s:sov'], {
    score: 5, durationMs: 60_000, submittedAt: 200, attempts: 1, lastPlayedAt: 200,
  });
});

test('planRow: post-F5 row (already v:1 with all fields) → skip', () => {
  const plan = planRow(POST_F5_ROW);
  assert.equal(plan.action, 'skip');
});

test('planRow: partial / race-window row → migrate; only the stale sub-entry gets defaulted; backfilled:true set', () => {
  const plan = planRow(PARTIAL_ROW);
  assert.equal(plan.action, 'migrate');
  assert.equal(plan.analyticalDefaulted, true);
  // The post-F5 sub-entry is preserved as-is.
  assert.deepEqual(plan.next.records['countries:60s:sov'], PARTIAL_ROW.records['countries:60s:sov']);
  // The stale one is filled.
  assert.deepEqual(plan.next.records['africa:60s:sov'], {
    score: 5, durationMs: 60_000, submittedAt: 200, attempts: 1, lastPlayedAt: 200,
  });
  assert.equal(plan.next.backfilled, true);
});

test('planRow: doc that has v but is missing v:TARGET_VERSION still gets migrated (v-only patch path)', () => {
  // Hypothetical future state: a v:0 doc with all fields. No analytical
  // default needed; just bump v. backfilled should NOT be set on this row.
  const row = {
    id: 'dev-d', deviceId: 'dev-d',
    records: {
      'countries:60s:sov': {
        score: 50, durationMs: 60_000, submittedAt: 100,
        attempts: 5, lastPlayedAt: 500,
      },
    },
    updatedAt: 500, v: 0,
  };
  const plan = planRow(row);
  assert.equal(plan.action, 'migrate');
  assert.equal(plan.analyticalDefaulted, false);
  assert.equal(plan.next.v, 1);
  assert.equal('backfilled' in plan.next, false);
});

test('planRow does not mutate the input', () => {
  const row = JSON.parse(JSON.stringify(PRE_F5_ROW));
  planRow(row);
  assert.deepEqual(row, PRE_F5_ROW);
});

test('stripSystemFields removes Cosmos system fields', () => {
  const cleaned = stripSystemFields(PRE_F5_ROW);
  for (const f of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
    assert.equal(f in cleaned, false);
  }
  assert.equal(cleaned.id, 'dev-a');
});

test('TARGET_VERSION matches the writer schema', () => {
  assert.equal(TARGET_VERSION, 1);
});
