import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY, STORAGE_KEY as DEVICE_STORAGE_KEY } from '../../flags/identity.js';
import { linkDevice } from '../../flags/passkeyClient.js';
import { syncPreview, syncMerge } from '../../flags/syncMergeClient.js';
import { t } from '../../i18n.js';

/**
 * Boot the `/profile/sync/` page. Two states:
 *
 *   Unlinked  → one "Link this device" button. Click triggers the
 *               full link-and-merge flow:
 *                 1. linkDevice → passkey register-or-auth → returns
 *                    identityId, targetDeviceId, mergeToken
 *                 2. if source === target (re-link on the registering
 *                    device) → no merge needed, just stamp identityId
 *                 3. else syncPreview → conflict report
 *                 4. if conflicts → show wizard (1–2 questions)
 *                 5. syncMerge with resolutions → server folds source
 *                    data into target
 *                 6. localStorage.gridgame.deviceId ← targetDeviceId
 *                 7. localStorage.gridgame.identityId ← identityId
 *                 8. flip UI to linked state
 *
 *   Linked    → show "✓ This device is linked." — re-link / manage is
 *               V2 work.
 */
export function bootSync() {
  const unlinkedEl = document.getElementById('sync-unlinked');
  const linkedEl = document.getElementById('sync-linked');
  const linkBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('sync-link'));
  const statusEl = document.getElementById('sync-status');
  const wizardEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('sync-wizard'));
  if (!unlinkedEl || !linkedEl || !linkBtn || !statusEl || !wizardEl) return;

  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());

  function paintState() {
    let stored = null;
    try { stored = window.localStorage.getItem(IDENTITY_STORAGE_KEY); } catch {}
    const isLinked = typeof stored === 'string' && stored.length > 0;
    unlinkedEl.hidden = isLinked;
    linkedEl.hidden = !isLinked;
  }
  paintState();
  document.addEventListener('langchanged', paintState);

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

  /** @param {string} reason */
  function statusForFailure(reason) {
    if (reason === 'no_webauthn') {
      showStatus('sync.error.browser', 'Your browser doesn’t support this yet — try a recent Chrome, Safari, or Edge.');
    } else if (reason === 'cancelled') {
      clearStatus();
    } else {
      showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
    }
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

  linkBtn.addEventListener('click', async () => {
    clearStatus();
    linkBtn.disabled = true;
    try {
      const linkResult = await linkDevice(deviceId);
      if (!linkResult.ok) {
        statusForFailure('reason' in linkResult ? linkResult.reason : 'unknown');
        return;
      }
      const { identityId, targetDeviceId, mergeToken } = linkResult;

      // Same-device case: registering on a fresh device, no merge to
      // do. Just stamp identityId and we're done.
      if (!targetDeviceId || targetDeviceId === deviceId || !mergeToken) {
        try { window.localStorage.setItem(IDENTITY_STORAGE_KEY, identityId); } catch {}
        paintState();
        showStatus('sync.savedConfirm', 'Done. Now open this page on your other device and tap the same button.');
        return;
      }

      // Cross-device case: preview, possibly wizard, then merge.
      showStatus('sync.merging', 'Linking your devices…');
      const preview = await syncPreview({ mergeToken, sourceDeviceId: deviceId });
      if (!preview.ok) {
        showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
        return;
      }

      /** @type {{ nickname?: 'target' | 'source', daily?: 'target' | 'source' }} */
      let resolutions = {};
      if (preview.daily || preview.profile) {
        const w = await showWizard({ profile: preview.profile, daily: preview.daily });
        if (!w) {
          // User cancelled the wizard — bail without merging. The
          // passkey is registered/authed but we don't switch deviceId.
          clearStatus();
          return;
        }
        resolutions = w;
      }

      const mergeRes = await syncMerge({ mergeToken, sourceDeviceId: deviceId, resolutions });
      if (!mergeRes.ok) {
        showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
        return;
      }

      // Swap localStorage atomically (best-effort — both writes can
      // throw on private mode / quota; we surface to status if they do).
      try {
        window.localStorage.setItem(DEVICE_STORAGE_KEY, targetDeviceId);
        window.localStorage.setItem(IDENTITY_STORAGE_KEY, identityId);
      } catch {
        // localStorage unavailable — the link still worked server
        // side, but this device won't *use* the linked deviceId next
        // page-load. Tell the user.
        showStatus('sync.error.generic', 'Couldn’t link this device — try again.');
        return;
      }

      paintState();
      showStatus('sync.signedinConfirm', 'Linked — your progress now syncs to this device.');
    } finally {
      linkBtn.disabled = false;
    }
  });
}

/**
 * Render the conflict-resolution wizard inside the existing dialog
 * element. Calls `onResolve` with either the chosen resolutions or
 * `null` if the user cancels.
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

    section.appendChild(makeRadioRow('daily', 'target', t('sync.wizard.dailyTarget', 'My linked profile'), true, (v) => { dailyChoice = v; }));
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
