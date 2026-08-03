import { VARIANTS } from './quiz.js';

/**
 * Decks — the top level of flagQuiz's navigation, above variants.
 *
 * A **deck** is a kind of question. A **variant** is a pool you can ask it of.
 * The distinction became load-bearing with Feature V: before it, every variant
 * asked the same question ("which flag is X?") over a slice of the world, so
 * one flat list said everything. `weird` asks the same question over a
 * different KIND of pool, which is what the two levels buy.
 *
 * Feature V also shipped two decks that asked genuinely different questions —
 * Outlines (pick a contour) and Statistics (pick the country at a metric's
 * extreme). Nobody played either, so both were removed and the machinery they
 * needed went with them: per-variant art, prompt kinds, endless pools, and the
 * `10q` mode. Two decks left, both asking "which flag is X?".
 *
 * **The player never sees this level.** The round-settings tray flattens decks
 * and variants into one row of pools (`flagQuiz/roundSettings.js`), because
 * from the player's side "Weird flags" is just one more thing you could be
 * quizzed on, and a two-level picker for eight leaves was ceremony. What the
 * distinction still buys is everything around the picking: which icon the
 * settings pill wears (Flags and Weird flags render identically once a round
 * starts, so the icon is the only thing saying which pool you are in), and
 * `DEFAULT_DECK` as the baseline for deciding which pools are a different KIND
 * of question and so worth marking out.
 *
 * Ordering here is display order — of the pool chips, and of anything else
 * that walks the decks.
 */

/** @typedef {{ id: string, label: string, variants: string[] }} Deck */

/**
 * Deck → the variants it can be played over, in display order.
 *
 * A new deck joins by adding an entry here plus its `VARIANTS` key; the
 * settings tray's pool chips read this, so nothing else needs touching.
 *
 * @type {Deck[]}
 */
export const DECKS = [
  {
    id: 'flags',
    label: 'Flags',
    variants: ['countries', 'europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'],
  },
  {
    id: 'weird',
    label: 'Weird',
    variants: ['weird'],
  },
];

/**
 * The ordinary deck: "which flag is this sovereign country?".
 *
 * Doubles as the fallback for a variant no deck claims, and as the baseline
 * callers compare against when deciding whether a pool needs marking out as
 * a different KIND of question (the round-settings tray does this — seven
 * continent chips wearing the same flag glyph is noise; the one chip that
 * isn't the ordinary deck is the one worth a mark).
 */
export const DEFAULT_DECK = 'flags';

/**
 * Which deck a variant belongs to.
 *
 * @param {string} variantKey
 * @returns {string} deck id; DEFAULT_DECK for an unknown variant, so a stale
 *   `?v=` or a saved lastVariant from a future build can never leave the play
 *   screen with no indicator at all.
 */
export function deckOf(variantKey) {
  const deck = DECKS.find((d) => d.variants.includes(variantKey));
  return deck ? deck.id : DEFAULT_DECK;
}

/**
 * Every variant claimed by some deck. Used by the drift test that pins DECKS
 * against VARIANTS — a variant no deck lists would be unreachable from the UI
 * even though `?v=` still plays it.
 *
 * @returns {string[]}
 */
export function allDeckVariants() {
  return DECKS.flatMap((d) => d.variants);
}

/** @returns {boolean} true when every VARIANTS key is claimed by exactly one deck. */
export function decksCoverVariants() {
  const claimed = allDeckVariants();
  const known = Object.keys(VARIANTS);
  return claimed.length === known.length && known.every((k) => claimed.includes(k));
}
