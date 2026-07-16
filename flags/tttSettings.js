/**
 * Player settings for the tic-tac-toe boards.
 *
 * **Advanced mode** decides which pool a board is dealt from:
 *
 *   - off (the default) — `buildFlagCategoryPool()`: the flag itself plus the
 *     continent.
 *   - on — `buildRandomCategoryPool()`: the above **plus** all 116 world-metric
 *     thresholds (GDP, population, forest cover, …).
 *
 * **Why off is the default.** A full-pool board averages 1.5 flag rules out of
 * 6, so the game the page advertises ("every move is a country flag pick
 * matching the row × column category") was mostly a country-data quiz. Feature U
 * first shipped this as an opt-in "No statistics" toggle, which only helped
 * players who opened a burger and decoded the label. Flipping the default fixes
 * it for everyone who never touches a menu, and makes the word honest: you opt
 * *into* advanced, which is what "advanced" means everywhere else.
 *
 * **Naming, settled after the "No statistics" experiment failed.** That label
 * read as "hide my score" — the online board renders a live head-to-head record
 * a few pixels from the burger, and the site has achievements and community
 * stats. It was also a *removal* framing, and in a burger those read as display
 * preferences. Naming the opt-in pole instead means one word covers the switch,
 * the room chip, and the how-to-play copy. The default state needs no name: it
 * is just the board.
 *
 * **Key.** `gridgame.ttt.advanced`, deliberately not the old `gridgame.ttt.easy`.
 * The two are near-opposites, and reusing the key would have made every player
 * who set "No statistics" land in Advanced mode — the exact board they had asked
 * to get away from. With a new key they fall to the new default, which *is* the
 * board they wanted, so there is no migration to write. The dead `.easy` key is
 * left where it lies; it is a few bytes and nothing reads it.
 */

import { readBoolSetting, writeBoolSetting } from './group.js';

const TTT_ADVANCED_KEY = 'gridgame.ttt.advanced';

/**
 * Whether the board should also be dealt world-metric categories.
 *
 * Default-off by construction: `readBoolSetting` is `getItem(key) === 'true'`,
 * so an unset key, a disabled localStorage, and an explicit "off" all read
 * false. That matches the product default, which is why no default-on idiom
 * (`getItem(k) !== 'false'`) is needed here.
 *
 * @param {{ getItem(key: string): string | null } | null | undefined} [store]
 * @returns {boolean}
 */
export function isTttAdvanced(store) {
  return readBoolSetting(
    store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null),
    TTT_ADVANCED_KEY,
  );
}

/**
 * @param {{ setItem(key: string, value: string): void, removeItem(key: string): void }} store
 * @param {boolean} value
 */
export function setTttAdvanced(store, value) {
  writeBoolSetting(store, TTT_ADVANCED_KEY, value);
}
