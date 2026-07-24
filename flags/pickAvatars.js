/**
 * How many pick avatars a reveal shows before it stops naming faces and starts
 * counting them.
 *
 * The reveal draws one avatar per player who chose a tile, which is the best beat
 * in the game at six players and the reason the screen falls apart at sixteen.
 * The two surfaces fail differently, which is why the rule lives in one place
 * rather than being solved twice:
 *
 *  - the **flag / outline tile** (`.picks`) is a flex row of fixed-width avatars
 *    with no wrap, so past about seven they simply walk off the tile;
 *  - the **statistics chart** (`.rank-rail`) is worse than that. Its rail is one
 *    width for the whole chart, taken from the busiest row (see `railWidthPx` in
 *    `flags/partyChart.js`), so a single popular country squeezes the country-name
 *    column on **all four rows** — including the three nobody picked. Capping the
 *    rail is what makes that column stop moving between rounds.
 *
 * Pure arithmetic over a list of player ids. No DOM: `flagParty/page.js` renders
 * what this returns, and `partyChart.js` measures it.
 */

/**
 * Faces shown before the overflow marker. Five, because that is where a tile's
 * row still clears its own width on the narrowest phone and where the chart's
 * rail still leaves the country name room to be read.
 *
 * Mirrored by nothing in CSS — the cap is applied in JS, and the stylesheet only
 * knows how wide one avatar and one marker are.
 */
export const PICK_AVATAR_CAP = 5;

/**
 * Split a tile's or a row's pickers into the faces to draw and the number left
 * over.
 *
 * `overflow` is a **count, not a flag**: the marker reads `+11`, because "everyone
 * went for Brazil" is the joke the reveal exists to tell and a bare ellipsis
 * cannot tell it. Zero means every picker fits and no marker is drawn.
 *
 * At exactly one over the cap this trades a face for a `+1` of about the same
 * width. Accepted deliberately: a cap that sometimes isn't the cap is harder to
 * reason about (and to lay the rail out from) than one that always is.
 *
 * @param {string[]} pickerIds  playerIds who chose this tile / row, in buzz order
 * @param {number} [cap]  faces to show; defaults to {@link PICK_AVATAR_CAP}
 * @returns {{ shown: string[], overflow: number }}
 */
export function capPickers(pickerIds, cap = PICK_AVATAR_CAP) {
  const ids = Array.isArray(pickerIds) ? pickerIds : [];
  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : PICK_AVATAR_CAP;
  if (ids.length <= limit) return { shown: ids.slice(), overflow: 0 };
  return { shown: ids.slice(0, limit), overflow: ids.length - limit };
}

/**
 * How many slots a row of `n` pickers occupies once capped — faces plus the
 * marker, which takes a slot of its own.
 *
 * The arithmetic half of {@link capPickers}, for callers that need to *measure* a
 * row they are not drawing (the chart sizes its rail from the busiest row, which
 * is usually not the row being built). Kept beside the cap so a change to one
 * cannot leave the other behind.
 *
 * @param {number} count  how many players picked
 * @param {number} [cap]
 * @returns {{ faces: number, marker: boolean }}
 */
export function pickSlots(count, cap = PICK_AVATAR_CAP) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : PICK_AVATAR_CAP;
  return { faces: Math.min(n, limit), marker: n > limit };
}
