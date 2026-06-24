/**
 * Shared "flag zoom" popup wiring. The dialog markup
 *
 *   <dialog id="zoom"><img alt="" /><p></p></dialog>
 *
 * lives in each page's HTML, and the CSS (border, fade-in transition,
 * backdrop dim) is in `common.css` keyed to `dialog#zoom`. This module
 * is the JS half: open the dialog with a country flag + name, close
 * on backdrop click.
 *
 * Used by `/flagsdata/` (every flag-tile click opens the zoom) and
 * `/flagQuiz/` (clicking an answered country on the Europe contour
 * map opens it). Extracted on the second consumer per the CLAUDE.md
 * "promote on second consumer" rule.
 *
 * Pure-ish: takes the dialog element + country shape + a relative
 * path to the SVG folder. No globals, no fetch — the caller already
 * knows the country object and its display name.
 */

/**
 * Minimal subset of the dialog's surface this module touches. Typed
 * permissively (querySelector returns `any`) so the test fake — which
 * returns simple `{ src, alt }` / `{ textContent }` objects — type-checks
 * alongside the real `HTMLDialogElement`.
 *
 * @typedef {{
 *   querySelector(sel: string): any,
 *   showModal(): void,
 *   close(): void,
 *   addEventListener(type: string, listener: (e: any) => void): void,
 * }} ZoomDialog
 */

/**
 * Open the zoom dialog showing a country's flag SVG and display name.
 *
 * @param {ZoomDialog} dialog
 * @param {{ code: string, displayName: string, svgBase: string }} args
 *   `svgBase` is the relative path to the `flags/svg/` folder from the
 *   page that owns the dialog. flagsdata is at `/flagsdata/`, so
 *   `../flags/svg/`; flagQuiz at `/flagQuiz/` uses the same. Caller
 *   passes it explicitly so the helper doesn't have to guess from
 *   window.location.
 */
export function openFlagZoom(dialog, { code, displayName, svgBase }) {
  if (!dialog) return;
  const img = /** @type {HTMLImageElement | null} */ (dialog.querySelector('img'));
  const p = dialog.querySelector('p');
  if (img) {
    img.src = `${svgBase}${code}.svg`;
    img.alt = displayName;
  }
  if (p) p.textContent = displayName;
  dialog.showModal();
}

/**
 * Wire the dialog so a click on the backdrop (the dialog element
 * itself, outside the content card) closes it. Native `<dialog>`
 * gives us Esc-to-close + focus management for free, but not
 * backdrop-click — that's a deliberate omission in the spec.
 *
 * Idempotent on the dialog (each call adds a listener; tests pin
 * that callers only invoke once per dialog).
 *
 * @param {ZoomDialog} dialog
 */
export function wireFlagZoomBackdropClose(dialog) {
  if (!dialog) return;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
