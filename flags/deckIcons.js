/**
 * The four deck icons — one per question type the flag games can ask.
 *
 * Born in `flagParty/page.js` as `SETUP_ICONS`, promoted here when flagQuiz
 * became the second consumer (Feature V: the play-screen deck indicator + its
 * picker popover). Per the repo's "promote on the second consumer" rule, this
 * is that moment; before it, sharing would have locked the wrong shape.
 *
 * WHAT IS SHARED IS THE ARTWORK, NOT THE SIZING. The two consumers need very
 * different boxes: Flag Party puts these in a 24×24 slot leading a row in a
 * vertical settings list; flagQuiz puts one inline in a 14px text row at
 * 24×18, and four more in a 130px popover. So the caller passes its own class
 * and owns the CSS. Baking sizing in here would just mean one of them fighting
 * it back off.
 *
 * The set is deliberately a matched quartet:
 *   flags     — a real country flag. France: a clean tricolour that still
 *               reads as "a flag" at 20px. Nothing keys off which country;
 *               swap the code to re-pick.
 *   weird     — the Jolly Roger. A flag with no country, and unmistakably not
 *               a specific one, which is exactly why it works as a symbol FOR
 *               the non-sovereign pool rather than a sample FROM it. (The
 *               intuitive alternative, Nepal's pennant, is actively wrong:
 *               Nepal is sovereign, so the one flag everyone would draw for
 *               "weird flags" lives in the OTHER deck.)
 *   outlines  — the real Italy contour asset, the same silhouette the round
 *               itself renders.
 *   facts     — an ascending stat-bar chart. Monochrome `currentColor`, unlike
 *               the flag artwork which carries its own colours by nature.
 *
 * Known rough edge, worth fixing at the call site rather than here: at small
 * sizes these don't read as a set. `flags` and `weird` are solid colour
 * rectangles; `outlines` and `facts` are thin marks on nothing. Two carry
 * visual weight and two don't. It never showed in Flag Party, where they sit
 * in a list with labels and room to breathe; it shows immediately when they're
 * four-across in a popover. The fix is a surface tile behind the contour and
 * the chart, which is a layout decision, so it belongs to the consumer.
 */

/** @typedef {'flags' | 'weird' | 'outlines' | 'facts'} DeckIconId */

/** Every deck icon, in the canonical display order. */
export const DECK_ICON_IDS = /** @type {const} */ (['flags', 'weird', 'outlines', 'facts']);

/**
 * Decks whose icon is an `<img>` pointing at a real asset (and therefore needs
 * `base`). The other two are self-contained inline SVG.
 *
 * @type {Record<string, string>}
 */
const ASSET_ICONS = {
  flags: 'flags/svg/fr.svg',
  outlines: 'flags/contours/it.svg',
};

const JOLLY_ROGER =
  '<svg viewBox="0 0 32 24" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="32" height="24" fill="#241f22"/>' +
  '<g stroke="#fff" stroke-width="2.4" stroke-linecap="round">' +
  '<line x1="10" y1="13" x2="22" y2="19"/><line x1="22" y1="13" x2="10" y2="19"/></g>' +
  '<g fill="#fff"><circle cx="9.4" cy="12.6" r="1.5"/><circle cx="22.6" cy="12.6" r="1.5"/>' +
  '<circle cx="9.4" cy="19.4" r="1.5"/><circle cx="22.6" cy="19.4" r="1.5"/></g>' +
  '<ellipse cx="16" cy="10.5" rx="5" ry="5.3" fill="#fff"/>' +
  '<rect x="12.6" y="13.6" width="6.8" height="3.4" rx="1" fill="#fff"/>' +
  '<circle cx="14" cy="10" r="1.4" fill="#241f22"/><circle cx="18" cy="10" r="1.4" fill="#241f22"/>' +
  '<rect x="15.3" y="11.6" width="1.4" height="2" fill="#241f22"/></svg>';

const STAT_BARS =
  '<svg viewBox="0 0 24 24" fill="currentColor">' +
  '<rect x="3" y="13" width="4.4" height="8" rx="1"/>' +
  '<rect x="9.8" y="8" width="4.4" height="13" rx="1"/>' +
  '<rect x="16.6" y="4" width="4.4" height="17" rx="1"/></svg>';

/**
 * Markup for one deck's icon.
 *
 * @param {string} deck  one of DECK_ICON_IDS
 * @param {{ base?: string, className?: string }} [opts]
 *   `base` prefixes the asset URLs. Defaults to `'../'`, which is right for
 *   any page one level under the repo root (`flagParty/`, `flagQuiz/`). A page
 *   nested deeper must pass its own.
 *   `className` is applied to the root element so the caller can size it.
 * @returns {string} HTML, or '' for an unknown deck (callers render nothing
 *   rather than a broken box).
 */
export function deckIconHtml(deck, { base = '../', className = '' } = {}) {
  const cls = className ? ` class="${className}"` : '';
  const asset = ASSET_ICONS[deck];
  if (asset) return `<img${cls} src="${base}${asset}" alt="" />`;
  if (deck === 'weird') return JOLLY_ROGER.replace('<svg ', `<svg${cls} `);
  if (deck === 'facts') return STAT_BARS.replace('<svg ', `<svg${cls} `);
  return '';
}
