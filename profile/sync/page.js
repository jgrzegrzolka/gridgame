import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY, STORAGE_KEY as DEVICE_STORAGE_KEY } from '../../flags/identity.js';
import { mintClaimToken, redeemClaimToken } from '../../flags/syncClaimClient.js';
import { syncPreview, syncMerge } from '../../flags/syncMergeClient.js';
import { fetchSyncLink } from '../../flags/syncLinkClient.js';
import { hydrateFromServer } from '../../flags/syncHydrate.js';
import { t } from '../../i18n.js';

/**
 * /profile/sync/ layout: a QR (always visible, lets any device link
 * to this one) above an optional "Device is linked." pane that paints
 * the shared post-merge deviceId. The pane is shown when:
 *
 *   - `localStorage.gridgame.identityId` is set (source device — it
 *     was the one that scanned the QR; the merge handler set this
 *     itself), OR
 *   - the server-side `GET /api/v1/sync/link` says this deviceId is
 *     in a link record (target device — discovered on visit; the
 *     identityId is then back-filled into localStorage so subsequent
 *     loads short-circuit the round-trip).
 *
 * Special URL params:
 *
 *   ?claim=<token>     — landed from a QR scan. Auto-redeem → preview
 *                        → maybe wizard → merge → swap deviceId →
 *                        paint linked.
 *   ?wizard-preview    — UI-only: opens the conflict wizard with mock
 *                        data so layout can be iterated without two
 *                        real devices.
 */
export function bootSync() {
  const linkedEl = document.getElementById('sync-linked');
  const linkedDeviceIdEl = document.getElementById('sync-linked-deviceid');
  const qrContainerEl = document.getElementById('sync-qr-container');
  const qrSvgEl = document.getElementById('sync-qr-svg');
  const statusEl = document.getElementById('sync-status');
  const progressEl = document.getElementById('sync-progress');
  const wizardEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('sync-wizard'));
  if (!linkedEl || !linkedDeviceIdEl || !qrContainerEl || !qrSvgEl || !statusEl || !progressEl || !wizardEl) return;

  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());

  /** @param {string} key @param {string} fallback */
  function showStatus(key, fallback) {
    statusEl.textContent = t(key, fallback);
    statusEl.setAttribute('data-i18n', key);
    statusEl.classList.add('is-active');
  }
  function clearStatus() {
    statusEl.textContent = '';
    statusEl.removeAttribute('data-i18n');
    statusEl.classList.remove('is-active');
  }
  function showProgress() {
    progressEl.hidden = false;
  }
  function hideProgress() {
    progressEl.hidden = true;
  }

  function paintLinkedState() {
    let storedIdentity = null;
    let storedDeviceId = null;
    try {
      storedIdentity = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
      storedDeviceId = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    } catch {}
    const isLinked = typeof storedIdentity === 'string' && storedIdentity.length > 0;
    linkedEl.hidden = !isLinked;
    if (isLinked && storedDeviceId) {
      linkedDeviceIdEl.textContent = storedDeviceId;
    }
  }

  // ---- Path 1: arriving with ?claim=<token> ----
  const params = new URLSearchParams(window.location.search);
  const claimToken = params.get('claim');
  if (claimToken) {
    void runClaimFlow(claimToken);
    return;
  }

  // ---- Preview-only: ?wizard-preview shows the conflict wizard
  // with mocked data so the UI can be iterated on without two real
  // devices + matching localStorage state. Pure UI: never calls
  // /sync/merge, never swaps deviceId. ---
  if (params.has('wizard-preview')) {
    void showWizard({
      profile: { target: 'Nimble Forest', source: 'Curious Otter' },
      daily: { count: 3, samplePuzzleIds: [3, 4, 7] },
    });
    return;
  }

  // Paint linked state from whatever localStorage knows right now,
  // then kick off the server-side discovery in parallel for the
  // target-device case (where only the server knows we're linked).
  paintLinkedState();
  document.addEventListener('langchanged', paintLinkedState);
  void discoverLinkedFromServer();

  // Auto-mint a QR on every page load — even when already linked.
  // The QR is the affordance for "let another device join the link",
  // and post-merge that's a perfectly normal thing to want (the
  // existing pair just absorbs a third browser). Tokens expire in
  // 5 min; reloading mints a fresh one.
  void (async () => {
    const mint = await mintClaimToken({ deviceId });
    if (!mint.ok) {
      showStatus('sync.error.generic', 'Couldn’t prepare the link — try again.');
      return;
    }
    // Inline the SVG. qrcode-svg's output is a self-contained
    // <svg>…</svg> string with no scripts.
    qrSvgEl.innerHTML = mint.qrSvg;
    qrContainerEl.hidden = false;
  })();

  /**
   * Ask the server whether this deviceId has been claimed (which
   * means at some point another browser scanned a QR minted by this
   * one and the merge stamped `linkedAt` on the profile row). Only
   * the target browser needs this — the source browser already set
   * its own identityId post-merge — but it's safe and cheap to run
   * either way: a never-throw GET that no-ops when the cached
   * identityId is already present.
   */
  async function discoverLinkedFromServer() {
    let stored = null;
    try { stored = window.localStorage.getItem(IDENTITY_STORAGE_KEY); } catch {}
    if (typeof stored === 'string' && stored.length > 0) return;
    const { linked } = await fetchSyncLink({ deviceId });
    if (!linked) return;
    try { window.localStorage.setItem(IDENTITY_STORAGE_KEY, deviceId); } catch {}
    paintLinkedState();
    // Now that we know this browser is the target of a link, pull
    // every server-side row (daily history + quiz personal-bests) into
    // local storage so /daily/archive and the quiz picker show the
    // post-merge view, not just the plays this particular browser
    // happened to make. Best-effort: a network failure leaves the
    // page correctly painted as "linked" and the user can reload.
    void hydrateFromServer({ deviceId, store: window.localStorage });
  }

  /**
   * Redeem the claim, preview merge, optionally show wizard, run
   * merge, swap localStorage.
   *
   * @param {string} token
   */
  async function runClaimFlow(token) {
    // Pulsing-dots progress line while the redeem / preview / merge
    // round-trips are in flight, so the user sees *something* during
    // the multi-second pipeline. Hidden again on success (linked-state
    // section takes over) or replaced by an error string on failure.
    showProgress();
    const redeem = await redeemClaimToken({ token });
    if (!redeem.ok) {
      hideProgress();
      const reason = 'reason' in redeem ? redeem.reason : 'unknown';
      if (reason === 'expired_token') {
        showStatus('sync.error.expired', 'That QR has expired — generate a new one on your other device.');
      } else if (reason === 'invalid_token') {
        showStatus('sync.error.invalidToken', 'That link isn’t valid. Generate a new QR on your other device.');
      } else {
        showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
      }
      return;
    }
    const { targetDeviceId } = redeem;

    if (targetDeviceId === deviceId) {
      // Same-device scan (e.g. user scanned their own QR for some
      // reason). Nothing to merge; just flip to linked.
      try {
        window.localStorage.setItem(IDENTITY_STORAGE_KEY, targetDeviceId);
      } catch {}
      hideProgress();
      clearStatus();
      paintLinkedState();
      return;
    }

    const preview = await syncPreview({ claimToken: token, sourceDeviceId: deviceId });
    if (!preview.ok) {
      hideProgress();
      showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
      return;
    }

    /** @type {{ nickname?: 'target' | 'source', daily?: 'target' | 'source' }} */
    let resolutions = {};
    if (preview.daily || preview.profile) {
      // Hide the progress line while the wizard is up — the dialog is
      // the user's active surface, the dots underneath would just
      // read as still-loading.
      hideProgress();
      const w = await showWizard({ profile: preview.profile, daily: preview.daily });
      if (!w) {
        // User cancelled the wizard — bail without merging. Tell
        // them clearly so the page doesn't look broken. Nothing
        // was changed server-side; the claim token has effectively
        // burned its 5-min window but localStorage and Cosmos are
        // untouched.
        showStatus('sync.cancelled', 'Cancelled — nothing was changed.');
        return;
      }
      resolutions = w;
      showProgress();
    }

    const mergeRes = await syncMerge({ claimToken: token, sourceDeviceId: deviceId, resolutions });
    if (!mergeRes.ok) {
      hideProgress();
      showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
      return;
    }

    try {
      window.localStorage.setItem(DEVICE_STORAGE_KEY, targetDeviceId);
      window.localStorage.setItem(IDENTITY_STORAGE_KEY, targetDeviceId);
    } catch {
      hideProgress();
      showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
      return;
    }

    hideProgress();
    clearStatus();
    paintLinkedState();
    // Pull every server-side row (post-merge daily history + quiz
    // PBs) into this browser's localStorage. Source's local cache
    // up to this point was just source's own pre-link plays; after
    // hydrate, /daily/archive and the quiz picker reflect the merged
    // pool the user expects from "linked". Uses the NEW deviceId
    // (targetDeviceId) since we just swapped.
    void hydrateFromServer({ deviceId: targetDeviceId, store: window.localStorage });
  }

  /**
   * @param {{
   *   profile: import('../../flags/syncMergeClient.js').NicknameConflict,
   *   daily: import('../../flags/syncMergeClient.js').DailyConflict,
   * }} conflicts
   * @returns {Promise<{ nickname: 'target' | 'source', daily: 'target' | 'source' } | null>}
   */
  function showWizard(conflicts) {
    return new Promise((resolve) => {
      paintWizard(wizardEl, conflicts, (resolution) => {
        wizardEl.close();
        resolve(resolution);
      });
      wizardEl.showModal();
    });
  }
}

/**
 * Render the conflict-resolution wizard inside the existing dialog.
 *
 * @param {HTMLDialogElement} dialog
 * @param {{
 *   profile: import('../../flags/syncMergeClient.js').NicknameConflict,
 *   daily: import('../../flags/syncMergeClient.js').DailyConflict,
 * }} conflicts
 * @param {(resolution: { nickname: 'target' | 'source', daily: 'target' | 'source' } | null) => void} onResolve
 */
function paintWizard(dialog, conflicts, onResolve) {
  dialog.innerHTML = '';

  /** @type {'target' | 'source'} */
  let nicknameChoice = 'target';
  /** @type {'target' | 'source'} */
  let dailyChoice = 'target';

  if (conflicts.profile) {
    const section = document.createElement('section');
    section.className = 'sync-wizard-q';
    const q = document.createElement('p');
    q.className = 'sync-wizard-question';
    q.setAttribute('data-i18n', 'sync.wizard.profileQ');
    q.textContent = t('sync.wizard.profileQ', 'Nickname');
    section.appendChild(q);
    section.appendChild(makeToggleRow(conflicts.profile.target, conflicts.profile.source, (v) => { nicknameChoice = v; }));
    dialog.appendChild(section);
  }

  if (conflicts.daily) {
    const section = document.createElement('section');
    section.className = 'sync-wizard-q';
    const q = document.createElement('p');
    q.className = 'sync-wizard-question';
    q.setAttribute('data-i18n', 'sync.wizard.dailyQ');
    // Inline the conflict count into the label — saves the dedicated
    // note paragraph and still tells the user how big the overlap is.
    q.textContent = t('sync.wizard.dailyQ', 'Daily — {count} overlap').replace('{count}', String(conflicts.daily.count));
    section.appendChild(q);
    section.appendChild(makeToggleRow(
      t('sync.wizard.dailyTarget', 'My other device'),
      t('sync.wizard.dailySource', 'This device'),
      (v) => { dailyChoice = v; },
    ));
    dialog.appendChild(section);
  }

  const actions = document.createElement('div');
  actions.className = 'sync-wizard-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'sync-wizard-cancel';
  cancel.setAttribute('data-i18n', 'sync.wizard.cancel');
  cancel.textContent = t('sync.wizard.cancel', 'Cancel');
  cancel.addEventListener('click', () => onResolve(null));
  actions.appendChild(cancel);
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'sync-wizard-confirm';
  confirm.setAttribute('data-i18n', 'sync.wizard.confirm');
  confirm.textContent = t('sync.wizard.confirm', 'Link devices');
  confirm.addEventListener('click', () => onResolve({ nickname: nicknameChoice, daily: dailyChoice }));
  actions.appendChild(confirm);
  dialog.appendChild(actions);
}

/**
 * Two-label iOS-style toggle: the target label sits on the left,
 * the source label on the right, and the switch in between. The
 * active side bolds. Default state = target (matches the
 * conservative-merge default everywhere else in the wizard).
 *
 * Reuses the existing `.scope-toggle-switch / -track / -thumb`
 * chrome from common.css so the visual idiom matches the burger
 * menu's include-territories toggle.
 *
 * @param {string} targetLabel
 * @param {string} sourceLabel
 * @param {(v: 'target' | 'source') => void} onChange
 */
function makeToggleRow(targetLabel, sourceLabel, onChange) {
  const row = document.createElement('div');
  row.className = 'sync-wizard-toggle';

  const left = document.createElement('span');
  left.className = 'sync-wizard-toggle-label is-active';
  left.textContent = targetLabel;
  row.appendChild(left);

  const switchEl = document.createElement('label');
  switchEl.className = 'scope-toggle-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  const track = document.createElement('span');
  track.className = 'scope-toggle-track';
  track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('span');
  thumb.className = 'scope-toggle-thumb';
  track.appendChild(thumb);
  switchEl.appendChild(input);
  switchEl.appendChild(track);
  row.appendChild(switchEl);

  const right = document.createElement('span');
  right.className = 'sync-wizard-toggle-label';
  right.textContent = sourceLabel;
  row.appendChild(right);

  input.addEventListener('change', () => {
    const useSource = input.checked;
    left.classList.toggle('is-active', !useSource);
    right.classList.toggle('is-active', useSource);
    onChange(useSource ? 'source' : 'target');
  });

  return row;
}
