/**
 * Player settings for the tic-tac-toe boards.
 *
 * **Offline and solo only.** The PartyKit server deals online puzzles
 * (`party/ticTacToeServer.js`, both the fresh-room and the rematch call), so a
 * localStorage flag read in the browser cannot reach an online board — and
 * wiring it naively would let whoever created the room impose their preference
 * on the opponent with no UI saying so. Online is a room setting (WS param at
 * create + durable-object state + lobby display), deferred. Don't render this
 * toggle on `ticTacToe/index.html`, where it would be a lie.
 *
 * **Naming split, deliberate.** Internally this is "easy" (`gridgame.ttt.easy`,
 * `buildEasyCategoryPool`). To the player it reads "No statistics", because the
 * pool it selects is flag-visual + continent, and continents are a country fact
 * — no "flags only" label would be true, and "easy" is a difficulty claim we'd
 * have to defend (a flags-only board isn't easy if you don't know flags). The
 * label is an i18n key and cheap to change; the storage key is not, since a
 * rename silently reverts every player who set it. They're free to disagree.
 */

import { readBoolSetting, writeBoolSetting } from './group.js';

const TTT_EASY_KEY = 'gridgame.ttt.easy';

/**
 * Whether the board should be dealt from the no-statistics pool.
 *
 * Default-off by construction: `readBoolSetting` is `getItem(key) === 'true'`,
 * which is the opt-in sense we want — an unset key, a disabled localStorage, and
 * an explicit "off" all read false.
 *
 * @param {{ getItem(key: string): string | null } | null | undefined} [store]
 * @returns {boolean}
 */
export function isTttEasy(store) {
  return readBoolSetting(
    store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null),
    TTT_EASY_KEY,
  );
}

/**
 * @param {{ setItem(key: string, value: string): void, removeItem(key: string): void }} store
 * @param {boolean} value
 */
export function setTttEasy(store, value) {
  writeBoolSetting(store, TTT_EASY_KEY, value);
}
