import { getOrCreateDeviceId } from '../flags/identity.js';
import { defaultNickname, displayNickname } from '../flags/nickname.js';
import { NICKNAME_STORAGE_KEY } from '../common.js';
import { t } from '../i18n.js';

const ENDPOINT = '/api/v1/profile';
const FLASH_MS = 1500;

export function bootProfile() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById('profile-input'));
  const hint = document.getElementById('profile-hint');
  const status = document.getElementById('profile-status');
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById('profile-form'));
  const resetBtn = document.getElementById('profile-reset');
  if (!input || !hint || !status || !form || !resetBtn) return;

  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
  const defaultName = defaultNickname(deviceId);

  let cached;
  try {
    cached = window.localStorage.getItem(NICKNAME_STORAGE_KEY);
  } catch {
    cached = null;
  }
  input.value = displayNickname(deviceId, cached);
  renderHint(hint, defaultName);

  /** @type {any} */
  let flashTimer = 0;
  /**
   * Push the resolved-and-trimmed `nickname` payload to the server, then
   * mirror it into localStorage and the input. The "lazy storage" rule
   * lives here: if the user is saving exactly the default, send `null`
   * to the server so we don't write a row that holds the same string the
   * deterministic default would produce anyway.
   *
   * @param {string | null} nickname
   * @param {string} successKey
   * @param {string} successFallback
   */
  async function save(nickname, successKey, successFallback) {
    const payload = nickname !== null && nickname === defaultName ? null : nickname;
    setButtonsDisabled(true);
    setStatus(status, '', null);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, nickname: payload }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      try {
        if (payload === null) window.localStorage.removeItem(NICKNAME_STORAGE_KEY);
        else window.localStorage.setItem(NICKNAME_STORAGE_KEY, payload);
      } catch {
        /* cache failure is non-fatal — server is the source of truth */
      }
      setStatus(status, t(successKey, successFallback), 'is-saved', successKey);
    } catch {
      setStatus(status, t('nickname.error', 'Could not save'), 'is-error', 'nickname.error');
    } finally {
      setButtonsDisabled(false);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setStatus(status, '', null), FLASH_MS);
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const raw = input.value.trim();
    const nickname = raw.length === 0 ? null : raw.slice(0, 24);
    void save(nickname, 'nickname.saved', 'Saved');
  });

  resetBtn.addEventListener('click', () => {
    input.value = defaultName;
    void save(null, 'nickname.saved', 'Saved');
  });

  function setButtonsDisabled(disabled) {
    /** @type {NodeListOf<HTMLButtonElement>} */
    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = disabled; });
  }
}

/**
 * @param {HTMLElement} hintEl
 * @param {string} defaultName
 */
function renderHint(hintEl, defaultName) {
  // "Your default name: Brave Falcon" — purely informational so the user
  // knows what gets shown when they leave it blank or hit Reset.
  hintEl.textContent = `${t('nickname.defaultHint', 'Default name')}: ${defaultName}`;
  hintEl.setAttribute('data-i18n', 'nickname.defaultHint');
  // We can't use `data-i18n` cleanly here because the value has a runtime
  // suffix. Re-translate manually on `langchanged` so a soft language
  // switch keeps the label-half fresh.
  window.addEventListener('langchanged', () => {
    hintEl.textContent = `${t('nickname.defaultHint', 'Default name')}: ${defaultName}`;
  });
}

/**
 * @param {HTMLElement} statusEl
 * @param {string} text
 * @param {'is-saved' | 'is-error' | null} cls
 * @param {string} [i18nKey]
 */
function setStatus(statusEl, text, cls, i18nKey) {
  statusEl.textContent = text;
  statusEl.classList.remove('is-saved', 'is-error');
  if (cls) statusEl.classList.add(cls);
  if (i18nKey) statusEl.setAttribute('data-i18n', i18nKey);
  else statusEl.removeAttribute('data-i18n');
}
