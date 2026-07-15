/**
 * The give-up "all matches" sheet, shared by the three 3×3 Tic-Tac-Toe pages
 * (solo, offline hotseat, online). After a give-up the board fills each empty
 * cell with ONE valid example flag; tapping a revealed cell opens this sheet,
 * which lists EVERY country that would have fit that (row × col) intersection,
 * with the board's example highlighted.
 *
 * Thin DOM glue on top of the unit-tested `matchingCountriesForCell` primitive
 * (flags/ticTacToe.js), same shape as matchStrip.js: the set is pure logic; the
 * sheet just renders it. The module owns the dialog's whole inner structure, so
 * each page's HTML only carries an empty `<dialog id="matches" class="match-sheet">`
 * and the markup can't drift between pages (CLAUDE.md "same mechanism = same
 * code"). `t` / `countryName` / `tCat` are passed in, not imported, to keep this
 * free of the i18n graph and the per-page svg base path.
 */

import { matchingCountriesForCell } from '../flags/ticTacToe.js';
import { renderCategoryPair } from '../flags/filterChips.js';
import { wireFlagLightbox } from '../flags/flagLightbox.js';

/**
 * Wire the sheet's dismiss-on-backdrop-click once, at boot. Native `<dialog>`
 * gives Esc + focus-trap for free; this adds the "click the dark margin to
 * close" affordance, mirroring how each page wires `<dialog id="zoom">`.
 *
 * @param {HTMLDialogElement | null} dialogEl
 */
export function wireMatchSheetDismiss(dialogEl) {
  if (!dialogEl) return;
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });
}

/**
 * Fill and open the match sheet for one revealed cell.
 *
 * @param {{
 *   dialogEl: HTMLDialogElement | null,
 *   puzzle: import('../flags/engine.js').Puzzle,
 *   row: number,
 *   col: number,
 *   countries: import('../flags/group.js').Country[],
 *   svgBase: string,
 *   t: (key: string, fallback: string) => string,
 *   countryName: (c: import('../flags/group.js').Country) => string,
 *   tCat: (c: import('../flags/engine.js').Category) => string,
 * }} ctx
 */
export function openMatchSheet(ctx) {
  const { dialogEl, puzzle, row, col, countries, svgBase, t, countryName, tCat } = ctx;
  if (!dialogEl) return;
  const rowCat = puzzle.rows[row];
  const colCat = puzzle.cols[col];
  const rowLabel = tCat(rowCat);
  const colLabel = tCat(colCat);

  // Sort by the localized name so the set is scannable; the pure helper returns
  // source order, sorting is a display concern that belongs to the glue.
  const matches = matchingCountriesForCell(puzzle, row, col, countries)
    .slice()
    .sort((a, b) => countryName(a).localeCompare(countryName(b)));

  dialogEl.setAttribute('aria-label', `${rowLabel} × ${colLabel}`);
  dialogEl.replaceChildren();

  // Corner × dismiss (shared 32×32 icon-button recipe, common.css), same idiom
  // as the flag-zoom close — no bottom "Got it" bar.
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'match-close';
  close.setAttribute('aria-label', t('game.close', 'Close'));
  close.textContent = '×';
  close.addEventListener('click', () => dialogEl.close());

  const head = document.createElement('div');
  head.className = 'match-head';
  const cats = document.createElement('span');
  cats.className = 'match-cats';
  renderCategoryPair(cats, rowCat, colCat, rowLabel, colLabel);
  head.appendChild(cats);

  // `flag-tile` (common.css) is the shared flag-thumbnail with the name-strip
  // the flagsdata browse grid uses; `quiet-scroll` gives the shared hairline
  // scrollbar. The sheet forces the name-strip always-on (see index.css).
  const grid = document.createElement('ul');
  grid.className = 'match-grid quiet-scroll';
  for (const country of matches) {
    const li = document.createElement('li');
    li.className = 'flag-tile';
    const name = countryName(country);
    li.dataset.name = name; // renders the hover name-strip via .flag-tile::after
    const img = document.createElement('img');
    img.src = `${svgBase}${country.code}.svg`;
    img.alt = name;
    img.loading = 'lazy';
    // Tap a flag to see it full-screen — the same lightbox the flag-story zoom
    // uses (flags/flagLightbox.js), so "enlarge" behaves identically site-wide.
    wireFlagLightbox(img, t);
    li.appendChild(img);
    grid.appendChild(li);
  }

  dialogEl.append(close, head, grid);
  dialogEl.showModal();
}
