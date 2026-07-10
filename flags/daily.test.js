import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { todayN, getPuzzle, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle, findPuzzle, resolvePuzzleEntry, isFilterRefinement, manualToCategory, superlativeToCategory, resolveNote, puzzleDate, formatPuzzleDate, LAUNCH_DATE } from './daily.js';
import { parseFilterString } from './findFlag.js';
import { matchesFilters } from './flagsFilter.js';
import { flagsGamePool, loadCountries, createCountry } from './group.js';
import { auditPuzzle } from './ambiguityAudit.js';
import { validateCatalog } from './dailyValidate.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./daily.js').DailyPuzzle} DailyPuzzle */

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNTRIES = loadCountries(JSON.parse(readFileSync(join(HERE, 'countries.json'), 'utf-8')));
// Single source of truth (Feature R) — `puzzles.json` carries every
// entry past, present and future, each with its own `date`. Lives in
// `.catalog/` (blob is canonical, no committed copy in the repo).
// Run `npm run catalog:pull` once before invoking the test suite; CI
// does this as a pre-test step in deploy.yml.
const CATALOG_DIR = join(HERE, '..', '.catalog');
/** @type {DailyPuzzle[]} */
const PUZZLES = JSON.parse(readFileSync(join(CATALOG_DIR, 'puzzles.json'), 'utf-8'));

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

test('isReplayFromUrl is true only on the literal ?replay=1', () => {
  assert.equal(isReplayFromUrl('?replay=1'), true);
  assert.equal(isReplayFromUrl('?n=42&replay=1'), true);
});

test('isReplayFromUrl is false on missing, empty, or unrelated values', () => {
  // The page treats any non-"1" value as "play normally" so that
  // ?replay=0 / ?replay=true / a stray ?replay= can't accidentally
  // suppress saveScore on a player's first real play.
  assert.equal(isReplayFromUrl(''), false);
  assert.equal(isReplayFromUrl('?n=42'), false);
  assert.equal(isReplayFromUrl('?replay='), false);
  assert.equal(isReplayFromUrl('?replay=0'), false);
  assert.equal(isReplayFromUrl('?replay=true'), false);
  assert.equal(isReplayFromUrl('?replay=yes'), false);
});

// --- resolveDailyPuzzle ------------------------------------------------

/**
 * @param {Partial<Country> & { code: string }} [over]
 * @returns {Country}
 */
function fixtureCountry(over = { code: 'xx' }) {
  return createCountry({
    name: over.code.toUpperCase(),
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...over,
  });
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
    assert.ok(r.filter && r.filter.continent.include.has('Europe'));
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

test('findPuzzle returns the entry matching n, regardless of position', () => {
  // Backlog catalogs continue numbering from the live catalog, so
  // entry 0 may have n=11. Array-index lookup would mis-resolve;
  // findPuzzle scans by `.n`.
  /** @type {DailyPuzzle[]} */
  const backlog = [
    { n: 11, filter: 'a', answers: ['x'] },
    { n: 12, filter: 'b', answers: ['y'] },
  ];
  assert.equal(findPuzzle(backlog, 11), backlog[0]);
  assert.equal(findPuzzle(backlog, 12), backlog[1]);
});

test('findPuzzle returns null when no entry matches', () => {
  /** @type {DailyPuzzle[]} */
  const backlog = [{ n: 11, filter: 'a', answers: ['x'] }];
  assert.equal(findPuzzle(backlog, 10), null);
  assert.equal(findPuzzle(backlog, 12), null);
  assert.equal(findPuzzle([], 1), null);
});

test('resolvePuzzleEntry: happy path resolves an entry directly', () => {
  const fr = fixtureCountry({ code: 'fr' });
  const de = fixtureCountry({ code: 'de' });
  const r = resolvePuzzleEntry({ n: 11, filter: 'continent:Europe', answers: ['fr', 'de'] }, [fr, de]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.entry.n, 11);
    assert.deepEqual(r.targets.map((c) => c.code), ['fr', 'de']);
  }
});

test('resolvePuzzleEntry: unparseable filter returns reason "invalid-filter"', () => {
  const r = resolvePuzzleEntry({ n: 1, filter: 'garbage', answers: ['fr'] }, []);
  assert.deepEqual(r, { ok: false, reason: 'invalid-filter' });
});

test('resolvePuzzleEntry: every answer code missing from the pool returns reason "no-targets"', () => {
  const r = resolvePuzzleEntry(
    { n: 1, filter: 'continent:Europe', answers: ['fr', 'de'] },
    [fixtureCountry({ code: 'gb' })],
  );
  assert.deepEqual(r, { ok: false, reason: 'no-targets' });
});

test('resolvePuzzleEntry: manual entry skips parseFilterString and returns filter: null', () => {
  // Manual entries are filter-less by design. The resolver must NOT
  // try to parse a (missing) filter — that would return invalid-filter
  // and reject the puzzle in the live flow. The page renders the
  // category label from `entry.title` via manualToCategory; filter is
  // null so callers know to take the manual branch.
  const fr = fixtureCountry({ code: 'fr' });
  const de = fixtureCountry({ code: 'de' });
  const r = resolvePuzzleEntry(
    {
      n: 51,
      kind: 'manual',
      answers: ['fr', 'de'],
      title: { en: 'Triangles from the hoist', pl: 'Trójkąty z drzewca' },
    },
    [fr, de],
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.filter, null);
    assert.deepEqual(r.targets.map((c) => c.code), ['fr', 'de']);
    assert.equal(r.entry.kind, 'manual');
  }
});

test('resolvePuzzleEntry: manual entry with no resolvable codes still returns "no-targets"', () => {
  // Same end state as a filter entry whose answers all drifted out of
  // the country pool — the page renders the not-found / no-targets
  // screen rather than launching an empty game.
  const r = resolvePuzzleEntry(
    {
      n: 51,
      kind: 'manual',
      answers: ['fr', 'de'],
      title: { en: 'Triangles from the hoist', pl: 'Trójkąty z drzewca' },
    },
    [fixtureCountry({ code: 'gb' })],
  );
  assert.deepEqual(r, { ok: false, reason: 'no-targets' });
});

test('manualToCategory: label comes from entry.title[lang]', () => {
  const category = manualToCategory(
    {
      n: 51,
      kind: 'manual',
      answers: ['fr', 'de'],
      title: { en: 'Triangles from the hoist', pl: 'Trójkąty z drzewca' },
    },
    'pl',
  );
  assert.equal(category.label, 'Trójkąty z drzewca');
  // id includes the puzzle number so two manual puzzles with the same
  // title don't collide in any future id-keyed lookup.
  assert.match(category.id, /51/);
});

test('manualToCategory: falls back to en when the requested language is missing', () => {
  const category = manualToCategory(
    {
      n: 51,
      kind: 'manual',
      answers: ['fr'],
      title: { en: 'Triangles from the hoist' },
    },
    'de',
  );
  assert.equal(category.label, 'Triangles from the hoist');
});

test('manualToCategory: predicate is code-membership against the frozen answer list', () => {
  const category = manualToCategory(
    {
      n: 51,
      kind: 'manual',
      answers: ['fr', 'de'],
      title: { en: 'X', pl: 'X' },
    },
    'en',
  );
  const fr = fixtureCountry({ code: 'fr' });
  const us = fixtureCountry({ code: 'us' });
  assert.equal(category.predicate(fr), true);
  assert.equal(category.predicate(us), false);
});

test('resolvePuzzleEntry: superlative entry skips filter parsing and returns filter: null', () => {
  // Like manual, a superlative's frozen answers ARE the puzzle — the top-N
  // rank is set-relative, not a per-flag predicate, so there's nothing to
  // parse here. Its optional `filter` only narrowed the ranking pool at
  // authoring time and must NOT be re-applied as a game filter.
  const inC = fixtureCountry({ code: 'in' });
  const cn = fixtureCountry({ code: 'cn' });
  const r = resolvePuzzleEntry(
    {
      n: 60,
      kind: 'superlative',
      metric: 'population',
      scope: 'world',
      direction: 'most',
      topN: 2,
      answers: ['in', 'cn'],
      title: { en: '2 most populous', pl: '2 najludniejsze' },
    },
    [inC, cn],
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.filter, null);
    assert.deepEqual(r.targets.map((c) => c.code), ['in', 'cn']);
    assert.equal(r.entry.kind, 'superlative');
  }
});

test('superlativeToCategory: label comes from entry.title[lang]', () => {
  const category = superlativeToCategory(
    {
      n: 60,
      kind: 'superlative',
      metric: 'population',
      scope: 'Europe',
      direction: 'most',
      topN: 5,
      answers: ['ru', 'de', 'gb', 'fr', 'it'],
      title: { en: '5 most populous in Europe', pl: '5 najludniejszych w Europie' },
    },
    'pl',
  );
  assert.equal(category.label, '5 najludniejszych w Europie');
  assert.match(category.id, /60/);
  assert.match(category.id, /superlative/);
});

test('superlativeToCategory: composes a bare fallback when title is absent (Phase-1 stopgap)', () => {
  const category = superlativeToCategory(
    {
      n: 60,
      kind: 'superlative',
      metric: 'population',
      scope: 'Europe',
      direction: 'most',
      topN: 5,
      answers: ['ru', 'de', 'gb', 'fr', 'it'],
      filter: 'color:white',
    },
    'en',
  );
  assert.equal(category.label, '5 most population · Europe · color:white');
});

test('superlativeToCategory: predicate is code-membership against the frozen answer list', () => {
  const category = superlativeToCategory(
    {
      n: 60,
      kind: 'superlative',
      metric: 'population',
      scope: 'world',
      direction: 'most',
      topN: 2,
      answers: ['in', 'cn'],
      title: { en: 'X', pl: 'X' },
    },
    'en',
  );
  assert.equal(category.predicate(fixtureCountry({ code: 'in' })), true);
  assert.equal(category.predicate(fixtureCountry({ code: 'us' })), false);
});

test('resolveNote: returns the note in the requested language', () => {
  const notes = { om: { en: 'A dagger, not a crest.', pl: 'Sztylet, nie herb.' } };
  assert.equal(resolveNote(notes, 'om', 'en'), 'A dagger, not a crest.');
  assert.equal(resolveNote(notes, 'om', 'pl'), 'Sztylet, nie herb.');
});

test('resolveNote: falls back to en when the requested language is missing', () => {
  const notes = { jp: { en: 'The disc is the sun.' } };
  assert.equal(resolveNote(notes, 'jp', 'pl'), 'The disc is the sun.');
});

test('resolveNote: returns empty string when there is no note for the code', () => {
  const notes = { om: { en: 'x', pl: 'y' } };
  assert.equal(resolveNote(notes, 'jp', 'en'), '');
});

test('resolveNote: returns empty string when notes is undefined', () => {
  assert.equal(resolveNote(undefined, 'om', 'en'), '');
});

test('isFilterRefinement: refined has strictly more tokens including all base tokens', () => {
  // Classic case — the player-experience canary.
  assert.equal(
    isFilterRefinement('continent:Europe,motif:cross,color:blue', 'continent:Europe,motif:cross'),
    true,
  );
});

test('isFilterRefinement: identical filters are NOT refinements', () => {
  assert.equal(isFilterRefinement('continent:Europe,motif:cross', 'continent:Europe,motif:cross'), false);
});

test('isFilterRefinement: same token set in different order is NOT a refinement', () => {
  // Same filter, different presentation — same token set, not a refinement.
  assert.equal(isFilterRefinement('motif:cross,continent:Europe', 'continent:Europe,motif:cross'), false);
});

test('isFilterRefinement: divergent framings are NOT refinements', () => {
  // cross+!UJ vs NA+cross — neither's tokens are a subset of the other's.
  assert.equal(isFilterRefinement('motif:cross,motif:!union-jack', 'continent:North America,motif:cross'), false);
  assert.equal(isFilterRefinement('continent:North America,motif:cross', 'motif:cross,motif:!union-jack'), false);
});

test('isFilterRefinement: include and exclude variants are distinct tokens', () => {
  // motif:union-jack vs motif:!union-jack — different tokens, neither subset.
  assert.equal(isFilterRefinement('motif:cross,motif:union-jack', 'motif:cross,motif:!union-jack'), false);
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

// --- Catalog: structural + drift checks (single dated puzzles.json) ------

/**
 * The filter-shape rules (drift, redundant-token, refinement, primary-clean,
 * single-use) only apply to filter entries. Manual + superlative entries carry
 * a frozen roster instead of a criterion filter, so those rules skip them — a
 * superlative's optional `filter` merely narrowed its ranking pool and isn't a
 * criterion to drift-check or de-duplicate against.
 *
 * @param {{ kind?: string }} entry
 */
function isFilterEntry(entry) {
  return entry.kind !== 'manual' && entry.kind !== 'superlative';
}

/** @param {DailyPuzzle[]} list */
function checkShape(list) {
  list.forEach((entry, i) => {
    assert.equal(entry.n, i + 1, `puzzles index ${i}: n=${entry.n}, expected ${i + 1}`);
    assert.ok(Array.isArray(entry.answers) && entry.answers.length > 0, `puzzles #${entry.n}: answers`);
    if (entry.kind === 'manual') {
      // Manual entries have a title (per-language) and answers — no filter.
      assert.equal(entry.filter, undefined, `puzzles #${entry.n}: manual entry must not carry a filter field`);
    } else if (entry.kind === 'superlative') {
      // A superlative's filter is optional (pool-narrowing); when present it
      // must be a real string. Full shape (metric/scope/direction/topN/title)
      // is pinned by flags/dailyValidate.test.js + the title test below.
      if (entry.filter !== undefined) {
        assert.ok(typeof entry.filter === 'string' && entry.filter.length > 0, `puzzles #${entry.n}: superlative filter must be a non-empty string when present`);
      }
    } else {
      assert.ok(typeof entry.filter === 'string' && entry.filter.length > 0, `puzzles #${entry.n}: filter`);
    }
  });
}

test('puzzles: every entry has n matching its index, non-empty filter and answers', () => {
  checkShape(PUZZLES);
});

test('catalog passes the shared push-time validator (validateCatalog)', () => {
  // The same gate authoring/push.mjs runs. Belt-and-suspenders over the
  // inline rule tests, and the only place a superlative entry's shape
  // (metric/scope/direction/topN/title) gets validated inside `npm test`.
  assert.doesNotThrow(() => validateCatalog({ puzzles: PUZZLES }));
});

test('puzzles: every entry has a YYYY-MM-DD date and dates are contiguous', () => {
  // Feature R rule 4b — the validator's hard rule made test-visible
  // here too, so contradictions on the dated catalog surface in `npm
  // test` rather than only at push time.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const DAY_MS = 86_400_000;
  PUZZLES.forEach((entry) => {
    assert.ok(
      typeof entry.date === 'string' && DATE_RE.test(entry.date),
      `puzzles #${entry.n}: date missing or not YYYY-MM-DD (got ${JSON.stringify(entry.date)})`,
    );
  });
  for (let i = 1; i < PUZZLES.length; i++) {
    const prev = Date.parse(/** @type {string} */ (PUZZLES[i - 1].date) + 'T00:00:00Z');
    const curr = Date.parse(/** @type {string} */ (PUZZLES[i].date) + 'T00:00:00Z');
    const gap = Math.round((curr - prev) / DAY_MS);
    assert.equal(
      gap,
      1,
      `puzzles #${PUZZLES[i].n}: ${PUZZLES[i].date} is not the day after #${PUZZLES[i - 1].n}'s ${PUZZLES[i - 1].date} (gap=${gap})`,
    );
  }
});

// Rule 9 (hard): every entry — filter or manual — must have between 4
// and 30 answers inclusive. The 4-floor was tightened from the old
// banded "≥2 in #1–50, ≥1 past #50" because tiny answer sets read as
// gotchas — "find all of them" needs enough flags to feel like a
// category. The 30-cap is autocomplete-UX bound (huge sets become
// "remember every member" rather than "discover the pattern").
//
// `sizeFloorExempt: true` grandfathers shipped puzzles that predate the
// rule tightening — they're in the immutable past, can't be reworked.
// Don't set this on new entries.
test('puzzles: every entry has 4–30 answers', () => {
  const offenders = [];
  for (const entry of PUZZLES) {
    if (entry.sizeFloorExempt) continue;
    const len = Array.isArray(entry.answers) ? entry.answers.length : 0;
    if (len < 4 || len > 30) {
      offenders.push(`#${entry.n} (${entry.filter ?? 'manual'}): ${len} answers`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('ideas: every entry has 4–30 answers', () => {
  const IDEAS = JSON.parse(
    readFileSync(join(CATALOG_DIR, 'ideas.json'), 'utf-8'),
  );
  const offenders = [];
  for (const entry of IDEAS) {
    const len = Array.isArray(entry.answers) ? entry.answers.length : 0;
    if (len < 4 || len > 30) {
      offenders.push(`idea (${entry.filter ?? 'manual'}): ${len} answers`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('puzzles: every answer code is a known country', () => {
  // Filter entries are sovereign-only (the DSL resolves against the
  // sovereign pool). Manual entries are the escape hatch for criteria the
  // DSL can't express — including real-world rosters that feature
  // non-sovereign flags (England, other home nations, territories). They
  // may draw from the full pool, but the code must still be a real flag.
  const sovCodes = new Set(flagsGamePool(COUNTRIES, false).map((c) => c.code));
  const fullCodes = new Set(flagsGamePool(COUNTRIES, true).map((c) => c.code));
  const offenders = [];
  for (const entry of PUZZLES) {
    const allowed = entry.kind === 'manual' ? fullCodes : sovCodes;
    const poolName = entry.kind === 'manual' ? 'full pool' : 'sovereign pool';
    for (const code of entry.answers) {
      if (!allowed.has(code)) offenders.push(`#${entry.n}: ${code} is not in the ${poolName}`);
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

test('puzzles: no filter carries a redundant constraint', () => {
  // A token is redundant only when dropping it changes neither the
  // default-`colors` resolution nor — for puzzles bound by the primary-
  // clean rule — the `primaryColors` resolution. The primary-side check
  // catches the case where a defensive `motif:!coat-of-arms` looks
  // redundant against `colors` alone but is what closes the COA-trap
  // under `primaryColors` (e.g. #3 SA·!green·!COA, where without !COA
  // Ecuador and Paraguay drift between the two colour models). Skipping
  // the primary check on `primaryCleanExempt` entries respects their
  // opt-out — there a primary-only token is genuinely dead weight.
  const sov = flagsGamePool(COUNTRIES, false);
  /** @param {import('./group.js').Country[]} arr */
  const codes = (arr) => arr.map((c) => c.code).sort();
  for (const entry of PUZZLES) {
    // Manual + superlative entries have no criterion filter to check.
    if (!isFilterEntry(entry)) continue;
    const filterStr = /** @type {string} */ (entry.filter);
    const tokens = filterStr.split(',');
    if (tokens.length < 2) continue;
    const fullFilter = parseFilterString(filterStr);
    assert.ok(fullFilter, `#${entry.n}: filter "${filterStr}" failed to parse`);
    const fullDefault = [...entry.answers].sort();
    const checkPrimary = entry.primaryCleanExempt !== true;
    const fullPrimary = checkPrimary
      ? codes(sov.filter((c) => matchesFilters(c, /** @type {import('./flagsFilter.js').Filters} */ (fullFilter), { colorField: 'primaryColors' })))
      : [];
    for (let i = 0; i < tokens.length; i++) {
      const trimmed = tokens.filter((_, j) => j !== i).join(',');
      const f = parseFilterString(trimmed);
      assert.ok(f, `#${entry.n}: trimmed filter "${trimmed}" failed to parse`);
      const withoutDefault = codes(sov.filter((c) => matchesFilters(c, /** @type {import('./flagsFilter.js').Filters} */ (f))));
      const sameDefault = JSON.stringify(withoutDefault) === JSON.stringify(fullDefault);
      if (!sameDefault) continue;
      if (checkPrimary) {
        const withoutPrimary = codes(sov.filter((c) => matchesFilters(c, /** @type {import('./flagsFilter.js').Filters} */ (f), { colorField: 'primaryColors' })));
        if (JSON.stringify(withoutPrimary) !== JSON.stringify(fullPrimary)) continue;
      }
      assert.fail(`#${entry.n}: constraint "${tokens[i]}" is redundant — dropping it from "${filterStr}" leaves the same ${fullDefault.length}-flag answer set under both colour models`);
    }
  }
});

test('ideas: no filter carries a redundant token', () => {
  // Mirror of the catalog rule-2 test, but for `daily/daily_ideas.json`.
  // Without this, hand-curated entries can sneak through with redundant
  // tokens (e.g. `motif:cross,motif:union-jack` — the union jack already
  // contains crosses, so the `motif:cross` token adds nothing). Default-
  // colours check only, since ideas don't currently use
  // `primaryCleanExempt`; if that changes, mirror the primary-side
  // check from the catalog version above.
  const sov = flagsGamePool(COUNTRIES, false);
  /** @type {{ kind?: string, filter: string, answers: string[] }[]} */
  const IDEAS = JSON.parse(
    readFileSync(join(CATALOG_DIR, 'ideas.json'), 'utf-8'),
  );
  for (const entry of IDEAS) {
    if (!isFilterEntry(entry)) continue;
    if (!Array.isArray(entry.answers) || entry.answers.length === 0) continue;
    const tokens = entry.filter.split(',');
    if (tokens.length < 2) continue;
    const full = [...entry.answers].sort();
    for (let i = 0; i < tokens.length; i++) {
      const trimmed = tokens.filter((_, j) => j !== i).join(',');
      const f = parseFilterString(trimmed);
      if (!f) continue;
      const without = sov
        .filter((c) => matchesFilters(c, /** @type {import('./flagsFilter.js').Filters} */ (f)))
        .map((c) => c.code)
        .sort();
      if (JSON.stringify(without) === JSON.stringify(full)) {
        assert.fail(
          `idea "${entry.filter}": token "${tokens[i]}" is redundant — dropping it leaves the same ${full.length}-flag answer set`,
        );
      }
    }
  }
});

test('puzzles: answers match what each filter resolves to today', () => {
  const sov = flagsGamePool(COUNTRIES, false);
  for (const entry of PUZZLES) {
    // Manual + superlative entries have no criterion filter — the drift
    // detector is filter-only. Their rosters are frozen; completeness /
    // correctness is the author's (for superlatives, audit-superlative.mjs).
    if (!isFilterEntry(entry)) continue;
    const filterStr = /** @type {string} */ (entry.filter);
    const f = parseFilterString(filterStr);
    assert.ok(f, `#${entry.n}: failed to parse filter "${filterStr}"`);
    const computed = sov
      .filter((c) => matchesFilters(c, /** @type {import('./flagsFilter.js').Filters} */ (f)))
      .map((c) => c.code)
      .sort();
    const stored = [...entry.answers].sort();
    assert.deepEqual(
      computed,
      stored,
      `#${entry.n}: filter "${filterStr}" resolves to [${computed.join(', ')}] but answers is [${stored.join(', ')}]`,
    );
  }
});

// Onboarding gate: in puzzles #1-100 no puzzle's answer set may be a
// strict subset of another puzzle's. Why: by the time the player meets
// the subset puzzle they've already seen every answer in the superset
// one, so the puzzle isn't "find all the X" — it collapses to
// "remember which of those were also Y", a weaker mechanic for
// onboarding. The trigger that drove this rule was Europe·blue·cross
// (fi, gb, gr, is, no, se) being a strict subset of Europe·cross (the
// same 6 + ch, dk, mt). Allowed past #100 as a deliberate recall
// mechanic.
test('puzzles: entries #1-100 have no filter-refinement subsets', () => {
  // Refined rule 6: strict-violation only when answer-set subset AND
  // filter-token subset coincide (`Europe+cross+blue` vs `Europe+cross`
  // — the smaller answer set's filter literally adds tokens to the
  // larger). Pure answer-set overlap with different filter framings is
  // allowed (`cross+!UJ` and `NA+cross` share 3 flags but neither
  // filter is a refinement of the other — different puzzles).
  const entries = PUZZLES.filter((e) => e.n <= 100);
  /** @type {string[]} */
  const offenders = [];
  for (const a of entries) {
    const aSet = new Set(a.answers);
    for (const b of entries) {
      if (a.n === b.n) continue;
      if (b.answers.length > a.answers.length) continue;
      const isAnswerSubset = b.answers.every((c) => aSet.has(c));
      if (!isAnswerSubset) continue;
      // b's answers are a subset (possibly equal) of a's.
      // Two sub-cases:
      //   - Equal sets: same puzzle, different filter — always a
      //     violation. Applies cross-kind too: a manual entry whose
      //     answers match a filter entry's answers is the same puzzle
      //     just framed differently.
      //   - Strict subset: only a violation when both sides are filter
      //     entries AND b's filter is a token-refinement of a's. Manual
      //     entries have no filter to refine, so a strict-subset that
      //     touches a manual entry isn't reachable by the refinement
      //     mechanic (the player reads the framings as distinct).
      const aFilter = a.filter ?? '<manual>';
      const bFilter = b.filter ?? '<manual>';
      if (b.answers.length === a.answers.length) {
        offenders.push(
          `#${b.n} ("${bFilter}") and #${a.n} ("${aFilter}") resolve to the same answer set — same puzzle, different filter`,
        );
      } else if (
        isFilterEntry(a) &&
        isFilterEntry(b) &&
        isFilterRefinement(/** @type {string} */ (b.filter), /** @type {string} */ (a.filter))
      ) {
        offenders.push(
          `#${b.n} ("${bFilter}") is a filter-refinement of #${a.n} ("${aFilter}") — the smaller set's filter literally adds tokens to the larger`,
        );
      }
    }
  }
  const unique = [...new Set(offenders)];
  assert.deepEqual(unique, [], '\n  ' + unique.join('\n  '));
});

// Rule 6, forward-looking: ideas are pre-promotion candidates. Each
// non-parked idea should be promote-eligible at any time — meaning its
// answer set must not be a strict subset/superset/equal of anything
// in live + backlog OR of any other non-parked idea. If it is, only
// one of the pair could ever become a puzzle without breaking rule 6,
// and keeping both in the ideas pool just hides the duplication.
// Parked ideas (parkUntilN set) are exempt — they're documented rule-6
// violators meant for past-#100 use.
//
// Without this test, the generator's within-batch rule-6 check is the
// only line of defense, and a hand-edit to daily_ideas.json could
// reintroduce duplicates silently. This puts teeth at the test level
// so `npm test` catches drift the moment it happens.
test('ideas: no filter-refinement relationships against catalog or other ideas', () => {
  // Refined rule 6 (see `live + backlog` test above for the rationale):
  // ideas can have answer-set overlap with catalog or other ideas as
  // long as the filters aren't structural refinements of each other.
  // Parked filters live in daily/daily_parked.json — intentional rule-6
  // violators kept as a waiting room — and aren't loaded here.
  /** @type {{ kind?: string, filter: string, answers?: string[], _label: string }[]} */
  const IDEAS = JSON.parse(
    readFileSync(join(CATALOG_DIR, 'ideas.json'), 'utf-8'),
  ).map((/** @type {any} */ e, /** @type {number} */ i) => ({ ...e, _label: `idea#${i + 1}` }));
  // Ideas are filter-only (the funnel for manual entries skips ideas),
  // and filter-refinement against a manual entry isn't a meaningful
  // relationship — the manual entry has no token vocabulary to be a
  // refinement of. Filter manuals out of the fixed set; equality
  // collisions between an idea and a manual remain an author judgment
  // call surfaced at promote time.
  const fixed = PUZZLES
    .filter(isFilterEntry)
    .map((e) => ({ ...e, filter: /** @type {string} */ (e.filter), _label: `puzzle#${e.n}` }));
  const candidates = IDEAS.filter(
    (e) => isFilterEntry(e) && Array.isArray(e.answers) && e.answers.length > 0,
  );

  /** @type {string[]} */
  const offenders = [];

  /**
   * Pair check. Returns a violation string when one of:
   *   - answer sets are equal (same puzzle, different filter)
   *   - one's filter is a strict refinement of the other AND its
   *     answer set is a strict subset of the other's
   *
   * @param {{filter: string, answers?: string[], _label: string}} a
   * @param {{filter: string, answers?: string[], _label: string}} b
   */
  const checkPair = (a, b) => {
    const aA = a.answers || [];
    const bA = b.answers || [];
    if (aA.length === 0 || bA.length === 0) return null;
    const aSet = new Set(aA);
    if (aA.length === bA.length) {
      return bA.every((c) => aSet.has(c))
        ? `${a._label} ("${a.filter}") and ${b._label} ("${b.filter}") resolve to the same answer set`
        : null;
    }
    const [smaller, larger] = aA.length < bA.length ? [a, b] : [b, a];
    const smallerA = smaller.answers || [];
    const largerA = larger.answers || [];
    const largerSet = new Set(largerA);
    const isAnswerSubset = smallerA.every((c) => largerSet.has(c));
    if (!isAnswerSubset) return null;
    if (!isFilterRefinement(smaller.filter, larger.filter)) return null;
    return `${smaller._label} ("${smaller.filter}") is a filter-refinement of ${larger._label} ("${larger.filter}")`;
  };

  // candidates vs fixed (live + backlog)
  for (const cand of candidates) {
    for (const fix of fixed) {
      const msg = checkPair(cand, fix);
      if (msg) offenders.push(msg);
    }
  }
  // candidates vs each other — each unordered pair once
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const msg = checkPair(candidates[i], candidates[j]);
      if (msg) offenders.push(msg);
    }
  }

  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// Every puzzle carries a hand-written helper sentence in every supported
// language. The sentence renders under the header to turn the pill chain
// ("Europe · cross") into a plain instruction ("Find all European flags
// with a cross") — without it, new players read the pill chain as a
// title rather than a filter spec and don't realise they need to find
// matching flags. Auto-generating the sentence from the filter was
// rejected because mixed include/exclude phrasing gets awkward in EN
// and the PL grammar (gendered adjectives, instrumental case) needs a
// human anyway. The test pins "every entry has both en and pl" so a
// new puzzle can't ship without copy.
// Manual entries pay an extra documentation tax — they're the only
// puzzles where the player has nothing else to read the framing from.
// Filter entries render a pill chain ("Europe · cross"); manual entries
// render only `entry.title[lang]`, so it has to be present in every
// supported language and non-empty.
test('puzzles: every manual + superlative entry has en + pl title', () => {
  // Both title-based kinds render `entry.title[lang]` where a filter entry
  // would render its pill chain, so the title must exist in both languages.
  /** @type {string[]} */
  const offenders = [];
  for (const entry of PUZZLES) {
    if (isFilterEntry(entry)) continue;
    const tt = /** @type {Record<string, string> | undefined} */ (entry.title);
    if (!tt) {
      offenders.push(`#${entry.n}: missing title`);
      continue;
    }
    for (const lang of ['en', 'pl']) {
      if (typeof tt[lang] !== 'string' || tt[lang].length === 0) {
        offenders.push(`#${entry.n}: missing or empty title.${lang}`);
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

test('puzzles: every entry has en + pl descriptions', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const entry of PUZZLES) {
    const d = /** @type {Record<string, string> | undefined} */ (entry.description);
    if (!d) {
      offenders.push(`#${entry.n}: missing description`);
      continue;
    }
    for (const lang of ['en', 'pl']) {
      if (typeof d[lang] !== 'string' || d[lang].length === 0) {
        offenders.push(`#${entry.n}: missing or empty description.${lang}`);
      }
    }
    // additionalDescription is optional (the sovereign-only line, absent on
    // rosters that include a home nation / territory), but when present it
    // pays the same en + pl tax — a half-translated note would show English
    // to Polish players.
    const ad = /** @type {Record<string, string> | undefined} */ (entry.additionalDescription);
    if (ad) {
      for (const lang of ['en', 'pl']) {
        if (typeof ad[lang] !== 'string' || ad[lang].length === 0) {
          offenders.push(`#${entry.n}: missing or empty additionalDescription.${lang}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// `notes` is optional (only non-obvious matches get one), but every note
// that IS present pays the same i18n tax as titles/descriptions: both
// `en` and `pl`, non-empty. A note may target either an *answer* (shown
// on the found/missed grid) OR a notable *distractor* — a wrong guess
// the player can still open from the "most common mistake" rail (e.g.
// Oman in an Asian-coat-of-arms puzzle: a weapon emblem, not a COA). So
// the code only has to be a real sovereign country code, not necessarily
// an answer; that still catches typos that would silently never render.
const NOTE_SOV_CODES = new Set(flagsGamePool(COUNTRIES, false).map((c) => c.code));
test('puzzles: every notes entry has en + pl and a valid country code', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const entry of PUZZLES) {
    const notes = /** @type {Record<string, Record<string, string>> | undefined} */ (entry.notes);
    if (!notes) continue;
    for (const [code, note] of Object.entries(notes)) {
      if (!NOTE_SOV_CODES.has(code)) {
        offenders.push(`#${entry.n}: note for "${code}" is not a sovereign country code`);
      }
      if (!note || typeof note !== 'object') {
        offenders.push(`#${entry.n}: note for "${code}" is not an object`);
        continue;
      }
      for (const lang of ['en', 'pl']) {
        if (typeof note[lang] !== 'string' || note[lang].length === 0) {
          offenders.push(`#${entry.n}: note for "${code}" missing or empty ${lang}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// Onboarding gate: in puzzles #1-100 every answer must also match under
// `primaryColors`. "Emblem-only" colour matches (Bolivia is "blue" only
// because its COA contains blue) read as "the game is wrong" in early
// play even when the data is technically correct. Past #100 a player has
// the muscle memory to read a surprise as trivia rather than a bug, so
// the rule is bounded.
test('puzzles: entries #1-100 are primary-clean (no emblem-only colour matches)', () => {
  const sov = flagsGamePool(COUNTRIES, false);
  for (const entry of PUZZLES) {
    if (entry.n > 100) continue;
    // Manual + superlative entries are filter-free (a superlative's optional
    // filter narrows a ranking pool, it isn't the answer set), so the
    // primary-clean rule — which resolves the filter under a stricter colour
    // model and compares to the whole answer set — doesn't apply here. The
    // author owns trust; for a compound superlative, resolve the roster under
    // `primaryColors` at authoring time (resolveSuperlative takes colorField).
    if (!isFilterEntry(entry)) continue;
    // Per-puzzle escape hatch — when set, the entry's answer set is
    // allowed to diverge between `colors` and `primaryColors`. Used for
    // the rare puzzle where excluding a primary-drift flag would gut
    // the category (e.g. Europe·black, where Malta's COA-only black
    // would be the only thing the primary-clean rule rejected, and
    // dropping Malta loses the "famous European black-element" feel).
    // Treat this flag as expensive — it pokes a hole in the rule's
    // onboarding-trust guardrail, so each use needs a curator's note.
    if (entry.primaryCleanExempt === true) continue;
    const filterStr = /** @type {string} */ (entry.filter);
    const f = parseFilterString(filterStr);
    assert.ok(f, `#${entry.n}: failed to parse filter "${filterStr}"`);
    const strict = sov
      .filter((c) =>
        matchesFilters(
          c,
          /** @type {import('./flagsFilter.js').Filters} */ (f),
          { colorField: 'primaryColors' },
        ),
      )
      .map((c) => c.code)
      .sort();
    const stored = [...entry.answers].sort();
    assert.deepEqual(
      strict,
      stored,
      `#${entry.n}: filter "${filterStr}" is not primary-clean — under primaryColors it resolves to [${strict.join(', ')}] but answers is [${stored.join(', ')}]. Onboarding (puzzles 1-100) forbids emblem-only colour matches.`,
    );
  }
});

// Rule 14 (hard) — once a token listed in `daily/daily_policy.json`
// has been used in a "find all X" puzzle, the player has seen every X
// flag. Future puzzles compounding X ("Africa + X", "X + animal") play
// as a recall puzzle dressed as a find puzzle and feel redundant.
// Small motif/colour properties are most prone to this because their
// compounds are tiny and contrived anyway. Continent tokens are
// deliberately NOT in the list — continents subdivide into
// recognizable subgroups (Europe + cross stays interesting even though
// "find all European flags" would also work as a puzzle).
//
// The list lives in `daily/daily_policy.json` rather than inline here
// so the author can add tokens by editing a data file with the same
// shape as the catalog files, no test-code edit required. Each entry
// carries the sovereign count + the rationale so the file is
// self-documenting.
/** @type {{ singleUseTokens: { token: string, sovs: number, reason: string }[] }} */
const POLICY = JSON.parse(
  readFileSync(join(CATALOG_DIR, 'policy.json'), 'utf-8'),
);

test('puzzles: single-use tokens appear in at most one entry', () => {
  const all = PUZZLES;
  for (const { token } of POLICY.singleUseTokens) {
    // Manual + superlative entries don't burn a single-use token: manual
    // has no filter, and a superlative's optional narrowing filter is a
    // pool restriction, not a "find all X" exposure of the token's full set.
    const uses = all.filter((e) => isFilterEntry(e) && e.filter?.split(',').includes(token));
    assert.ok(
      uses.length <= 1,
      `single-use token "${token}" appears in ${uses.length} entries (${uses.map((e) => '#' + e.n).join(', ')}); limit is 1 — see rule 14 / daily/daily_policy.json`,
    );
  }
});

test('LAUNCH_DATE: puzzle #1 anchored at 2026-06-06', () => {
  assert.equal(LAUNCH_DATE, '2026-06-06');
});

test('puzzleDate: n=1 is the launch day; n=N is launch + (N-1) days', () => {
  assert.equal(puzzleDate(1).toISOString(), '2026-06-06T00:00:00.000Z');
  assert.equal(puzzleDate(2).toISOString(), '2026-06-07T00:00:00.000Z');
  assert.equal(puzzleDate(6).toISOString(), '2026-06-11T00:00:00.000Z');
  // Crosses month boundary cleanly.
  assert.equal(puzzleDate(26).toISOString(), '2026-07-01T00:00:00.000Z');
});

test('puzzleDate: injectable launchDate (for fixtures that anchor elsewhere)', () => {
  assert.equal(puzzleDate(1, '2027-01-15').toISOString(), '2027-01-15T00:00:00.000Z');
  assert.equal(puzzleDate(10, '2027-01-15').toISOString(), '2027-01-24T00:00:00.000Z');
});

test('puzzleDate: throws for n < 1 (no zeroth puzzle)', () => {
  assert.throws(() => puzzleDate(0), /expected n ≥ 1/);
  assert.throws(() => puzzleDate(-3), /expected n ≥ 1/);
  assert.throws(() => puzzleDate(1.5), /expected n ≥ 1/);
});

test('formatPuzzleDate: DD.MM.YYYY format', () => {
  assert.equal(formatPuzzleDate(new Date('2026-06-06T00:00:00Z')), '06.06.2026');
  assert.equal(formatPuzzleDate(new Date('2026-12-31T00:00:00Z')), '31.12.2026');
  assert.equal(formatPuzzleDate(new Date('2027-01-01T00:00:00Z')), '01.01.2027');
});

// Feature DA hard rule: no live or backlog entry may contain a flag whose
// ambiguousColorCount or ambiguousColors tagging puts a player into the
// disagreement zone (their plausible count/membership call would flip
// answer-set membership). Scoped to the sovereign pool because daily
// puzzles only accept sovereign answers (rule 3) — a territory whose
// tagging would straddle a filter can't actually be offered as an
// answer, so it shouldn't false-positive. See flags/ambiguityAudit.js
// and DATA_FEATURE.md.
const SOV_FOR_AUDIT = flagsGamePool(COUNTRIES, false);

test('no puzzle has a flag-data ambiguity violation', () => {
  for (const entry of PUZZLES) {
    // Manual + superlative entries have no criterion filter — the audit's
    // "plausible count flips filter membership" logic doesn't apply. Author
    // owns judgment about ambiguous flags in the roster (for a compound
    // superlative, the flag-filter is a pool restriction, not the criterion).
    if (!isFilterEntry(entry)) continue;
    const filterStr = /** @type {string} */ (entry.filter);
    const violations = auditPuzzle({ filter: filterStr }, SOV_FOR_AUDIT);
    assert.equal(
      violations.length,
      0,
      `puzzles #${entry.n} (${filterStr}) has ambiguity violations:\n` +
        violations.map((v) => `  [${v.kind}] ${v.country}: ${v.detail}`).join('\n'),
    );
  }
});

test('no idea has a flag-data ambiguity violation', () => {
  // Mirrors the catalog/backlog checks against daily_ideas.json so the
  // batch generator's output also has to pass this gate — otherwise a
  // hand-promote from ideas → backlog could carry an ambig-broken
  // candidate that only the audit script would catch.
  /** @type {{ kind?: string, filter: string, answers?: string[] }[]} */
  const IDEAS = JSON.parse(
    readFileSync(join(CATALOG_DIR, 'ideas.json'), 'utf-8'),
  );
  for (const entry of IDEAS) {
    if (!isFilterEntry(entry)) continue;
    if (!Array.isArray(entry.answers) || entry.answers.length === 0) continue;
    const violations = auditPuzzle(entry, SOV_FOR_AUDIT);
    assert.equal(
      violations.length,
      0,
      `IDEA (${entry.filter}) has ambiguity violations:\n` +
        violations.map((v) => `  [${v.kind}] ${v.country}: ${v.detail}`).join('\n'),
    );
  }
});
