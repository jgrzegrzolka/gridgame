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
 * screen shows no dock at all.
 *
 * The three mid-show beats (round card, draft pick, between-rounds break) used to
 * be null on the reasoning that they are moments the show is driving, not moments
 * you act in. They now carry a dock, and only because of `partyPause`: those are
 * exactly the beats a break may start in ({@link module:partyTiming.BREAK_PHASES}),
 * so a dockless screen there would mean the control vanishes at the calmest
 * moments in the show — the ones somebody is most likely to reach for it in. They
 * still carry nothing else: Home, and the break.
 *
 * `partyPause` is always FIRST, on every screen that has it. Same slot everywhere
 * is the whole point of a control you reach for without looking.
 */

/** @typedef {'start'|'lobby'|'question'|'roundcard'|'pick'|'break'|'honour'|'winner'|'final'} PartySection */

/** @type {Record<PartySection, string | null>} */
export const DOCK_BY_SECTION = {
  start: 'home',
  lobby: 'home',
  // Only the host can abort a running game back to the lobby; the item itself is
  // hidden per-seat at render time, which is why the spec is the same for both.
  // Three items is the dock's documented maximum, and a guest sees two.
  question: 'partyPause backToSettings home',
  roundcard: 'partyPause home',
  pick: 'partyPause home',
  break: 'partyPause home',
  // The finish's three screens share ONE spec, which is the point: the ceremony
  // runs for ~12 s and a bar that appeared only at the end of it would blink into
  // existence under the player's thumb at the exact moment the board arrives.
  // Nothing left to pause on any of them — the game is over.
  honour: 'playAgainParty home',
  winner: 'playAgainParty home',
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
