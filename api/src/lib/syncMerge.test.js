const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planDailyMerge,
  countDailyConflicts,
  planQuizMerge,
  planTttMerge,
  planEventsMerge,
  planProfileMerge,
  detectProfileConflict,
  inferLowerWins,
  pickBetterEntry,
} = require('./syncMerge');

const TGT = 'dev-target';
const SRC = 'dev-source';
const NOW = 1_780_000_000_000;

// ---- countDailyConflicts ------------------------------------------------

test('countDailyConflicts: zero if no overlap', () => {
  const r = countDailyConflicts({
    targetRows: [{ puzzleId: 1 }, { puzzleId: 2 }],
    sourceRows: [{ puzzleId: 3 }, { puzzleId: 4 }],
  });
  assert.deepEqual(r, { count: 0, puzzleIds: [] });
});

test('countDailyConflicts: counts overlapping puzzleIds, sorted', () => {
  const r = countDailyConflicts({
    targetRows: [{ puzzleId: 1 }, { puzzleId: 2 }, { puzzleId: 3 }, { puzzleId: 4 }],
    sourceRows: [{ puzzleId: 3 }, { puzzleId: 4 }, { puzzleId: 5 }, { puzzleId: 6 }],
  });
  assert.deepEqual(r, { count: 2, puzzleIds: [3, 4] });
});

// ---- planDailyMerge ------------------------------------------------------

test('planDailyMerge: non-overlap rows transfer with new deviceId, source deleted', () => {
  const r = planDailyMerge({
    targetRows: [{ puzzleId: 1, deviceId: TGT, foundCodes: ['gb'], id: `1:${TGT}` }],
    sourceRows: [{ puzzleId: 5, deviceId: SRC, foundCodes: ['fr'], id: `5:${SRC}` }],
    targetDeviceId: TGT, sourceDeviceId: SRC, primary: 'target',
  });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.id, `5:${TGT}`);
  assert.equal(r.upserts[0].doc.deviceId, TGT);
  assert.deepEqual(r.upserts[0].doc.foundCodes, ['fr']);
  assert.equal(r.deletes.length, 1);
  assert.deepEqual(r.deletes[0], { container: 'dailyResults', partitionKey: 5, id: `5:${SRC}` });
});

test('planDailyMerge: overlap + primary=target keeps target row, deletes source row, no upsert', () => {
  const r = planDailyMerge({
    targetRows: [{ puzzleId: 3, deviceId: TGT, foundCodes: ['gb', 'fr'], id: `3:${TGT}` }],
    sourceRows: [{ puzzleId: 3, deviceId: SRC, foundCodes: ['de'], id: `3:${SRC}` }],
    targetDeviceId: TGT, sourceDeviceId: SRC, primary: 'target',
  });
  assert.equal(r.upserts.length, 0, 'target row keeps as-is, no rewrite');
  assert.equal(r.deletes.length, 1);
  assert.equal(r.deletes[0].id, `3:${SRC}`);
});

test('planDailyMerge: overlap + primary=source rewrites target with source data, deletes source row', () => {
  const r = planDailyMerge({
    targetRows: [{ puzzleId: 3, deviceId: TGT, foundCodes: ['gb'], id: `3:${TGT}` }],
    sourceRows: [{ puzzleId: 3, deviceId: SRC, foundCodes: ['de', 'fr', 'it'], id: `3:${SRC}` }],
    targetDeviceId: TGT, sourceDeviceId: SRC, primary: 'source',
  });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.id, `3:${TGT}`);
  assert.equal(r.upserts[0].doc.deviceId, TGT);
  assert.deepEqual(r.upserts[0].doc.foundCodes, ['de', 'fr', 'it']);
  assert.equal(r.deletes.length, 1);
  assert.equal(r.deletes[0].id, `3:${SRC}`);
});

test('planDailyMerge: Jan example — dev1[1,2,3,4] + dev2[3,4,5,6], primary=dev1, result is 1..4 from dev1 + 5,6 from dev2', () => {
  const targetRows = [1, 2, 3, 4].map((p) => ({ puzzleId: p, deviceId: TGT, foundCodes: ['t'], id: `${p}:${TGT}` }));
  const sourceRows = [3, 4, 5, 6].map((p) => ({ puzzleId: p, deviceId: SRC, foundCodes: ['s'], id: `${p}:${SRC}` }));
  const r = planDailyMerge({ targetRows, sourceRows, targetDeviceId: TGT, sourceDeviceId: SRC, primary: 'target' });
  // Transfers only the non-overlap rows (5, 6) with target deviceId.
  const transferred = r.upserts.map((u) => u.doc.puzzleId).sort((a, b) => a - b);
  assert.deepEqual(transferred, [5, 6]);
  for (const u of r.upserts) {
    assert.equal(u.doc.deviceId, TGT);
    // source's foundCodes are preserved on the transferred non-overlap
    assert.deepEqual(u.doc.foundCodes, ['s']);
  }
  // All four source rows get deleted (overlap rows + transferred rows)
  const deletedIds = r.deletes.map((d) => d.id).sort();
  assert.deepEqual(deletedIds, [`3:${SRC}`, `4:${SRC}`, `5:${SRC}`, `6:${SRC}`]);
});

test('planDailyMerge: strips Cosmos system fields from transferred rows', () => {
  const r = planDailyMerge({
    targetRows: [],
    sourceRows: [{ puzzleId: 1, deviceId: SRC, foundCodes: ['gb'], id: `1:${SRC}`, _rid: 'r', _etag: 'e', _ts: 1 }],
    targetDeviceId: TGT, sourceDeviceId: SRC, primary: 'target',
  });
  assert.equal(r.upserts.length, 1);
  for (const k of ['_rid', '_etag', '_ts']) {
    assert.equal(k in r.upserts[0].doc, false, `${k} not stripped`);
  }
});

// ---- inferLowerWins / pickBetterEntry -----------------------------------

test('inferLowerWins: "all" mode = lower wins (count of mistakes); "60s" = higher (timed score)', () => {
  assert.equal(inferLowerWins('countries:all:sov'), true);
  assert.equal(inferLowerWins('europe:60s:sov'), false);
  assert.equal(inferLowerWins('africa:90s:sov'), false);
});

test('pickBetterEntry: higher-wins picks larger score, tied breaks on faster time', () => {
  const a = { score: 5, durationMs: 10_000 };
  const b = { score: 7, durationMs: 12_000 };
  assert.equal(pickBetterEntry(a, b, false), b);
  const c = { score: 5, durationMs: 8_000 };
  assert.equal(pickBetterEntry(a, c, false), c);
});

test('pickBetterEntry: lower-wins picks smaller score', () => {
  const a = { score: 3, durationMs: 10_000 };
  const b = { score: 7, durationMs: 5_000 };
  assert.equal(pickBetterEntry(a, b, true), a);
});

// ---- planQuizMerge ------------------------------------------------------

test('planQuizMerge: target alone — no source row → no upsert, no delete', () => {
  const targetRow = { id: TGT, deviceId: TGT, records: { 'europe:60s:sov': { score: 5, durationMs: 1000, attempts: 1, lastPlayedAt: 100 } }, updatedAt: 100 };
  const r = planQuizMerge({ targetRow, sourceRow: null, targetDeviceId: TGT, sourceDeviceId: SRC, now: NOW });
  assert.equal(r.upserts.length, 0);
  assert.equal(r.deletes.length, 0);
});

test('planQuizMerge: source alone — its records become target row, source row deleted', () => {
  const sourceRow = { id: SRC, deviceId: SRC, records: { 'europe:60s:sov': { score: 5, durationMs: 1000, attempts: 2, lastPlayedAt: 200 } }, updatedAt: 200 };
  const r = planQuizMerge({ targetRow: null, sourceRow, targetDeviceId: TGT, sourceDeviceId: SRC, now: NOW });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.id, TGT);
  assert.equal(r.upserts[0].doc.deviceId, TGT);
  const rec = /** @type {any} */ (r.upserts[0].doc.records)['europe:60s:sov'];
  assert.equal(rec.score, 5);
  assert.equal(rec.attempts, 2);
  assert.equal(r.deletes.length, 1);
  assert.deepEqual(r.deletes[0], { container: 'quizRecords', partitionKey: SRC, id: SRC });
});

test('planQuizMerge: per configKey better PB wins, attempts sum, latest lastPlayedAt wins', () => {
  const targetRow = {
    id: TGT, deviceId: TGT,
    records: {
      'europe:60s:sov': { score: 10, durationMs: 30_000, attempts: 3, lastPlayedAt: 100 },
      'africa:all:sov': { score: 5, durationMs: 60_000, attempts: 2, lastPlayedAt: 200 },
    },
  };
  const sourceRow = {
    id: SRC, deviceId: SRC,
    records: {
      'europe:60s:sov': { score: 15, durationMs: 25_000, attempts: 5, lastPlayedAt: 300 }, // higher score → wins
      'africa:all:sov': { score: 8, durationMs: 50_000, attempts: 1, lastPlayedAt: 50 },   // higher mistakes → loses
      'asia:60s:sov':   { score: 7, durationMs: 20_000, attempts: 4, lastPlayedAt: 400 },  // only in source → transfer
    },
  };
  const r = planQuizMerge({ targetRow, sourceRow, targetDeviceId: TGT, sourceDeviceId: SRC, now: NOW });
  assert.equal(r.upserts.length, 1);
  const records = /** @type {any} */ (r.upserts[0].doc.records);
  assert.equal(records['europe:60s:sov'].score, 15);
  assert.equal(records['europe:60s:sov'].attempts, 8); // 3 + 5
  assert.equal(records['europe:60s:sov'].lastPlayedAt, 300);
  assert.equal(records['africa:all:sov'].score, 5);    // target wins (lower mistakes)
  assert.equal(records['africa:all:sov'].attempts, 3); // 2 + 1
  assert.equal(records['africa:all:sov'].lastPlayedAt, 200);
  assert.equal(records['asia:60s:sov'].score, 7);
  assert.equal(records['asia:60s:sov'].attempts, 4);
});

// ---- planTttMerge -------------------------------------------------------

test('planTttMerge: new opponent in source → row transferred with target deviceId', () => {
  const sourceRows = [{
    id: `${SRC}:opp-1`, deviceId: SRC, opponentId: 'opp-1',
    m3x3: { wins: 2, losses: 1, draws: 0 }, m9x9: { wins: 0, losses: 0, draws: 0 },
    lastOutcome: 'win', lastPlayedAt: 500, v: 1,
  }];
  const r = planTttMerge({ targetRows: [], sourceRows, targetDeviceId: TGT, sourceDeviceId: SRC });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.id, `${TGT}:opp-1`);
  assert.equal(r.upserts[0].doc.deviceId, TGT);
  assert.equal(r.upserts[0].doc.m3x3.wins, 2);
  assert.equal(r.deletes.length, 1);
  assert.equal(r.deletes[0].id, `${SRC}:opp-1`);
});

test('planTttMerge: overlapping opponent — counters sum, newer lastPlayedAt + outcome wins', () => {
  const targetRows = [{
    id: `${TGT}:opp-1`, deviceId: TGT, opponentId: 'opp-1',
    m3x3: { wins: 3, losses: 1, draws: 0 }, m9x9: { wins: 1, losses: 0, draws: 1 },
    lastOutcome: 'win', lastPlayedAt: 1000, v: 1,
  }];
  const sourceRows = [{
    id: `${SRC}:opp-1`, deviceId: SRC, opponentId: 'opp-1',
    m3x3: { wins: 2, losses: 4, draws: 1 }, m9x9: { wins: 0, losses: 1, draws: 0 },
    lastOutcome: 'loss', lastPlayedAt: 2000, v: 1,
  }];
  const r = planTttMerge({ targetRows, sourceRows, targetDeviceId: TGT, sourceDeviceId: SRC });
  assert.equal(r.upserts.length, 1);
  const m3 = /** @type {any} */ (r.upserts[0].doc.m3x3);
  assert.equal(m3.wins, 5);
  assert.equal(m3.losses, 5);
  assert.equal(m3.draws, 1);
  const m9 = /** @type {any} */ (r.upserts[0].doc.m9x9);
  assert.equal(m9.wins, 1);
  assert.equal(m9.losses, 1);
  assert.equal(m9.draws, 1);
  assert.equal(r.upserts[0].doc.lastOutcome, 'loss', 'newer wins on outcome');
  assert.equal(r.upserts[0].doc.lastPlayedAt, 2000);
});

// ---- planEventsMerge ---------------------------------------------------

test('planEventsMerge: source events transfer to target partition, target dedupes by id', () => {
  const targetRows = [{ id: 'daily_start:20619:5', deviceId: TGT, kind: 'daily_start', dayId: 20619, occurredAt: 1, payload: { puzzleId: 5 }, v: 1 }];
  const sourceRows = [
    { id: 'daily_start:20619:5', deviceId: SRC, kind: 'daily_start', dayId: 20619, occurredAt: 2, payload: { puzzleId: 5 }, v: 1 }, // dup id — should NOT transfer
    { id: 'share:abc', deviceId: SRC, kind: 'share', dayId: 20619, occurredAt: 3, payload: { surface: 'daily', contextHint: '5' }, v: 1 }, // unique — transfer
  ];
  const r = planEventsMerge({ targetRows, sourceRows, targetDeviceId: TGT, sourceDeviceId: SRC });
  // Only `share:abc` transferred; daily_start:20619:5 already in target.
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.id, 'share:abc');
  assert.equal(r.upserts[0].doc.deviceId, TGT);
  // Both source rows deleted regardless (we never want source partition to keep them).
  assert.equal(r.deletes.length, 2);
});

// ---- planProfileMerge --------------------------------------------------

test('planProfileMerge: no source row, target unchanged nickname → still upserts to stamp linkedAt', () => {
  // Pre-link-marker behaviour was "no-op when nothing material to merge".
  // Post-marker we always upsert so the target row carries `linkedAt: now`,
  // which is how the QR-shower device discovers that it was claimed.
  const r = planProfileMerge({
    targetRow: { id: TGT, deviceId: TGT, nickname: 'Alice', updatedAt: 100 },
    sourceRow: null, targetDeviceId: TGT, sourceDeviceId: SRC, nicknameChoice: 'target', now: NOW,
  });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.nickname, 'Alice');
  assert.equal(r.upserts[0].doc.linkedAt, NOW);
  assert.equal(r.deletes.length, 0);
});

test('planProfileMerge: source has nickname, target does not → transfer to target with linkedAt', () => {
  const r = planProfileMerge({
    targetRow: null,
    sourceRow: { id: SRC, deviceId: SRC, nickname: 'Bob', updatedAt: 200 },
    targetDeviceId: TGT, sourceDeviceId: SRC, nicknameChoice: 'target', now: NOW,
  });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.nickname, 'Bob');
  assert.equal(r.upserts[0].doc.id, TGT);
  assert.equal(r.upserts[0].doc.deviceId, TGT);
  assert.equal(r.upserts[0].doc.linkedAt, NOW);
  assert.equal(r.deletes.length, 1);
  assert.equal(r.deletes[0].id, SRC);
});

test('planProfileMerge: both have nickname, choice=target → target wins, source deleted, linkedAt stamped', () => {
  const r = planProfileMerge({
    targetRow: { id: TGT, deviceId: TGT, nickname: 'Alice' },
    sourceRow: { id: SRC, deviceId: SRC, nickname: 'Bob' },
    targetDeviceId: TGT, sourceDeviceId: SRC, nicknameChoice: 'target', now: NOW,
  });
  assert.equal(r.upserts.length, 1, 'always upsert target — even with unchanged nickname — so linkedAt lands');
  assert.equal(r.upserts[0].doc.nickname, 'Alice');
  assert.equal(r.upserts[0].doc.linkedAt, NOW);
  assert.equal(r.deletes.length, 1);
});

test('planProfileMerge: both have nickname, choice=source → target rewritten with source nickname + linkedAt', () => {
  const r = planProfileMerge({
    targetRow: { id: TGT, deviceId: TGT, nickname: 'Alice' },
    sourceRow: { id: SRC, deviceId: SRC, nickname: 'Bob' },
    targetDeviceId: TGT, sourceDeviceId: SRC, nicknameChoice: 'source', now: NOW,
  });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.nickname, 'Bob');
  assert.equal(r.upserts[0].doc.id, TGT);
  assert.equal(r.upserts[0].doc.linkedAt, NOW);
  assert.equal(r.deletes.length, 1);
});

test('planProfileMerge: neither row exists → still upserts a barebones target row with linkedAt', () => {
  // Two never-played-before devices can still link. The target needs a
  // profile row anyway so its sync page learns about the link, even
  // though both sides have nickname: null.
  const r = planProfileMerge({
    targetRow: null, sourceRow: null,
    targetDeviceId: TGT, sourceDeviceId: SRC, nicknameChoice: 'target', now: NOW,
  });
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].doc.nickname, null);
  assert.equal(r.upserts[0].doc.linkedAt, NOW);
  assert.equal(r.upserts[0].doc.createdAt, NOW);
  assert.equal(r.deletes.length, 0);
});

// ---- detectProfileConflict ---------------------------------------------

test('detectProfileConflict: returns null when nicknames match or one is missing', () => {
  assert.equal(detectProfileConflict({ targetRow: { nickname: 'Alice' }, sourceRow: { nickname: 'Alice' } }), null);
  assert.equal(detectProfileConflict({ targetRow: { nickname: 'Alice' }, sourceRow: null }), null);
  assert.equal(detectProfileConflict({ targetRow: null, sourceRow: { nickname: 'Bob' } }), null);
});

test('detectProfileConflict: returns the two names when they differ', () => {
  const r = detectProfileConflict({
    targetRow: { nickname: 'Alice' },
    sourceRow: { nickname: 'Bob' },
  });
  assert.deepEqual(r, { target: 'Alice', source: 'Bob' });
});
