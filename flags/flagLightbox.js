/**
 * Shared flag lightbox — tap a flag to see it big.
 *
 * The flag in the zoom dialog is capped small so it doesn't dwarf the story.
 * Tapping it opens a **bare, full-viewport `<dialog>`** — no card, no border,
 * no close button: just the flag on a dim backdrop, dismissed by clicking
 * anywhere or pressing Esc. It stacks above the story dialog in the top layer
 * (the only reliable way to paint over a modal `<dialog>`), but because it's
 * styled as nothing more than the enlarged image, it reads as "the picture
 * got bigger", not a nested popup.
 *
 * CSS lives in `common.css` under `.flag-lightbox` / `.flag-zoomable`.
 *
 * Mostly DOM glue, but the wiring rules — idempotency, keyboard activation,
 * that open() reads the source image's *current* src/alt — are pinned in
 * `flagLightbox.test.js` against a fake document, same pattern as
 * `flagZoom.test.js`.
 */

/**
 * The single lightbox overlay for a document, created lazily and cached on the
 * document itself (not a module singleton) so multiple documents — the real
 * page and each test's fake — stay isolated.
 *
 * @param {any} doc
 * @returns {{ dialog: any, img: any }}
 */
function ensureLightbox(doc) {
  if (doc.__flagLightbox) return doc.__flagLightbox;
  const dialog = doc.createElement('dialog');
  dialog.className = 'flag-lightbox';
  const img = doc.createElement('img');
  img.alt = '';
  dialog.appendChild(img);
  // Click anywhere in the overlay (backdrop or the image itself) closes it.
  dialog.addEventListener('click', () => dialog.close && dialog.close());
  if (doc.body && doc.body.appendChild) doc.body.appendChild(dialog);
  const lb = { dialog, img };
  doc.__flagLightbox = lb;
  return lb;
}

/**
 * Open the lightbox showing an image source at full size.
 *
 * @param {string} src
 * @param {string} alt
 * @param {any} [doc]
 */
export function openFlagLightbox(src, alt, doc = globalThis.document) {
  const { dialog, img } = ensureLightbox(doc);
  img.src = src;
  img.alt = alt || '';
  if (dialog.showModal) dialog.showModal();
}

/**
 * Make a flag `<img>` tap-to-enlarge: click or Enter/Space opens the lightbox
 * with that image's *current* src + alt (so it works even though the headline
 * flag's src changes each time the zoom dialog opens a new country). Idempotent
 * per element — safe to call once at mount.
 *
 * @param {any} img the headline flag image in the zoom dialog
 * @param {(key: string, fallback: string) => string} [t] translator for the a11y label
 * @param {any} [doc]
 */
export function wireFlagLightbox(img, t, doc = globalThis.document) {
  if (!img) return;
  if (img.dataset && img.dataset.lightboxWired) return;
  if (img.dataset) img.dataset.lightboxWired = '1';

  if (img.classList && img.classList.add) img.classList.add('flag-zoomable');
  // The flag becomes an activatable control (it was decorative before).
  img.setAttribute('role', 'button');
  img.setAttribute('tabindex', '0');
  img.setAttribute('aria-label', t ? t('zoom.enlarge', 'Enlarge flag') : 'Enlarge flag');

  const open = () => openFlagLightbox(img.src, img.alt, doc);
  img.addEventListener('click', open);
  img.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      if (e.preventDefault) e.preventDefault();
      open();
    }
  });
}
