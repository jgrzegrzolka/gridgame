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
 * The play screen shows the current deck as one quiet icon; the burger shows
 * the decks as pills, and below them the current deck's variants — but only
 * when there is a choice to make.
 *
 * **That "only when there's a choice" rule is derived, not declared.** A deck
 * with one variant has nothing to pick, so no list renders. `flags` has seven
 * (the world plus six continents) so it lists them; `weird` has one so it
 * doesn't. Writing it as `if (deck === 'flags')` would have been a rule that
 * needs maintaining every time a deck lands — this way there's nothing to
 * update.
 *
 * Ordering here is display order, in both the pills and the indicator popover.
 */

/** @typedef {{ id: string, label: string, variants: string[] }} Deck */

/**
 * Deck → the variants it can be played over, in display order.
 *
 * A new deck joins by adding an entry here plus its `VARIANTS` key; the pills,
 * the popover and the burger all read this, so nothing else needs touching.
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
 * The variants of a deck, in display order. Empty for an unknown deck.
 *
 * @param {string} deckId
 * @returns {string[]}
 */
export function variantsForDeck(deckId) {
  const deck = DECKS.find((d) => d.id === deckId);
  return deck ? [...deck.variants] : [];
}

/**
 * Where tapping a deck takes you: its first variant.
 *
 * Tapping a deck starts playing it immediately rather than waiting for a
 * scope. Weird has no scope to wait for, so waiting would be a dead end for
 * half the decks; the cost is that Flags also starts immediately (at "All
 * countries") and reaching Europe means reopening the burger. Consistency over
 * the one tap.
 *
 * @param {string} deckId
 * @returns {string | null}
 */
export function defaultVariantForDeck(deckId) {
  const deck = DECKS.find((d) => d.id === deckId);
  return deck && deck.variants.length > 0 ? deck.variants[0] : null;
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
