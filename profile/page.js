import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY } from '../flags/identity.js';
import { defaultNickname, displayNickname } from '../flags/nickname.js';
import { avatarSvg } from '../flags/avatar.js';
import { isOffensiveNickname } from '../flags/nicknameModeration.js';
import { NICKNAME_STORAGE_KEY } from '../common.js';
import { hydrateFromServer } from '../flags/syncHydrate.js';
import { fetchDailyMe } from '../daily/streakClient.js';
import { evaluateAchievements } from '../flags/achievements.js';
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

  // Self-heal for a freshly-linked browser: this device shares its
  // deviceId with another browser that DID save a nickname, but the
  // hydrate that should have populated our local cache never ran (the
  // link happened on an older deploy, or the user cleared
  // localStorage). Fire one hydrate to pull the server's truth, then
  // patch the input + persisted state if the user hasn't typed yet.
  // Bypasses the trySyncDevices staleness gate on purpose — the
  // "no local nickname despite being linked" condition is the signal
  // that something needs refreshing now, not in an hour.
  let identityId = null;
  try { identityId = window.localStorage.getItem(IDENTITY_STORAGE_KEY); } catch {}
  if (typeof identityId === 'string' && identityId.length > 0 && !cached) {
    void (async () => {
      const res = await hydrateFromServer({ deviceId, store: window.localStorage });
      if (!res.ok) return;
      let refreshed = null;
      try { refreshed = window.localStorage.getItem(NICKNAME_STORAGE_KEY); } catch {}
      // Only overwrite the input if the user hasn't started editing —
      // input.value === defaultName means they're still looking at the
      // initial default-paint state. Any user keystroke moves it away
      // from that, and we leave it alone.
      if (typeof refreshed === 'string' && refreshed.length > 0 && input.value === defaultName) {
        input.value = refreshed;
        persisted = refreshed;
        refreshButtons();
      }
    })();
  }

  let inFlight = false;
  /** @type {any} */
  let flashTimer = 0;
  /** Tracks whether the previous refreshButtons pass found the input
   * to be offensive. Used to fire the status shake only on the
   * transition false → true — not on every subsequent keystroke while
   * the input stays offensive (that'd shake on every character typed
   * inside a blocked word, which reads as nervous, not informative). */
  let wasOffensive = false;

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
      if (!wasOffensive) {
        // Transition into offensive — shake the status line once via
        // the reflow-restart trick so the user notices the message
        // even if their eye was on the input. Subsequent keystrokes
        // that keep the input offensive don't re-trigger.
        status.classList.remove('shake-wrong');
        void status.offsetWidth;
        status.classList.add('shake-wrong');
      }
      wasOffensive = true;
      return;
    }
    wasOffensive = false;
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
  // failure can re-add it cleanly via the reflow restart trick. Same
  // pattern for the status element when it shakes on transition into
  // an offensive name.
  input.addEventListener('animationend', () => {
    input.classList.remove('shake-wrong');
  });
  status.addEventListener('animationend', () => {
    status.classList.remove('shake-wrong');
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

  // Feature O — achievement grid. Async, non-blocking: nickname form
  // is fully usable while the streak fetch is in flight. Section stays
  // `hidden` until we have data, so a network failure leaves the page
  // looking like the pre-feature version rather than showing an empty
  // "Achievements" header.
  void renderAchievements(deviceId);
}

/**
 * Fetch the player's daily snapshot and paint the achievement grid.
 * No-op (and the section stays hidden) if the fetch fails — same
 * silent-degrade rule as the streak hint on the finish screen.
 *
 * @param {string} deviceId
 */
async function renderAchievements(deviceId) {
  const section = document.getElementById('achievements');
  const grid = document.getElementById('achievements-grid');
  if (!section || !grid) return;

  const snapshot = await fetchDailyMe(deviceId);
  if (!snapshot) return;

  const statuses = evaluateAchievements(snapshot);
  // Show the section even if zero are earned — locked silhouettes are
  // the "things to chase" UX. A truly empty grid would be a sign that
  // every rule failed to load; let the test gate catch that, not the
  // player.
  grid.replaceChildren();
  for (const { rule, earned } of statuses) {
    const li = document.createElement('li');
    li.dataset.achievementId = rule.id;

    // Tile is a <button> so a tap or keyboard Enter opens the info
    // dialog. The button itself takes the badge styling — the <li>
    // is just a grid cell.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `achievement-badge achievement-badge--${earned ? 'earned' : 'locked'}`;
    button.setAttribute('aria-label', `${rule.name} — ${earned ? 'earned' : 'locked'}`);
    // Tooltip carries the description (earned) or hint (locked) —
    // keeps the tile itself compact, only one line of name + icon.
    button.title = earned ? rule.description : rule.hint;
    button.addEventListener('click', () => openAchievementInfo(rule, earned));

    const icon = document.createElement('span');
    icon.className = 'achievement-icon';
    icon.setAttribute('aria-hidden', 'true');
    // Icons are static SVG strings authored in flags/achievements.js
    // (no player data inside), so innerHTML is safe here — no
    // user-controlled content reaches this branch.
    icon.innerHTML = rule.icon;
    button.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'achievement-name';
    name.textContent = rule.name;
    button.appendChild(name);

    li.appendChild(button);
    grid.appendChild(li);
  }
  wireAchievementInfoDismiss();
  section.hidden = false;
}

/**
 * Show the info dialog for a tapped achievement. Reuses one
 * `<dialog>` for every tile — content is repopulated each open.
 * `<dialog>` gives us Esc-to-close + focus management for free; the
 * sibling `wireAchievementInfoDismiss` adds backdrop-click dismiss.
 *
 * @param {import('../flags/achievements.js').AchievementRule} rule
 * @param {boolean} earned
 */
function openAchievementInfo(rule, earned) {
  const dialog = /** @type {HTMLDialogElement | null} */ (
    document.getElementById('achievement-info')
  );
  if (!dialog) return;
  dialog.classList.toggle('achievement-info--earned', earned);
  dialog.classList.toggle('achievement-info--locked', !earned);

  const iconEl = document.getElementById('achievement-info-icon');
  if (iconEl) iconEl.innerHTML = rule.icon;

  const nameEl = document.getElementById('achievement-info-name');
  if (nameEl) nameEl.textContent = rule.name;

  const statusEl = document.getElementById('achievement-info-status');
  if (statusEl) statusEl.textContent = earned ? 'Earned' : 'Locked';

  const bodyEl = document.getElementById('achievement-info-body');
  if (bodyEl) bodyEl.textContent = earned ? rule.description : rule.hint;

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/**
 * Idempotent — only wires the dialog backdrop-click listener once,
 * even when re-render fires (currently re-render happens at most
 * once per page load, but defensive against a future "refresh after
 * earn" hook).
 */
let achievementInfoDismissWired = false;
function wireAchievementInfoDismiss() {
  if (achievementInfoDismissWired) return;
  const dialog = /** @type {HTMLDialogElement | null} */ (
    document.getElementById('achievement-info')
  );
  if (!dialog) return;
  dialog.addEventListener('click', (ev) => {
    // `<dialog>` fires click on the dialog element when the backdrop
    // is clicked (the dialog's own children consume their own click).
    if (ev.target === dialog) dialog.close();
  });
  achievementInfoDismissWired = true;
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
