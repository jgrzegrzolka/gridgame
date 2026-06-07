/**
 * Body scroll lock used by the picker on tic-tac-toe pages.
 *
 * Why this exists: when the picker opens on mobile, focusing the input
 * fires the soft keyboard, and the browser auto-scrolls the document to
 * keep the input visible — dragging the board up/down behind the backdrop.
 * `overflow: hidden` on body stops *user* scroll but not the browser's
 * scroll-into-view. Freezing the body with `position: fixed` does.
 *
 * Pure DOM glue, not unit-tested — verify in a real mobile browser.
 */

let savedScrollY = 0;
let locked = false;

export function lockBodyScroll() {
  if (locked) return;
  savedScrollY = window.scrollY;
  const body = document.body;
  body.style.position = 'fixed';
  body.style.top = `-${savedScrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  locked = true;
}

export function unlockBodyScroll() {
  if (!locked) return;
  const body = document.body;
  body.style.position = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  window.scrollTo(0, savedScrollY);
  locked = false;
}
