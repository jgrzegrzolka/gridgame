import { sovereigntyOf } from './group.js';

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
 * @typedef {{
 *   status: FilterSet,
 *   continent: FilterSet,
 *   color: FilterSet,
 *   motif: FilterSet,
 *   colorCount: number | null,
 * }} Filters
 */

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
    colorCount: null,
  };
}

/**
 * State machine behind the "no other colours" toggle pill shared by
 * findFlag's chooser and flagsdata's filter bar. When on, the filter's
 * `colorCount` tracks the size of `color.include` — adding a colour pill
 * bumps the locked count up, removing one bumps it down. When off,
 * `colorCount` stays null and the constraint is inactive.
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
    filter.colorCount = on ? filter.color.include.size : null;
  }
  return {
    get isOn() { return on; },
    toggle() {
      on = !on;
      sync();
      return on;
    },
    sync,
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
  // union), not the colorField-selected view. Semantic: "the flag has exactly
  // N visible colours" — a player counting colours sees the union regardless
  // of how the data is split. Primary-clean stays consistent because both
  // modes resolve colorCount against the same field.
  if (filters.colorCount !== null && country.colors.length !== filters.colorCount) return false;

  const motifs = country.motifs ?? [];
  for (const m of filters.motif.include) {
    if (!motifs.includes(m)) return false;
  }
  if (filters.motif.exclude.size && motifs.some((m) => filters.motif.exclude.has(m))) return false;

  return true;
}
