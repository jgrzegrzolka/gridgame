import { getOrCreateDeviceId } from '../flags/identity.js';
import { t } from '../i18n.js';

const ENDPOINT = '/api/v1/profile/requestDeletion';

export function bootPrivacy() {
  const link = /** @type {HTMLAnchorElement | null} */ (document.getElementById('privacy-request-link'));
  const status = document.getElementById('privacy-request-status');
  if (!link || !status) return;

  link.addEventListener('click', async (e) => {
    e.preventDefault();
    // `<a>` has no native `disabled` — aria-disabled doubles as the
    // re-click guard and the CSS hook for the greyed-out style. Bail
    // early if a previous click already succeeded.
    if (link.getAttribute('aria-disabled') === 'true') return;
    link.setAttribute('aria-disabled', 'true');
    setStatus(status, '', null);
    const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      // Success — leave the link disabled. If the user comes back
      // tomorrow and wants to cancel, playing again clears the flag at
      // manual-purge time — same path the page promises.
      setStatus(status, t('privacy.removal.confirmed', 'Got it — your data is flagged for removal. Coming back to play will cancel the request.'), 'is-ok', 'privacy.removal.confirmed');
    } catch {
      setStatus(status, t('privacy.removal.error', 'Could not send the request. Please try again later.'), 'is-error', 'privacy.removal.error');
      link.removeAttribute('aria-disabled');
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
