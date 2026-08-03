/**
 * Staging a finish screen: each element becomes visible at a time measured
 * from the finish, not from when its data turned up.
 *
 * Both finish boards paint in pieces, and the pieces arrive out of order —
 * the score is there the instant the round ends, the leaderboard is a
 * network round trip away, the community average slower still. A plain CSS
 * `animation-delay` counts from when the element renders, so the same
 * cascade plays differently on a fast connection and a slow one, and a
 * late-arriving element can overtake one that was supposed to precede it.
 *
 * The fix is one line of arithmetic: an element that should appear 1.3s
 * after the finish, created 0.8s after the finish, gets a 0.5s delay. That
 * arithmetic is this module. The fade itself is `.fade-up-in` in common.css.
 */

/**
 * How long an element created `elapsedMs` after the finish should wait
 * before appearing, to land on `targetMs` after the finish.
 *
 * Clamped at zero: something that arrives after its slot has passed shows
 * immediately. It has already missed the cascade, and holding it back
 * further would only delay the screen settling.
 *
 * @param {number} targetMs   when this element should be visible, from finish
 * @param {number} elapsedMs  how long ago the finish was
 * @returns {number}
 */
export function remainingDelayMs(targetMs, elapsedMs) {
  if (!Number.isFinite(targetMs) || targetMs <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return targetMs;
  return Math.max(0, targetMs - elapsedMs);
}

/**
 * Stage `el` to fade up at `targetMs` after the finish.
 *
 * @param {{ style: { animationDelay: string }, classList: { add(name: string): void } }} el
 * @param {{ targetMs: number, elapsedMs: number }} args
 */
export function fadeUpAt(el, { targetMs, elapsedMs }) {
  if (!el) return;
  el.style.animationDelay = `${remainingDelayMs(targetMs, elapsedMs)}ms`;
  el.classList.add('fade-up-in');
}
