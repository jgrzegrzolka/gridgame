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
/** @type {Array<'continent' | 'color' | 'motif' | 'status'>} */
const GROUP_ORDER = ['continent', 'color', 'motif', 'status'];

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
    const group = tok.slice(0, colon);
    let val = tok.slice(colon + 1);
    if (!val) continue;
    // Scalar primitive: `colorCount:N` constrains the country's full
    // palette size to exactly N. Doesn't take include/exclude — it's a
    // single integer, null means unconstrained.
    if (group === 'colorCount') {
      const n = Number.parseInt(val, 10);
      if (Number.isInteger(n) && n >= 0) {
        f.colorCount = n;
        any = true;
      }
      continue;
    }
    /** @type {'include' | 'exclude'} */
    let sign = 'include';
    if (val.startsWith('!')) {
      sign = 'exclude';
      val = val.slice(1);
    }
    if (!val) continue;
    if (!(group in f)) continue;
    const set = /** @type {any} */ (f)[group];
    if (!set || typeof set !== 'object' || !('include' in set)) continue;
    set[sign].add(val);
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
  if (f.colorCount !== null) tokens.push(`colorCount:${f.colorCount}`);
  return tokens.join(',');
}

/**
 * Translate the legacy `?cat=<id>` URL form into a single-include
 * Filters object. Old shared/bookmarked links keep working unchanged —
 * the parser at the page boundary just normalizes them into the new
 * shape before the game starts. Returns null for ids whose prefix the
 * chooser never emitted.
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
 * Render a single pill's display label in the active language. Includes
 * render as the bare noun ("Africa", "orange", "cross"); excludes are
 * prefixed with the localized lowercase "not " so a multi-pill mix
 * reads naturally — e.g. "Africa · orange · not cross". Lowercase
 * matches the lowercase colour / motif nouns the prefix sits next to;
 * the trade-off is that a standalone exclude filter renders with a
 * lowercase initial ("not cross"), but the daily catalog never starts
 * a title with an exclude and the explorer power-user case is rare.
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
    body = translate(`color.${value}`, value);
  } else if (group === 'motif') {
    body = translate(`motif.${value}`, value);
  } else {
    body = translate(`status.${value}`, value);
  }
  if (sign === 'exclude') {
    return `${translate('findFlag.notPrefix', 'not ')}${body}`;
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
 * 50% chance of 2, 30% chance of 3, 20% chance of 4. Bottom-heavy
 * because under AND-within-group semantics each extra pill tightens
 * the result fast — 4-pill mixes often collapse to a single flag.
 * Never returns 1: single-pill plays are exactly what the user gets
 * by clicking a pill in the chooser, so Random always delivers a real
 * mix.
 *
 * @param {() => number} rng
 * @returns {2 | 3 | 4}
 */
function pickMixSize(rng) {
  const r = rng();
  if (r < 0.5) return 2;
  if (r < 0.8) return 3;
  return 4;
}

/** Scalar groups — a country has exactly one value, so two distinct
 * values AND-ed together can never match. The picker enforces "max 1
 * pill per scalar group" to keep mixes satisfiable. */
const SCALAR_GROUPS = new Set(/** @type {Array<keyof Filters>} */ (['continent', 'status']));

/**
 * Generate a random filter for the chooser's "Random" button. Picks
 * 2-4 distinct pills from the pool — never 1, since a single-pill
 * play is exactly what the user gets by clicking a pill themselves
 * in the chooser. Scalar groups (continent, status) contribute at
 * most one pill each (two distinct values AND-ed are unsatisfiable);
 * array groups (colors, motifs) may contribute several since
 * AND-within-group just narrows the result.
 *
 * Each pill defaults to include, with `excludeProbability` chance of
 * flipping to exclude. Retries up to `maxAttempts` times until the
 * mix has at least `minIntersection` matching countries (default 1).
 * If no attempt meets the threshold, returns the last attempt anyway
 * — the result page lands on a 0-flag mix, which startGame's
 * targets.length < 1 guard bounces back to the chooser.
 *
 * @param {Array<{ group: 'continent' | 'color' | 'motif' | 'status', value: string }>} pillPool
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
    minIntersection = 1,
    maxAttempts = 20,
    excludeProbability = 0.2,
  } = options;

  // A 2+ pill mix needs at least 2 pills to draw from; degenerate
  // pools fall through to "no filter" so the caller can bounce to
  // the chooser rather than start a one-pill round dressed as Random.
  if (pillPool.length < 2) return emptyFilters();

  /** @type {Filters | null} */
  let lastAttempt = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const wantN = Math.min(pickMixSize(rng), pillPool.length);
    /** @type {typeof pillPool} */
    let remaining = pillPool.slice();
    const f = emptyFilters();
    let picked = 0;
    while (picked < wantN && remaining.length > 0) {
      const idx = Math.floor(rng() * remaining.length);
      const pill = remaining[idx];
      const useExclude = rng() < excludeProbability;
      f[pill.group][useExclude ? 'exclude' : 'include'].add(pill.value);
      picked++;
      // Drop the picked pill, plus any other pill in the same scalar
      // group — two continents AND-ed is empty by construction, so we
      // never want a second scalar pick in the same group.
      remaining = remaining.filter(
        (p, i) => i !== idx && !(SCALAR_GROUPS.has(p.group) && p.group === pill.group),
      );
    }
    lastAttempt = f;
    const count = all.filter((c) => matchesFilters(c, f)).length;
    if (count >= minIntersection) return f;
  }

  return lastAttempt ?? emptyFilters();
}
