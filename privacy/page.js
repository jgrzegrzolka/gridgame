import { getOrCreateDeviceId } from '../flags/identity.js';
import { t } from '../i18n.js';

const ENDPOINT = '/api/v1/profile/requestDeletion';

export function bootPrivacy() {
  const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('privacy-request-btn'));
  const status = document.getElementById('privacy-request-status');
  if (!btn || !status) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setStatus(status, '', null);
    const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      // Success — leave the button disabled so the user can't spam the
      // endpoint, and confirm in-page (no auto-clear). If they come back
      // tomorrow and want to cancel, playing again clears the flag at
      // manual-purge time — same path the page promises.
      setStatus(status, t('privacy.removal.confirmed', 'Got it — your data is flagged for removal. Coming back to play will cancel the request.'), 'is-ok', 'privacy.removal.confirmed');
    } catch {
      setStatus(status, t('privacy.removal.error', 'Could not send the request. Please try again later.'), 'is-error', 'privacy.removal.error');
      btn.disabled = false;
    }
  });
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 * @param {'is-ok' | 'is-error' | null} cls
 * @param {string} [i18nKey]
 */
function setStatus(el, text, cls, i18nKey) {
  el.textContent = text;
  el.classList.remove('is-ok', 'is-error');
  if (cls) el.classList.add(cls);
  if (i18nKey) el.setAttribute('data-i18n', i18nKey);
  else el.removeAttribute('data-i18n');
}
