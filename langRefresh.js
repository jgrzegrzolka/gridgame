/**
 * Shared helpers for the soft language-switch path. Two concerns, one
 * file because every consumer (daily, findFlag) hits both at the same
 * moment — when `langchanged` fires:
 *
 *  1. `computeLangRefreshPayload` — pure. Re-runs
 *     `withLocalizedAliases(flagsGamePool(raw, false))` so the
 *     suggestion matcher's `aliases` carry the new language's names,
 *     then re-derives the puzzle's targets by `code` (the only stable
 *     identity across a re-alias pass) and re-translates the category
 *     label via `filterToCategory`. The match-by-code step matters:
 *     if a caller forgot it and kept the old Country objects, the
 *     matcher's aliases would silently stay stale.
 *
 *  2. `bindTileCountry` + `refreshTileNames` — tile-name refresh. Each
 *     `.find-tile` element gets its source Country tracked in a
 *     module-private WeakMap when it's created; on a soft language
 *     switch we walk every tile currently in the document and
 *     re-apply `countryName(c)` to `dataset.name` (read by CSS's
 *     `content: attr(data-name)` hover overlay) and to the inner
 *     `<img>.alt`. WeakMap so removed tiles don't pin Country refs.
 *
 * The split into "pure" (computeLangRefreshPayload) and "DOM" (the
 * tile helpers) keeps the pure half unit-testable without a document.
 */

import { withLocalizedAliases, countryName } from './i18n.js';
import { flagsGamePool } from './flags/group.js';

/** @typedef {import('./flags/group.js').Country} Country */

/**
 * Pure half of the soft language-switch payload. Callers (daily,
 * findFlag) call this from a `langchanged` listener and hand the
 * result to whichever in-page renderer needs it.
 *
 * `labelFor` is a callback so this helper stays agnostic about how the
 * label is produced. Filter-derived puzzles close over a `Filters`
 * object and call `filterToCategory(filter, t).label`; manual daily
 * puzzles close over `entry.title` and look up the current language.
 *
 * @param {{ raw: any[], targetCodes: Set<string>, labelFor: () => string }} deps
 * @returns {{ all: Country[], targets: Country[], label: string }}
 */
export function computeLangRefreshPayload({ raw, targetCodes, labelFor }) {
  const all = withLocalizedAliases(flagsGamePool(raw, false));
  const targets = all.filter((c) => targetCodes.has(c.code));
  const label = labelFor();
  return { all, targets, label };
}

/**
 * @type {WeakMap<HTMLElement, Country>}
 */
const tileCountries = new WeakMap();

/**
 * Track which Country a `.find-tile` element was built for, so
 * `refreshTileNames` can re-apply `countryName(c)` on a soft language
 * switch. Call this from every tile-factory at the moment of creation;
 * the tile's lifetime owns the WeakMap entry (GC drops it when the
 * tile is removed).
 *
 * @param {HTMLElement} el
 * @param {Country} c
 */
export function bindTileCountry(el, c) {
  tileCountries.set(el, c);
}

/**
 * Walk every flag-tile element currently in `doc` and re-paint its
 * display name (`dataset.name` + `<img>.alt`) against the freshly-
 * loaded i18n cache. No-op for tiles that weren't registered via
 * `bindTileCountry`.
 *
 * The selector covers both visual variants: `.find-tile` (daily +
 * findFlag — in-game / result-screen found / result-screen missed
 * lists, all CSS-coupled via `findFlag/index.css`) and `.flag`
 * (flagsdata's browse grid). Both classes use the same
 * `content: attr(data-name)` hover overlay, so one walk re-paints
 * every visible tile on every page.
 *
 * @param {Document} [doc]
 */
export function refreshTileNames(doc = document) {
  const tiles = /** @type {NodeListOf<HTMLElement>} */ (
    doc.querySelectorAll('.find-tile, .flag')
  );
  for (const tile of tiles) {
    const c = tileCountries.get(tile);
    if (!c) continue;
    const displayName = countryName(c);
    tile.dataset.name = displayName;
    const img = /** @type {HTMLImageElement | null} */ (tile.querySelector('img'));
    if (img) img.alt = displayName;
  }
}
