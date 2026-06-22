/**
 * Client-side mirror of `api/src/lib/warsawDay.js` (Feature S Phase 3
 * needs it for `bumpQuiz60sDay(store, dayId)` on the 60s-quiz finish
 * site, where the dayId must come from the same axis the server's
 * `streakCompute` uses).
 *
 * Map a unix-ms timestamp to an integer "Warsaw day number" — days
 * since epoch as seen from Europe/Warsaw. DST-safe via
 * `Intl.DateTimeFormat`.
 *
 * Why duplicate the server impl: server is CommonJS (api/), client is
 * ESM (flags/). Cross-runtime imports across that boundary aren't
 * worth the build complexity for a 12-line pure function. The two
 * copies must stay in sync — `flags/warsawDay.test.js` pins the
 * shared behaviour (same year-month-day → same number, DST-safe
 * boundary handling, null on bad input) so drift fails CI.
 *
 * @param {number} ms
 * @returns {number | null}
 */
export function warsawDayNumber(ms) {
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

const MS_PER_DAY = 86_400_000;
const FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
