/**
 * Map a unix-ms timestamp to an integer "Warsaw day number" — days
 * since epoch as seen from Europe/Warsaw. DST-safe via
 * Intl.DateTimeFormat (CET/CEST transitions handled automatically).
 *
 * Used by the streak computation: streaks count consecutive Warsaw
 * days the player submitted something, not consecutive puzzleIds.
 * A player who plays archive puzzles #1, #2, #3 in one sitting today
 * gets streak = 1 (one day with plays), not streak = 3.
 *
 * Warsaw chosen over UTC because the daily puzzle release runs on
 * Warsaw time (Logic App, Feature E), the audience is PL-anchored,
 * and a player playing at 1am Warsaw shouldn't have their submission
 * counted as "the previous day" by UTC math.
 *
 * Returns null on invalid input (NaN, non-finite, non-number) so the
 * caller can filter rather than handle exceptions in a hot path. Real
 * rows always have a valid `submittedAt` written by buildDailyResultDoc.
 */

const MS_PER_DAY = 86_400_000;
const FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * @param {number} ms
 * @returns {number | null}
 */
function warsawDayNumber(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const parts = FORMATTER.formatToParts(new Date(ms));
  let year = 0, month = 0, day = 0;
  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
  }
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

module.exports = { warsawDayNumber };
