import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY, STORAGE_KEY as DEVICE_STORAGE_KEY } from '../../flags/identity.js';
import { mintClaimToken, redeemClaimToken } from '../../flags/syncClaimClient.js';
import { syncPreview, syncMerge } from '../../flags/syncMergeClient.js';
import { t } from '../../i18n.js';

/**
 * /profile/sync/ has three states:
 *
 *   1. Landed via `?claim=<token>` — the user just scanned a QR from
 *      another device. Auto-redeem the token, run preview, possibly
 *      show the merge wizard, run merge, swap localStorage.deviceId,
 *      flip to ✓ Linked.
 *
 *   2. No `?claim=`, no identityId yet — "Show QR" affordance. Click
 *      mints a claim token, displays the QR inline. Other device
 *      scans the QR with its camera → lands on /profile/sync/?claim=…
 *      on that device → flow (1) runs there.
 *
 *   3. No `?claim=`, identityId already set — ✓ This device is linked.
 *      Re-link is V2 work; for now the linked state is terminal.
 *
 * Test-gate still applies — without `?test` on the URL, the page
 * redirects to /profile/.
 */
export function bootSync() {
  const unlinkedEl = document.getElementById('sync-unlinked');
  const linkedEl = document.getElementById('sync-linked');
  const qrContainerEl = document.getElementById('sync-qr-container');
  const qrSvgEl = document.getElementById('sync-qr-svg');
  const statusEl = document.getElementById('sync-status');
  const wizardEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('sync-wizard'));
  if (!unlinkedEl || !linkedEl || !qrContainerEl || !qrSvgEl || !statusEl || !wizardEl) return;

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

  function paintLinkedState() {
    let stored = null;
    try { stored = window.localStorage.getItem(IDENTITY_STORAGE_KEY); } catch {}
    const isLinked = typeof stored === 'string' && stored.length > 0;
    unlinkedEl.hidden = isLinked;
    linkedEl.hidden = !isLinked;
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

  // ---- Path 2 / 3: unlinked or linked ----
  paintLinkedState();
  document.addEventListener('langchanged', paintLinkedState);

  // Auto-mint the QR on page load when the user is unlinked — the
  // page exists to show one specific affordance, no reason to gate
  // it behind a button click. Token expires in 5 min; user can
  // reload to get a fresh one.
  let stored = null;
  try { stored = window.localStorage.getItem(IDENTITY_STORAGE_KEY); } catch {}
  const isAlreadyLinked = typeof stored === 'string' && stored.length > 0;
  if (!isAlreadyLinked) {
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
  }

  /**
   * Redeem the claim, preview merge, optionally show wizard, run
   * merge, swap localStorage.
   *
   * @param {string} token
   */
  async function runClaimFlow(token) {
    // Use Path-2 hidden state during the redeem so the user sees
    // *something* in the meantime.
    showStatus('sync.redeeming', 'Linking this device to your other one…');
    const redeem = await redeemClaimToken({ token });
    if (!redeem.ok) {
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
      paintLinkedState();
      showStatus('sync.signedinConfirm', 'Linked — your progress now syncs to this device.');
      return;
    }

    const preview = await syncPreview({ claimToken: token, sourceDeviceId: deviceId });
    if (!preview.ok) {
      showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
      return;
    }

    /** @type {{ nickname?: 'target' | 'source', daily?: 'target' | 'source' }} */
    let resolutions = {};
    if (preview.daily || preview.profile) {
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
    }

    const mergeRes = await syncMerge({ claimToken: token, sourceDeviceId: deviceId, resolutions });
    if (!mergeRes.ok) {
      showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
      return;
    }

    try {
      window.localStorage.setItem(DEVICE_STORAGE_KEY, targetDeviceId);
      window.localStorage.setItem(IDENTITY_STORAGE_KEY, targetDeviceId);
    } catch {
      showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
      return;
    }

    paintLinkedState();
    showStatus('sync.signedinConfirm', 'Linked — your progress now syncs to this device.');
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
