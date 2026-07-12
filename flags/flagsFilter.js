import { sovereigntyOf } from './group.js';
import { METRIC_KEYS } from './engine.js';

/**
 * Two-set selection per filter group. `include` is AND-among-values (a
 * country has to match every selected value); `exclude` is none-of (a
 * country must not match any excluded value).
 *
 * For scalar groups (status, continent) AND across two distinct values
 * is unsatisfiable by construction — picking Asia AND Africa yields
 * zero matches. For array groups (color, motif) AND means the country's
 * array must contain every selected value — "has weapon AND has animal"
 * keeps only flags that depict both motifs.
 *
 * @typedef {{ include: Set<string>, exclude: Set<string> }} FilterSet
 *
 * @typedef {{ op: '=' | '>=' | '<=', n: number }} ColorCountConstraint
 *   `=` constrains the full palette size to exactly N; `>=` to N or
 *   more; `<=` to N or fewer.
 *
 * @typedef {{ op: '>=' | '<=', n: number }} PopulationConstraint
 *   `>=` matches countries of at least N people; `<=` at most N. Scalar
 *   like colorCount (a country has one population), so it's a single
 *   constraint, not a two-set FilterSet. No `=` op — population is a
 *   continuous quantity, so an exact-match tier would match ~nothing.
 *
 * @typedef {{ op: '>=' | '<=', n: number }} AreaConstraint
 *   Land-area threshold in km², the scalar twin of PopulationConstraint. Same
 *   shape and contract; reads `country.area`.
 *
 * @typedef {{ op: '>=' | '<=', n: number }} DensityConstraint
 *   Population-density threshold (people/km²), scalar twin; reads `country.density`.
 *
 * @typedef {{ op: '>=' | '<=', n: number }} GdpConstraint
 *   GDP threshold (nominal US$), scalar twin; reads `country.gdp`.
 *
 * @typedef {{ op: '>=' | '<=', n: number }} GdpPerCapitaConstraint
 *   GDP-per-capita threshold (nominal US$/person), scalar twin; reads `country.gdpPerCapita`.
 *
 * @typedef {{
 *   status: FilterSet,
 *   continent: FilterSet,
 *   color: FilterSet,
 *   motif: FilterSet,
 *   stripesOnly: FilterSet,
 *   colorCount: ColorCountConstraint | null,
 *   population: PopulationConstraint | null,
 *   area: AreaConstraint | null,
 *   density: DensityConstraint | null,
 *   gdp: GdpConstraint | null,
 *   gdpPerCapita: GdpPerCapitaConstraint | null,
 * }} Filters
 */

/**
 * Valid colorCount constraint shapes — the same triple of operators
 * and N values surfaced by the colorCount picker UI in findFlag and
 * flagsdata. Hosting these here (next to the ColorCountConstraint
 * typedef) keeps the random-mix generator in `findFlag.js` and the
 * picker widget in `colorCountPicker.js` from drifting on what's
 * valid; both import from this one source of truth.
 *
 * If new ops or N values are added later (e.g. ">7"), update the
 * picker UI, the random-mix coverage tests, and the findflag-random-
 * coverage skill at .claude/skills/.
 *
 * @type {Array<'=' | '>=' | '<='>}
 */
export const COLOR_COUNT_OPS = ['=', '>=', '<='];
/** @type {number[]} */
export const COLOR_COUNT_NS = [2, 3, 4, 5];

/**
 * Build an empty Filters object so callers (page glue + tests) agree
 * on the shape without each hand-rolling its own.
 *
 * @returns {Filters}
 */
export function emptyFilters() {
  return {
    status: { include: new Set(), exclude: new Set() },
    continent: { include: new Set(), exclude: new Set() },
    color: { include: new Set(), exclude: new Set() },
    motif: { include: new Set(), exclude: new Set() },
    stripesOnly: { include: new Set(), exclude: new Set() },
    colorCount: null,
    population: null,
    area: null,
    density: null,
    gdp: null,
    gdpPerCapita: null,
  };
}

/**
 * State machine behind the "no other colours" toggle pill shared by
 * findFlag's chooser and flagsdata's filter bar. When on, the filter's
 * `colorCount` tracks the size of `color.include` — adding a colour pill
 * bumps the locked count up, removing one bumps it down. When off,
 * `colorCount` stays null and the constraint is inactive.
 *
 * The lock always produces the `=` op (exactly N) — that's what the
 * "no other colours" toggle means semantically. `>=` is reachable via
 * URL / daily catalog authoring, not via the chooser UI.
 *
 * Pages own the DOM (button creation, classList toggling) — the helper
 * just keeps the boolean flag and the colorCount field in sync so both
 * pages can't drift on what "only these colours" means. Use the returned
 * methods at three points:
 *
 *   - `toggle()` from the toggle button's click handler. Returns the
 *     new on/off state so the page can reflect it in the button's
 *     `.active` class.
 *   - `sync()` from every colour-include pill click, so adding/removing
 *     a colour while the lock is on adjusts the count immediately.
 *   - `reset()` from the page's Clear button, so the lock flips off
 *     and the count clears in one call.
 *
 * @param {Filters} filter
 */
export function createColorCountLock(filter) {
  let on = false;
  function sync() {
    // Off → no-op. Critical: the picker pill may have written
    // `filter.colorCount` while the lock is off; if sync also reset
    // the primitive here, every colour-pill click (which calls sync)
    // would clobber the picker's filter. Behaviour the user sees
    // when this is wrong: pick =2 on the picker, then toggle any
    // colour pill, and the count filter silently disappears.
    if (!on) return;
    filter.colorCount = { op: '=', n: filter.color.include.size };
  }
  return {
    get isOn() { return on; },
    toggle() {
      on = !on;
      if (on) {
        sync();
      } else {
        // User explicitly toggled the lock off — relinquish the
        // primitive. Sync no longer does this on its own (so colour-
        // pill clicks don't clobber the picker), so toggle-off has
        // to clear explicitly.
        filter.colorCount = null;
      }
      return on;
    },
    sync,
    /**
     * Cosmetic disengage — flips the lock off without touching
     * `filter.colorCount`. Called when another UI surface (the
     * colour-count picker pill) takes over the shared primitive: the
     * lock's `on` flag has to clear so the next user toggle starts
     * fresh, but blowing away `filter.colorCount` here would wipe what
     * the picker just set.
     */
    disengage() {
      on = false;
    },
    reset() {
      on = false;
      filter.colorCount = null;
    },
  };
}

/**
 * Decide whether a country survives the current filter selection.
 * Groups combine via AND; within a group, includes are AND-among-values
 * and excludes are none-of. For scalar groups (status, continent) AND
 * across two distinct values is unsatisfiable — the scalar can only
 * equal one of them. For array groups (colors, motifs) AND means the
 * country's array must contain every selected value.
 *
 * `colorField` picks which color list to match against:
 *   - `'colors'` (default) — every color visible anywhere on the flag,
 *     including small emblem details. Used by findFlag's "browse" UI
 *     where the player can examine the flag up close. Resolves to the
 *     union of `primaryColors` and `additionalColors`.
 *   - `'primaryColors'` — only the colors that read from across a room
 *     (drops COA-only colors). Used by the daily-puzzle generator so
 *     "European flags with green" doesn't include Portugal-style flags
 *     where green only appears inside the coat of arms.
 *
 * @param {import('./group.js').Country} country
 * @param {Filters} filters
 * @param {{ colorField?: 'colors' | 'primaryColors' }} [options]
 * @returns {boolean}
 */
export function matchesFilters(country, filters, options = {}) {
  const colorField = options.colorField ?? 'colors';

  const sov = sovereigntyOf(country);
  if (filters.status.include.size && (filters.status.include.size > 1 || !filters.status.include.has(sov))) return false;
  if (filters.status.exclude.has(sov)) return false;

  const cont = country.continent ?? 'Other';
  if (filters.continent.include.size && (filters.continent.include.size > 1 || !filters.continent.include.has(cont))) return false;
  if (filters.continent.exclude.has(cont)) return false;

  const colors = colorField === 'primaryColors' ? country.primaryColors : country.colors;
  for (const c of filters.color.include) {
    if (!colors.includes(c)) return false;
  }
  if (filters.color.exclude.size && colors.some((c) => filters.color.exclude.has(c))) return false;

  // colorCount always checks the full palette (c.colors = primary + additional
  // union), not the colorField-selected view. Semantic: "the flag has N visible
  // colours" — a player counting colours sees the union regardless of how the
  // data is split. Primary-clean stays consistent because both modes resolve
  // colorCount against the same field.
  if (filters.colorCount !== null) {
    const len = country.colors.length;
    const { op, n } = filters.colorCount;
    if (op === '=' && len !== n) return false;
    if (op === '>=' && len < n) return false;
    if (op === '<=' && len > n) return false;
  }

  // Threshold world-metrics (population, area, density, …) each compare a
  // denormalized Country field (`attach<Metric>s`, group.js) — the field name
  // equals the metric key — against a >=/<= threshold. The metric is sparse: a
  // country with no value (territories, every non-place flag) matches neither
  // direction, same contract as the engine predicate. One generic loop over
  // the registered keys covers every metric.
  for (const key of METRIC_KEYS) {
    const flt = /** @type {any} */ (filters)[key];
    if (!flt) continue;
    const v = /** @type {any} */ (country)[key];
    if (typeof v !== 'number') return false;
    if (flt.op === '>=' && v < flt.n) return false;
    if (flt.op === '<=' && v > flt.n) return false;
  }

  const motifs = country.motifs ?? [];
  for (const m of filters.motif.include) {
    if (!motifs.includes(m)) return false;
  }
  if (filters.motif.exclude.size && motifs.some((m) => filters.motif.exclude.has(m))) return false;

  // stripesOnly is scalar like continent / status: a country has exactly one
  // value (or null). Two-value AND is unsatisfiable. Excluding a value lets
  // null-stripes flags through — `stripesOnly:!horizontal` reads as "anything
  // not pure-horizontal", which includes both vertical and the null cases.
  const stripes = country.stripesOnly ?? null;
  if (filters.stripesOnly.include.size) {
    if (filters.stripesOnly.include.size > 1) return false;
    if (stripes === null) return false;
    if (!filters.stripesOnly.include.has(stripes)) return false;
  }
  if (stripes !== null && filters.stripesOnly.exclude.has(stripes)) return false;

  return true;
}

/**
 * @typedef {'status' | 'continent' | 'color' | 'motif' | 'stripesOnly'} PillGroup
 * @typedef {'colorCount' | 'population' | 'area' | 'density' | 'gdp' | 'gdpPerCapita'} ScalarGroup
 *
 * @typedef {{ kind: 'pill', group: PillGroup, value: string, exclude: boolean }
 *   | { kind: 'scalar', group: ScalarGroup }} FilterChip
 *   A pill chip names one include/exclude value; a scalar chip names a
 *   single-constraint group (the constraint's op/n lives in `filters`).
 */

/** Fixed group order for the chip row — matches the filter bar's pill-group
 * order so a chip sits under the same mental heading the user toggled it in. */
const PILL_GROUP_ORDER = /** @type {PillGroup[]} */ (['status', 'continent', 'color', 'motif', 'stripesOnly']);

/**
 * Flatten an active `Filters` object into an ordered list of chip descriptors,
 * one per active constraint, for the collapsed "active filters" summary row.
 *
 * Pure and label-free: the caller resolves display text (the page owns i18n +
 * the metric/colour-count labels) and wires removal. Order is stable — group
 * order, then each group's include values before its exclude values (both in
 * the Set's own insertion order), then the scalar constraints — so the chip
 * row never reshuffles as filters toggle on and off.
 *
 * The "no other colours" lock isn't a distinct chip: it drives
 * `filters.colorCount`, so it surfaces as the single `colorCount` scalar chip
 * (removing that chip is what clears the lock).
 *
 * @param {Filters} filters
 * @returns {FilterChip[]}
 */
export function activeFilterChips(filters) {
  /** @type {FilterChip[]} */
  const chips = [];
  for (const group of PILL_GROUP_ORDER) {
    for (const value of filters[group].include) chips.push({ kind: 'pill', group, value, exclude: false });
    for (const value of filters[group].exclude) chips.push({ kind: 'pill', group, value, exclude: true });
  }
  if (filters.colorCount !== null) chips.push({ kind: 'scalar', group: 'colorCount' });
  for (const key of METRIC_KEYS) {
    if (/** @type {any} */ (filters)[key] !== null) {
      chips.push({ kind: 'scalar', group: /** @type {ScalarGroup} */ (key) });
    }
  }
  return chips;
}
