/**
 * Warsaw-aware time helpers — used by the daily-release timer to:
 *   1. Skip the half of the dual-cron schedule that isn't Warsaw midnight
 *      (so the function is DST-resilient with a static cron expression).
 *   2. Compute the puzzle number that "today in Warsaw" should be on,
 *      so a double-fire on the same Warsaw day is a no-op.
 *
 * The trick avoids `WEBSITE_TIME_ZONE` (ignored on Linux Consumption) and
 * `CRON_TZ=` (rejected by the indexer) — see FEATURE.md Feature P Phase 2
 * for the dead ends. Pure-JS, no @azure/* deps; bundled with the function.
 *
 * Pure-functional helpers take a `now` Date arg so tests can pin the
 * clock without monkey-patching Date.
 */

/**
 * Get the wall-clock components in `Europe/Warsaw` for `now`.
 *
 * @param {Date} now
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number }}
 */
export function warsawClock(now) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    hour: Number(m.hour) % 24,
    minute: Number(m.minute),
  };
}

/**
 * Days elapsed between two Warsaw-local YYYY-MM-DD dates (b - a). UTC
 * arithmetic on the date components — no TZ offset shenanigans, since
 * both inputs already represent Warsaw calendar dates.
 *
 * @param {{year:number, month:number, day:number}} a
 * @param {{year:number, month:number, day:number}} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  const ma = Date.UTC(a.year, a.month - 1, a.day);
  const mb = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((mb - ma) / 86_400_000);
}

const LAUNCH = { year: 2026, month: 6, day: 6 };

/**
 * Puzzle number that should be "today" in Warsaw — derived from the
 * launch date (puzzle #1 = 2026-06-06). If today's Warsaw date matches
 * the launch date, returns 1; the day after launch returns 2; and so on.
 *
 * @param {Date} now
 * @returns {number}
 */
export function expectedTodayN(now) {
  return daysBetween(LAUNCH, warsawClock(now)) + 1;
}

/**
 * Should the release handler do work? Two gates:
 *   1. We're in the Warsaw midnight slot (hour 0 — the dual-cron schedule
 *      fires both 22:05 and 23:05 UTC, but only one of those is hour 0
 *      in Warsaw under either CEST or CET).
 *   2. The catalog's last entry is older than today's Warsaw date — i.e.
 *      we haven't already promoted today. Protects against duplicate
 *      fires inside the same Warsaw day.
 *
 * @param {Date} now
 * @param {number} lastLiveN  the n of the catalog's last entry pre-promote
 * @returns {{ run: true } | { run: false, reason: string }}
 */
export function shouldRun(now, lastLiveN) {
  const w = warsawClock(now);
  if (w.hour !== 0) {
    return { run: false, reason: `Warsaw hour is ${w.hour}, not 0 — wrong cron fire, skipping` };
  }
  const expected = expectedTodayN(now);
  if (lastLiveN >= expected) {
    return {
      run: false,
      reason: `already promoted today (live ends at #${lastLiveN}, expected for today is #${expected})`,
    };
  }
  return { run: true };
}
