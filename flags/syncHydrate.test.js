import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHydratePayload } from './syncHydrate.js';

/** Map-backed Storage stand-in — same shape getItem/setItem the real
 * localStorage exposes for our purposes. */
function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { map.set(k, v); },
  };
}

test('applyHydratePayload: empty payload is a no-op (no writes, returns zero counts)', () => {
  const store = makeStore();
  const counts = applyHydratePayload({ store, payload: { daily: [], records: {} } });
  assert.deepEqual(counts, { dailyWritten: 0, quizWritten: 0 });
  assert.equal(store.map.size, 0);
});

test('applyHydratePayload: daily rows overwrite local for matching puzzleIds', () => {
  // Local thinks puzzle 1 was 5/10. Server says it was actually 7/10 with
  // a richer codes list (because the source device's better attempt got
  // merged). Hydrate must replace, not preserve, the local entry.
  const store = makeStore({
    'daily.scores': JSON.stringify({ 1: { f: 5, t: 10, c: ['fr', 'de'] } }),
  });
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [{ puzzleId: 1, foundCodes: ['fr', 'de', 'es', 'it', 'pl', 'gb', 'pt'], totalCount: 10 }],
      records: {},
    },
  });
  assert.equal(counts.dailyWritten, 1);
  const blob = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.equal(blob[1].f, 7);
  assert.equal(blob[1].t, 10);
  assert.deepEqual(blob[1].c, ['fr', 'de', 'es', 'it', 'pl', 'gb', 'pt']);
});

test('applyHydratePayload: daily rows non-overlapping with local are added', () => {
  // Local has puzzle 1; server returns puzzles 2 + 3. Hydrate must add
  // those without dropping puzzle 1 — the local cache may include plays
  // the server doesn't (a localhost-only dev play, for example).
  const store = makeStore({
    'daily.scores': JSON.stringify({ 1: { f: 9, t: 10, c: ['fr'] } }),
  });
  applyHydratePayload({
    store,
    payload: {
      daily: [
        { puzzleId: 2, foundCodes: ['de', 'pl'], totalCount: 5 },
        { puzzleId: 3, foundCodes: ['it'], totalCount: 4 },
      ],
      records: {},
    },
  });
  const blob = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.deepEqual(Object.keys(blob).sort(), ['1', '2', '3']);
  assert.equal(blob[1].f, 9, 'puzzle 1 preserved');
  assert.equal(blob[2].t, 5);
  assert.equal(blob[3].f, 1);
});

test('applyHydratePayload: malformed daily.scores blob is replaced cleanly (no JSON crash)', () => {
  const store = makeStore({ 'daily.scores': '{ not json' });
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [{ puzzleId: 1, foundCodes: ['fr'], totalCount: 2 }],
      records: {},
    },
  });
  assert.equal(counts.dailyWritten, 1);
  const blob = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.equal(blob[1].f, 1);
});

test('applyHydratePayload: skips daily rows with invalid puzzleId', () => {
  const store = makeStore();
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [
        { puzzleId: /** @type {any} */ ('not a number'), foundCodes: [], totalCount: 0 },
        { puzzleId: 0, foundCodes: [], totalCount: 0 },
        { puzzleId: 1, foundCodes: ['fr'], totalCount: 2 },
      ],
      records: {},
    },
  });
  assert.equal(counts.dailyWritten, 1);
});

test('applyHydratePayload: quiz records write to bestKey-shaped storage keys', () => {
  // Mirror the bestKey() format from flags/quiz.js exactly — the test is
  // the pinning for the cross-module agreement. configKey shape per
  // quizRecordConfigKey: "<variant>:<mode>:<scope>".
  const store = makeStore();
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [],
      records: {
        'europe:60s:sov': { score: 45, durationMs: 54566 },
        'countries:all:sov': { score: 12, durationMs: 180000 },
        'asia:60s:all': { score: 30, durationMs: 60000 },
        'oceania:all:all': { score: 8, durationMs: 120000 },
      },
    },
  });
  assert.equal(counts.quizWritten, 4);
  // 60s mode → flagquiz.best.<variant>.60s[.all]
  assert.equal(
    store.getItem('flagquiz.best.europe.60s'),
    JSON.stringify({ score: 45, time: 54566 }),
  );
  assert.equal(
    store.getItem('flagquiz.best.asia.60s.all'),
    JSON.stringify({ score: 30, time: 60000 }),
  );
  // all mode → flagquiz.best.<variant>.all.v2[.all] — the .v2 segment
  // is the "mistakes count, lower wins" semantic switch from quiz.js.
  assert.equal(
    store.getItem('flagquiz.best.countries.all.v2'),
    JSON.stringify({ score: 12, time: 180000 }),
  );
  assert.equal(
    store.getItem('flagquiz.best.oceania.all.v2.all'),
    JSON.stringify({ score: 8, time: 120000 }),
  );
});

test('applyHydratePayload: skips quiz entries with malformed configKey shape', () => {
  // Anything other than three colon-separated parts (with scope ∈ {sov,all})
  // is suspect — likely a stale row from an older schema. Don't write
  // something nonsensical to the user's localStorage.
  const store = makeStore();
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [],
      records: {
        'europe:60s': { score: 1, durationMs: 1 },           // missing scope
        'europe:60s:bogus': { score: 1, durationMs: 1 },     // unknown scope
        ':60s:sov': { score: 1, durationMs: 1 },             // empty variant
        'europe::sov': { score: 1, durationMs: 1 },          // empty mode
        'europe:60s:sov': { score: 1, durationMs: 1 },       // OK
      },
    },
  });
  assert.equal(counts.quizWritten, 1);
  assert.equal(store.map.size, 1);
});

test('applyHydratePayload: skips quiz entries missing score/durationMs', () => {
  const store = makeStore();
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [],
      records: {
        'europe:60s:sov': /** @type {any} */ ({}),
        'asia:60s:sov': /** @type {any} */ ({ score: 1 }),
        'africa:60s:sov': /** @type {any} */ ({ durationMs: 1 }),
      },
    },
  });
  assert.equal(counts.quizWritten, 0);
});
