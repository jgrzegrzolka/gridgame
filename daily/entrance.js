/**
 * Timing for the daily playing screen's staged entrance.
 *
 * The CSS half lives in `common.css` (the `.enter` / `.enter-wash` /
 * `.enter-heart` mechanism); this module owns the one thing CSS can't do —
 * landing the caret in the input once the entrance has finished. The
 * entrance's job is "here is the puzzle, now type"; if it doesn't end there
 * it is decoration.
 *
 * Pulled out of `playFlow.js` so the rules are testable without a DOM: the
 * delay, the reduced-motion shortcut, and the two guards that stop the
 * entrance from taking a caret away from a player who is already using it.
 */

/**
 * How long the entrance runs before the input is ready for the caret:
 * `--enter-duration` + 2 × `--enter-stagger`, the beat the input itself
 * animates on (`--enter-i: 2`). Pinned against `common.css` by
 * `entrance.test.js` — change the tokens and the test points here.
 */
export const ENTRANCE_FOCUS_DELAY_MS = 420;

/**
 * Focus the search input once the entrance has played.
 *
 * Three conditions, each with a reason:
 *  - touch devices are skipped entirely (pre-existing behaviour) — focusing
 *    there throws the on-screen keyboard over the board before the player
 *    has read the puzzle;
 *  - only if the input is still empty, because a fast typer is allowed to
 *    start during the animation (the input is never disabled) and stealing
 *    the caret back mid-word would be worse than not focusing at all;
 *  - immediately, not on a timer, under `prefers-reduced-motion: reduce` —
 *    there is no entrance to wait for.
 *
 * @param {{ value: string, focus: () => void }} inputEl
 * @param {{
 *   touch?: boolean,
 *   reducedMotion?: boolean,
 *   schedule?: (fn: () => void, ms: number) => any,
 * }} [opts]
 * @returns {any} the timer handle, or null when nothing was scheduled
 */
export function scheduleEntranceFocus(inputEl, opts = {}) {
  const {
    touch = false,
    reducedMotion = false,
    schedule = (fn, ms) => setTimeout(fn, ms),
  } = opts;
  if (touch) return null;
  const focusIfUntouched = () => {
    if (!inputEl.value) inputEl.focus();
  };
  if (reducedMotion) {
    focusIfUntouched();
    return null;
  }
  return schedule(focusIfUntouched, ENTRANCE_FOCUS_DELAY_MS);
}

/**
 * The environment reads `scheduleEntranceFocus` needs, resolved from the
 * live window. Separate from the scheduler itself so the rules above can be
 * tested against plain values.
 *
 * @param {any} view
 * @returns {{ touch: boolean, reducedMotion: boolean }}
 */
export function readEntranceEnv(view) {
  return {
    touch: 'ontouchstart' in view,
    reducedMotion: typeof view.matchMedia === 'function'
      && view.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
