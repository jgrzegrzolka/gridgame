/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./engine.js').Category} Category */
/** @typedef {import('./flagsFilter.js').Filters} Filters */

import { categoryFromId as gridCategoryFromId } from './engine.js';
import { readBoolSetting, writeBoolSetting } from './group.js';
import { emptyFilters, matchesFilters } from './flagsFilter.js';

// Re-exported so existing findFlag callers don't need to update their import.
// The implementation lives in engine.js next to the category factories.
export const categoryFromId = gridCategoryFromId;

/**
 * Filter-group names in the order they should appear in titles and URLs.
 * Status is included for completeness — the findFlag chooser doesn't
 * surface it, but legacy rehydration via `?cat=statehood:…` still maps
 * through this list to keep round-trips total.
 *
 * @type {Array<keyof Filters>}
 */
const GROUP_ORDER = ['continent', 'color', 'motif', 'status'];

/**
 * Maps a Filters group name to the legacy category-id prefix used in
 * stats storage keys and the old `?cat=…` URL form. Keeps best-score
 * persistence stable across the chooser refactor: a single-include
 * filter on `color:red` still saves under `findflag.best.hasColor:red`,
 * not `findflag.best.color:red`.
 *
 * @type {Record<keyof Filters, string>}
 */
const LEGACY_PREFIX = {
  continent: 'continent',
  color: 'hasColor',
  motif: 'hasMotif',
  status: 'statehood',
};

const FIND_INCLUDE_ALL_KEY = 'gridgame.flagfind.includeAll';

/**
 * @param {{ getItem(key: string): string | null } | null | undefined} [store]
 */
export function isFindIncludeAll(store) {
  return readBoolSetting(store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null), FIND_INCLUDE_ALL_KEY);
}

/**
 * @param {{ setItem(key: string, value: string): void, removeItem(key: string): void }} store
 * @param {boolean} value
 */
export function setFindIncludeAll(store, value) {
  writeBoolSetting(store, FIND_INCLUDE_ALL_KEY, value);
}

/**
 * @param {Country[]} allCountries
 * @param {Category} category
 * @returns {Country[]}
 */
export function findTargets(allCountries, category) {
  return allCountries.filter((c) => category.predicate(c));
}

/**
 * Pass-through; kept so callers have a stable export to use even though
 * we no longer apply an engine-level scope filter — scope is decided at
 * the page level via flagsGamePool.
 * @param {Country[]} allCountries
 * @returns {Country[]}
 */
export function findPool(allCountries) {
  return allCountries;
}

/**
 * @typedef {Object} FindState
 * @property {Set<string>} targetCodes
 * @property {Set<string>} foundCodes
 */

/**
 * @typedef {{ kind: 'match' | 'duplicate' | 'wrong-category' | 'unknown' }} GuessOutcome
 */

/**
 * @param {FindState} state
 * @param {Country | null | undefined} country
 * @returns {GuessOutcome}
 */
export function classifyGuess(state, country) {
  if (!country) return { kind: 'unknown' };
  const inTargets = state.targetCodes.has(country.code);
  if (inTargets && !state.foundCodes.has(country.code)) {
    return { kind: 'match' };
  }
  if (inTargets) {
    return { kind: 'duplicate' };
  }
  return { kind: 'wrong-category' };
}

/**
 * @typedef {Object} FindBest
 * @property {number} time
 * @property {number} found
 * @property {number} total
 */

/**
 * @param {string} categoryId
 * @param {boolean} [includeAll]
 * @returns {string}
 */
export function bestKey(categoryId, includeAll = false) {
  const base = `findflag.best.${categoryId}`;
  return includeAll ? `${base}.all` : base;
}

/**
 * @param {{ getItem(key: string): string | null }} store
 * @param {string} categoryId
 * @param {boolean} [includeAll]
 * @returns {FindBest | null}
 */
export function loadBest(store, categoryId, includeAll = false) {
  try {
    const raw = store.getItem(bestKey(categoryId, includeAll));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.time === 'number' &&
      typeof parsed.found === 'number' &&
      typeof parsed.total === 'number'
    ) {
      return { time: parsed.time, found: parsed.found, total: parsed.total };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{ setItem(key: string, value: string): void }} store
 * @param {string} categoryId
 * @param {FindBest} best
 * @param {boolean} [includeAll]
 */
export function saveBest(store, categoryId, best, includeAll = false) {
  try {
    store.setItem(bestKey(categoryId, includeAll), JSON.stringify(best));
  } catch {
    // localStorage may throw in private mode / zero quota; degrade silently.
  }
}

/**
 * @param {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} store
 * @param {string} categoryId
 * @param {FindBest} current
 * @param {boolean} [includeAll]
 * @returns {{ best: FindBest, isNew: boolean }}
 */
export function recordFindResult(store, categoryId, current, includeAll = false) {
  const prev = loadBest(store, categoryId, includeAll);
  const isNew =
    !prev ||
    current.found > prev.found ||
    (current.found === prev.found && current.time < prev.time);
  if (isNew) saveBest(store, categoryId, current, includeAll);
  return { best: isNew ? current : prev ?? current, isNew };
}

/**
 * Confetti rule for the find-flag page: a clean sweep (found === total)
 * always celebrates, even if a previous faster sweep means there's no
 * new record; a new record (better partial result than before) also
 * fires, so a give-up that still beat your previous best feels rewarded.
 *
 * @param {{ found: number, total: number, isNew: boolean }} params
 * @returns {boolean}
 */
export function shouldFireFindFlagConfetti({ found, total, isNew }) {
  return found === total || isNew;
}

/**
 * Parse a serialized filter token list back into a Filters object.
 *
 * Format: comma-separated tokens of the form `<group>:<value>` (include)
 * or `<group>:!<value>` (exclude). Group names are the Filters keys
 * (`continent` / `color` / `motif` / `status`). Unknown groups are
 * skipped; empty tokens are ignored. Returns null when nothing parses
 * — so an empty `?f=` and a malformed `?f=garbage` both fall through to
 * the chooser rather than rendering a useless game with zero targets.
 *
 * Sign uses `!` rather than `+`/`-` because URLSearchParams encodes
 * spaces as `+` in some browsers, and the spaceless sign avoids the
 * collision with continent names like "North America".
 *
 * @param {string} s
 * @returns {Filters | null}
 */
export function parseFilterString(s) {
  const f = emptyFilters();
  let any = false;
  for (const rawTok of s.split(',')) {
    const tok = rawTok.trim();
    if (!tok) continue;
    const colon = tok.indexOf(':');
    if (colon < 0) continue;
    const group = /** @type {keyof Filters} */ (tok.slice(0, colon));
    let val = tok.slice(colon + 1);
    /** @type {'include' | 'exclude'} */
    let sign = 'include';
    if (val.startsWith('!')) {
      sign = 'exclude';
      val = val.slice(1);
    }
    if (!val) continue;
    if (!(group in f)) continue;
    f[group][sign].add(val);
    any = true;
  }
  return any ? f : null;
}

/**
 * Serialize a Filters object back to the `?f=…` token list shape that
 * `parseFilterString` consumes. Tokens come out in GROUP_ORDER (and
 * includes before excludes within a group) so the serialized form is
 * deterministic — important for stable shareable links and for snapshot
 * tests.
 *
 * @param {Filters} f
 * @returns {string}
 */
export function serializeFilter(f) {
  /** @type {string[]} */
  const tokens = [];
  for (const group of GROUP_ORDER) {
    for (const v of f[group].include) tokens.push(`${group}:${v}`);
    for (const v of f[group].exclude) tokens.push(`${group}:!${v}`);
  }
  return tokens.join(',');
}

/**
 * Translate the legacy `?cat=<id>` URL form into a single-include
 * Filters object. Old shared/bookmarked links (and the stats page's
 * "click to play" rows) keep working unchanged — the parser at the page
 * boundary just normalizes them into the new shape before the game
 * starts. Returns null for ids whose prefix the chooser never emitted.
 *
 * @param {string} cat
 * @returns {Filters | null}
 */
export function filterFromLegacyCat(cat) {
  const f = emptyFilters();
  if (cat.startsWith('continent:')) {
    f.continent.include.add(cat.slice('continent:'.length));
    return f;
  }
  if (cat.startsWith('hasColor:')) {
    f.color.include.add(cat.slice('hasColor:'.length));
    return f;
  }
  if (cat.startsWith('hasMotif:')) {
    f.motif.include.add(cat.slice('hasMotif:'.length));
    return f;
  }
  if (cat.startsWith('statehood:')) {
    f.status.include.add(cat.slice('statehood:'.length));
    return f;
  }
  return null;
}

/**
 * Resolve a Filters object from a URL query string. Prefers the new
 * `f=` form; falls back to the legacy `cat=` form so old links keep
 * working. Returns null when neither is set (or both are empty/
 * unparseable) — the page treats that as "show the chooser".
 *
 * @param {string} search
 * @returns {Filters | null}
 */
export function parseFilterFromUrl(search) {
  const params = new URLSearchParams(search);
  const f = params.get('f');
  if (f) {
    const parsed = parseFilterString(f);
    if (parsed) return parsed;
  }
  const cat = params.get('cat');
  if (cat) return filterFromLegacyCat(cat);
  return null;
}

/**
 * True iff the filter is a single positive selection — one value
 * included, no excludes, in any group. Defines the boundary between
 * "ranked play" (best-score persisted, the same leaderboard as before
 * the chooser refactor) and "mix play" (no record kept). Mixing or
 * excluding is unranked even with one pill on.
 *
 * @param {Filters} f
 * @returns {boolean}
 */
export function isRankedFilter(f) {
  let includes = 0;
  for (const group of GROUP_ORDER) {
    if (f[group].exclude.size > 0) return false;
    includes += f[group].include.size;
    if (includes > 1) return false;
  }
  return includes === 1;
}

/**
 * Returns the legacy category id (`continent:Africa`, `hasColor:red`,
 * `hasMotif:weapon`, `statehood:sovereign`) for a ranked filter, or null
 * when the filter isn't ranked. Used as the best-score storage key so a
 * ranked play under the new chooser writes to the same slot a pre-
 * refactor play would have.
 *
 * @param {Filters} f
 * @returns {string | null}
 */
export function rankedCategoryId(f) {
  if (!isRankedFilter(f)) return null;
  for (const group of GROUP_ORDER) {
    if (f[group].include.size === 1) {
      const [v] = f[group].include;
      return `${LEGACY_PREFIX[group]}:${v}`;
    }
  }
  return null;
}

/**
 * Render a single pill's display label in the active language. Includes
 * use the same "Africa" / "Has orange" wording as the existing chooser;
 * excludes are prefixed with the localized "Not " so a multi-pill mix
 * reads naturally — e.g. "Africa · Has orange · Not cross".
 *
 * @param {keyof Filters} group
 * @param {string} value
 * @param {'include' | 'exclude'} sign
 * @param {(key: string, fallback: string) => string} translate
 * @returns {string}
 */
export function pillLabel(group, value, sign, translate) {
  /** @type {string} */
  let body;
  if (group === 'continent') {
    body = translate(`variant.${value.toLowerCase().replace(/ /g, '-')}`, value);
  } else if (group === 'color') {
    const colorName = translate(`color.${value}`, value);
    body =
      sign === 'include'
        ? translate('game.has', 'Has {x}').replace('{x}', colorName)
        : colorName;
  } else if (group === 'motif') {
    const motifName = translate(`motif.${value}`, value);
    body =
      sign === 'include'
        ? translate('game.has', 'Has {x}').replace('{x}', motifName)
        : motifName;
  } else {
    body = translate(`status.${value}`, value);
  }
  if (sign === 'exclude') {
    return `${translate('findFlag.notPrefix', 'Not ')}${body}`;
  }
  return body;
}

/**
 * Build a human-readable title for a filter — "Africa · Has orange ·
 * Not cross". Used as the game-screen header for both single-pill plays
 * (matches the old per-category title) and mixes (which the old chooser
 * couldn't produce). Empty filter → empty string.
 *
 * @param {Filters} f
 * @param {(key: string, fallback: string) => string} translate
 * @returns {string}
 */
export function filterTitle(f, translate) {
  /** @type {string[]} */
  const parts = [];
  for (const group of GROUP_ORDER) {
    for (const v of f[group].include) parts.push(pillLabel(group, v, 'include', translate));
    for (const v of f[group].exclude) parts.push(pillLabel(group, v, 'exclude', translate));
  }
  return parts.join(' · ');
}

/**
 * Wrap a Filters object as a synthetic Category so the existing
 * `findTargets` / `classifyGuess` pipeline can stay unchanged. The id
 * is stable (the serialized filter) so two filters that mean the same
 * thing produce the same id — handy for debug, not load-bearing for
 * persistence (best-score storage routes through `rankedCategoryId`).
 *
 * @param {Filters} f
 * @param {(key: string, fallback: string) => string} translate
 * @returns {Category}
 */
export function filterToCategory(f, translate) {
  return {
    id: `find:${serializeFilter(f)}`,
    label: filterTitle(f, translate),
    predicate: (c) => matchesFilters(c, f),
  };
}

/**
 * Weighted pick for "how many pills should a random mix include":
 * 30% chance of 1, 50% chance of 2, 20% chance of 3. Biased toward 2
 * because that's where mix mode actually shines — three-way
 * intersections often collapse to a tiny set, and single-pill plays
 * are exactly what the user can get by clicking a pill themselves.
 *
 * @param {() => number} rng
 * @returns {1 | 2 | 3}
 */
function pickMixSize(rng) {
  const r = rng();
  if (r < 0.3) return 1;
  if (r < 0.8) return 2;
  return 3;
}

/**
 * Pick `n` distinct entries from `arr` without replacement, in random
 * order. Used to sample group keys for the mix picker; small-n so a
 * splice-based loop is fine.
 *
 * @template T
 * @param {T[]} arr
 * @param {number} n
 * @param {() => number} rng
 * @returns {T[]}
 */
function pickN(arr, n, rng) {
  const remaining = arr.slice();
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < n && remaining.length > 0; i++) {
    const j = Math.floor(rng() * remaining.length);
    out.push(remaining[j]);
    remaining.splice(j, 1);
  }
  return out;
}

/**
 * Generate a random filter for the chooser's "Random" button. Pulls
 * 1-3 distinct groups from the available pill pool, picks one value
 * per group, and marks it include — always when only one pill is
 * chosen (which keeps single-pill randoms ranked, matching the
 * pre-mix behavior), otherwise mostly include with a small
 * `excludeProbability` chance of flipping to exclude per pill.
 *
 * Retries up to `maxAttempts` times if the resulting intersection is
 * too small to be fun; falls back to a single-include pill when no
 * mix above `minIntersection` shows up. The fallback also covers the
 * degenerate "pillPool is empty" case (returns an empty filter then).
 *
 * Why "at most one pill per group": continents are mutually
 * exclusive (Africa AND Europe = empty), and multi-include within
 * one group widens (OR-semantics among values) rather than tightens
 * — neither makes for an interesting random mix. Cross-group AND is
 * the move.
 *
 * @param {Array<{ group: keyof Filters, value: string }>} pillPool
 * @param {Country[]} all
 * @param {{
 *   rng?: () => number,
 *   minIntersection?: number,
 *   maxAttempts?: number,
 *   excludeProbability?: number,
 * }} [options]
 * @returns {Filters}
 */
export function pickRandomMix(pillPool, all, options = {}) {
  const {
    rng = Math.random,
    minIntersection = 3,
    maxAttempts = 20,
    excludeProbability = 0.2,
  } = options;

  /** @type {Map<keyof Filters, Array<{ group: keyof Filters, value: string }>>} */
  const byGroup = new Map();
  for (const p of pillPool) {
    const bucket = byGroup.get(p.group);
    if (bucket) bucket.push(p);
    else byGroup.set(p.group, [p]);
  }
  const groups = [...byGroup.keys()];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const wantN = Math.min(pickMixSize(rng), groups.length);
    const chosenGroups = pickN(groups, wantN, rng);
    const f = emptyFilters();
    for (const g of chosenGroups) {
      const groupPills = /** @type {Array<{ group: keyof Filters, value: string }>} */ (
        byGroup.get(g)
      );
      const pill = groupPills[Math.floor(rng() * groupPills.length)];
      const useExclude = wantN >= 2 && rng() < excludeProbability;
      f[g][useExclude ? 'exclude' : 'include'].add(pill.value);
    }
    const count = all.filter((c) => matchesFilters(c, f)).length;
    if (count >= minIntersection) return f;
  }

  const fallback = emptyFilters();
  if (pillPool.length > 0) {
    const pick = pillPool[Math.floor(rng() * pillPool.length)];
    fallback[pick.group].include.add(pick.value);
  }
  return fallback;
}
