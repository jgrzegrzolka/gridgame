/**
 * Disable the burger menu button when its menu has no items. Empty-menu pages
 * (the Tic Tac Toe hub and the offline game) still render the burger for visual
 * consistency with every other page, but with no destinations to offer the
 * button should be inert.
 *
 * @param {HTMLButtonElement} burgerEl
 * @param {HTMLElement} menuEl
 */
export function disableBurgerIfEmpty(burgerEl, menuEl) {
  if (menuEl.children.length === 0) {
    burgerEl.disabled = true;
  }
}
