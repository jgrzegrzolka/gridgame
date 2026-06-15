/**
 * Compute streak / win-% numbers from a player's daily-puzzle history.
 *
 * Inputs are puzzle-completion rows; outputs are the five numbers the
 * finish screen and profile page surface. Pure: no DOM, no clock, no
 * Cosmos client. Caller decides what counts as `completed` (today every
 * `dailyResults` row counts; if a future definition emerges — e.g.
 * score ≥ threshold — the caller filters before calling).
 *
 * Streak semantics:
 *   - A "streak" is a run of consecutive puzzleIds with `completed:true`
 *     and no gap in puzzleId between them. Puzzles are integers
 *     released one per day, so a gap == a missed day.
 *   - `currentStreak` is the trailing run ending at the most recent row.
 *     If `latestPuzzleId` is supplied and the most recent row's id is
 *     less than it, the streak resets to 0 (the player missed today and
 *     possibly more — they need to play to count again).
 *   - A `completed:false` row breaks the streak the same way a missing
 *     puzzleId does. (Today there's no source of `completed:false` rows
 *     — `dailyResults` only records finishes — but the shape is honest
 *     for a future "played but didn't finish" signal from Feature M.)
 *
 * Win definition is "completion = win" (decision settled in FEATURE.md
 * Feature N). `winPercent` is integer-rounded; callers wanting decimals
 * can recompute from `totalCompleted / totalPlayed`.
 */

/**
 * @typedef {{ puzzleId: number, completed: boolean }} StreakRow
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
 * @param {{ rows: StreakRow[], latestPuzzleId?: number }} args
 * @returns {StreakResult}
 */
export function computeStreak({ rows, latestPuzzleId }) {
  if (!rows || rows.length === 0) return { ...EMPTY };

  const sorted = [...rows].sort((a, b) => a.puzzleId - b.puzzleId);

  const totalPlayed = sorted.length;
  const totalCompleted = sorted.reduce((n, r) => n + (r.completed ? 1 : 0), 0);
  const winPercent = Math.round((totalCompleted / totalPlayed) * 100);

  let maxStreak = 0;
  let run = 0;
  let prevId = null;
  for (const row of sorted) {
    if (!row.completed) {
      run = 0;
      prevId = row.puzzleId;
      continue;
    }
    run = prevId !== null && row.puzzleId === prevId + 1 ? run + 1 : 1;
    if (run > maxStreak) maxStreak = run;
    prevId = row.puzzleId;
  }

  const last = sorted[sorted.length - 1];
  let currentStreak = 0;
  const missedLatest =
    latestPuzzleId !== undefined && last.puzzleId < latestPuzzleId;
  if (!missedLatest && last.completed) {
    currentStreak = 1;
    let expectedId = last.puzzleId - 1;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const row = sorted[i];
      if (row.puzzleId !== expectedId || !row.completed) break;
      currentStreak += 1;
      expectedId -= 1;
    }
  }

  return { currentStreak, maxStreak, winPercent, totalPlayed, totalCompleted };
}
