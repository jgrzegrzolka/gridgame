/**
 * How far the winner card's honour line has to slide to show its tail.
 *
 * The final board's winner card reads "♛ Winner · ⚡ Fastest Finger in the West".
 * At 320 px, with a typed-in name of any length, that line does not fit however
 * the row is built — the crown, the title and the name are all load-bearing, so
 * there is nothing left to drop. Rather than cut it, the line slides once per
 * cycle to show its end and slides back (`flow-peek` in `flagParty/index.css`).
 *
 * This module owns the one number that decides, because it is the one thing here
 * that is arithmetic rather than DOM, and it has a wrong answer that looks right:
 * the slide has to clear the **fade band as well as the overflow**. The container
 * masks its right edge so the text visibly continues instead of stopping at an
 * ellipsis, and a slide of exactly `scrollWidth - clientWidth` parks the final
 * characters *underneath* that mask — semi-transparent at precisely the moment
 * the animation is holding still for them to be read. The fix is to travel the
 * width of the band too.
 *
 * Kept out of `page.js` so it can be tested: everything else about the effect is
 * measurement and class toggling, which is not, but this is where the bug would
 * actually live.
 */

/**
 * Width of the right-edge fade, in px. Must match the `mask-image` stop on
 * `.fw-crown.flowing` in `flagParty/index.css` — they are two halves of one
 * number, and `crownFlow.test.js` pins them together so the CSS cannot drift
 * away from the arithmetic.
 */
export const CROWN_FADE_PX = 16;

/**
 * The smallest overflow worth animating for, in px.
 *
 * Measured at 390 px the honour line overflows by **2 px** — the ellipsis alone
 * costs about that much to draw, so it is a character either way. Flowing for it
 * would slide the line `2 + 16 = 18` px to reveal two: a visible wobble, running
 * for as long as the board is on screen, to recover nothing. At 320 px the same
 * line overflows by 60, which is a real sentence going missing.
 *
 * So the effect is reserved for the case it was designed for. Below the floor the
 * ellipsis is the honest answer and nobody can tell what they are missing; above
 * it the line moves. The number is a judgement call, not a measurement — it is
 * the width at which a truncation stops being invisible.
 */
export const FLOW_MIN_OVERFLOW_PX = 8;

/**
 * The `--flow` translation for a line of this width in a box of this width, or
 * **null when it fits** — which is the common case and means no animation at all
 * is applied. A permanently sliding line on the last screen of the night would
 * be the wrong kind of energy; this is the exception path.
 *
 * Negative, because the line travels left to reveal its tail.
 *
 * @param {number} scrollWidth  the line's full width (`el.scrollWidth`)
 * @param {number} clientWidth  the width it is allowed (`el.clientWidth`)
 * @param {number} [fadePx]  the mask band; defaults to {@link CROWN_FADE_PX}
 * @returns {number | null} px to translate by, or null if nothing overflows
 */
export function flowDistance(scrollWidth, clientWidth, fadePx = CROWN_FADE_PX) {
  // Guard the pre-layout call: a hidden or unmounted card measures 0/0, which is
  // not "it fits" so much as "there is nothing to measure yet". Both read as
  // null here, and the caller re-measures after layout.
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) return null;
  const overflow = scrollWidth - clientWidth;
  if (overflow < FLOW_MIN_OVERFLOW_PX) return null;
  return -(overflow + fadePx);
}
