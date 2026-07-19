/**
 * The one screen-change primitive for Flag Party.
 *
 * Every screen the show puts up — question, break, pick, round card, final —
 * lives in its own `<section>`, and moving between them used to be a `hidden`
 * attribute flip: an instant cut, four times a round. This sequences the change
 * instead: the outgoing screen falls away over {@link SWAP_OUT_MS}, then the
 * incoming one rises into place over {@link SWAP_IN_MS}.
 *
 * **One helper, not per-screen tweaks.** Every caller goes through `to()`, so
 * there is exactly one definition of what a screen change looks like. The
 * duplicate-`countUp` bug in Iteration 11 is the cautionary tale: two
 * implementations of one mechanism, and the wrong one silently won.
 *
 * The logic lives here rather than in `page.js` because it is a small state
 * machine with real edge cases — `render()` runs on every state change AND every
 * clock tick, so `to()` is called with the *same* screen far more often than with
 * a new one, and the show's beats (a 2 s round card, a sub-second reveal) can
 * interrupt a swap that is still mid-flight. Both are unit-tested with a fake
 * clock in `sectionSwap.test.js`; neither is observable from a screenshot.
 *
 * The DOM work itself is injected, so this module stays pure: the page passes in
 * how to show a section, how to mark it, and how to schedule.
 */

/** How long the outgoing screen takes to fall away. */
export const SWAP_OUT_MS = 120;
/** How long the incoming screen takes to rise into place. */
export const SWAP_IN_MS = 180;

/** Class on the screen currently falling away. */
export const LEAVING_CLASS = 'pt-leaving';
/** Class on the screen currently rising into place. */
export const ENTERING_CLASS = 'pt-entering';

/**
 * @typedef {Object} SwapIO
 * @property {(which: string | null) => void} show  make `which` the only visible
 *   section (or hide everything, for null). The page owns the `hidden` flips.
 * @property {(name: string, cls: string, on: boolean) => void} mark  toggle an
 *   animation class on a section.
 * @property {(fn: () => void, ms: number) => any} schedule
 * @property {(handle: any) => void} cancel
 * @property {() => boolean} reduced  whether the player asked for reduced motion.
 * @property {((which: string | null) => void) | undefined} [onShown]  called the
 *   moment a section actually becomes visible — i.e. after the out phase, not when
 *   it was requested. A screen whose own choreography is timed (the finish board's
 *   bottom-up reveal) has to start from here: `render()` builds it ~200 ms before
 *   the swap displays it, so a sequence started at build time is already part-run
 *   by the time anyone can see it.
 */

/**
 * Build a swapper over the given DOM adapters.
 *
 * @param {SwapIO} io
 */
export function createSectionSwapper(io) {
  /** The section actually visible right now. Lags `target` during a swap: the
   *  outgoing screen is still on screen while it falls away, which is the whole
   *  point of an out phase. */
  let shown = /** @type {string | null} */ (null);
  /** Where we are heading. Equals `shown` whenever nothing is in flight. */
  let target = /** @type {string | null} */ (null);
  let timer = /** @type {any} */ (null);

  /**
   * Drop any in-flight swap and leave the DOM in a clean, consistent state: the
   * animation classes come off whatever is on screen, and `shown` is still
   * accurate because we only ever set it at the moment we actually show.
   *
   * This is what makes an interrupted swap safe. The show's beats can be shorter
   * than the swap (a clean reveal is 0.9 s, the round-card beat 2 s), so a second
   * `to()` landing mid-flight is normal, not exotic — and a half-finished swap
   * that left a section wearing `pt-leaving` would fade a live screen to nothing.
   */
  function settle() {
    // Gated on a pending timer, not called unconditionally: a class is only ever
    // on a section while its timer is pending, so with nothing in flight there is
    // nothing to clean — and unmarking anyway would write to the DOM on every
    // settled screen change for no reason.
    if (timer === null) return;
    io.cancel(timer);
    timer = null;
    if (shown !== null) {
      io.mark(shown, LEAVING_CLASS, false);
      io.mark(shown, ENTERING_CLASS, false);
    }
  }

  /**
   * Show `which` now and play it in. Shared by the reduced-motion path, the
   * first-ever screen, and the tail of a full swap.
   * @param {string | null} which
   * @param {boolean} animate
   */
  function enter(which, animate) {
    io.show(which);
    shown = which;
    if (io.onShown) io.onShown(which);
    if (!animate || which === null) return;
    io.mark(which, ENTERING_CLASS, true);
    timer = io.schedule(() => {
      timer = null;
      io.mark(/** @type {string} */ (which), ENTERING_CLASS, false);
    }, SWAP_IN_MS);
  }

  return {
    /**
     * Move to `which`. A no-op when we are already there or already heading
     * there — which is the common case by a wide margin, since `render()` calls
     * this on every clock tick. Returns whether it started a change, for tests.
     *
     * @param {string | null} which
     * @returns {boolean}
     */
    to(which) {
      if (which === target) return false;
      settle();
      const from = shown;
      target = which;
      // Nothing to animate away from (first paint), or the player asked for
      // less motion: land on the new screen immediately. Reduced motion skips
      // the out phase entirely rather than just dropping the CSS animation —
      // otherwise the screen change would still cost 120 ms of nothing.
      if (from === null || io.reduced()) {
        enter(which, !io.reduced());
        return true;
      }
      io.mark(from, LEAVING_CLASS, true);
      timer = io.schedule(() => {
        timer = null;
        io.mark(from, LEAVING_CLASS, false);
        enter(which, true);
      }, SWAP_OUT_MS);
      return true;
    },

    /** The section on screen right now (lags `target` mid-swap). */
    get shown() { return shown; },
    /** Where the swapper is heading; equals `shown` when settled. */
    get target() { return target; },
    /** Whether a swap is mid-flight. */
    get busy() { return timer !== null; },
  };
}
