/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./engine.js').Category} Category */
/** @typedef {import('./flagsFilter.js').Filters} Filters */

import { readBoolSetting, writeBoolSetting } from './group.js';
import { emptyFilters, matchesFilters, COLOR_COUNT_OPS, COLOR_COUNT_NS } from './flagsFilter.js';
import { THRESHOLD_METRICS, METRIC_KEYS, parseThreshold } from './engine.js';

/**
 * Filter-group names in the order they should appear in titles and URLs.
 * Status is included for completeness — the findFlag chooser doesn't
 * surface it, but legacy rehydration via `?cat=statehood:…` still maps
 * through this list to keep round-trips total.
 *
 * @type {Array<'continent' | 'color' | 'motif' | 'status' | 'stripesOnly'>}
 */
const GROUP_ORDER = ['continent', 'color', 'motif', 'status', 'stripesOnly'];

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
    // Scalar primitive: constrains the country's full palette size.
    //   colorCount:N    → exactly N (bare form, back-compat with daily
    //                     catalog entries that pre-date the op syntax)
    //   colorCount:=N   → exactly N (explicit)
    //   colorCount:>=N  → N or more
    //   colorCount:<=N  → N or fewer
    // Doesn't take include/exclude — `!` prefix is meaningless on a
    // scalar comparison and is silently dropped.
    if (group === 'colorCount') {
      /** @type {'=' | '>=' | '<='} */
      let op = '=';
      let nStr = val;
      if (val.startsWith('>=')) { op = '>='; nStr = val.slice(2); }
      else if (val.startsWith('<=')) { op = '<='; nStr = val.slice(2); }
      else if (val.startsWith('=')) { nStr = val.slice(1); }
      const n = Number.parseInt(nStr, 10);
      if (Number.isInteger(n) && n >= 0 && String(n) === nStr) {
        f.colorCount = { op, n };
        any = true;
      }
      continue;
    }
    // Scalar threshold world-metrics (population / area / density / …): always
    // an explicit op — `population:>=10000000` / `density:<=10` — matching the
    // engine's `<metric>:` category id so findFlag links and TTT category ids
    // share one vocabulary. No `=` op and no include/exclude sign: a threshold,
    // not a value set. One generic parse over the registered metric keys.
    if (METRIC_KEYS.includes(group)) {
      const parsed = parseThreshold(val);
      if (parsed) {
        /** @type {any} */ (f)[group] = { op: parsed.op, n: parsed.n };
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
  if (f.colorCount !== null) {
    // Emit the bare form `colorCount:N` for the `=` op so existing
    // shareable URLs and the 23 daily catalog entries that pre-date the
    // op syntax round-trip byte-identical. `>=` and `<=` always emit
    // the explicit form.
    const { op, n } = f.colorCount;
    tokens.push(op === '=' ? `colorCount:${n}` : `colorCount:${op}${n}`);
  }
  // Threshold world-metrics, in registry order (stable, deterministic URLs).
  for (const key of METRIC_KEYS) {
    const flt = /** @type {any} */ (f)[key];
    if (flt) tokens.push(`${key}:${flt.op}${flt.n}`);
  }
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
  if (cat.startsWith('stripesOnly:')) {
    f.stripesOnly.include.add(cat.slice('stripesOnly:'.length));
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
  } else if (group === 'stripesOnly') {
    body = translate(`stripesOnly.${value}`, `${value} stripes only`);
  } else if (group === 'colorCount') {
    // colorCount is a scalar; the "value" echoes the URL-suffix form:
    //   "N" or "=N" → exactly N, via filter.onlyN.<n>
    //   ">=N"       → N or more, via filter.atLeastN.<n>
    //   "<=N"       → N or fewer, via filter.atMostN.<n>
    // Doesn't support exclude — the primitive itself is scalar, you
    // either constrain to N or you don't.
    if (value.startsWith('>=')) {
      const n = value.slice(2);
      return translate(`filter.atLeastN.${n}`, `${n} or more colours`);
    }
    if (value.startsWith('<=')) {
      const n = value.slice(2);
      return translate(`filter.atMostN.${n}`, `${n} or fewer colours`);
    }
    const n = value.startsWith('=') ? value.slice(1) : value;
    return translate(`filter.onlyN.${n}`, `only ${n} colours`);
  } else if (THRESHOLD_METRICS[group]) {
    // Scalar threshold world-metric (population / area / density / …). The
    // "value" echoes the id suffix (">=N" / "<=N"); the metric's own `labelFor`
    // renders the localized threshold text, keyed identically to the TTT
    // category label (engine.js translateCategoryLabel). No exclude — the
    // primitive is a threshold, you either constrain it or you don't.
    const parsed = parseThreshold(value);
    if (parsed) return THRESHOLD_METRICS[group].labelFor(parsed.op, parsed.n, translate);
    return value;
  } else {
    body = translate(`status.${value}`, value);
  }
  if (sign === 'exclude') {
    return `${translate('findFlag.notPrefix', 'not ')}${excludeBody(group, value, body, translate)}`;
  }
  return body;
}

/**
 * Pick the noun form that reads correctly after the localized exclude
 * prefix. English "not " takes the bare nominative ("not blue"), but
 * Polish "bez " governs the genitive ("bez niebieskiego", not "bez
 * niebieski"). We look up a per-language genitive override keyed by
 * group + value and fall back to the nominative `body` when none exists
 * — so English (which has no override table) renders unchanged, and any
 * untranslated value degrades gracefully to its base form instead of
 * throwing. Only colour and motif are inflected: those are the groups
 * that actually appear as excludes in titles, and the home page already
 * pins the genitive shape with `notCrescent: "bez półksiężyca"`.
 *
 * @param {keyof Filters} group
 * @param {string} value
 * @param {string} body - the nominative form, used as the fallback
 * @param {(key: string, fallback: string) => string} translate
 * @returns {string}
 */
function excludeBody(group, value, body, translate) {
  if (group === 'color') return translate(`colorExclude.${value}`, body);
  if (group === 'motif') return translate(`motifExclude.${value}`, body);
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
  if (f.colorCount !== null) {
    const { op, n } = f.colorCount;
    if (op === '>=') parts.push(translate(`filter.atLeastN.${n}`, `${n} or more colours`));
    else if (op === '<=') parts.push(translate(`filter.atMostN.${n}`, `${n} or fewer colours`));
    else parts.push(translate(`filter.onlyN.${n}`, `only ${n} colours`));
  }
  for (const key of METRIC_KEYS) {
    const flt = /** @type {any} */ (f)[key];
    if (flt) parts.push(pillLabel(/** @type {any} */ (key), `${flt.op}${flt.n}`, 'include', translate));
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
const SCALAR_GROUPS = new Set(/** @type {Array<keyof Filters>} */ (['continent', 'status', 'stripesOnly']));

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
 * flipping to exclude. After picking pills, two further modifiers
 * may attach a `colorCount` constraint:
 *   - `onlyColorsProbability`: when at least one colour pill is in
 *     the include set, this is the chance of locking colorCount to
 *     exactly that count — i.e. "only these colours". Matches what
 *     the chooser's "no other colours" toggle produces.
 *   - `colorCountProbability`: independent chance of attaching a
 *     random colorCount constraint (any op + N from the picker's
 *     valid set), regardless of how many colours are in the mix.
 *     Only checked when the "only colours" modifier didn't fire.
 *
 * Both modifier probabilities default to 0 so existing callers
 * (and tests) get the pre-existing pill-only behaviour without
 * change. findFlag/page.js opts in for the live Random button.
 *
 * Retries up to `maxAttempts` times until the mix has at least
 * `minIntersection` matching countries (default 1). If no attempt
 * meets the threshold, returns the last attempt anyway — the
 * result page lands on a 0-flag mix, which startGame's
 * targets.length < 1 guard bounces back to the chooser.
 *
 * @param {Array<{ group: 'continent' | 'color' | 'motif' | 'status' | 'stripesOnly', value: string }>} pillPool
 * @param {Country[]} all
 * @param {{
 *   rng?: () => number,
 *   minIntersection?: number,
 *   maxAttempts?: number,
 *   excludeProbability?: number,
 *   onlyColorsProbability?: number,
 *   colorCountProbability?: number,
 *   populationProbability?: number,
 *   areaProbability?: number,
 *   densityProbability?: number,
 *   gdpProbability?: number,
 *   gdpPerCapitaProbability?: number,
 *   coffeeProbability?: number,
 *   wineProbability?: number,
 *   cocoaProbability?: number,
 *   bananaProbability?: number,
 *   appleProbability?: number,
 *   elevationProbability?: number,
 *   coastlineProbability?: number,
 *   forestProbability?: number,
 * }} [options]
 * @returns {Filters}
 */
export function pickRandomMix(pillPool, all, options = {}) {
  const {
    rng = Math.random,
    minIntersection = 1,
    maxAttempts = 20,
    excludeProbability = 0.2,
    onlyColorsProbability = 0,
    colorCountProbability = 0,
    populationProbability = 0,
    areaProbability = 0,
    densityProbability = 0,
    gdpProbability = 0,
    gdpPerCapitaProbability = 0,
    coffeeProbability = 0,
    wineProbability = 0,
    cocoaProbability = 0,
    bananaProbability = 0,
    appleProbability = 0,
    elevationProbability = 0,
    coastlineProbability = 0,
    forestProbability = 0,
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
    maybeAttachColorCount(f, rng, onlyColorsProbability, colorCountProbability);
    // Threshold metrics, drawn in registry order. Each is mutually exclusive
    // with colorCount and with every other metric (at most one scalar modifier
    // per mix), so only the first drawn attaches; a 0-probability metric
    // consumes zero rng bytes, keeping seeded pill-only tests deterministic.
    /** @type {Record<string, number>} */
    const metricProbabilities = {
      population: populationProbability,
      area: areaProbability,
      density: densityProbability,
      gdp: gdpProbability,
      gdpPerCapita: gdpPerCapitaProbability,
      coffee: coffeeProbability,
      wine: wineProbability,
      cocoa: cocoaProbability,
      banana: bananaProbability,
      apple: appleProbability,
      elevation: elevationProbability,
      coastline: coastlineProbability,
      forest: forestProbability,
    };
    for (const key of METRIC_KEYS) maybeAttachMetric(f, rng, key, metricProbabilities[key] ?? 0);
    lastAttempt = f;
    const count = all.filter((c) => matchesFilters(c, f)).length;
    if (count >= minIntersection) return f;
  }

  return lastAttempt ?? emptyFilters();
}

/**
 * Mutate `f` to attach a `colorCount` constraint with the given
 * probabilities. The two paths are mutually exclusive: the
 * "no other colours" path runs first and short-circuits when it
 * fires. Each path is gated on its probability being > 0 BEFORE the
 * rng() call so a caller that opts out (probability 0) consumes
 * exactly zero rng bytes — keeping the pre-existing pill-only tests
 * deterministic against their seeded RNGs.
 *
 * Skipped entirely when the mix already constrains `stripesOnly`. A
 * pure-stripes flag has a tightly-determined palette (usually 2 or 3
 * colours), so layering a colorCount constraint on top almost always
 * either restates that fact ("horizontal stripes only" + "exactly 3
 * colours" → most pure tricolours already match) or breaks the mix
 * down to a single flag. The simpler shape reads better in the puzzle
 * title and matches more flags.
 *
 * @param {Filters} f
 * @param {() => number} rng
 * @param {number} onlyColorsProbability
 * @param {number} colorCountProbability
 */
function maybeAttachColorCount(f, rng, onlyColorsProbability, colorCountProbability) {
  if (f.stripesOnly.include.size > 0 || f.stripesOnly.exclude.size > 0) return;
  const includeColors = f.color.include.size;
  if (includeColors > 0 && onlyColorsProbability > 0 && rng() < onlyColorsProbability) {
    f.colorCount = { op: '=', n: includeColors };
    return;
  }
  if (colorCountProbability > 0 && rng() < colorCountProbability) {
    const op = COLOR_COUNT_OPS[Math.floor(rng() * COLOR_COUNT_OPS.length)];
    const n = COLOR_COUNT_NS[Math.floor(rng() * COLOR_COUNT_NS.length)];
    f.colorCount = { op, n };
  }
}

/**
 * Mutate `f` to attach a `population` threshold with probability
 * `populationProbability`, drawing one of the six curated tiers from
 * `POPULATION_BREAKS_FOR_RANDOM` (the same set the TTT generator uses, so
 * the two surfaces can't drift on what counts as a tier). Uniform pick, so
 * every tier is reachable by Random — the coverage half of the findFlag
 * random-mix contract (see the findflag-random-coverage skill).
 *
 * Kept mutually exclusive with `colorCount`: skipped when the mix already
 * carries a colour-count constraint, so a random puzzle never stacks two
 * scalar modifiers into a busy title / near-empty answer set. Population is
 * NOT skipped on `stripesOnly` (unlike colorCount) — it's orthogonal to the
 * palette, so "horizontal-stripes flags over 50M" is a perfectly good round.
 *
 * The probability is checked BEFORE the first rng() call so a caller that
 * opts out (probability 0, the default) consumes exactly zero rng bytes —
 * keeping the pre-existing pill-only / colorCount tests deterministic
 * against their seeded RNGs.
 *
/**
 * Mutate `f` to attach one threshold-metric constraint (`key`) with probability
 * `probability`, drawing one of that metric's curated tiers uniformly from
 * `THRESHOLD_METRICS[key].breaks`. Generalizes the old per-metric
 * `maybeAttachPopulation` / `maybeAttachArea` / `maybeAttachDensity`.
 *
 * Kept mutually exclusive with colorCount AND every other metric scalar: a
 * random puzzle carries at most one scalar modifier, so the title stays legible
 * and the answer set doesn't collapse. Because the callers draw metrics in a
 * fixed order and this returns early once any scalar is set, only the first
 * drawn attaches. The exclusion check runs BEFORE any rng() call, and the
 * probability is checked before the first rng() too, so an opted-out metric
 * (probability 0, the default) consumes exactly zero rng bytes — keeping seeded
 * pill-only / colorCount tests deterministic. Uniform tier pick so every tier
 * stays reachable by Random (the findflag-random-coverage contract).
 *
 * @param {Filters} f
 * @param {() => number} rng
 * @param {string} key — a registered metric key (a member of METRIC_KEYS)
 * @param {number} probability
 */
function maybeAttachMetric(f, rng, key, probability) {
  if (f.colorCount !== null) return;
  for (const k of METRIC_KEYS) if (/** @type {any} */ (f)[k] !== null) return;
  if (probability > 0 && rng() < probability) {
    const breaks = THRESHOLD_METRICS[key].breaks;
    const brk = breaks[Math.floor(rng() * breaks.length)];
    /** @type {any} */ (f)[key] = { op: brk.op, n: brk.n };
  }
}
