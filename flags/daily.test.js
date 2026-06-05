import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { todayN, getPuzzle, dailyNFromUrl, resolveDailyPuzzle } from './daily.js';
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
/** @type {DailyPuzzle[]} */
const BACKLOG = JSON.parse(
  readFileSync(join(HERE, '..', 'daily', 'daily_backlog.json'), 'utf-8'),
);

test('todayN returns the catalog length (the last released puzzle)', () => {
  assert.equal(todayN([]), 0);
  assert.equal(todayN([{ n: 1, filter: 'a', answers: ['x'] }]), 1);
  assert.equal(todayN([
    { n: 1, filter: 'a', answers: ['x'] },
    { n: 2, filter: 'b', answers: ['y'] },
    { n: 3, filter: 'c', answers: ['z'] },
  ]), 3);
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

// --- resolveDailyPuzzle ------------------------------------------------

/**
 * @param {Partial<Country> & { code: string }} [over]
 * @returns {Country}
 */
function fixtureCountry(over = { code: 'xx' }) {
  return {
    name: over.code.toUpperCase(),
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...over,
  };
}

test('resolveDailyPuzzle: happy path returns entry, parsed filter, and resolved Country targets', () => {
  const fr = fixtureCountry({ code: 'fr' });
  const de = fixtureCountry({ code: 'de' });
  /** @type {DailyPuzzle[]} */
  const catalog = [{ n: 1, filter: 'continent:Europe', answers: ['fr', 'de'] }];
  const r = resolveDailyPuzzle(catalog, [fr, de], 1);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.entry.n, 1);
    assert.equal(r.entry.filter, 'continent:Europe');
    assert.equal(r.targets.length, 2);
    assert.deepEqual(r.targets.map((c) => c.code), ['fr', 'de']);
    // filter is a parsed Filters object, not the raw string
    assert.equal(typeof r.filter, 'object');
    assert.ok(r.filter.continent.include.has('Europe'));
  }
});

test('resolveDailyPuzzle: n outside [1, catalog.length] returns reason "not-found"', () => {
  const fr = fixtureCountry({ code: 'fr' });
  /** @type {DailyPuzzle[]} */
  const catalog = [{ n: 1, filter: 'continent:Europe', answers: ['fr'] }];
  assert.deepEqual(resolveDailyPuzzle(catalog, [fr], 0), { ok: false, reason: 'not-found' });
  assert.deepEqual(resolveDailyPuzzle(catalog, [fr], 2), { ok: false, reason: 'not-found' });
  assert.deepEqual(resolveDailyPuzzle([], [fr], 1), { ok: false, reason: 'not-found' });
});

test('resolveDailyPuzzle: unparseable filter returns reason "invalid-filter"', () => {
  // parseFilterString rejects strings with no recognisable <group>:<value>
  // token — the catalog-shape tests prevent this from ever showing up
  // in real data, but the runtime branch needs to be exercised.
  /** @type {DailyPuzzle[]} */
  const catalog = [{ n: 1, filter: 'garbage', answers: ['fr'] }];
  assert.deepEqual(resolveDailyPuzzle(catalog, [], 1), { ok: false, reason: 'invalid-filter' });
});

test('resolveDailyPuzzle: every answer code missing from the pool returns reason "no-targets"', () => {
  /** @type {DailyPuzzle[]} */
  const catalog = [{ n: 1, filter: 'continent:Europe', answers: ['fr', 'de'] }];
  // Pool has none of the answer codes
  const r = resolveDailyPuzzle(catalog, [fixtureCountry({ code: 'gb' })], 1);
  assert.deepEqual(r, { ok: false, reason: 'no-targets' });
});

test('resolveDailyPuzzle: partial pool drift drops missing codes but still succeeds', () => {
  // If most answer codes resolve, the puzzle still plays — the page
  // gets the resolvable subset. Full pool drift surfaces as the
  // catalog test's "every answer code is a known sovereign" failure.
  const fr = fixtureCountry({ code: 'fr' });
  /** @type {DailyPuzzle[]} */
  const catalog = [{ n: 1, filter: 'continent:Europe', answers: ['fr', 'unknown'] }];
  const r = resolveDailyPuzzle(catalog, [fr], 1);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.targets.length, 1);
    assert.equal(r.targets[0].code, 'fr');
  }
});

// --- Catalog: structural + drift checks (live and backlog) ---------------

/** @param {DailyPuzzle[]} list @param {string} label */
function checkShape(list, label) {
  list.forEach((entry, i) => {
    assert.equal(entry.n, i + 1, `${label} index ${i}: n=${entry.n}, expected ${i + 1}`);
    assert.ok(typeof entry.filter === 'string' && entry.filter.length > 0, `${label} #${entry.n}: filter`);
    assert.ok(Array.isArray(entry.answers) && entry.answers.length > 0, `${label} #${entry.n}: answers`);
  });
}

test('live catalog: every entry has n matching its index, non-empty filter and answers', () => {
  checkShape(CATALOG, 'live');
});

test('backlog: numbering picks up where the live catalog leaves off', () => {
  // The first backlog entry's n must equal live catalog length + 1, and
  // backlog entries must continue sequentially. This way, releasing a
  // puzzle is just "move backlog[0] to the end of live" — n stays valid
  // in both files without renumbering anything.
  if (BACKLOG.length === 0) return;
  assert.equal(BACKLOG[0].n, CATALOG.length + 1,
    `backlog[0].n=${BACKLOG[0].n} but live catalog has ${CATALOG.length} entries — expected backlog to start at ${CATALOG.length + 1}`);
  BACKLOG.forEach((entry, i) => {
    const expectedN = CATALOG.length + 1 + i;
    assert.equal(entry.n, expectedN, `backlog index ${i}: n=${entry.n}, expected ${expectedN}`);
  });
});

test('live catalog: every answer code is a known sovereign country', () => {
  const sovCodes = new Set(flagsGamePool(COUNTRIES, false).map((c) => c.code));
  const offenders = [];
  for (const entry of [...CATALOG, ...BACKLOG]) {
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
// Every constraint in a filter must do work — dropping any single
// token has to change the answer set. The generator already dedupes
// by answer set and prefers the simpler filter, so it can't produce
// a redundant-constraint puzzle; this test pins the invariant against
// a future hand-edit (or a regenerated catalog with weaker dedup)
// sneaking through a filter that says more than it needs to.
// Daily resolves color filters against the full `colors` field — the
// player should be able to type Spain in "Europe · blue" and have it
// accepted, even though Spain's blue lives only in its coat of arms.
// `primaryColors` data stays in countries.json as a quality signal for
// future picker heuristics / strict-mode puzzles, but the default
// `colors` matching is what the catalog answers are computed against.

test('live + backlog: no puzzle filter carries a redundant constraint', () => {
  const sov = flagsGamePool(COUNTRIES, false);
  for (const entry of [...CATALOG, ...BACKLOG]) {
    const tokens = entry.filter.split(',');
    if (tokens.length < 2) continue;
    for (let i = 0; i < tokens.length; i++) {
      const trimmed = tokens.filter((_, j) => j !== i).join(',');
      const f = parseFilterString(trimmed);
      assert.ok(f, `#${entry.n}: trimmed filter "${trimmed}" failed to parse`);
      const without = sov
        .filter((c) => matchesFilters(c, /** @type {import('./flagsFilter.js').Filters} */ (f)))
        .map((c) => c.code)
        .sort();
      const full = [...entry.answers].sort();
      assert.notDeepEqual(
        without,
        full,
        `#${entry.n}: constraint "${tokens[i]}" is redundant — dropping it from "${entry.filter}" leaves the same ${full.length}-flag answer set`,
      );
    }
  }
});

test('live + backlog: answers match what each filter resolves to today', () => {
  const sov = flagsGamePool(COUNTRIES, false);
  for (const entry of [...CATALOG, ...BACKLOG]) {
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
