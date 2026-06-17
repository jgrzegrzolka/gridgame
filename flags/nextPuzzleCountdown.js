/**
 * Countdown to the next Warsaw midnight — when the next dated puzzle
 * in `puzzles.json` becomes visible (Feature R). Pure, DST-safe.
 *
 * The page filter (`flags/puzzleFilter.js`) uses `warsawToday()` and
 * the catalog is dated in Warsaw time, so "when does the next puzzle
 * appear?" reduces to "when is the next Warsaw midnight?". This
 * module turns that into milliseconds and a localized short string.
 */

import { warsawClock } from './warsawTime.js';

/**
 * Minutes UTC-Warsaw differs from UTC at the given instant. CET = +60,
 * CEST = +120. DST handled implicitly by `Intl.DateTimeFormat`.
 *
 * @param {Date} at
 * @returns {number}
 */
function warsawUtcOffsetMinutes(at) {
  const wc = warsawClock(at);
  // Treat the Warsaw wall-clock components as if they were UTC; the
  // difference between that and the actual instant is the offset.
  const asIfUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute);
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/**
 * The next UTC instant whose Warsaw projection is 00:00. If `now` is
 * itself exactly Warsaw midnight, returns the *following* midnight
 * (i.e. always strictly in the future, never the present moment).
 *
 * @param {Date} now
 * @returns {Date}
 */
export function nextWarsawMidnightFrom(now) {
  const wc = warsawClock(now);
  // Approximate UTC midnight on the Warsaw next-day. JS Date math
  // handles month / year rollover when day exceeds the calendar.
  const approxUtcMidnight = new Date(Date.UTC(wc.year, wc.month - 1, wc.day + 1));
  // Shift back by the Warsaw offset at the *target* moment so the
  // result's Warsaw projection lands on 00:00 sharp. The offset on
  // the target side is what matters because that's when DST applies.
  const offsetMin = warsawUtcOffsetMinutes(approxUtcMidnight);
  return new Date(approxUtcMidnight.getTime() - offsetMin * 60_000);
}

/**
 * Milliseconds from `now` to the next Warsaw midnight. Always > 0
 * (strictly future) at sub-second granularity unless `now` is already
 * past midnight — which is the same instant flipping into the next
 * day, so the function returns ~86_400_000 in that edge case.
 *
 * @param {Date} now
 * @returns {number}
 */
export function msUntilNextWarsawMidnight(now) {
  return nextWarsawMidnightFrom(now).getTime() - now.getTime();
}

/**
 * Short countdown string. The main "Xh Ym" / "X min" form is **not
 * localized** — the Polish equivalent ("X godz. Y min") is too wide
 * for the result-panel slot and was a prod-visible eyesore on the
 * day Feature R Phase 1 shipped (2026-06-17). Lang only branches on
 * the boundary states ("now" / "less than a minute") where the
 * Polish forms are short enough to not wrap awkwardly.
 *
 * @param {number} ms
 * @param {string} [lang]  'en' | 'pl' (defaults to 'en')
 * @returns {string}
 */
export function formatCountdown(ms, lang = 'en') {
  if (ms <= 0) return lang === 'pl' ? 'teraz' : 'now';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return lang === 'pl' ? 'mniej niż minuta' : 'less than a minute';
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
