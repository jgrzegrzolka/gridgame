import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  primeAchievementsBaseline,
  refreshAchievementsAndDiff,
  getCachedAchievementsBaseline,
  __resetAchievementsBaselineForTest,
} from './achievementsBaseline.js';

// achievementsBaseline.js imports fetchDailyMe from daily/streakClient.js,
// which calls globalThis.fetch. Tests inject a fake.
/** @param {typeof fetch} impl */
function withFakeFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

/** @param {Record<string, unknown>} body */
function fakeJsonResponse(body) {
  return /** @type {any} */ ({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

const ZERO_SNAP = {
  currentStreak: 0, maxStreak: 0, winPercent: 0, totalPlayed: 0, totalCompleted: 0,
};

test('refreshAndDiff returns [] when prime never called', async () => {
  __resetAchievementsBaselineForTest();
  const restore = withFakeFetch(async () => fakeJsonResponse({ ...ZERO_SNAP, totalCompleted: 1 }));
  try {
    // Skip the prime — refresh should silently return [] even though
    // the fetch would have shown new achievements.
    const newly = await refreshAchievementsAndDiff('dev-abc');
    assert.deepEqual(newly, []);
  } finally {
    restore();
  }
});

test('prime + refresh fires the cards that actually crossed thresholds (returning player not flooded)', async () => {
  __resetAchievementsBaselineForTest();
  // Baseline: returning player who already has First Daily.
  const baseline = { ...ZERO_SNAP, totalCompleted: 1 };
  // After action: same, plus a daily-habit cross (7-day streak).
  const after = { ...ZERO_SNAP, totalCompleted: 8, maxStreak: 7 };
  let call = 0;
  const restore = withFakeFetch(async () => {
    call++;
    return fakeJsonResponse(call === 1 ? baseline : after);
  });
  try {
    primeAchievementsBaseline('dev-abc');
    // Drain the boot prefetch then run the post-action diff.
    const newly = await refreshAchievementsAndDiff('dev-abc');
    // First Daily was already earned in the baseline → not in the diff.
    // Daily Habit crossed → in the diff.
    const ids = newly.map((r) => r.id).sort();
    assert.ok(!ids.includes('first-daily'), `first-daily must NOT re-fire: got ${ids.join(', ')}`);
    assert.ok(ids.includes('daily-habit'), `daily-habit must fire: got ${ids.join(', ')}`);
  } finally {
    restore();
  }
});

test('two refreshes in sequence: each only reports its own delta (baseline advances)', async () => {
  __resetAchievementsBaselineForTest();
  const snap0 = { ...ZERO_SNAP };
  const snap1 = { ...ZERO_SNAP, totalCompleted: 1 };                   // First Daily
  const snap2 = { ...ZERO_SNAP, totalCompleted: 8, maxStreak: 7 };     // + Daily Habit
  let call = 0;
  const restore = withFakeFetch(async () => {
    call++;
    if (call === 1) return fakeJsonResponse(snap0);
    if (call === 2) return fakeJsonResponse(snap1);
    return fakeJsonResponse(snap2);
  });
  try {
    primeAchievementsBaseline('dev-abc');
    const first = await refreshAchievementsAndDiff('dev-abc');
    const second = await refreshAchievementsAndDiff('dev-abc');
    assert.deepEqual(first.map((r) => r.id), ['first-daily']);
    assert.deepEqual(second.map((r) => r.id), ['daily-habit']);
  } finally {
    restore();
  }
});

test('refreshAndDiff returns [] when bypass fetch fails (silent degrade)', async () => {
  __resetAchievementsBaselineForTest();
  let call = 0;
  const restore = withFakeFetch(async () => {
    call++;
    if (call === 1) return fakeJsonResponse(ZERO_SNAP);
    // post-action fetch fails
    return /** @type {any} */ ({ ok: false, status: 500, json: async () => ({}) });
  });
  try {
    primeAchievementsBaseline('dev-abc');
    const newly = await refreshAchievementsAndDiff('dev-abc');
    assert.deepEqual(newly, []);
  } finally {
    restore();
  }
});

// ---- degraded ("partial") snapshots ----
//
// `/api/v1/daily/me` soft-degrades: if the profiles or tttPairs read
// fails, it still answers 200 with `hasNickname: false`, `hasWonTtt:
// false`, `tttGamesPlayed: 0` — indistinguishable from a player who
// genuinely has none of it. Baselining on that and then diffing against
// a healthy read reports every already-earned rule as newly earned.
//
// That is not hypothetical: a 60s-quiz give-up scoring 0 popped five
// cards at once — Identified, Matrix, First TTT Win, First TTT Loss,
// Ten TTT Games — which is exactly the set fed by those two reads, and
// includes a pair (first win + first loss) that cannot both be earned
// by one event. The server now marks such a snapshot `partial: true`;
// these tests pin that the client treats it as "unknown", not "not
// earned".

/** A player who has long since earned the profile + TTT rules. */
const EARNED_SNAP = {
  ...ZERO_SNAP,
  hasNickname: true,
  hasLinkedDevice: true,
  hasWonTtt: true,
  hasLostTtt: true,
  tttGamesPlayed: 14,
};

/** The same player, as seen through a failed profiles + tttPairs read. */
const DEGRADED_SNAP = { ...ZERO_SNAP, partial: true };

test('partial baseline does not flood: a degraded boot snapshot is not a diff axis', async () => {
  __resetAchievementsBaselineForTest();
  let call = 0;
  const restore = withFakeFetch(async () => {
    call++;
    // Boot read degraded, post-action read healthy — the exact shape of
    // the five-card incident.
    return fakeJsonResponse(call === 1 ? DEGRADED_SNAP : EARNED_SNAP);
  });
  try {
    primeAchievementsBaseline('dev-abc');
    const newly = await refreshAchievementsAndDiff('dev-abc');
    assert.deepEqual(
      newly.map((r) => r.id),
      [],
      'already-earned rules must not re-fire off a degraded baseline',
    );
  } finally {
    restore();
  }
});

test('partial fresh snapshot is not diffed, and does not poison the baseline', async () => {
  __resetAchievementsBaselineForTest();
  let call = 0;
  const restore = withFakeFetch(async () => {
    call++;
    if (call === 1) return fakeJsonResponse(EARNED_SNAP);      // healthy boot
    if (call === 2) return fakeJsonResponse(DEGRADED_SNAP);    // degraded action
    return fakeJsonResponse(EARNED_SNAP);                      // healthy action
  });
  try {
    primeAchievementsBaseline('dev-abc');
    const degraded = await refreshAchievementsAndDiff('dev-abc');
    assert.deepEqual(degraded, [], 'a degraded fresh read reports nothing');
    // If the degraded snapshot had replaced the baseline, this second
    // refresh would see false -> true on all five and flood.
    const after = await refreshAchievementsAndDiff('dev-abc');
    assert.deepEqual(
      after.map((r) => r.id),
      [],
      'the degraded read must not become the axis the next action diffs against',
    );
  } finally {
    restore();
  }
});

test('a real cross still fires when both snapshots are healthy', async () => {
  __resetAchievementsBaselineForTest();
  let call = 0;
  const restore = withFakeFetch(async () => {
    call++;
    return fakeJsonResponse(
      call === 1 ? EARNED_SNAP : { ...EARNED_SNAP, totalCompleted: 1 },
    );
  });
  try {
    primeAchievementsBaseline('dev-abc');
    const newly = await refreshAchievementsAndDiff('dev-abc');
    assert.deepEqual(newly.map((r) => r.id), ['first-daily']);
  } finally {
    restore();
  }
});

test('the display snapshot still refreshes even when the baseline is unusable', async () => {
  // daily/page.js repaints its streak line from
  // getCachedAchievementsBaseline() right after the diff. A degraded
  // boot read must not cost it that repaint.
  __resetAchievementsBaselineForTest();
  let call = 0;
  const restore = withFakeFetch(async () => {
    call++;
    return fakeJsonResponse(
      call === 1 ? DEGRADED_SNAP : { ...EARNED_SNAP, currentStreak: 5 },
    );
  });
  try {
    primeAchievementsBaseline('dev-abc');
    await refreshAchievementsAndDiff('dev-abc');
    const snap = getCachedAchievementsBaseline();
    assert.equal(snap?.currentStreak, 5, 'latest snapshot must reach display consumers');
  } finally {
    restore();
  }
});

test('prime is idempotent — two calls do not double-fetch', async () => {
  __resetAchievementsBaselineForTest();
  let fetchCount = 0;
  const restore = withFakeFetch(async () => {
    fetchCount++;
    // Hold the response so both prime calls can happen first.
    return fakeJsonResponse(ZERO_SNAP);
  });
  try {
    primeAchievementsBaseline('dev-abc');
    primeAchievementsBaseline('dev-abc');
    // Wait for boot to settle.
    await refreshAchievementsAndDiff('dev-abc'); // forces drain of inflight
    assert.equal(fetchCount, 2, `boot + first refresh = 2 fetches; got ${fetchCount}`);
  } finally {
    restore();
  }
});
