import { getOrCreateDeviceId } from '../flags/identity.js';
import { defaultNickname, displayNickname } from '../flags/nickname.js';
import { avatarSvg } from '../flags/avatar.js';
import { isOffensiveNickname } from '../flags/nicknameModeration.js';
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
    return trimmed.slice(0, 32);
  }

  /**
   * Refresh Save enablement + live moderation feedback in one pass.
   * Save is disabled when:
   *   - a request is in flight, OR
   *   - the payload already equals what the server holds (no-op), OR
   *   - the current input matches the offensive-nickname blocklist.
   *
   * The third branch mirrors `api/src/lib/blockedNicknames.js` so the
   * user can't even *try* to submit an offensive name — no round-trip,
   * no rate-limit risk from repeated rejected Saves. The server still
   * validates as defence-in-depth, but the common case never leaves
   * the browser. The inline error renders the moment the input lands
   * in the blocked zone, with no clear-timer so it persists while the
   * input is still offensive.
   */
  function refreshButtons() {
    if (inFlight) {
      saveBtn.disabled = true;
      return;
    }
    const offensive = isOffensiveNickname(input.value);
    if (offensive) {
      saveBtn.disabled = true;
      setStatus(status, t('nickname.errorOffensive', 'Please choose a different nickname'), 'is-error', 'nickname.errorOffensive');
      return;
    }
    // Clear the moderation error when the user edits back into a
    // valid range. Other error types (network / server) clear on their
    // own timers; the live-offensive branch is sticky while offensive.
    if (status.getAttribute('data-i18n') === 'nickname.errorOffensive') {
      setStatus(status, '', null);
    }
    saveBtn.disabled = currentPayload() === persisted;
  }

  refreshButtons();
  input.addEventListener('input', refreshButtons);
  // Drop the shake-wrong class once its animation ends so a subsequent
  // failure can re-add it cleanly via the reflow restart trick.
  input.addEventListener('animationend', () => {
    input.classList.remove('shake-wrong');
  });

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
      if (!res.ok) {
        // Read the server's structured error code so we can show the
        // user *why* their nickname didn't save — "Could not save" alone
        // makes a moderation reject feel like a server error.
        let code = `http_${res.status}`;
        try {
          const body = await res.json();
          if (body && typeof body.error === 'string') code = body.error;
        } catch { /* leave as http_<status> */ }
        throw new Error(code);
      }
      persisted = payload;
      try {
        if (payload === null) window.localStorage.removeItem(NICKNAME_STORAGE_KEY);
        else window.localStorage.setItem(NICKNAME_STORAGE_KEY, payload);
      } catch {
        /* cache failure is non-fatal — server is the source of truth */
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : 'unknown';
      const { i18nKey, fallback } = errorMessageFor(code);
      setStatus(status, t(i18nKey, fallback), 'is-error', i18nKey);
      // Shake the input so the error registers visually even if the user
      // wasn't looking at the status line. Reflow-restart trick lets a
      // repeated failure replay the animation cleanly. Same pattern as
      // the flagQuiz wrong-answer flash.
      input.classList.remove('shake-wrong');
      void input.offsetWidth;
      input.classList.add('shake-wrong');
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
 * Map a server error code (or local network code) to the i18n key + fallback
 * the user should see. `offensive_nickname` and `invalid_nickname` get
 * specific feedback so the user knows what to change; anything else is
 * "Could not save" because there's nothing actionable for them to fix.
 *
 * @param {string} code
 */
function errorMessageFor(code) {
  if (code === 'offensive_nickname') {
    return { i18nKey: 'nickname.errorOffensive', fallback: 'Please choose a different nickname' };
  }
  if (code === 'invalid_nickname') {
    return { i18nKey: 'nickname.errorInvalid', fallback: 'That nickname contains characters that aren’t allowed' };
  }
  return { i18nKey: 'nickname.error', fallback: 'Could not save' };
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
