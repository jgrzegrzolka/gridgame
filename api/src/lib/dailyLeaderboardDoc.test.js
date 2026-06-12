const test = require('node:test');
const assert = require('node:assert/strict');

const {
  todayDateKey,
  makePk,
  buildDailyLeaderboardDoc,
  mergeDailyLeaderboard,
} = require('./dailyLeaderboardDoc');

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
// 2026-06-12T10:30:00Z → date key 2026-06-12 regardless of caller timezone
const NOW = Date.UTC(2026, 5, 12, 10, 30, 0);

test('todayDateKey: returns UTC YYYY-MM-DD for the given unix ms', () => {
  assert.equal(todayDateKey(NOW), '2026-06-12');
});

test('todayDateKey: handles UTC midnight boundary (just before midnight = previous day)', () => {
  const just_before_midnight = Date.UTC(2026, 5, 12, 23, 59, 59);
  const just_after_midnight = Date.UTC(2026, 5, 13, 0, 0, 1);
  assert.equal(todayDateKey(just_before_midnight), '2026-06-12');
  assert.equal(todayDateKey(just_after_midnight), '2026-06-13');
});

test('makePk: joins configKey + dateKey with a pipe', () => {
  assert.equal(makePk('europe:60s:sov', '2026-06-12'), 'europe:60s:sov|2026-06-12');
});

test('buildDailyLeaderboardDoc: includes all required fields and v: 1', () => {
  const doc = buildDailyLeaderboardDoc({
    deviceId: DEVICE,
    configKey: 'europe:60s:sov',
    dateKey: '2026-06-12',
    nickname: 'Alice',
    entry: { score: 18, durationMs: 32_400 },
    now: NOW,
  });
  assert.equal(doc.id, DEVICE);
  assert.equal(doc.pk, 'europe:60s:sov|2026-06-12');
  assert.equal(doc.deviceId, DEVICE);
  assert.equal(doc.configKey, 'europe:60s:sov');
  assert.equal(doc.date, '2026-06-12');
  assert.equal(doc.nickname, 'Alice');
  assert.equal(doc.score, 18);
  assert.equal(doc.durationMs, 32_400);
  assert.equal(doc.submittedAt, NOW);
  assert.equal(doc.v, 1);
});

test('buildDailyLeaderboardDoc: null nickname stays null', () => {
  const doc = buildDailyLeaderboardDoc({
    deviceId: DEVICE, configKey: 'europe:60s:sov', dateKey: '2026-06-12',
    nickname: null, entry: { score: 10, durationMs: 60_000 }, now: NOW,
  });
  assert.equal(doc.nickname, null);
});

test('buildDailyLeaderboardDoc: undefined nickname normalises to null (not stored as undefined)', () => {
  const doc = buildDailyLeaderboardDoc({
    deviceId: DEVICE, configKey: 'europe:60s:sov', dateKey: '2026-06-12',
    nickname: /** @type {any} */ (undefined),
    entry: { score: 10, durationMs: 60_000 }, now: NOW,
  });
  assert.equal(doc.nickname, null);
});

test('mergeDailyLeaderboard: no existing row → changed=true, fresh doc returned', () => {
  const out = mergeDailyLeaderboard({
    existing: null, deviceId: DEVICE, configKey: 'europe:60s:sov',
    dateKey: '2026-06-12', nickname: 'Alice',
    entry: { score: 12, durationMs: 60_000 }, lowerWins: false, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.ok(out.doc);
  assert.equal(out.doc.score, 12);
  assert.equal(out.doc.nickname, 'Alice');
});

test('mergeDailyLeaderboard: timed mode (higherWins) — better score replaces incumbent', () => {
  const out = mergeDailyLeaderboard({
    existing: { score: 10, durationMs: 60_000 },
    deviceId: DEVICE, configKey: 'europe:60s:sov',
    dateKey: '2026-06-12', nickname: 'Alice',
    entry: { score: 11, durationMs: 60_000 },
    lowerWins: false, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.equal(out.doc.score, 11);
});

test('mergeDailyLeaderboard: timed mode — worse score does NOT replace incumbent', () => {
  const out = mergeDailyLeaderboard({
    existing: { score: 10, durationMs: 60_000 },
    deviceId: DEVICE, configKey: 'europe:60s:sov',
    dateKey: '2026-06-12', nickname: 'Alice',
    entry: { score: 9, durationMs: 30_000 },
    lowerWins: false, now: NOW,
  });
  assert.equal(out.changed, false);
  assert.equal(out.doc, undefined);
});

test('mergeDailyLeaderboard: count mode (lowerWins) — fewer mistakes replaces incumbent', () => {
  const out = mergeDailyLeaderboard({
    existing: { score: 5, durationMs: 90_000 },
    deviceId: DEVICE, configKey: 'europe:all:sov',
    dateKey: '2026-06-12', nickname: 'Bob',
    entry: { score: 4, durationMs: 100_000 },
    lowerWins: true, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.equal(out.doc.score, 4);
});

test('mergeDailyLeaderboard: endurance mode tiebreak — equal mistakes, faster duration wins', () => {
  const out = mergeDailyLeaderboard({
    existing: { score: 4, durationMs: 100_000 },
    deviceId: DEVICE, configKey: 'europe:all:sov',
    dateKey: '2026-06-12', nickname: 'Bob',
    entry: { score: 4, durationMs: 90_000 },
    lowerWins: true, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.equal(out.doc.durationMs, 90_000);
});

test('mergeDailyLeaderboard: tiebreak — equal score, faster duration wins', () => {
  const out = mergeDailyLeaderboard({
    existing: { score: 10, durationMs: 60_000 },
    deviceId: DEVICE, configKey: 'europe:60s:sov',
    dateKey: '2026-06-12', nickname: 'Alice',
    entry: { score: 10, durationMs: 55_000 },
    lowerWins: false, now: NOW,
  });
  assert.equal(out.changed, true);
  assert.equal(out.doc.durationMs, 55_000);
});

test('mergeDailyLeaderboard: equal score + equal duration → not changed', () => {
  const out = mergeDailyLeaderboard({
    existing: { score: 10, durationMs: 60_000 },
    deviceId: DEVICE, configKey: 'europe:60s:sov',
    dateKey: '2026-06-12', nickname: 'Alice',
    entry: { score: 10, durationMs: 60_000 },
    lowerWins: false, now: NOW,
  });
  assert.equal(out.changed, false);
});
