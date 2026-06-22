import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateEngagement, SENTINEL_KEY, SENTINEL_VALUE } from './engagementMigration.js';
import { STORAGE_KEY as STATE_KEY, loadState } from './engagementCounters.js';

const DEV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeStore() {
  const map = new Map();
  return {
    _map: map,
    getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { map.set(k, v); },
  };
}

/**
 * Scripted fetch double. Returns responses in the order given; tracks
 * every call so tests can assert on the URLs hit.
 *
 * @param {Array<{ status?: number, json?: any, throws?: boolean }>} responses
 */
function makeFetch(responses) {
  /** @type {Array<{ url: string, init?: any }>} */
  const calls = [];
  let i = 0;
  /** @type {any} */
  const impl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    const r = responses[i++] ?? { status: 200, json: {} };
    if (r.throws) throw new Error('network');
    return {
      status: r.status ?? 200,
      async json() { return r.json; },
    };
  };
  return { impl, calls };
}

// ---------------------------------------------------------------------------
// Sentinel short-circuit
// ---------------------------------------------------------------------------

test('migrateEngagement: sentinel set → no-op, returns source:sentinel, no fetch fired', async () => {
  const store = makeStore();
  store.setItem(SENTINEL_KEY, SENTINEL_VALUE);
  const fetcher = makeFetch([]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { migrated: false, source: 'sentinel' });
  assert.equal(fetcher.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Pull-first ordering — the critical correctness step
// ---------------------------------------------------------------------------

test('migrateEngagement: blob already populated → inflate from blob, skip dailyMe', async () => {
  // Another device on this deviceId migrated first and pushed its state.
  // This device's migration should hydrate from the blob, NOT re-read
  // the stale historical engagementEvents rows via dailyMe — that's the
  // race that would silently overwrite the post-migration data.
  const store = makeStore();
  const blobEngagement = {
    v: 1,
    shares: { daily: 12, flagquiz: 8, findflag: 0, ttt: 1 },
    coffeeClickCount: 1,
    quiz60sDayLog: [19000, 19001, 19003],
  };
  const fetcher = makeFetch([
    { status: 200, json: { daily: [], records: {}, nickname: null, syncBlob: { v: 1, engagement: blobEngagement } } },
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { migrated: true, source: 'blob' });
  // dailyMe must NOT have been called — only the syncHydrate pull
  assert.equal(fetcher.calls.length, 1);
  assert.match(fetcher.calls[0].url, /\/api\/v1\/sync\/hydrate\?deviceId=/);
  // Local state mirrors the blob
  assert.deepEqual(loadState(store).shares, blobEngagement.shares);
  assert.equal(loadState(store).coffeeClickCount, 1);
  // Sentinel latched
  assert.equal(store.getItem(SENTINEL_KEY), SENTINEL_VALUE);
});

test('migrateEngagement: blob exists but no engagement section → falls through to dailyMe', async () => {
  // Edge case: another device pushed an `attempts`-only blob (Phase 5
  // future). Phase 3 migration sees the blob but no engagement key →
  // does its own dailyMe-based migration.
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { daily: [], records: {}, nickname: null, syncBlob: { v: 1, attempts: { quiz60s: 100 } } } },
    { status: 200, json: { dailySharesCount: 3, quizSharesCount: 0, findflagSharesCount: 0, coffeeClicked: false } },
    { status: 204 },  // pushSyncBlob
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(r.source, 'dailyMe');
  // Two reads (hydrate + dailyMe) + one write (push)
  assert.equal(fetcher.calls.length, 3);
  assert.equal(loadState(store).shares.daily, 3);
  assert.equal(store.getItem(SENTINEL_KEY), SENTINEL_VALUE);
});

// ---------------------------------------------------------------------------
// dailyMe migration path — first device for this deviceId
// ---------------------------------------------------------------------------

test('migrateEngagement: no blob, dailyMe returns counts → populates localStorage + pushes blob', async () => {
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { status: 200, json: {
      dailySharesCount: 5,
      quizSharesCount: 3,
      findflagSharesCount: 2,
      coffeeClicked: true,
    } },
    { status: 204 },
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(r.source, 'dailyMe');

  const state = loadState(store);
  assert.equal(state.shares.daily, 5);
  assert.equal(state.shares.flagquiz, 3);
  assert.equal(state.shares.findflag, 2);
  assert.equal(state.shares.ttt, 0, 'ttt starts fresh — never aggregated pre-Phase-3');
  assert.equal(state.coffeeClickCount, 1, 'server only knew boolean — translate to 1');
  assert.deepEqual(state.quiz60sDayLog, [], 'day log starts empty — server never exposed it');

  // Pushed the blob back so other devices skip the dailyMe read
  const pushCall = fetcher.calls[2];
  assert.equal(pushCall.url, '/api/v1/profile/sync-blob');
  const pushedBody = JSON.parse(pushCall.init.body);
  assert.equal(pushedBody.deviceId, DEV_ID);
  assert.equal(pushedBody.blob.v, 1);
  assert.deepEqual(pushedBody.blob.engagement, state);

  assert.equal(store.getItem(SENTINEL_KEY), SENTINEL_VALUE);
});

test('migrateEngagement: dailyMe shows no engagement signals → empty state, sentinel still latches', async () => {
  // Fresh device whose pre-Phase-3 history has nothing to migrate.
  // Still a successful migration — the state is just empty. Latching
  // the sentinel means the user doesn't hit the dailyMe read again on
  // every page load.
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { status: 200, json: { dailySharesCount: 0, quizSharesCount: 0, findflagSharesCount: 0, coffeeClicked: false } },
    { status: 204 },
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(r.source, 'dailyMe');
  const state = loadState(store);
  assert.equal(state.shares.daily, 0);
  assert.equal(state.coffeeClickCount, 0);
  assert.equal(store.getItem(SENTINEL_KEY), SENTINEL_VALUE);
});

test('migrateEngagement: coffeeClicked false → coffeeClickCount stays 0', async () => {
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { status: 200, json: { dailySharesCount: 1, coffeeClicked: false } },
    { status: 204 },
  ]);
  await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(loadState(store).coffeeClickCount, 0);
});

test('migrateEngagement: dailyMe push failure does NOT block the sentinel (fire-and-forget)', async () => {
  // Even if pushSyncBlob fails, the local state is valid and the next
  // counter bump will re-push. We don't want the sentinel unset (it'd
  // re-run migration on every boot for users behind a flaky network).
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { status: 200, json: { dailySharesCount: 1, coffeeClicked: false } },
    { status: 500 },  // push fails
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(r.source, 'dailyMe');
  assert.equal(store.getItem(SENTINEL_KEY), SENTINEL_VALUE);
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

test('migrateEngagement: dailyMe non-200 → sentinel unset, next boot retries', async () => {
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { status: 500 },
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(r.migrated, false);
  assert.equal(r.source, 'failed');
  assert.match(r.reason ?? '', /^http_/);
  assert.equal(store.getItem(SENTINEL_KEY), null);
});

test('migrateEngagement: network throw on dailyMe → sentinel unset', async () => {
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { throws: true },
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.deepEqual(r, { migrated: false, source: 'failed', reason: 'network_error' });
  assert.equal(store.getItem(SENTINEL_KEY), null);
});

test('migrateEngagement: pull failure → treat as empty blob, falls through to dailyMe (resilient)', async () => {
  // A pullSyncBlob failure isn't fatal — we just don't know if anyone
  // else has migrated. Falling through to the dailyMe path means worst
  // case both devices read dailyMe and the second push overwrites the
  // first; same result as the no-blob case. Better than not migrating.
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 500 },                                              // pull fails
    { status: 200, json: { dailySharesCount: 2, coffeeClicked: false } },
    { status: 204 },
  ]);
  const r = await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(r.source, 'dailyMe');
  assert.equal(loadState(store).shares.daily, 2);
  assert.equal(store.getItem(SENTINEL_KEY), SENTINEL_VALUE);
});

test('migrateEngagement: invalid deviceId rejected, sentinel unset, no fetch fired', async () => {
  const store = makeStore();
  const fetcher = makeFetch([]);
  const r = await migrateEngagement({ deviceId: '', store, fetchImpl: fetcher.impl });
  assert.equal(r.source, 'failed');
  // pull rejects empty deviceId at the syncBlob.js layer, so we may see
  // 0 fetch calls (pull short-circuited) or 1 (if pull retried). Either
  // way, sentinel stays unset.
  assert.equal(store.getItem(SENTINEL_KEY), null);
});

// ---------------------------------------------------------------------------
// Idempotency under repeated invocation
// ---------------------------------------------------------------------------

test('migrateEngagement: second call after success is a sentinel short-circuit (no extra network)', async () => {
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { status: 200, json: { dailySharesCount: 1, coffeeClicked: false } },
    { status: 204 },
  ]);
  await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  const callsAfterFirst = fetcher.calls.length;
  await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });
  assert.equal(fetcher.calls.length, callsAfterFirst, 'second call must not touch the network');
});

// ---------------------------------------------------------------------------
// State written to localStorage matches what was pushed to the blob
// ---------------------------------------------------------------------------

test('migrateEngagement: pushed blob.engagement deep-equals saved local state', async () => {
  const store = makeStore();
  const fetcher = makeFetch([
    { status: 200, json: { syncBlob: null } },
    { status: 200, json: {
      dailySharesCount: 7,
      quizSharesCount: 4,
      findflagSharesCount: 1,
      coffeeClicked: true,
    } },
    { status: 204 },
  ]);
  await migrateEngagement({ deviceId: DEV_ID, store, fetchImpl: fetcher.impl });

  const saved = JSON.parse(/** @type {string} */ (store.getItem(STATE_KEY)));
  const pushedBody = JSON.parse(fetcher.calls[2].init.body);
  assert.deepEqual(pushedBody.blob.engagement, saved);
});
