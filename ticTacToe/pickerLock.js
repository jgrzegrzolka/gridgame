/**
 * Picker keyboard guard used by all tic-tac-toe pages.
 *
 * Two things happen when the picker opens on mobile and the soft keyboard
 * appears:
 *
 *  1. The browser auto-scrolls the *document* to keep the focused input in
 *     view. We stop that by pinning the body (position: fixed +
 *     top: -scrollY), so the underlying board can't slide.
 *
 *  2. The browser also pans the *visual viewport* (the part the user
 *     actually sees) to expose the input from behind the keyboard. Pinning
 *     the body does nothing for this — the visual viewport is a separate
 *     layer above the layout viewport. We handle it by tracking the
 *     visual viewport with JS and keeping the picker sheet centered on
 *     whatever area is currently visible. Then the input is always already
 *     in view and the browser has nothing to pan to.
 *
 * Pure DOM glue, not unit-tested — verify in a real mobile browser.
 */

/** @type {(() => void) | null} */
let teardown = null;

/**
 * @param {HTMLElement} pickerEl The .picker wrapper (so we can find .picker-sheet inside).
 */
export function trapPicker(pickerEl) {
  if (teardown) return;

  const savedScrollY = window.scrollY;
  const body = document.body;
  body.style.position = 'fixed';
  body.style.top = `-${savedScrollY}px`;
  body.style.left = '0';
  body.style.right = '0';

  const sheet = /** @type {HTMLElement | null} */ (pickerEl.querySelector('.picker-sheet'));
  const vv = window.visualViewport;
  /** @type {(() => void) | null} */
  let reposition = null;

  if (vv && sheet) {
    reposition = () => {
      // Center the sheet on the visible (not the layout) viewport. With the
      // existing `transform: translate(-50%, -50%)` on .picker-sheet, setting
      // `top` to the visible center puts the sheet's middle there.
      sheet.style.top = `${vv.offsetTop + vv.height / 2}px`;
      // Keep the sheet inside the visible area even when the keyboard takes
      // half the screen. 32 px of breathing room top + bottom.
      sheet.style.maxHeight = `${Math.max(120, vv.height - 32)}px`;
    };
    reposition();
    vv.addEventListener('resize', reposition);
    vv.addEventListener('scroll', reposition);
  }

  teardown = () => {
    if (vv && reposition) {
      vv.removeEventListener('resize', reposition);
      vv.removeEventListener('scroll', reposition);
    }
    if (sheet) {
      sheet.style.top = '';
      sheet.style.maxHeight = '';
    }
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    window.scrollTo(0, savedScrollY);
    teardown = null;
  };
}

export function releasePicker() {
  if (teardown) teardown();
}
