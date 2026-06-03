import { sovereigntyOf } from './group.js';

/**
 * Two-set selection per filter group. `include` is OR-among-values (a
 * country has to match at least one when the set is non-empty);
 * `exclude` is none-of (a country must not match any value).
 *
 * @typedef {{ include: Set<string>, exclude: Set<string> }} FilterSet
 *
 * @typedef {{
 *   status: FilterSet,
 *   continent: FilterSet,
 *   color: FilterSet,
 *   motif: FilterSet,
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
  };
}

/**
 * Decide whether a country survives the current filter selection.
 * Groups combine via AND; within a group, includes are OR and excludes
 * are none-of. Arrays (colors, motifs) use overlap semantics; scalars
 * (status, continent) use direct membership.
 *
 * @param {import('./group.js').Country} country
 * @param {Filters} filters
 * @returns {boolean}
 */
export function matchesFilters(country, filters) {
  const sov = sovereigntyOf(country);
  if (filters.status.include.size && !filters.status.include.has(sov)) return false;
  if (filters.status.exclude.has(sov)) return false;

  const cont = country.continent ?? 'Other';
  if (filters.continent.include.size && !filters.continent.include.has(cont)) return false;
  if (filters.continent.exclude.has(cont)) return false;

  const colors = country.colors ?? [];
  if (filters.color.include.size && !colors.some((c) => filters.color.include.has(c))) return false;
  if (filters.color.exclude.size && colors.some((c) => filters.color.exclude.has(c))) return false;

  const motifs = country.motifs ?? [];
  if (filters.motif.include.size && !motifs.some((m) => filters.motif.include.has(m))) return false;
  if (filters.motif.exclude.size && motifs.some((m) => filters.motif.exclude.has(m))) return false;

  return true;
}
