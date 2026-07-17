import { VARIANTS } from './quiz.js';

/**
 * Decks — the top level of flagQuiz's navigation, above variants.
 *
 * A **deck** is a kind of question. A **variant** is a pool you can ask it of.
 * The distinction only became load-bearing with Feature V: before it, every
 * variant asked the same question ("which flag is X?") over a slice of the
 * world, so one flat list said everything. Now `weird` asks the same question
 * over a different KIND of pool, and Phases 3 and 4 add decks that ask
 * genuinely different questions (a contour, a statistic).
 *
 * The play screen shows the current deck as one quiet icon; the burger shows
 * the decks as pills, and below them the current deck's variants — but only
 * when there is a choice to make.
 *
 * **That "only when there's a choice" rule is derived, not declared.** A deck
 * with one variant has nothing to pick, so no list renders. `flags` has seven
 * (the world plus six continents) so it lists them; `weird` has one so it
 * doesn't. Phases 3 and 4 are world-only and get the same silence for free.
 * Writing it as `if (deck === 'flags')` would have been a rule that needs
 * maintaining every time a deck lands — this way there's nothing to update.
 *
 * Ordering here is display order, in both the pills and the indicator popover.
 */

/** @typedef {{ id: string, label: string, variants: string[] }} Deck */

/**
 * Deck → the variants it can be played over, in display order.
 *
 * Only the decks that actually exist are listed. Outlines (Phase 3) and Facts
 * (Phase 4) join by adding an entry here plus their `VARIANTS` key; the pills,
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
  // World-only: contour coverage is microstate-shaped (Oceania is 3/14), so
  // there's no continent slice worth offering. One variant means
  // `deckHasScopes` is false and the burger renders no scope list — derived,
  // not declared, so this entry is the whole change.
  {
    id: 'outlines',
    label: 'Shapes',
    variants: ['outlines'],
  },
  // World-only for the same reason Outlines is, but arrived at from the other
  // side: "Europe: most populous" would work, "Europe: most coffee" is all
  // zeros. A per-continent Facts deck is its own sparse matrix, and world-only
  // deletes it. One variant, so no scope list — same silence as the two above.
  {
    id: 'facts',
    label: 'Facts',
    variants: ['facts'],
  },
];

/** Fallback for a variant no deck claims — treated as an ordinary flags deck. */
const DEFAULT_DECK = 'flags';

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
 * scope. Weird / Outlines / Facts have no scope to wait for, so waiting would
 * be a dead end for three decks out of four; the cost is that Flags also
 * starts immediately (at "All countries") and reaching Europe means reopening
 * the burger. Consistency over the one tap.
 *
 * @param {string} deckId
 * @returns {string | null}
 */
export function defaultVariantForDeck(deckId) {
  const deck = DECKS.find((d) => d.id === deckId);
  return deck && deck.variants.length > 0 ? deck.variants[0] : null;
}

/**
 * Does this deck offer a scope choice? False when it has a single variant —
 * there is nothing to pick, so the burger renders no list. See the module
 * docstring: derived, not declared.
 *
 * @param {string} deckId
 * @returns {boolean}
 */
export function deckHasScopes(deckId) {
  return variantsForDeck(deckId).length > 1;
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
