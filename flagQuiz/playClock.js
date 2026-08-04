/**
 * The round clock for both quiz modes — the 60s budget and the endurance
 * stopwatch read from the same one.
 *
 * Two rules live here, and both used to be inline in `page.js` where nothing
 * could test them.
 *
 * **It does not run until the player plays.** The clock is armed by the first
 * pick, not by the round being set up. `startGame` used to stamp the start
 * time and then kick off the first four flag requests, so every round charged
 * the player for its own loading — worst on a cold visit, where the images are
 * uncached and the board is still blank while the budget drains. Both modes
 * feed a shared leaderboard, and in endurance mode elapsed time *is* the
 * score, so that was scoring people on their connection. The deliberate
 * trade: question one is untimed, and a player can study that first board for
 * as long as they like. Same gift for everyone, and the alternative (waiting
 * on image decode) makes the clock depend on how the network behaved.
 *
 * **Time spent in the settings tray is not play time.** The clock is
 * wall-clock, so a pause banks its own duration and subtracts it — freezing a
 * rAF instead would drift, because real time moves on while the loop is
 * stopped.
 *
 * Note that pausing and arming are independent: opening the tray before the
 * first pick pauses a clock that has not started, which must still block
 * picks (that is what `isPaused` is read for) while banking nothing.
 *
 * @param {{ now?: () => number }} [deps]  `now` is injectable so the tests
 *   can drive the clock instead of sleeping.
 */
export function createPlayClock({ now = Date.now } = {}) {
  /** Timestamp of the first pick. 0 until then — the clock is not running. */
  let startedAt = 0;
  /** Timestamp the current pause began, or 0 when not paused. */
  let pausedAt = 0;
  /** Total banked pause time, already excluded from `elapsedMs`. */
  let pausedMs = 0;

  return {
    /**
     * Arm the clock on the player's first pick. Idempotent: every later pick
     * calls it too, and must not restart the round.
     */
    start() {
      if (!startedAt) startedAt = now();
    },
    /** True once the first pick has landed. */
    isStarted() {
      return startedAt !== 0;
    },
    /** True while the settings tray holds the round. */
    isPaused() {
      return pausedAt !== 0;
    },
    /** Hold the round. Idempotent, and legal before the clock is armed. */
    pause() {
      if (pausedAt) return;
      pausedAt = now();
    },
    /**
     * Release the round, banking however long the pause lasted. Nothing is
     * banked if the clock was never armed — there is no elapsed time for the
     * pause to have inflated.
     */
    resume() {
      if (!pausedAt) return;
      if (startedAt) pausedMs += now() - pausedAt;
      pausedAt = 0;
    },
    /**
     * Play time so far: 0 before the first pick, frozen while paused, and
     * never counting time spent in the tray.
     */
    elapsedMs() {
      if (!startedAt) return 0;
      return (pausedAt || now()) - startedAt - pausedMs;
    },
  };
}
