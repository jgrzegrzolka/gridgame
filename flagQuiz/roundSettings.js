import { VARIANTS, MODES, availableModes } from '../flags/quiz.js';
import { allDeckVariants, deckOf, DEFAULT_DECK } from '../flags/decks.js';

/**
 * The round-settings pill and its tray — everything about them that isn't DOM.
 *
 * The pill replaces four separate places the same two questions used to be
 * answered from: the burger's deck pills, the burger's continent list, the
 * play row's deck-icon popover, and the play row's `60s | all` links. All of
 * those asked either "which flags?" or "how long?", so the tray asks exactly
 * those two questions once, in that order, and the pill is the answer read
 * back.
 *
 * Flattening the deck/variant hierarchy is deliberate. Decks exist because
 * `weird` is a different KIND of pool, but from the player's side "Weird
 * flags" is just one more thing you could be quizzed on, and a two-level
 * picker for eight leaves was ceremony. `deckOf` still decides which icon
 * the pill wears, so the distinction survives where it earns its place.
 */

/**
 * Every pool you can be quizzed on, in deck order, flattened.
 *
 * Reads `allDeckVariants` rather than `Object.keys(VARIANTS)` so a variant
 * no deck claims stays out of the tray — `decksCoverVariants` already pins
 * that the two lists agree, and going through the decks keeps display order
 * owned by one place.
 *
 * `marked` says whether the chip should wear its deck's icon. Only pools
 * outside the ordinary flags deck get one: the world and the six continents
 * are all the same question over a different slice, so giving all seven the
 * same flag glyph would decorate them identically and say nothing. The icon
 * earns its place exactly where the KIND of question changes — which today
 * is the Weird flags pool, and tomorrow is whatever deck lands next, with no
 * rule to remember.
 *
 * @param {string} currentVariantKey
 * @returns {{ key: string, deck: string, active: boolean, marked: boolean }[]}
 */
export function poolOptions(currentVariantKey) {
  return allDeckVariants()
    .filter((key) => Object.prototype.hasOwnProperty.call(VARIANTS, key))
    .map((key) => {
      const deck = deckOf(key);
      return {
        key,
        deck,
        active: key === currentVariantKey,
        marked: deck !== DEFAULT_DECK,
      };
    });
}

/**
 * The clock choices, in MODES order (time-attack first).
 *
 * @param {string} currentMode
 * @returns {{ key: string, active: boolean }[]}
 */
export function modeOptions(currentMode) {
  return availableModes().map((key) => ({ key, active: key === currentMode }));
}

/**
 * What the pill says, and which deck icon it wears.
 *
 * The label is the two answers joined by the same middot the play row used
 * between its old segments — "All countries · 60s". `t` is passed in rather
 * than imported so this module stays free of i18n's load-order constraints
 * and the tests can read the label without booting a language.
 *
 * @param {{ variantKey: string, modeKey: string, t: (key: string, fallback: string) => string }} args
 * @returns {{ deck: string, label: string }}
 */
export function roundPillModel({ variantKey, modeKey, t }) {
  const variant = VARIANTS[variantKey];
  const pool = t(`variant.${variantKey}`, variant ? variant.label : variantKey);
  const clock = t(`quiz.mode.${modeKey}`, modeKey);
  return { deck: deckOf(variantKey), label: `${pool} · ${clock}` };
}

/**
 * The query string a given round configuration is reachable at.
 *
 * The tray restarts the round in place, so nothing navigates any more — but
 * the address bar still has to describe what you are playing, because the
 * share button copies `location.href` and "Play again" is a plain link to
 * it. `history.replaceState` writes this on every settings change; without
 * it, sharing after two chip taps would send a friend to the round you
 * started on rather than the one you played.
 *
 * @param {string} variantKey
 * @param {string} modeKey
 * @returns {string}
 */
export function roundQuery(variantKey, modeKey) {
  return `?v=${encodeURIComponent(variantKey)}&n=${encodeURIComponent(modeKey)}`;
}

/**
 * Resolve the configuration a page load should start in.
 *
 * Order is explicit deep-link → last saved pick → default, per axis. The two
 * axes resolve independently: `?v=europe` with no `?n=` keeps the mode you
 * were last playing rather than silently resetting you to 60s, which is what
 * a shared continent link used to do.
 *
 * @param {{
 *   urlVariant: string | null,
 *   urlMode: string | null,
 *   savedVariant: string | null,
 *   savedMode: string | null,
 *   defaultVariant: string,
 *   defaultMode: string,
 * }} args
 * @returns {{ variantKey: string, modeKey: string }}
 */
export function resolveRoundConfig({
  urlVariant, urlMode, savedVariant, savedMode, defaultVariant, defaultMode,
}) {
  /**
   * First source that names something the table actually knows, wins;
   * `fallback` if none of them do.
   *
   * The "knows" part is load-bearing, not defensive dressing: `10q` was a
   * real mode until the Statistics deck went, and a bookmark or a cached
   * client can still send it. An unknown value has to fall THROUGH to the
   * next source rather than being taken and passed on — `targetFor` throws
   * on a mode it doesn't recognise.
   *
   * `fallback` is returned unvalidated on purpose. It is the caller's own
   * default, not something a URL or a stale localStorage entry can reach, so
   * validating it would only turn a caller's bug into a silent `undefined`
   * that surfaces somewhere far less obvious.
   *
   * @param {Record<string, unknown>} table
   * @param {(string | null)[]} sources
   * @param {string} fallback
   * @returns {string}
   */
  const firstKnown = (table, sources, fallback) => sources.find(
    (k) => !!k && Object.prototype.hasOwnProperty.call(table, k),
  ) ?? fallback;
  return {
    variantKey: firstKnown(VARIANTS, [urlVariant, savedVariant], defaultVariant),
    modeKey: firstKnown(MODES, [urlMode, savedMode], defaultMode),
  };
}
