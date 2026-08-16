/**
 * Per-seat visibility for Flag Party's one dock.
 *
 * Two dock items are host-only, because the server drops them from anyone else:
 * `applyPlayAgain` and `applyReturnToLobby` (`flags/partyRoom.js`) both return an
 * untouched room for a non-host, with no reply and no error. A guest who can see
 * either button gets a control that does nothing at all when pressed — the worst
 * shape a control can have, since nothing on screen says why.
 *
 * **Why this owns the mount as well as the hiding.** `setDock` rebuilds the bar's
 * items from the catalog on every screen change, so each remount hands back a
 * fresh, VISIBLE copy of whatever the new spec carries. Hiding therefore has to
 * happen after the mount, every time, and the way to guarantee that is to make it
 * impossible to do one without the other — which is what `sync` is.
 *
 * The bug this replaced: the finish's hide ran synchronously after
 * `playCeremony()`, which only arms timers. It landed on the PREVIOUS screen's
 * bar (which has no play-again, so: a silent no-op), and the honour beat mounted
 * a fresh visible button a moment later. Guests saw "Play again" through the
 * whole ending and pressing it did nothing. It only ever corrected itself if some
 * unrelated re-render happened to fire while the board was up, which is why it
 * read as intermittent.
 *
 * The DOM work is injected, same as `sectionSwap.js`, so this stays pure and
 * testable.
 */

/**
 * Dom ids of the dock items only the host may act on. Dom ids rather than
 * catalog ids because these are what the page looks up; `seatDock.test.js`
 * pins them against the catalog so a typo can't silently stop hiding.
 */
export const HOST_ONLY_ITEMS = ['play-again', 'question-to-settings'];

/**
 * @typedef {Object} SeatDockIO
 * @property {(spec: string) => void} mount  rebuild the bar from a spec.
 * @property {(id: string, hidden: boolean) => void} setHidden  hide or show one
 *   item by dom id. A no-op for an id the current bar doesn't carry.
 * @property {(() => void) | undefined} [afterMount]  called once per real
 *   rebuild, for state the fresh catalog items don't carry (the queued-break
 *   tint). Runs after the items exist.
 */

/**
 * Build a seat-aware dock over the given DOM adapters.
 *
 * @param {SeatDockIO} io
 * @param {string | null} [initialSpec]  what the markup already has mounted.
 */
export function createSeatDock(io, initialSpec = null) {
  let mounted = initialSpec;

  return {
    /**
     * Point the bar at `spec` and paint it for this seat.
     *
     * Remounts only on a real change — rebuilding an identical bar would destroy
     * and recreate the button under a finger already on it, and `render()` calls
     * this on every clock tick. The seat pass runs regardless, so a host handover
     * mid-screen reveals the item without a blink.
     *
     * `null` means "this screen shows no dock"; the page hides the element and
     * the mounted spec is left alone, so returning to the same screen doesn't
     * rebuild.
     *
     * @param {string | null} spec
     * @param {boolean} isHost
     */
    sync(spec, isHost) {
      if (spec === null) return;
      if (spec !== mounted) {
        io.mount(spec);
        mounted = spec;
        if (io.afterMount) io.afterMount();
      }
      for (const id of HOST_ONLY_ITEMS) io.setHidden(id, !isHost);
    },

    /** The spec currently on the bar. */
    get mounted() { return mounted; },
  };
}
