/**
 * Build the multi-line share-text block for a finished daily puzzle —
 * a Wordle-style teaser the player can paste into chat / social.
 *
 * Shape:
 *   <titleLine>
 *
 *   <grid>
 *   <streakLine?>
 *
 *   <url>
 *
 * The grid is one emoji per answer slot, in the canonical answer-set
 * order, 5 cells per row. 🟩 if the player found the answer at that
 * slot, ⬛ if they missed it. The optional streak line appears flush
 * under the grid (no blank between) so it reads as a flourish on the
 * result block rather than a second visual section.
 *
 * Pure: no DOM, no clock, no i18n lookup. Caller passes the localised
 * title line, optional streak line, and the canonical URL.
 */

/**
 * @param {{
 *   titleLine: string,
 *   answerCodes: string[],
 *   foundCodes: string[],
 *   url: string,
 *   streakLine?: string,
 * }} args
 * @returns {string}
 */
export function buildShareText({ titleLine, answerCodes, foundCodes, url, streakLine }) {
  const found = new Set(foundCodes);
  const cells = answerCodes.map((code) => (found.has(code) ? '🟩' : '⬛'));
  const rows = [];
  for (let i = 0; i < cells.length; i += 5) {
    rows.push(cells.slice(i, i + 5).join(''));
  }
  const gridBlock = streakLine ? `${rows.join('\n')}\n${streakLine}` : rows.join('\n');
  return `${titleLine}\n\n${gridBlock}\n\n${url}`;
}
