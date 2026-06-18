/**
 * Drop-and-bounce celebration for freshly-earned achievements.
 *
 * Reusable across surfaces — currently fires on the daily finish
 * screen (the in-the-moment celebration), can wire onto any future
 * earn trigger (TTT first-win, etc.) by calling `celebrate(rules)`
 * with the array of newly-earned `AchievementRule`s.
 *
 * Cards rain down from above and pile up at the bottom of the
 * screen — staggered by `STAGGER_MS` so they cascade rather than
 * appear all at once. The overlay has no backdrop and is
 * pointer-events: none on the empty area: the player can still
 * interact with the result screen underneath. Each card has its own
 * × to dismiss; tapping the card body opens an info dialog with the
 * full description (the same shared `.achievement-info` dialog the
 * profile page uses).
 *
 * The overlay + dialog DOM are lazy-mounted on first call so
 * consumer pages don't have to drop any HTML.
 */

/** @typedef {import('./achievements.js').AchievementRule} AchievementRule */

const STAGGER_MS = 250;

/**
 * Cascade-mount one card per rule, staggered by `STAGGER_MS`. Each
 * card lingers until the player closes it via its own × button.
 * Resolves once every card has been dismissed.
 *
 * @param {AchievementRule[]} rules
 * @returns {Promise<void>}
 */
export function celebrate(rules) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || rules.length === 0) {
      resolve();
      return;
    }
    const { overlay, stack, dialog } = ensureOverlay();
    stack.replaceChildren();
    let remaining = rules.length;
    const onCardClosed = () => {
      remaining--;
      if (remaining === 0) {
        overlay.hidden = true;
        resolve();
      }
    };
    rules.forEach((rule, i) => {
      stack.appendChild(buildCard(rule, i, dialog, onCardClosed));
    });
    overlay.hidden = false;
  });
}

/**
 * @param {AchievementRule} rule
 * @param {number} i
 * @param {HTMLDialogElement} dialog
 * @param {() => void} onClose
 * @returns {HTMLElement}
 */
function buildCard(rule, i, dialog, onClose) {
  const card = document.createElement('div');
  card.className = 'ach-celebrate-card';
  card.style.animationDelay = `${i * STAGGER_MS}ms`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ach-celebrate-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '&times;';
  // stopPropagation so the close click doesn't also bubble up to the
  // card body listener (which opens the info dialog).
  closeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    card.remove();
    onClose();
  });
  card.appendChild(closeBtn);

  const hat = document.createElement('p');
  hat.className = 'ach-celebrate-hat';
  hat.textContent = 'Achievement unlocked';
  card.appendChild(hat);

  const icon = document.createElement('span');
  icon.className = 'ach-celebrate-icon';
  icon.setAttribute('aria-hidden', 'true');
  // rule.icon is a static SVG string authored in flags/achievements.js
  // (no player data ever flows through it), so innerHTML is safe here.
  icon.innerHTML = rule.icon;
  card.appendChild(icon);

  const name = document.createElement('h3');
  name.className = 'ach-celebrate-name';
  name.textContent = rule.name;
  card.appendChild(name);

  card.addEventListener('click', () => openInfoDialog(dialog, rule));
  return card;
}

/**
 * Reuses the shared `.achievement-info` dialog (mounted by
 * `ensureOverlay`) — same DOM shape and class names the profile page
 * uses, so they share styling in `common.css`.
 *
 * @param {HTMLDialogElement} dialog
 * @param {AchievementRule} rule
 */
function openInfoDialog(dialog, rule) {
  const iconEl = dialog.querySelector('.achievement-info-icon');
  if (iconEl) iconEl.innerHTML = rule.icon;
  const nameEl = dialog.querySelector('.achievement-info-name');
  if (nameEl) nameEl.textContent = rule.name;
  const statusEl = dialog.querySelector('.achievement-info-status');
  if (statusEl) statusEl.textContent = 'Earned';
  const bodyEl = dialog.querySelector('.achievement-info-body');
  if (bodyEl) bodyEl.textContent = rule.description;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/**
 * Lazy-mount the overlay (card stack) + the shared info dialog on
 * first call; idempotent on subsequent calls.
 *
 * @returns {{ overlay: HTMLElement, stack: HTMLElement, dialog: HTMLDialogElement }}
 */
function ensureOverlay() {
  const existing = /** @type {HTMLElement | null} */ (document.getElementById('ach-celebrate'));
  if (existing) {
    return {
      overlay: existing,
      stack: /** @type {HTMLElement} */ (document.getElementById('ach-celebrate-stack')),
      dialog: /** @type {HTMLDialogElement} */ (document.getElementById('ach-celebrate-dialog')),
    };
  }
  const overlay = document.createElement('div');
  overlay.id = 'ach-celebrate';
  overlay.className = 'ach-celebrate';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.hidden = true;
  const stack = document.createElement('div');
  stack.id = 'ach-celebrate-stack';
  stack.className = 'ach-celebrate-stack';
  overlay.appendChild(stack);
  document.body.appendChild(overlay);

  const dialog = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
  dialog.id = 'ach-celebrate-dialog';
  dialog.className = 'achievement-info achievement-info--earned';
  dialog.setAttribute('aria-labelledby', 'ach-celebrate-dialog-name');
  const card = document.createElement('div');
  card.className = 'achievement-info-card';
  card.innerHTML =
    '<span class="achievement-info-icon" aria-hidden="true"></span>' +
    '<h3 class="achievement-info-name" id="ach-celebrate-dialog-name"></h3>' +
    '<p class="achievement-info-status">Earned</p>' +
    '<p class="achievement-info-body"></p>';
  dialog.appendChild(card);
  document.body.appendChild(dialog);
  // Backdrop click closes the dialog — native <dialog> doesn't do
  // this on its own.
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });

  return { overlay, stack, dialog };
}
