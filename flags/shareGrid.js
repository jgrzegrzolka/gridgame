/**
 * Build the multi-line share-text block for a finished daily puzzle —
 * a Wordle-style teaser the player can paste into chat / social.
 *
 * Shape:
 *   <titleLine>
 *
 *   <grid>
 *
 *   <url>
 *
 * The grid is one emoji per answer slot, in the canonical answer-set
 * order, 5 cells per row. 🟩 if the player found the answer at that
 * slot, ⬛ if they missed it. No country names, no flag emojis — the
 * grid is a structural teaser, not a spoiler.
 *
 * Why no 🟥-for-wrong-guesses: `wrongCodes` is a tally of "guessed
 * countries that weren't targets," not a per-slot state. Mapping them
 * onto the slot grid would mean inventing positions where there
 * aren't any. The score line ("8/10") carries the success rate; the
 * wrong-guess count is structurally outside the grid and we
 * deliberately leave it out for cleanliness.
 *
 * Pure: no DOM, no clock, no i18n lookup. Caller passes the localised
 * title line and the canonical URL.
 */

/**
 * @param {{
 *   titleLine: string,
 *   answerCodes: string[],
 *   foundCodes: string[],
 *   url: string,
 * }} args
 * @returns {string}
 */
export function buildShareText({ titleLine, answerCodes, foundCodes, url }) {
  const found = new Set(foundCodes);
  const cells = answerCodes.map((code) => (found.has(code) ? '🟩' : '⬛'));
  const rows = [];
  for (let i = 0; i < cells.length; i += 5) {
    rows.push(cells.slice(i, i + 5).join(''));
  }
  return `${titleLine}\n\n${rows.join('\n')}\n\n${url}`;
}
