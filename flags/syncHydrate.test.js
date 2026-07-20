import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHydratePayload, trySyncDevices } from './syncHydrate.js';

/** Map-backed Storage stand-in — same shape getItem/setItem/removeItem
 * the real localStorage exposes for our purposes. */
function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { map.set(k, v); },
    removeItem: (/** @type {string} */ k) => { map.delete(k); },
  };
}

test('applyHydratePayload: empty payload is a no-op (no writes, returns zero counts)', () => {
  const store = makeStore();
  const counts = applyHydratePayload({ store, payload: { daily: [], records: {} } });
  assert.deepEqual(counts, { dailyWritten: 0, quizWritten: 0, nicknameWritten: false });
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

// Feature V Phase 1a. This is the silent one: if the 2-part shape isn't
// parsed here, a linked device stops restoring quiz PBs entirely and says
// nothing about it. The 2-part key means "sovereign pool", which is exactly
// what bestKey() emits with no suffix — so these must land on the same
// storage keys the 3-part `:sov` form does.
test('applyHydratePayload: 2-part configKeys hydrate onto the sovereign bestKey', () => {
  const store = makeStore();
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [],
      records: {
        'europe:60s': { score: 45, durationMs: 54566 },
        'countries:all': { score: 12, durationMs: 180000 },
        'weird:60s': { score: 22, durationMs: 60000 },
      },
    },
  });
  assert.equal(counts.quizWritten, 3);
  assert.equal(
    store.getItem('flagquiz.best.europe.60s'),
    JSON.stringify({ score: 45, time: 54566 }),
  );
  // `all` mode keeps its .v2 semantic-switch segment, and gains no .all suffix.
  assert.equal(
    store.getItem('flagquiz.best.countries.all.v2'),
    JSON.stringify({ score: 12, time: 180000 }),
  );
  assert.equal(
    store.getItem('flagquiz.best.weird.60s'),
    JSON.stringify({ score: 22, time: 60000 }),
  );
});

test('applyHydratePayload: 2-part and 3-part sovereign keys agree on the storage key', () => {
  // The rename in Phase 1c turns "europe:60s:sov" into "europe:60s". Both
  // must resolve to the same localStorage slot or the backfill would strand
  // a PB under a second key.
  const a = makeStore();
  applyHydratePayload({ store: a, payload: { daily: [], records: { 'europe:60s:sov': { score: 9, durationMs: 5 } } } });
  const b = makeStore();
  applyHydratePayload({ store: b, payload: { daily: [], records: { 'europe:60s': { score: 9, durationMs: 5 } } } });
  assert.deepEqual([...a.map.keys()], [...b.map.keys()]);
});

test('applyHydratePayload: skips quiz entries with malformed configKey shape', () => {
  // Two or three colon-separated parts (scope, when present, ∈ {sov,all}).
  // Anything else is suspect — likely a stale row from an older schema.
  // Don't write something nonsensical to the user's localStorage.
  const store = makeStore();
  const counts = applyHydratePayload({
    store,
    payload: {
      daily: [],
      records: {
        'europe:60s:bogus': { score: 1, durationMs: 1 },     // unknown scope
        ':60s:sov': { score: 1, durationMs: 1 },             // empty variant
        'europe::sov': { score: 1, durationMs: 1 },          // empty mode
        ':60s': { score: 1, durationMs: 1 },                 // empty variant, 2-part
        'europe:': { score: 1, durationMs: 1 },              // empty mode, 2-part
        'europe': { score: 1, durationMs: 1 },               // one part
        'a:b:c:d': { score: 1, durationMs: 1 },              // four parts
        'europe:60s:sov': { score: 1, durationMs: 1 },       // OK
      },
    },
  });
  assert.equal(counts.quizWritten, 1);
  assert.equal(store.map.size, 1);
});

test('applyHydratePayload: nickname string writes to gridgame.nickname', () => {
  const store = makeStore();
  const counts = applyHydratePayload({
    store,
    payload: { daily: [], records: {}, nickname: 'Janko' },
  });
  assert.equal(counts.nicknameWritten, true);
  assert.equal(store.getItem('gridgame.nickname'), 'Janko');
});

test('applyHydratePayload: nickname overwrites a stale local cache (linked-device truth)', () => {
  // Source of truth is the server post-merge. If local cache has an
  // old or different nickname, the server value wins — same rule as
  // daily.scores and the quiz PBs.
  const store = makeStore({ 'gridgame.nickname': 'Stale Name' });
  applyHydratePayload({
    store,
    payload: { daily: [], records: {}, nickname: 'Janko' },
  });
  assert.equal(store.getItem('gridgame.nickname'), 'Janko');
});

test('applyHydratePayload: nickname null removes the local cache (falls back to default)', () => {
  // Server explicitly has no nickname → the local cache must clear so
  // displayNickname falls through to the deterministic default. A
  // stale local nickname would otherwise read as "I have a name" on
  // every page load.
  const store = makeStore({ 'gridgame.nickname': 'Old Name' });
  const counts = applyHydratePayload({
    store,
    payload: { daily: [], records: {}, nickname: null },
  });
  assert.equal(counts.nicknameWritten, true);
  assert.equal(store.getItem('gridgame.nickname'), null);
});

test('applyHydratePayload: missing `nickname` key is a no-op (back-compat with older callers)', () => {
  const store = makeStore({ 'gridgame.nickname': 'Keep Me' });
  const counts = applyHydratePayload({
    store,
    payload: { daily: [], records: {} }, // no nickname field
  });
  assert.equal(counts.nicknameWritten, false);
  assert.equal(store.getItem('gridgame.nickname'), 'Keep Me');
});

test('applyHydratePayload: empty-string nickname is treated as "no nickname" — neither writes nor clears', () => {
  // Defensive: server should never return an empty string (nickname:
  // null is the "no nickname" wire value), but if a deploy ever does,
  // don't pollute the cache with "" and don't silently wipe a local
  // value either.
  const store = makeStore({ 'gridgame.nickname': 'Existing' });
  const counts = applyHydratePayload({
    store,
    payload: { daily: [], records: {}, nickname: '' },
  });
  assert.equal(counts.nicknameWritten, false);
  assert.equal(store.getItem('gridgame.nickname'), 'Existing');
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

// ---- trySyncDevices ---------------------------------------------------

/**
 * Build a fetch double that resolves to a successful hydrate payload
 * and records every call. Lets the tests assert "no network when
 * gated" purely by checking `calls.length`.
 */
/**
 * @param {{ daily: Array<{ puzzleId: number, foundCodes: string[], totalCount: number }>, records: Record<string, { score: number, durationMs: number }> }} [payload]
 */
function makeFetchDouble(payload = { daily: [], records: {} }) {
  /** @type {string[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url) => {
    calls.push(url);
    return {
      ok: true,
      async json() { return payload; },
    };
  });
  return { fetchImpl, calls };
}

/**
 * Fetch double that routes by endpoint: the `/sync/link` probe gets the
 * `link` body, everything else (the hydrate GET) gets `hydrate`. Lets
 * the self-discovery tests model "server says linked" vs "not linked"
 * independently of the hydrate payload.
 *
 * @param {{ link?: { linked: boolean, linkedAt?: number }, hydrate?: { daily: Array<{ puzzleId: number, foundCodes: string[], totalCount: number }>, records: Record<string, { score: number, durationMs: number }> } }} [opts]
 */
function makeRoutingFetch({ link = { linked: false }, hydrate = { daily: [], records: {} } } = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url) => {
    calls.push(url);
    const body = url.includes('/sync/link') ? link : hydrate;
    return { ok: true, async json() { return body; } };
  });
  return { fetchImpl, calls };
}

test('trySyncDevices: unlinked + probe already done recently → no network, stays unlinked', async () => {
  // linkProbedAt within the probe interval suppresses the self-discovery
  // probe, so a genuinely-unlinked device that already checked today
  // pays zero network — the 99%-of-players fast path.
  const store = makeStore({ 'gridgame.linkProbedAt': String(1_000_000 - 1000) }); // 1s ago
  const { fetchImpl, calls } = makeFetchDouble();
  const res = await trySyncDevices({
    deviceId: 'd1', store, identityKey: 'gridgame.identityId', fetchImpl, now: 1_000_000,
  });
  assert.deepEqual(res, { ran: false, reason: 'unlinked' });
  assert.equal(calls.length, 0, 'no fetch when the probe was already spent this interval');
});

test('trySyncDevices: unlinked + probe due, server says NOT linked → one probe, stays unlinked, stamps linkProbedAt', async () => {
  const store = makeStore(); // no identityId, no prior probe
  const { fetchImpl, calls } = makeRoutingFetch({ link: { linked: false } });
  const res = await trySyncDevices({
    deviceId: 'd1', store, identityKey: 'gridgame.identityId', fetchImpl, now: 1_000_000,
  });
  assert.deepEqual(res, { ran: false, reason: 'unlinked' });
  assert.equal(calls.length, 1, 'exactly the link probe — no hydrate when not linked');
  assert.ok(calls[0].includes('/sync/link'));
  assert.equal(store.getItem('gridgame.linkProbedAt'), '1000000', 'probe timestamp stamped');
  assert.equal(store.getItem('gridgame.identityId'), null, 'identity not back-filled when not linked');
});

test('trySyncDevices: unlinked + probe says LINKED → back-fills identityId then hydrates', async () => {
  // The target-device self-heal: server confirms this deviceId is linked,
  // so we write identityId locally and fall straight through to hydrate.
  const store = makeStore();
  const { fetchImpl, calls } = makeRoutingFetch({
    link: { linked: true, linkedAt: 123 },
    hydrate: { daily: [{ puzzleId: 24, foundCodes: ['cn', 'pk'], totalCount: 10 }], records: {} },
  });
  const res = await trySyncDevices({
    deviceId: 'd1', store, identityKey: 'gridgame.identityId', fetchImpl, now: 1_000_000,
  });
  assert.equal(res.ran, true);
  if (res.ran) assert.equal(res.ok, true);
  assert.equal(store.getItem('gridgame.identityId'), 'd1', 'identity back-filled from the link probe');
  assert.equal(calls.length, 2, 'link probe + hydrate GET');
  assert.ok(calls[0].includes('/sync/link'));
  assert.ok(calls[1].includes('/sync/hydrate'));
  const scores = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.equal(scores[24].f, 2, 'hydrated row landed so the daily page can revisit');
});

test('trySyncDevices: linked but within minInterval returns { ran: false, reason: fresh } — no network', async () => {
  const store = makeStore({
    'gridgame.identityId': 'd1',
    'gridgame.lastHydrateAt': String(1_000_000 - 30 * 1000), // 30 s ago
  });
  const { fetchImpl, calls } = makeFetchDouble();
  const res = await trySyncDevices({
    deviceId: 'd1', store, identityKey: 'gridgame.identityId',
    minIntervalMs: 60 * 1000, // 1 minute window
    now: 1_000_000, fetchImpl,
  });
  assert.deepEqual(res, { ran: false, reason: 'fresh' });
  assert.equal(calls.length, 0);
});

test('trySyncDevices: linked + stale fires the GET and stamps the timestamp', async () => {
  const store = makeStore({
    'gridgame.identityId': 'd1',
    'gridgame.lastHydrateAt': String(1_000_000 - 2 * 60 * 60 * 1000), // 2h ago
  });
  const { fetchImpl, calls } = makeFetchDouble({
    daily: [{ puzzleId: 1, foundCodes: ['fr'], totalCount: 2 }],
    records: {},
  });
  const res = await trySyncDevices({
    deviceId: 'd1', store, identityKey: 'gridgame.identityId',
    minIntervalMs: 60 * 60 * 1000, // 1h
    now: 1_000_000, fetchImpl,
  });
  assert.equal(res.ran, true);
  if (res.ran) assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(store.getItem('gridgame.lastHydrateAt'), '1000000', 'timestamp stamped to now');
  // And the hydrated row landed in daily.scores.
  const scores = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.equal(scores[1].f, 1);
});

test('trySyncDevices: no prior timestamp on a linked device fires the GET on first call', async () => {
  const store = makeStore({ 'gridgame.identityId': 'd1' });
  const { fetchImpl, calls } = makeFetchDouble();
  const res = await trySyncDevices({
    deviceId: 'd1', store, identityKey: 'gridgame.identityId',
    minIntervalMs: 60 * 60 * 1000, now: 1_000_000, fetchImpl,
  });
  assert.equal(res.ran, true);
  assert.equal(calls.length, 1);
});

test('trySyncDevices: force=true bypasses the fresh gate (still skips when unlinked)', async () => {
  // Linked + already hydrated 30s ago. Default trySyncDevices would
  // return { ran: false, reason: 'fresh' }. With force=true the GET
  // fires anyway — callers use this to refresh local cache before
  // taking a UX decision that depends on it (e.g. daily revisit).
  const store = makeStore({
    'gridgame.identityId': 'd1',
    'gridgame.lastHydrateAt': String(1_000_000 - 30 * 1000),
  });
  const { fetchImpl, calls } = makeFetchDouble({
    daily: [{ puzzleId: 1, foundCodes: ['fr'], totalCount: 2 }],
    records: {},
  });
  const res = await trySyncDevices({
    deviceId: 'd1', store, identityKey: 'gridgame.identityId',
    minIntervalMs: 60 * 1000, now: 1_000_000, fetchImpl, force: true,
  });
  assert.equal(res.ran, true);
  if (res.ran) assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  // Identity gate still applies — force on an unlinked store stays
  // unlinked. (linkProbedAt is recent so the self-discovery probe is
  // suppressed and this asserts the pure no-op path: no network.)
  const store2 = makeStore({ 'gridgame.linkProbedAt': String(1_000_000 - 1000) });
  const { fetchImpl: f2, calls: calls2 } = makeFetchDouble();
  const res2 = await trySyncDevices({
    deviceId: 'd1', store: store2, identityKey: 'gridgame.identityId',
    now: 1_000_000, fetchImpl: f2, force: true,
  });
  assert.deepEqual(res2, { ran: false, reason: 'unlinked' });
  assert.equal(calls2.length, 0);
});

test('trySyncDevices: stamps the timestamp BEFORE awaiting the fetch (de-races concurrent tabs)', async () => {
  // Two simultaneous calls — only the first should hit the network if
  // the timestamp is stamped synchronously before the await. We model
  // "simultaneous" by giving both calls the same `now` and inspecting
  // call count after Promise.all.
  const store = makeStore({ 'gridgame.identityId': 'd1' });
  const { fetchImpl, calls } = makeFetchDouble();
  // Wrap the fetch double in a small delay so the second call has time
  // to see the stamped timestamp before its own gate check.
  const wrapped = /** @type {any} */ (async (/** @type {string} */ url) => {
    await new Promise((r) => setTimeout(r, 10));
    return fetchImpl(url);
  });
  await Promise.all([
    trySyncDevices({ deviceId: 'd1', store, identityKey: 'gridgame.identityId', minIntervalMs: 60_000, now: 1_000_000, fetchImpl: wrapped }),
    trySyncDevices({ deviceId: 'd1', store, identityKey: 'gridgame.identityId', minIntervalMs: 60_000, now: 1_000_000, fetchImpl: wrapped }),
  ]);
  assert.equal(calls.length, 1, 'second concurrent call hit the fresh gate after the first stamped');
});

// ---- wrong guesses survive the hydrate -------------------------------------
// The payload carried only foundCodes + totalCount, so any record that reached
// a device via sync lost its wrong-guess list. Two visible symptoms: the
// revisit "your wrong guesses" section was empty, and the daily heart row —
// which derives spent hearts from `w` — showed a full row on a puzzle the
// player had actually fumbled 11 times. The data was in Cosmos the whole time.

test('applyHydratePayload: daily rows carry wrongCodes into the local record', () => {
  const store = makeStore();
  applyHydratePayload({
    store,
    payload: {
      daily: [{ puzzleId: 43, foundCodes: ['cn', 'in'], totalCount: 8, wrongCodes: ['ru', 'tr', 'mn'] }],
      records: {},
    },
  });
  const blob = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.deepEqual(blob[43].w, ['ru', 'tr', 'mn']);
});

test('applyHydratePayload: a row with no wrong guesses writes no w key', () => {
  const store = makeStore();
  applyHydratePayload({
    store,
    payload: { daily: [{ puzzleId: 44, foundCodes: ['fi'], totalCount: 1, wrongCodes: [] }], records: {} },
  });
  const blob = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.ok(!('w' in blob[44]), 'empty wrong list should not write a w key');
});

test('applyHydratePayload: a hydrate without wrongCodes does not erase a local w', () => {
  // Older servers, and any row predating the field, send no wrongCodes. The
  // hydrate overwrites the record wholesale, so without this guard a sync
  // would silently delete wrong guesses the player earned on this device.
  const store = makeStore();
  store.setItem('daily.scores', JSON.stringify({ 45: { f: 2, t: 12, c: ['so'], w: ['cg', 'er', 'sd'] } }));
  applyHydratePayload({
    store,
    payload: { daily: [{ puzzleId: 45, foundCodes: ['so', 'km'], totalCount: 12 }], records: {} },
  });
  const blob = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.deepEqual(blob[45].w, ['cg', 'er', 'sd'], 'local wrong guesses must survive');
  assert.equal(blob[45].f, 2, 'and the rest of the row still hydrates');
});

test('applyHydratePayload: non-string wrong codes are filtered out', () => {
  const store = makeStore();
  applyHydratePayload({
    store,
    payload: {
      daily: [{ puzzleId: 43, foundCodes: ['cn'], totalCount: 8, wrongCodes: /** @type {any} */ (['ru', 7, null, 'tr']) }],
      records: {},
    },
  });
  const blob = JSON.parse(/** @type {string} */ (store.getItem('daily.scores')));
  assert.deepEqual(blob[43].w, ['ru', 'tr']);
});
