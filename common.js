import { getOrCreateDeviceId } from './flags/identity.js';

/** Display nickname cache key. Read on burger-panel mount; written when the
 *  user successfully saves a new value. Cleared (`removeItem`) when the
 *  user empties the field — the matching server-side state for "anonymous
 *  device" is `nickname: null`. */
export const NICKNAME_STORAGE_KEY = 'gridgame.nickname';

const NICKNAME_MAX = 24;

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
 * Mount the device-profile nickname field into a `<section id="burger-nickname">`
 * placeholder inside the burger panel. The placeholder lives in every page's
 * HTML; this helper fills it with a small inline form and wires the save
 * round-trip to `PUT /api/v1/profile`.
 *
 * Behaviour:
 *   - On mount, pre-fill the input from `localStorage.gridgame.nickname` if set.
 *   - On submit, validate length client-side, then PUT the deviceId + new
 *     nickname (or `null` for "clear my nickname" when the field is empty).
 *   - On success (any 2xx), write the new value back to localStorage and
 *     show a short "Saved" flash. On failure (non-2xx / network error),
 *     surface an error state and leave localStorage untouched so the
 *     server is the only source of disagreement.
 *
 * Anything Node-side (DOM, storage, fetch, deviceId, clock) is injectable so
 * tests don't need a real browser. Returns the created `<form>` element (or
 * `null` if `rootEl` was missing — pages without the placeholder are a no-op).
 *
 * @param {{
 *   rootEl: HTMLElement | null,
 *   doc?: Document,
 *   storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
 *   fetchImpl?: typeof fetch,
 *   getDeviceId?: () => string,
 *   now?: () => number,
 *   savedFlashMs?: number,
 *   setTimeoutImpl?: (cb: () => void, ms: number) => any,
 *   clearTimeoutImpl?: (id: any) => void,
 * }} opts
 */
export function mountNicknameField(opts) {
  if (!opts || !opts.rootEl) return null;
  const doc = opts.doc ?? document;
  const storage = opts.storage ?? window.localStorage;
  const fetchImpl = opts.fetchImpl ?? window.fetch.bind(window);
  const getDeviceId = opts.getDeviceId
    ?? (() => getOrCreateDeviceId(storage, () => window.crypto.randomUUID()));
  const setTimeoutImpl = opts.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = opts.clearTimeoutImpl ?? clearTimeout;
  const savedFlashMs = typeof opts.savedFlashMs === 'number' ? opts.savedFlashMs : 1500;

  const form = doc.createElement('form');
  form.className = 'burger-nickname-form';

  const label = doc.createElement('label');
  label.className = 'burger-nickname-label';
  const labelText = doc.createElement('span');
  labelText.setAttribute('data-i18n', 'nickname.label');
  labelText.textContent = 'Nickname';
  label.appendChild(labelText);

  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'burger-nickname-input';
  input.maxLength = NICKNAME_MAX;
  input.setAttribute('data-i18n-attr', 'placeholder:nickname.placeholder');
  input.placeholder = 'optional';
  label.appendChild(input);

  const button = doc.createElement('button');
  button.type = 'submit';
  button.className = 'burger-nickname-save';
  button.setAttribute('data-i18n', 'nickname.save');
  button.textContent = 'Save';

  const status = doc.createElement('span');
  status.className = 'burger-nickname-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  form.appendChild(label);
  form.appendChild(button);
  form.appendChild(status);

  // Pre-fill from cache. Read defensively so a private-mode-throwing
  // storage doesn't break the mount.
  try {
    const cached = storage.getItem(NICKNAME_STORAGE_KEY);
    if (typeof cached === 'string' && cached.length > 0) input.value = cached;
  } catch {
    // Ignore — leave the field blank, the user can still type a fresh value.
  }

  /** @type {any} */
  let flashTimer = 0;

  form.addEventListener('submit', async (ev) => {
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    const raw = input.value.trim();
    const nickname = raw.length === 0 ? null : raw.slice(0, NICKNAME_MAX);

    button.disabled = true;
    status.textContent = '';
    status.classList.remove('is-saved', 'is-error');

    try {
      const res = await fetchImpl('/api/v1/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getDeviceId(), nickname }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      try {
        if (nickname === null) storage.removeItem(NICKNAME_STORAGE_KEY);
        else storage.setItem(NICKNAME_STORAGE_KEY, nickname);
      } catch {
        // Cache miss on save is harmless — the server is the source of truth
        // and the next mount will fall back to "empty" until the user retypes.
      }
      status.setAttribute('data-i18n', 'nickname.saved');
      status.textContent = 'Saved';
      status.classList.add('is-saved');
    } catch {
      status.setAttribute('data-i18n', 'nickname.error');
      status.textContent = 'Could not save';
      status.classList.add('is-error');
    } finally {
      button.disabled = false;
      if (flashTimer) clearTimeoutImpl(flashTimer);
      flashTimer = setTimeoutImpl(() => {
        status.textContent = '';
        status.removeAttribute('data-i18n');
        status.classList.remove('is-saved', 'is-error');
      }, savedFlashMs);
    }
  });

  opts.rootEl.appendChild(form);
  return form;
}
