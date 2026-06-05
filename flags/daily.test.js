import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LAUNCH_UTC,
  dayNumberFor,
  getPuzzle,
  dailyNFromUrl,
  launchDateIso,
} from './daily.js';
import { parseFilterString } from './findFlag.js';
import { matchesFilters } from './flagsFilter.js';
import { flagsGamePool } from './group.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./daily.js').DailyPuzzle} DailyPuzzle */

const HERE = dirname(fileURLToPath(import.meta.url));
/** @type {Country[]} */
const COUNTRIES = JSON.parse(readFileSync(join(HERE, 'countries.json'), 'utf-8'));
/** @type {DailyPuzzle[]} */
const CATALOG = JSON.parse(
  readFileSync(join(HERE, '..', 'daily', 'daily_puzzles.json'), 'utf-8'),
);

const DAY = 86_400_000;

test('LAUNCH_UTC is 2026-06-06 at 00:00 UTC', () => {
  const d = new Date(LAUNCH_UTC);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 5, 'June is month index 5');
  assert.equal(d.getUTCDate(), 6);
  assert.equal(d.getUTCHours(), 0);
  assert.equal(d.getUTCMinutes(), 0);
});

test('launchDateIso renders LAUNCH_UTC as 2026-06-06', () => {
  assert.equal(launchDateIso(), '2026-06-06');
});

test('dayNumberFor returns 1 at launch midnight', () => {
  assert.equal(dayNumberFor(LAUNCH_UTC), 1);
});

test('dayNumberFor returns 1 throughout launch day in UTC', () => {
  assert.equal(dayNumberFor(LAUNCH_UTC + 12 * 3600 * 1000), 1);
  assert.equal(dayNumberFor(LAUNCH_UTC + DAY - 1), 1);
});

test('dayNumberFor returns 2 the day after launch', () => {
  assert.equal(dayNumberFor(LAUNCH_UTC + DAY), 2);
});

test('dayNumberFor returns 0 just before launch midnight', () => {
  assert.equal(dayNumberFor(LAUNCH_UTC - 1), 0);
});

test('dayNumberFor returns negative N well before launch', () => {
  assert.equal(dayNumberFor(LAUNCH_UTC - 10 * DAY), -9);
});

test('getPuzzle returns the entry at n-1', () => {
  /** @type {DailyPuzzle[]} */
  const c = [
    { n: 1, filter: 'a', answers: ['x'] },
    { n: 2, filter: 'b', answers: ['y'] },
  ];
  assert.deepEqual(getPuzzle(c, 1), c[0]);
  assert.deepEqual(getPuzzle(c, 2), c[1]);
});

test('getPuzzle returns null for N before #1 or past the end', () => {
  /** @type {DailyPuzzle[]} */
  const c = [{ n: 1, filter: 'a', answers: ['x'] }];
  assert.equal(getPuzzle(c, 0), null);
  assert.equal(getPuzzle(c, -1), null);
  assert.equal(getPuzzle(c, 2), null);
});

test('getPuzzle throws on a miscounted catalog (n != position + 1)', () => {
  /** @type {DailyPuzzle[]} */
  const c = [{ n: 2, filter: 'a', answers: ['x'] }];
  assert.throws(() => getPuzzle(c, 1), /mismatch/i);
});

test('dailyNFromUrl returns the parsed n when present', () => {
  assert.equal(dailyNFromUrl('?n=42', 5), 42);
  assert.equal(dailyNFromUrl('?n=1&other=x', 99), 1);
});

test('dailyNFromUrl falls back to today when ?n= is missing or garbage', () => {
  assert.equal(dailyNFromUrl('', 7), 7);
  assert.equal(dailyNFromUrl('?other=x', 7), 7);
  assert.equal(dailyNFromUrl('?n=', 7), 7);
  assert.equal(dailyNFromUrl('?n=abc', 7), 7);
});

// --- Seed catalog: structural and drift checks ---------------------------

test('seed catalog: every entry has n matching its index', () => {
  CATALOG.forEach((entry, i) => {
    assert.equal(entry.n, i + 1, `index ${i}: n=${entry.n}, expected ${i + 1}`);
  });
});

test('seed catalog: every entry has a non-empty filter and non-empty answers', () => {
  for (const entry of CATALOG) {
    assert.ok(typeof entry.filter === 'string' && entry.filter.length > 0, `#${entry.n}: filter`);
    assert.ok(Array.isArray(entry.answers) && entry.answers.length > 0, `#${entry.n}: answers`);
  }
});

test('seed catalog: every answer code is a known sovereign country', () => {
  const sovCodes = new Set(flagsGamePool(COUNTRIES, false).map((c) => c.code));
  const offenders = [];
  for (const entry of CATALOG) {
    for (const code of entry.answers) {
      if (!sovCodes.has(code)) offenders.push(`#${entry.n}: ${code} is not in the sovereign pool`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

// The "drift detector": each puzzle's stored answers must equal exactly
// what its filter resolves to against current data. If this fails after
// editing countries.json (e.g. fixing a continent or a color), the
// historical puzzle would silently change — which is exactly what the
// plan's "frozen catalog" invariant forbids. The fix is either to
// revert the data change for that flag, or to detach the puzzle from
// the filter (keep answers, drop filter). Don't just regenerate
// answers — that defeats the test's purpose.
test('seed catalog: answers match what the filter resolves to today', () => {
  const sov = flagsGamePool(COUNTRIES, false);
  for (const entry of CATALOG) {
    const f = parseFilterString(entry.filter);
    assert.ok(f, `#${entry.n}: failed to parse filter "${entry.filter}"`);
    const computed = sov
      .filter((c) => matchesFilters(c, /** @type {import('./flagsFilter.js').Filters} */ (f)))
      .map((c) => c.code)
      .sort();
    const stored = [...entry.answers].sort();
    assert.deepEqual(
      computed,
      stored,
      `#${entry.n}: filter "${entry.filter}" resolves to [${computed.join(', ')}] but answers is [${stored.join(', ')}]`,
    );
  }
});
