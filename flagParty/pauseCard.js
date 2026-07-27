/**
 * What the pause card should do next, as a pure decision over the current view.
 *
 * The card is a modal `<dialog>`, which is state the page has to open and close
 * by hand — the browser will not derive it from anything. That kind of "make the
 * DOM agree with the state" logic is exactly where a missed transition hides,
 * and one did: the first version closed the card only when the ROOM said the
 * pause had ended, so leaving the room with the card up (Back, or the phone's
 * edge swipe) left a modal stranded over the start screen, with Esc suppressed
 * and — for a guest — no button on it at all. Only a reload cleared it.
 *
 * Pulling the decision out here makes that case a single assertion instead of
 * something you can only find by driving a browser into the right corner.
 */

/**
 * @typedef {Object} PauseCardView
 * @property {boolean} inRoom  whether this client is still in a room at all.
 *   Independent of `pausedFor`, because the two disagree on exactly the path
 *   that broke: a client can leave a room whose last known state was paused, and
 *   a rejected connection keeps its stale `pausedFor` for good.
 * @property {string | null} pausedFor  the seat the room is waiting for.
 * @property {boolean} isOpen  whether the card is on screen right now.
 * @property {boolean} timerPending  whether the delay before showing it is
 *   already running, so a second call does not start a second timer.
 * @property {boolean} [delayElapsed]  set only by the delay firing, to
 *   distinguish "start waiting" from "the wait is over". Without it the timer
 *   callback would ask the same question it just answered and schedule itself
 *   again forever.
 */

/**
 * @param {PauseCardView} view
 * @returns {'open' | 'close' | 'repaint' | 'schedule' | 'none'}
 *   `close` means make sure no card and no pending timer — it is the "none of
 *   this applies any more" answer, not only the end of a pause.
 */
export function pauseCardStep(view) {
  const { inRoom, pausedFor, isOpen, timerPending, delayElapsed = false } = view;
  // Leaving beats everything the room last said. Checked first, and separately
  // from `pausedFor`, because the room's own answer is stale by then: nobody is
  // going to send this client a `paused` message telling it the game it walked
  // out of has resumed.
  if (!inRoom || !pausedFor) return (isOpen || timerPending) ? 'close' : 'none';
  // Already up: keep its text current instead of reopening. A pause that moves
  // to a SECOND absentee changes who the card names without ever closing.
  if (isOpen) return 'repaint';
  if (delayElapsed) return 'open';
  // A wait is already running; let it finish rather than restarting the delay
  // every time a roster message lands.
  if (timerPending) return 'none';
  return 'schedule';
}
