import { parseFilterString } from './findFlag.js';

/**
 * Daily-puzzle catalog helpers. Pure logic; no DOM, no fetch.
 *
 * Release model: the catalog is the source of truth for which puzzles
 * have been released. "Today's puzzle" is the last entry in the catalog
 * — there is no date math. Releasing puzzle N+1 means manually appending
 * its entry to daily/daily_puzzles.json (typically by moving the next
 * staged entry from daily/daily_backlog.json). The UI automatically
 * picks up the new last entry on next load.
 *
 * Why no dates: a calendar-driven counter looks tidy until you miss a
 * day or want to postpone, at which point the puzzle numbers and the
 * displayed dates fall out of sync and history looks broken. Manual
 * release keeps the numbering and the visible state always consistent
 * regardless of when (or whether) we publish.
 *
 * The catalog stores resolved answers (a list of country codes), not
 * just the filter that produced them — fixes to country data later
 * don't retroactively change historical puzzles.
 *
 * @typedef {Object} DailyPuzzle
 * @property {number} n
 * @property {string} filter   serialized filter, same form as the
 *                             findFlag chooser's `?f=` URL parameter
 * @property {string[]} answers  country codes the puzzle resolves to
 * @property {Record<string, string>} [description]  per-language helper
 *                             sentence shown under the header. Keys are
 *                             language codes (`en`, `pl`). Lets the player
 *                             read the pill chain as natural language —
 *                             "Find all European flags with a cross"
 *                             rather than parsing "Europe · cross" as a
 *                             filter spec. Hand-written per puzzle (no
 *                             auto-gen) so PL grammar lands correctly.
 *                             Typedef-optional so synthetic test fixtures
 *                             stay terse; runtime presence is pinned by
 *                             the description test in flags/daily.test.js.
 * @property {boolean} [primaryCleanExempt]  rare escape hatch — when true,
 *                             this entry opts out of the #1-100 primary-clean
 *                             test. Use sparingly; see SKILL.md rule 5.
 */

/**
 * Puzzle number for "today" — the last entry in the catalog. Returns 0
 * for an empty catalog (caller decides how to render that edge case).
 *
 * @param {DailyPuzzle[]} catalog
 * @returns {number}
 */
export function todayN(catalog) {
  return catalog.length;
}

/**
 * Look up puzzle #n in the catalog. Returns null when N is out of range
 * — callers show a "not found" copy and link back to today's puzzle.
 *
 * Throws on a miscounted catalog (entry.n != position + 1) rather than
 * silently misnumbering — a renumber bug here would corrupt history.
 *
 * @param {DailyPuzzle[]} catalog
 * @param {number} n
 * @returns {DailyPuzzle | null}
 */
export function getPuzzle(catalog, n) {
  if (n < 1 || n > catalog.length) return null;
  const entry = catalog[n - 1];
  if (entry.n !== n) {
    throw new Error(`Daily catalog mismatch: entry at index ${n - 1} has n=${entry.n}, expected ${n}`);
  }
  return entry;
}

/**
 * Parse `?n=…` out of a URL search string, falling back to today's
 * puzzle number. Garbage and missing values both fall back — the
 * deep-link form is purely additive over the bare `/daily/` URL.
 *
 * @param {string} search
 * @param {number} fallbackN
 * @returns {number}
 */
export function dailyNFromUrl(search, fallbackN) {
  const params = new URLSearchParams(search);
  const raw = params.get('n');
  if (raw === null) return fallbackN;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallbackN;
  return parsed;
}

/**
 * Parse `?replay=1` out of a URL search string. Any other value (or no
 * value at all) means "not a replay". Lives next to `dailyNFromUrl`
 * because both are pure URL-shape helpers used by daily/page.js.
 *
 * Replay mode is a read-only flag on the live daily page: it lets the
 * player retry a finished puzzle without overwriting the archive
 * score. The page wires this into two things — skipping the
 * "complete record → jump to result" shortcut, and skipping
 * `saveScore` in `finish()`.
 *
 * @param {string} search
 * @returns {boolean}
 */
export function isReplayFromUrl(search) {
  return new URLSearchParams(search).get('replay') === '1';
}

/**
 * Author/owner test mode — `?test=1`. When set, the daily page plays
 * the puzzle exactly as a real finish would *except* it skips the
 * server POST. Used to walk through give-up flows and result screens
 * without writing pollution rows to Cosmos (one such row from a 6-second
 * incognito give-up made puzzle #1's tile %s look like a bug — see
 * PR #322 background).
 *
 * Real players never get the flag (no UI surface mentions it). Same
 * strict-"1" check as `isReplayFromUrl` so a stray `?test=` or
 * `?test=true` can't accidentally suppress real submissions.
 *
 * @param {string} search
 * @returns {boolean}
 */
export function isTestModeFromUrl(search) {
  return new URLSearchParams(search).get('test') === '1';
}

/**
 * Discriminated union: success carries the entry, parsed Filters, and
 * the resolved Country[] for the game UI; failure carries a reason tag
 * the page maps to a localised message.
 *
 * @typedef {Object} DailyResolutionOk
 * @property {true} ok
 * @property {DailyPuzzle} entry
 * @property {import('./flagsFilter.js').Filters} filter
 * @property {import('./group.js').Country[]} targets
 *
 * @typedef {Object} DailyResolutionFail
 * @property {false} ok
 * @property {'not-found' | 'invalid-filter' | 'no-targets'} reason
 *
 * @typedef {DailyResolutionOk | DailyResolutionFail} DailyResolution
 */

/**
 * Resolve a daily-puzzle entry into the data the game UI needs.
 *
 * Pulls every error path out of daily/page.js — so each branch is
 * testable here against synthetic input instead of via mocked DOM and
 * fetch. The page glue becomes a switch over `result.reason` plus the
 * happy-path startGame call.
 *
 * Frozen-answers contract: targets are built from `entry.answers`
 * (the stored codes), never from re-resolving the filter against the
 * current data. Answer codes missing from `allCountries` are silently
 * dropped — country-pool drift gets surfaced as `no-targets` only if
 * *every* code goes missing. Partial drift is caught earlier, at
 * catalog-validation time, by the "every answer code is a known
 * sovereign country" test.
 *
 * @param {DailyPuzzle[]} catalog
 * @param {import('./group.js').Country[]} allCountries
 * @param {number} n
 * @returns {DailyResolution}
 */
export function resolveDailyPuzzle(catalog, allCountries, n) {
  const entry = getPuzzle(catalog, n);
  if (!entry) return { ok: false, reason: 'not-found' };
  return resolvePuzzleEntry(entry, allCountries);
}

/**
 * Look up a puzzle by its `n` field rather than its array position. The
 * backlog catalog continues numbering from where the live catalog left
 * off (e.g. backlog[0].n = 11, not 1), so the array-index lookup in
 * `getPuzzle` would mis-resolve. Returns null when no entry matches —
 * caller renders the not-found state.
 *
 * @param {DailyPuzzle[]} catalog
 * @param {number} n
 * @returns {DailyPuzzle | null}
 */
export function findPuzzle(catalog, n) {
  return catalog.find((e) => e.n === n) ?? null;
}

/**
 * Resolve an already-found puzzle entry into the data the game UI
 * needs. Shared between `resolveDailyPuzzle` (live catalog, sequential
 * lookup) and the backlog preview path (non-sequential lookup via
 * `findPuzzle`). See `resolveDailyPuzzle` for the frozen-answers
 * contract.
 *
 * @param {DailyPuzzle} entry
 * @param {import('./group.js').Country[]} allCountries
 * @returns {DailyResolution}
 */
export function resolvePuzzleEntry(entry, allCountries) {
  const filter = parseFilterString(entry.filter);
  if (!filter) return { ok: false, reason: 'invalid-filter' };

  const byCode = new Map(allCountries.map((c) => [c.code, c]));
  const targets = /** @type {import('./group.js').Country[]} */ (
    entry.answers.map((code) => byCode.get(code)).filter((c) => c !== undefined)
  );
  if (targets.length === 0) return { ok: false, reason: 'no-targets' };

  return { ok: true, entry, filter, targets };
}

/**
 * Detect whether `refined` is a strict filter-refinement of `base` —
 * i.e. `refined`'s tokens are a strict superset of `base`'s tokens.
 * Used by rule 6's enforcement layers to distinguish two cases:
 *
 *   - "Filter refinement": `Europe + cross + blue` adds `blue` to
 *     `Europe + cross`. The player reads this as "you just added blue
 *     to the puzzle you already solved" — clearly repetitive.
 *
 *   - "Answer-incidental overlap": `cross + !union-jack` and
 *     `NA + cross` share 3 flags but neither filter is a refinement
 *     of the other. The player reads these as two different puzzles
 *     that happen to overlap.
 *
 * Rule 6 strict-violates only when answer-set subset AND filter
 * refinement coincide. Pure answer-set overlap is allowed because the
 * framings differ enough that the player doesn't feel repetition.
 *
 * Tokens are compared as plain strings after a comma split — order
 * is irrelevant (set comparison), but exact spelling matters (so
 * `motif:union-jack` and `motif:!union-jack` are distinct tokens,
 * which is the correct semantic).
 *
 * Returns `false` for identical filters (a filter isn't a strict
 * refinement of itself) and for equal token sets in different
 * orders (same filter, different presentation).
 *
 * @param {string} refined
 * @param {string} base
 * @returns {boolean}
 */
export function isFilterRefinement(refined, base) {
  const r = new Set(refined.split(','));
  const b = new Set(base.split(','));
  if (r.size <= b.size) return false; // refined needs MORE tokens than base
  for (const t of b) {
    if (!r.has(t)) return false;
  }
  return true;
}
