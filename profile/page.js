import { getOrCreateDeviceId } from '../flags/identity.js';
import { defaultNickname, displayNickname } from '../flags/nickname.js';
import { avatarSvg } from '../flags/avatar.js';
import { NICKNAME_STORAGE_KEY } from '../common.js';
import { t } from '../i18n.js';

const ENDPOINT = '/api/v1/profile';
const FLASH_MS = 1500;

export function bootProfile() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById('profile-input'));
  const status = document.getElementById('profile-status');
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById('profile-form'));
  const saveBtn = /** @type {HTMLButtonElement | null} */ (form?.querySelector('.profile-save'));
  if (!input || !status || !form || !saveBtn) return;

  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
  const defaultName = defaultNickname(deviceId);

  // Identity tile — same hash-of-deviceId identicon used in the burger menu,
  // sized up for the dedicated profile context. It does NOT change when the
  // user edits or resets their nickname: the visual identity is keyed by
  // deviceId, the textual identity (nickname) is the editable layer on top.
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.innerHTML = avatarSvg(deviceId, { size: 64 });

  let cached;
  try {
    cached = window.localStorage.getItem(NICKNAME_STORAGE_KEY);
  } catch {
    cached = null;
  }
  input.value = displayNickname(deviceId, cached);

  /**
   * What the server is believed to currently hold for this device. Starts
   * at whatever the cache says (string for a saved nickname, null for the
   * default/unedited state). Every successful save updates this. A Save
   * click whose payload equals `persisted` skips the network round-trip
   * entirely — three layers of throttle (this + the in-flight button
   * disable + the 5/min/IP server rate limit) stop a stuck-Save-button
   * scenario from ever reaching Cosmos in volume.
   *
   * @type {string | null}
   */
  let persisted = typeof cached === 'string' && cached.length > 0 ? cached : null;

  let inFlight = false;
  /** @type {any} */
  let flashTimer = 0;

  /**
   * Translate the live input value into the payload the server would receive.
   * Whitespace-only or default-matching input collapses to `null` (the lazy-
   * storage signal). Used by both the save path and the button-enable check.
   *
   * @returns {string | null}
   */
  function currentPayload() {
    const trimmed = input.value.trim();
    if (trimmed.length === 0 || trimmed === defaultName) return null;
    return trimmed.slice(0, 24);
  }

  /**
   * Disable Save when the payload already equals what the server holds, so
   * the page only invites clicks that would actually change something.
   * Stays disabled while a request is in flight, regardless of state.
   */
  function refreshButtons() {
    if (inFlight) {
      saveBtn.disabled = true;
      return;
    }
    saveBtn.disabled = currentPayload() === persisted;
  }

  refreshButtons();
  input.addEventListener('input', refreshButtons);

  /**
   * Push the resolved-and-trimmed `nickname` payload to the server, then
   * mirror it into localStorage. The "lazy storage" rule lives here: if
   * the user is saving exactly the default, send `null` to the server so
   * we don't write a row that holds the same string the deterministic
   * default would produce anyway.
   *
   * The success path is intentionally silent — no "Saved" confirmation
   * is shown. The Save button going disabled (because input now matches
   * `persisted`) is signal enough. Errors still surface via the status
   * line so the user knows when something didn't take.
   *
   * @param {string | null} nickname
   */
  async function save(nickname) {
    const payload = nickname !== null && nickname === defaultName ? null : nickname;
    // Idempotent skip — the button-enable logic already prevents this for
    // a normal Save click, but defence-in-depth so a race in the disabled
    // state can't ever PUT a no-op.
    if (payload === persisted) {
      refreshButtons();
      return;
    }
    inFlight = true;
    refreshButtons();
    setStatus(status, '', null);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, nickname: payload }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      persisted = payload;
      try {
        if (payload === null) window.localStorage.removeItem(NICKNAME_STORAGE_KEY);
        else window.localStorage.setItem(NICKNAME_STORAGE_KEY, payload);
      } catch {
        /* cache failure is non-fatal — server is the source of truth */
      }
    } catch {
      setStatus(status, t('nickname.error', 'Could not save'), 'is-error', 'nickname.error');
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setStatus(status, '', null), FLASH_MS);
    } finally {
      inFlight = false;
      refreshButtons();
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void save(currentPayload());
  });
}

/**
 * @param {HTMLElement} statusEl
 * @param {string} text
 * @param {'is-error' | null} cls
 * @param {string} [i18nKey]
 */
function setStatus(statusEl, text, cls, i18nKey) {
  statusEl.textContent = text;
  statusEl.classList.remove('is-error');
  if (cls) statusEl.classList.add(cls);
  if (i18nKey) statusEl.setAttribute('data-i18n', i18nKey);
  else statusEl.removeAttribute('data-i18n');
}
