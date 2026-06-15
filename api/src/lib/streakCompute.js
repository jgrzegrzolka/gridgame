/**
 * Compute streak / win-% numbers from a sequence of completion events
 * keyed by a consecutivity axis (today: Warsaw day-number).
 *
 * Inputs are `{id, completed}` rows where `id` is any integer key on
 * which "consecutive = no break" applies. The caller decides the
 * meaning: for daily streaks the caller passes Warsaw day-numbers
 * (one row per day the player submitted something), so the streak
 * counts consecutive *days*, not consecutive puzzleIds. Doing
 * archive puzzles #1, #2, #3 in one sitting is one day → streak 1.
 *
 * Pure: no DOM, no clock, no Cosmos client. The day-conversion +
 * dedupe lives in `submissionsToStreakRows` so the streak math stays
 * independent of the calendar semantics.
 *
 * Streak semantics:
 *   - A "streak" is a run of consecutive `id`s with `completed:true`
 *     and no gap between them.
 *   - `currentStreak` is the trailing run ending at the most recent
 *     row. If `latestId` is supplied and the most recent row's id is
 *     less than it, the streak resets to 0 (player skipped at least
 *     the latest day — they need to play to count again).
 *   - A `completed:false` row breaks the streak the same way a
 *     missing id does. (Today no source produces such rows;
 *     submissionsToStreakRows always emits `completed:true`. The
 *     shape stays open for a future Feature M start-event signal.)
 *
 * Win definition is "completion = win" (FEATURE.md Feature N).
 * `winPercent` is integer-rounded; callers wanting decimals recompute
 * from `totalCompleted / totalPlayed`.
 *
 * Lives in api/src/lib/ — every caller is server-side. The endpoint
 * computes, the frontend just renders.
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
function computeStreak({ rows, latestId }) {
  if (!rows || rows.length === 0) return { ...EMPTY };

  const sorted = [...rows].sort((a, b) => a.id - b.id);

  const totalPlayed = sorted.length;
  const totalCompleted = sorted.reduce((n, r) => n + (r.completed ? 1 : 0), 0);
  const winPercent = Math.round((totalCompleted / totalPlayed) * 100);

  let maxStreak = 0;
  let run = 0;
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
 * Map a list of submission docs (subset of `dailyResults` rows with
 * `submittedAt`) to deduped streak rows. Multiple submissions on the
 * same calendar day collapse to one row — the streak counts days the
 * player showed up, not how many puzzles they fired off in a sitting.
 *
 * `dayFn` is injected (typically `warsawDayNumber`) so tests don't
 * depend on the system timezone.
 *
 * Rows with a non-numeric / NaN `submittedAt` are dropped — a future
 * pre-v:1 row without the field shouldn't crash the read path. Real
 * rows from `buildDailyResultDoc` always have a valid value.
 *
 * @param {Array<{ submittedAt?: unknown }>} docs
 * @param {(ms: number) => number | null} dayFn
 * @returns {StreakRow[]}
 */
function submissionsToStreakRows(docs, dayFn) {
  const days = new Set();
  for (const doc of docs) {
    if (typeof doc?.submittedAt !== 'number') continue;
    const day = dayFn(doc.submittedAt);
    if (day === null) continue;
    days.add(day);
  }
  return Array.from(days)
    .sort((a, b) => a - b)
    .map((id) => ({ id, completed: true }));
}

module.exports = { computeStreak, submissionsToStreakRows };
