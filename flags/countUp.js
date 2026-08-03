/**
 * The score count-up shared by the finish screens.
 *
 * Two screens tick a number up from zero when a round ends — the daily
 * puzzle and the flag quiz — and they want different pacing: daily walks
 * one flag per 60 ms (a found-list of 14 reads as a list being counted),
 * the quiz covers whatever you scored in a flat 600 ms (a 60-second round
 * can score 40+, and 2.4 s of ticking would still be running while the
 * leaderboard fades in under it).
 *
 * That is one mechanism with a duration knob, not two mechanisms, so it
 * lives here rather than twice in two page.js files. `countUpValue` is the
 * whole rule and is pure; `runCountUp` is the loop that reads a clock and
 * calls back.
 */

/**
 * The number to show `elapsedMs` into a count-up from 0 to `target`.
 *
 * Floored, so the value only ever moves forward through whole numbers and
 * lands exactly on `target` at the end. Out-of-range inputs resolve to the
 * final value rather than throwing: a caller with a zero duration wants the
 * answer, not an animation.
 *
 * @param {{ target: number, durationMs: number, elapsedMs: number }} args
 * @returns {number}
 */
export function countUpValue({ target, durationMs, elapsedMs }) {
  if (!Number.isFinite(target) || target <= 0) return Math.max(0, target || 0);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return target;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (elapsedMs >= durationMs) return target;
  return Math.min(target, Math.floor((elapsedMs / durationMs) * target));
}

/**
 * Drive a count-up, calling `onValue` with each new whole number.
 *
 * Frame-driven rather than `setInterval`-driven: the caller gets a value
 * that is correct for the wall clock even if a frame is dropped, which an
 * interval that assumes every tick fires does not. `onValue` is called only
 * when the number actually changes, so the caller can write to the DOM
 * unconditionally without repainting the same digits every frame.
 *
 * Fires `onValue(0)` synchronously before the first frame, so the element
 * shows the starting value rather than flashing its final one.
 *
 * The clock and the scheduler are injectable for tests; the defaults are
 * `Date.now` and `requestAnimationFrame`. Reduced motion jumps straight to
 * `target` — a value that arrives instantly is the accessible form of a
 * value that arrives over 600 ms, and every caller wants that, so it is
 * handled here instead of at each call site.
 *
 * @param {{
 *   target: number,
 *   durationMs: number,
 *   onValue: (value: number) => void,
 *   now?: () => number,
 *   schedule?: (cb: () => void) => number,
 *   cancel?: (handle: number) => void,
 *   reducedMotion?: boolean,
 * }} args
 * @returns {() => void} stop — cancels a run in flight, leaving the last
 *   painted value alone. Safe to call after the run has finished.
 */
export function runCountUp({
  target,
  durationMs,
  onValue,
  now = () => Date.now(),
  schedule = (cb) => globalThis.requestAnimationFrame(cb),
  cancel = (handle) => globalThis.cancelAnimationFrame(handle),
  reducedMotion = detectReducedMotion(),
}) {
  if (reducedMotion || typeof schedule !== 'function') {
    onValue(countUpValue({ target, durationMs: 0, elapsedMs: 0 }));
    return () => {};
  }

  const started = now();
  let shown = 0;
  let handle = 0;
  let stopped = false;
  onValue(0);

  const step = () => {
    if (stopped) return;
    const value = countUpValue({ target, durationMs, elapsedMs: now() - started });
    if (value !== shown) {
      shown = value;
      onValue(value);
    }
    if (shown >= target) return;
    handle = schedule(step);
  };
  handle = schedule(step);

  return () => {
    stopped = true;
    if (handle && typeof cancel === 'function') cancel(handle);
  };
}

/**
 * Read the reduced-motion preference, defaulting to "no preference" where
 * there is no `matchMedia` to ask (jsdom-less tests, older engines).
 *
 * @returns {boolean}
 */
function detectReducedMotion() {
  const view = globalThis;
  if (!view || typeof view.matchMedia !== 'function') return false;
  try {
    return !!view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
