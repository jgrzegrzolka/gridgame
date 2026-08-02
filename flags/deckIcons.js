/**
 * The deck icons — one per question type the flag games can ask.
 *
 * Born in `flagParty/page.js` (as the setup panel's icon table, now `MODE_ICONS`),
 * promoted here when flagQuiz
 * became the second consumer (Feature V: the play-screen deck indicator + its
 * picker popover). Per the repo's "promote on the second consumer" rule, this
 * is that moment; before it, sharing would have locked the wrong shape.
 *
 * WHAT IS SHARED IS THE ARTWORK, NOT THE SIZING. The two consumers need very
 * different boxes: Flag Party puts these in a 24×24 slot leading a row in a
 * vertical settings list; flagQuiz puts one inline in a 14px text row at
 * 24×18, and the rest in a popover. So the caller passes its own class and owns
 * the CSS. Baking sizing in here would just mean one of them fighting it back
 * off.
 *
 * **This is a shared artwork catalog, not a picture of either menu.** The two
 * consumers overlap but neither uses all of it: flagQuiz has two decks (`flags`,
 * `weird`), Flag Party has four round types (those two plus `outlines` and
 * `spot`). An id here needs at least one consumer, which is what retired the
 * ascending-bar `facts` chart when flagQuiz's Statistics deck was removed —
 * Flag Party draws its statistics rounds from `metricVisuals` instead, per
 * metric, so nothing was left pointing at it.
 *
 *   flags     — the invented generic flag (`glyphFlag.svg`): a Nordic cross
 *               offset to the hoist, flown by no country. This was France's
 *               tricolour until it wasn't: a real flag here quietly claims that
 *               one country represents the deck, and at 20px players read it as
 *               "the France round" rather than "the flags round". The invented
 *               mark says "a flag" without naming one — the same argument
 *               `weird` makes below, and the same mark `filterChips.js` already
 *               draws for "this criterion is about the flag's design", so one
 *               picture now means "flag" site-wide.
 *   weird     — the Jolly Roger. A flag with no country, and unmistakably not
 *               a specific one, which is exactly why it works as a symbol FOR
 *               the non-sovereign pool rather than a sample FROM it. (The
 *               intuitive alternative, Nepal's pennant, is actively wrong:
 *               Nepal is sovereign, so the one flag everyone would draw for
 *               "weird flags" lives in the OTHER deck.)
 *   outlines  — the real Italy contour asset, the same silhouette Flag Party's
 *               map round itself renders.
 *   spot      — a magnifier, for the round where you inspect the flags rather
 *               than recall them. Monochrome `currentColor`, unlike the flag
 *               artwork which carries its own colours by nature.
 */

/** @typedef {'flags' | 'weird' | 'outlines' | 'spot'} DeckIconId */

/** Every deck icon, in the canonical display order. */
export const DECK_ICON_IDS = /** @type {const} */ (['flags', 'weird', 'outlines', 'spot']);

/**
 * Decks whose icon is an `<img>` pointing at a real asset (and therefore needs
 * `base`). The other two are self-contained inline SVG.
 *
 * @type {Record<string, string>}
 */
const ASSET_ICONS = {
  flags: 'flags/glyphFlag.svg',
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

/** Flag Party's "spot the flag" round: a magnifier, because that round is the one
 *  where you inspect the flags rather than recall them. `currentColor` so it
 *  inherits wherever it is placed. */
const MAGNIFIER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" ' +
  'stroke-linecap="round">' +
  '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.4" y1="15.4" x2="20.5" y2="20.5"/></svg>';

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
  if (deck === 'spot') return MAGNIFIER.replace('<svg ', `<svg${cls} `);
  return '';
}
