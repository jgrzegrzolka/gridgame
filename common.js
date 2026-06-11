import { getOrCreateDeviceId } from './flags/identity.js';
import { displayNickname } from './flags/nickname.js';

/** Display nickname cache key. Written when the user successfully saves a
 *  new value on the /profile/ page. Cleared (`removeItem`) when the user
 *  resets or clears their nickname — the matching server-side state is
 *  `nickname: null`, which means "fall back to the deterministic default
 *  from `flags/nickname.js`". */
export const NICKNAME_STORAGE_KEY = 'gridgame.nickname';

/**
 * Disable the burger menu button when its menu has no items. Empty-menu pages
 * still render the burger for visual consistency with every other page, but
 * with no destinations to offer the button should be inert.
 *
 * Sets BOTH the native disabled property (so keyboard/Enter activation is
 * blocked at the DOM level) AND the aria-disabled attribute (which is what
 * common.css keys off for the greyed-out visual + pointer-events:none). The
 * two have to be set together: setting only `disabled` blocks the click but
 * leaves the button visually active, which reads as a broken interaction
 * rather than an inert affordance.
 *
 * @param {HTMLButtonElement} burgerEl
 * @param {HTMLElement} menuEl
 */
export function disableBurgerIfEmpty(burgerEl, menuEl) {
  if (menuEl.children.length === 0) {
    burgerEl.disabled = true;
    burgerEl.setAttribute('aria-disabled', 'true');
  }
}

/**
 * Add the missing dismissal paths to the burger menu:
 *   - A click anywhere outside both the burger button and its panel closes
 *     the panel. Before this, the only way to close was a second click on
 *     the burger itself, which is the only thing every other modern menu
 *     UX does NOT expect.
 *   - Pressing Escape closes the panel and returns focus to the burger so
 *     a keyboard user lands somewhere predictable.
 *
 * The burger button's open/close *toggle* still lives in the inline onclick
 * on every page — this helper only adds the dismiss-from-elsewhere paths
 * that the inline onclick can't observe. Safe to call on pages without a
 * burger: the function exits early if the elements are missing.
 *
 * @param {{ doc?: Document }} [options]
 */
export function wireBurgerDismiss(options = {}) {
  const doc = options.doc ?? document;
  const burger = doc.querySelector('.burger');
  const panel = /** @type {HTMLElement | null} */ (doc.querySelector('#burger-panel'));
  if (!burger || !panel) return;
  doc.addEventListener('click', (e) => {
    if (panel.hidden) return;
    const t = /** @type {Node | null} */ (e.target);
    if (!t) return;
    if (burger.contains(t) || panel.contains(t)) return;
    closeBurger(burger, panel);
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    closeBurger(burger, panel);
    /** @type {HTMLElement} */ (burger).focus?.();
  });
}

/**
 * @param {Element} burgerEl
 * @param {HTMLElement} panelEl
 */
function closeBurger(burgerEl, panelEl) {
  burgerEl.setAttribute('aria-expanded', 'false');
  const openLabel = /** @type {HTMLElement} */ (burgerEl).dataset?.labelOpen;
  if (openLabel) burgerEl.setAttribute('aria-label', openLabel);
  panelEl.hidden = true;
}

/**
 * Mount the "Your name: <display-name>" link into the burger panel's `<ul>`.
 * The link points at `/profile/` so the user can change their nickname on
 * a dedicated page; this helper only renders the menu surface.
 *
 * The displayed name resolves via `flags/nickname.js::displayNickname`:
 * the cached `gridgame.nickname` wins if present; otherwise a deterministic
 * two-word default is derived from the deviceId. Same deviceId → same
 * default for every viewer, with no server fetch required.
 *
 * Inserted as the FIRST child of the menu so the "this is you" affordance
 * is the most prominent item. `aria-current="page"` is set automatically
 * when the page hosting the menu is `/profile/` itself.
 *
 * Anything DOM-side (storage, deviceId, doc, location) is injectable so
 * tests don't need a real browser.
 *
 * @param {{
 *   rootEl: HTMLElement | null,
 *   profileHref: string,
 *   doc?: Document,
 *   storage?: Pick<Storage, 'getItem'>,
 *   getDeviceId?: () => string,
 *   pageIsProfile?: boolean,
 * }} opts
 */
export function mountNicknameMenuItem(opts) {
  if (!opts || !opts.rootEl) return null;
  const doc = opts.doc ?? document;
  const storage = opts.storage ?? window.localStorage;
  // Default deviceId resolution reads from window.localStorage directly,
  // not from `storage` — in prod they're the same object, but tests
  // inject `storage` as a read-only fake and override `getDeviceId`.
  // Keeping the default path off `storage` lets the `storage` param's
  // type stay `Pick<Storage, 'getItem'>` instead of dragging in
  // setItem/removeItem (needed by getOrCreateDeviceId on first run).
  const getDeviceId = opts.getDeviceId
    ?? (() => getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID()));

  /** @type {string | null} */
  let cached = null;
  try {
    cached = storage.getItem(NICKNAME_STORAGE_KEY);
  } catch {
    /* private mode / no quota — fall through to the default */
  }
  const name = displayNickname(getDeviceId(), cached);

  const li = doc.createElement('li');
  li.className = 'menu-nickname';

  const a = doc.createElement('a');
  a.setAttribute('href', opts.profileHref);
  if (opts.pageIsProfile) a.setAttribute('aria-current', 'page');

  const label = doc.createElement('span');
  label.className = 'menu-nickname-label';
  label.setAttribute('data-i18n', 'nickname.yourName');
  label.textContent = 'Your name';

  const value = doc.createElement('strong');
  value.className = 'menu-nickname-value';
  value.textContent = name;

  a.appendChild(label);
  a.appendChild(doc.createTextNode(': '));
  a.appendChild(value);
  li.appendChild(a);

  // Insert as the first menu item — "you" deserves top placement above any
  // navigation links the page added below.
  const firstChild = opts.rootEl.firstChild;
  if (firstChild) opts.rootEl.insertBefore(li, firstChild);
  else opts.rootEl.appendChild(li);
  return li;
}
