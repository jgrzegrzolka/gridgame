/**
 * CommonJS twin of `flags/warsawTime.js`. The api/ side runs on Node 22
 * under CommonJS (see CLAUDE.md "API / Azure Functions") so we can't
 * just `require()` the ESM page-side copy.
 *
 * Pure-functional: tests pin the clock by passing a fixed `now` Date.
 */

function warsawClock(now) {
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

function warsawToday(now = new Date()) {
  const c = warsawClock(now);
  const mm = String(c.month).padStart(2, '0');
  const dd = String(c.day).padStart(2, '0');
  return `${c.year}-${mm}-${dd}`;
}

module.exports = { warsawClock, warsawToday };
