/**
 * Which dock each Flag Party screen wants.
 *
 * The dock used to live INSIDE each `<section>`, one copy per screen. That is
 * what made the bar jump on phones: the screen-swap animation puts a
 * `transform` on the section, and a transformed ancestor becomes the containing
 * block for `position: fixed` descendants — so for the ~190ms the swap class was
 * on, the dock's `bottom: 0` resolved against the SECTION instead of the
 * viewport and the bar rendered ~400px up the screen before snapping down. It
 * only showed below 700px, because that is the only width where the dock is
 * fixed rather than in-flow.
 *
 * So the page now has ONE dock, a sibling of the sections rather than a child of
 * any of them, and the screen says what it wants in it. Nothing inside a
 * transformed element, nothing to mis-resolve.
 *
 * The rule this encodes, worth keeping if the dock ever moves again: **a
 * position-fixed element must not sit inside anything that can be transformed.**
 *
 * Values are `data-dock` specs (see DOCK_CATALOG in common.js). `null` means the
 * screen shows no dock at all — the three mid-show beats (round card, draft
 * pick, between-rounds break) are timed and self-advancing, and none of them
 * carried a dock before this change either. That is deliberate rather than an
 * oversight: they are moments the show is driving, not moments you act in.
 */

/** @typedef {'start'|'lobby'|'question'|'roundcard'|'pick'|'break'|'final'} PartySection */

/** @type {Record<PartySection, string | null>} */
export const DOCK_BY_SECTION = {
  start: 'home',
  lobby: 'home',
  // Only the host can abort a running game back to the lobby; the item itself is
  // hidden per-seat at render time, which is why the spec is the same for both.
  question: 'backToSettings home',
  roundcard: null,
  pick: null,
  break: null,
  final: 'playAgainParty home',
};

/**
 * The dock spec for a screen, or null for "no dock here".
 *
 * Unknown / null screens resolve to null rather than throwing: `showSection` is
 * also called with `null` while the page is deciding what to show, and a hard
 * failure there would take the whole page down over a navigation bar.
 *
 * @param {string | null} section
 * @returns {string | null}
 */
export function dockSpecFor(section) {
  if (!section) return null;
  return Object.prototype.hasOwnProperty.call(DOCK_BY_SECTION, section)
    ? DOCK_BY_SECTION[/** @type {PartySection} */ (section)]
    : null;
}
