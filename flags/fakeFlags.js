/**
 * Three obviously-invented flags for the home hero's empty state — shown
 * before you've found any of today's flags, instead of blank boxes. Being fake
 * is the whole point: they fill the hero with flag imagery without spoiling the
 * puzzle's answers, and the Jolly Roger winks that these aren't the ones to find.
 *
 * The set reuses the site's existing invented-flag artwork, redrawn native 3:2
 * so it fills the same stamp boxes as the real found-flags:
 *   - a two-tone Nordic cross — the same design as `FLAG_GLYPH` in
 *     `filterChips.js` (teal field, cream cross), the mark the criteria headers
 *     already use for "this is about the flag's design".
 *   - an invented saltire, in the same cream-on-colour style, for variety.
 *   - the Jolly Roger — the "weird deck" symbol from `deckIcons.js`.
 *
 * The two fixed illustrative hues per flag are the documented exception to the
 * eight-colour palette rule, the same standing as the real flag SVGs and the
 * criteria glyphs: a mark that depicts a flag can't be built from brand tokens.
 *
 * Self-contained inline SVG (no external refs, no `id`s that could collide) so
 * each is safe to drop straight into `innerHTML`. A later step may draw these at
 * random from a larger pool; for now the trio is fixed.
 */

/** @type {readonly string[]} */
export const FAKE_FLAGS = Object.freeze([
  // Nordic cross — teal field, cream cross offset to the hoist (FLAG_GLYPH design).
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#2a9d8f"/><rect x="10" y="0" width="4.5" height="24" fill="#f4efe6"/><rect x="0" y="9.75" width="36" height="4.5" fill="#f4efe6"/></svg>',
  // Invented saltire — magenta field, cream diagonals.
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#c65f9a"/><path d="M0 0L36 24M36 0L0 24" stroke="#f4efe6" stroke-width="5"/></svg>',
  // Jolly Roger — the deckIcons "weird" symbol, redrawn 3:2.
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#241f22"/><g stroke="#fff" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="13" x2="24" y2="19"/><line x1="24" y1="13" x2="12" y2="19"/></g><g fill="#fff"><circle cx="11.4" cy="12.6" r="1.5"/><circle cx="24.6" cy="12.6" r="1.5"/><circle cx="11.4" cy="19.4" r="1.5"/><circle cx="24.6" cy="19.4" r="1.5"/></g><ellipse cx="18" cy="10.5" rx="5" ry="5.3" fill="#fff"/><rect x="14.6" y="13.6" width="6.8" height="3.4" rx="1" fill="#fff"/><circle cx="16" cy="10" r="1.4" fill="#241f22"/><circle cx="20" cy="10" r="1.4" fill="#241f22"/><rect x="17.3" y="11.6" width="1.4" height="2" fill="#241f22"/></svg>',
]);
