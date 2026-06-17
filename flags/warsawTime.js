/**
 * Warsaw-aware time helpers for the daily page. `warsawToday(now)` is the
 * date string the page filters on — every puzzle whose `date <=
 * warsawToday()` is visible to players.
 *
 * Pure-functional: tests pin the clock by passing a fixed `now` Date.
 */

/**
 * Wall-clock components in `Europe/Warsaw` for `now`.
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
 * Warsaw calendar date as `YYYY-MM-DD`. Default arg lets callers in the page
 * write `warsawToday()`; pass a Date in tests.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function warsawToday(now = new Date()) {
  const c = warsawClock(now);
  const mm = String(c.month).padStart(2, '0');
  const dd = String(c.day).padStart(2, '0');
  return `${c.year}-${mm}-${dd}`;
}
