/**
 * Drop-and-bounce celebration for freshly-earned achievements.
 *
 * Reusable across surfaces — currently fires on the daily finish
 * screen (the in-the-moment celebration), can wire onto any future
 * earn trigger (TTT first-win, etc.) by calling `celebrate(rules)`
 * with the array of newly-earned `AchievementRule`s.
 *
 * The overlay DOM is lazy-mounted on first call so consumer pages
 * don't have to remember to drop the HTML — every page that imports
 * this module gets the celebration capability for free. CSS lives in
 * `common.css` so the styles are always loaded alongside.
 *
 * Each rule plays one card at a time (queued) — multiple unlocks
 * never pile up on screen. ~4 seconds per card: ~1.6s drop + bounce,
 * ~2.4s hold, ~250ms fade out. Tap anywhere to skip the current card.
 */

/** @typedef {import('./achievements.js').AchievementRule} AchievementRule */

/**
 * Play the drop-and-bounce overlay for each newly-earned rule in
 * sequence. Returns when the last card has been dismissed.
 *
 * @param {AchievementRule[]} rules
 * @returns {Promise<void>}
 */
export async function celebrate(rules) {
  for (const rule of rules) {
    await celebrateOne(rule);
  }
}

/**
 * @param {AchievementRule} rule
 * @returns {Promise<void>}
 */
function celebrateOne(rule) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    const els = ensureOverlay();
    els.icon.innerHTML = rule.icon;
    els.name.textContent = rule.name;
    els.desc.textContent = rule.description;

    els.overlay.hidden = false;
    // Force a reflow so the keyframe animation restarts cleanly
    // between queued celebrations.
    els.overlay.classList.remove('ach-celebrate--leaving');
    // eslint-disable-next-line no-unused-expressions
    els.overlay.offsetHeight;

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      els.overlay.classList.add('ach-celebrate--leaving');
      setTimeout(() => {
        els.overlay.hidden = true;
        els.overlay.classList.remove('ach-celebrate--leaving');
        els.overlay.removeEventListener('click', dismiss);
        resolve();
      }, 250);
    };
    els.overlay.addEventListener('click', dismiss);
    // Auto-dismiss after the drop-bounce (~1.6s) + hold (~2.4s).
    setTimeout(dismiss, 4000);
  });
}

/**
 * Lazy-mount the overlay DOM on first call; idempotent on subsequent
 * calls. Returns handles for the four nodes the player gets to see.
 *
 * @returns {{ overlay: HTMLElement, icon: HTMLElement, name: HTMLElement, desc: HTMLElement }}
 */
function ensureOverlay() {
  const existing = /** @type {HTMLElement | null} */ (document.getElementById('ach-celebrate'));
  if (existing) {
    return {
      overlay: existing,
      icon: /** @type {HTMLElement} */ (document.getElementById('ach-celebrate-icon')),
      name: /** @type {HTMLElement} */ (document.getElementById('ach-celebrate-name')),
      desc: /** @type {HTMLElement} */ (document.getElementById('ach-celebrate-desc')),
    };
  }
  const overlay = document.createElement('div');
  overlay.id = 'ach-celebrate';
  overlay.className = 'ach-celebrate';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="ach-celebrate-card" id="ach-celebrate-card">' +
      '<p class="ach-celebrate-hat">Achievement unlocked</p>' +
      '<span class="ach-celebrate-icon" id="ach-celebrate-icon" aria-hidden="true"></span>' +
      '<h3 class="ach-celebrate-name" id="ach-celebrate-name"></h3>' +
      '<p class="ach-celebrate-desc" id="ach-celebrate-desc"></p>' +
    '</div>';
  document.body.appendChild(overlay);
  return {
    overlay,
    icon: /** @type {HTMLElement} */ (document.getElementById('ach-celebrate-icon')),
    name: /** @type {HTMLElement} */ (document.getElementById('ach-celebrate-name')),
    desc: /** @type {HTMLElement} */ (document.getElementById('ach-celebrate-desc')),
  };
}
