/**
 * Client-side mirror of `api/src/lib/streakCompute.js` — the pure
 * streak math used to derive `quiz60sCurrentStreak`/`MaxStreak`/
 * `DistinctDays` from the local day log.
 *
 * Feature S Phase 4.5 moved engagement-snapshot derivation from the
 * server (`dailyMe` reading `syncBlob.engagement`) to the client
 * (`flags/engagementSnapshot.js` reading `engagementCounters`'s
 * localStorage state). The streak math has to follow — server compute
 * stays for daily-puzzle streaks (sourced from `dailyResults`, which
 * the client doesn't mirror).
 *
 * Why duplicate the server impl: server is CommonJS (api/), client is
 * ESM (flags/). Cross-runtime imports across that boundary aren't
 * worth the build complexity for a pure function. The two copies
 * must stay in sync — `flags/streakCompute.test.js` mirrors the
 * server's expected-output tests so drift fails CI.
 */

/**
 * @typedef {{ id: number, completed: boolean }} StreakRow
 * @typedef {{
 *   currentStreak: number,
 *   maxStreak: number,
 *   winPercent: number,
 *   totalPlayed: number,
 *   totalCompleted: number,
 * }} StreakResult
 */

/** @type {StreakResult} */
const EMPTY = {
  currentStreak: 0,
  maxStreak: 0,
  winPercent: 0,
  totalPlayed: 0,
  totalCompleted: 0,
};

/**
 * @param {{ rows: StreakRow[], latestId?: number }} args
 * @returns {StreakResult}
 */
export function computeStreak({ rows, latestId }) {
  if (!rows || rows.length === 0) return { ...EMPTY };

  const sorted = [...rows].sort((a, b) => a.id - b.id);

  const totalPlayed = sorted.length;
  const totalCompleted = sorted.reduce((n, r) => n + (r.completed ? 1 : 0), 0);
  const winPercent = Math.round((totalCompleted / totalPlayed) * 100);

  let maxStreak = 0;
  let run = 0;
  /** @type {number | null} */
  let prevId = null;
  for (const row of sorted) {
    if (!row.completed) {
      run = 0;
      prevId = row.id;
      continue;
    }
    run = prevId !== null && row.id === prevId + 1 ? run + 1 : 1;
    if (run > maxStreak) maxStreak = run;
    prevId = row.id;
  }

  const last = sorted[sorted.length - 1];
  let currentStreak = 0;
  const missedLatest = latestId !== undefined && last.id < latestId;
  if (!missedLatest && last.completed) {
    currentStreak = 1;
    let expectedId = last.id - 1;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const row = sorted[i];
      if (row.id !== expectedId || !row.completed) break;
      currentStreak += 1;
      expectedId -= 1;
    }
  }

  return { currentStreak, maxStreak, winPercent, totalPlayed, totalCompleted };
}

/**
 * Map a quiz-mode day log (the sorted+deduped number[] kept in
 * `engagementCounters`'s localStorage state) to streak rows. Defensive
 * against hand-edited / future-shape state — non-integer or negative
 * entries are silently dropped.
 *
 * @param {unknown} log
 * @returns {StreakRow[]}
 */
export function dayLogToStreakRows(log) {
  if (!Array.isArray(log)) return [];
  const days = new Set();
  for (const n of log) {
    if (Number.isInteger(n) && /** @type {number} */ (n) >= 0) days.add(n);
  }
  return Array.from(days)
    .sort((a, b) => a - b)
    .map((id) => ({ id, completed: true }));
}
