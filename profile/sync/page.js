import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY, STORAGE_KEY as DEVICE_STORAGE_KEY } from '../../flags/identity.js';
import { mintClaimToken, redeemClaimToken } from '../../flags/syncClaimClient.js';
import { syncPreview, syncMerge } from '../../flags/syncMergeClient.js';
import { isSyncTestMode } from '../../common.js';
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
  if (!isSyncTestMode()) {
    try { window.location.replace('../'); } catch {}
    return;
  }

  const unlinkedEl = document.getElementById('sync-unlinked');
  const linkedEl = document.getElementById('sync-linked');
  const showQrBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('sync-show-qr'));
  const qrContainerEl = document.getElementById('sync-qr-container');
  const qrSvgEl = document.getElementById('sync-qr-svg');
  const qrHintEl = document.getElementById('sync-qr-hint');
  const statusEl = document.getElementById('sync-status');
  const wizardEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('sync-wizard'));
  if (!unlinkedEl || !linkedEl || !showQrBtn || !qrContainerEl || !qrSvgEl || !qrHintEl || !statusEl || !wizardEl) return;

  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());

  // ---- How-it-works help dialog ----
  const helpBtn = document.getElementById('sync-help-btn');
  const helpDialog = /** @type {HTMLDialogElement | null} */ (document.getElementById('sync-help'));
  const helpClose = document.getElementById('sync-help-close');
  if (helpBtn && helpDialog) {
    helpBtn.addEventListener('click', () => helpDialog.showModal());
    helpDialog.addEventListener('click', (e) => {
      if (e.target === helpDialog) helpDialog.close();
    });
  }
  if (helpClose && helpDialog) {
    helpClose.addEventListener('click', () => helpDialog.close());
  }

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

  // ---- Path 2 / 3: unlinked or linked ----
  paintLinkedState();
  document.addEventListener('langchanged', paintLinkedState);

  showQrBtn.addEventListener('click', async () => {
    clearStatus();
    showQrBtn.disabled = true;
    try {
      const mint = await mintClaimToken({ deviceId });
      if (!mint.ok) {
        showStatus('sync.error.generic', 'Couldn’t prepare the link — try again.');
        return;
      }
      // Inline the SVG. qrcode-svg's output is a self-contained
      // <svg>…</svg> string with no scripts.
      qrSvgEl.innerHTML = mint.qrSvg;
      qrContainerEl.hidden = false;
      qrHintEl.hidden = false;
      showQrBtn.hidden = true;
    } finally {
      showQrBtn.disabled = false;
    }
  });

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
      if (!w) { clearStatus(); return; }
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
  const heading = document.createElement('h2');
  heading.setAttribute('data-i18n', 'sync.wizard.title');
  heading.textContent = t('sync.wizard.title', 'Two quick questions');
  dialog.appendChild(heading);

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
    q.textContent = t('sync.wizard.profileQ', 'Which nickname should this device use?');
    section.appendChild(q);
    section.appendChild(makeRadioRow('nickname', 'target', conflicts.profile.target, true, (v) => { nicknameChoice = v; }));
    section.appendChild(makeRadioRow('nickname', 'source', conflicts.profile.source, false, (v) => { nicknameChoice = v; }));
    dialog.appendChild(section);
  }

  if (conflicts.daily) {
    const section = document.createElement('section');
    section.className = 'sync-wizard-q';
    const q = document.createElement('p');
    q.className = 'sync-wizard-question';
    q.setAttribute('data-i18n', 'sync.wizard.dailyQ');
    q.textContent = t('sync.wizard.dailyQ', 'Which device should win on overlapping daily puzzles?');
    section.appendChild(q);
    const note = document.createElement('p');
    note.className = 'sync-wizard-note';
    note.textContent = t('sync.wizard.dailyNote', 'Overlap: {count} puzzles. Non-overlapping plays keep regardless.')
      .replace('{count}', String(conflicts.daily.count));
    section.appendChild(note);
    section.appendChild(makeRadioRow('daily', 'target', t('sync.wizard.dailyTarget', 'My other device'), true, (v) => { dailyChoice = v; }));
    section.appendChild(makeRadioRow('daily', 'source', t('sync.wizard.dailySource', 'This device'), false, (v) => { dailyChoice = v; }));
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
 * @param {string} group
 * @param {'target' | 'source'} value
 * @param {string} label
 * @param {boolean} checked
 * @param {(v: 'target' | 'source') => void} onChange
 */
function makeRadioRow(group, value, label, checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'sync-wizard-radio';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = group;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', () => { if (input.checked) onChange(value); });
  wrap.appendChild(input);
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(span);
  return wrap;
}
