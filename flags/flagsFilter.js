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
 * Groups combine via AND; within a group, includes are AND-among-values
 * and excludes are none-of. For scalar groups (status, continent) AND
 * across two distinct values is unsatisfiable — the scalar can only
 * equal one of them. For array groups (colors, motifs) AND means the
 * country's array must contain every selected value.
 *
 * @param {import('./group.js').Country} country
 * @param {Filters} filters
 * @returns {boolean}
 */
export function matchesFilters(country, filters) {
  const sov = sovereigntyOf(country);
  if (filters.status.include.size && (filters.status.include.size > 1 || !filters.status.include.has(sov))) return false;
  if (filters.status.exclude.has(sov)) return false;

  const cont = country.continent ?? 'Other';
  if (filters.continent.include.size && (filters.continent.include.size > 1 || !filters.continent.include.has(cont))) return false;
  if (filters.continent.exclude.has(cont)) return false;

  const colors = country.colors ?? [];
  for (const c of filters.color.include) {
    if (!colors.includes(c)) return false;
  }
  if (filters.color.exclude.size && colors.some((c) => filters.color.exclude.has(c))) return false;

  const motifs = country.motifs ?? [];
  for (const m of filters.motif.include) {
    if (!motifs.includes(m)) return false;
  }
  if (filters.motif.exclude.size && motifs.some((m) => filters.motif.exclude.has(m))) return false;

  return true;
}
