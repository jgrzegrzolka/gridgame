import { isTttEasy, setTttEasy } from '../flags/tttSettings.js';

/**
 * What the online board's "No statistics" switch should show, and whether the
 * player may touch it.
 *
 * The whole rule, in one place, because it is the thing that makes the online
 * switch honest rather than decorative:
 *
 *   - **In the lobby** (no room yet) it is your saved preference, and it is
 *     yours to change. It seeds the next room you create.
 *   - **In a room** it is *that room's* mode, not your preference — the server
 *     dealt one board for two people, and this reports which kind it dealt.
 *   - It is live only for the host, and only while the board is untouched.
 *     Re-dealing discards every move on the board, and here some of those moves
 *     are the opponent's. That leaves a create-to-first-move window, which in
 *     practice is the wait for someone to join.
 *
 * The payoff of the second rule is that the switch always describes the board
 * in front of you. The alternative (mid-game flips applying to the next board,
 * as offline does) would have the joiner's switch reading "No statistics: on"
 * while they look at a board full of metrics.
 *
 * Disabling is a courtesy, not a defence: `applySetEasy` re-checks all of this
 * server-side, since anyone can send a WebSocket frame.
 *
 * @param {{
 *   inRoom: boolean,
 *   isHost: boolean,
 *   boardUntouched: boolean,
 *   roomEasy: boolean | null,
 *   prefEasy: boolean,
 * }} args
 * @returns {{ checked: boolean, disabled: boolean }}
 */
export function decideEasyToggleState({ inRoom, isHost, boardUntouched, roomEasy, prefEasy }) {
  if (!inRoom) return { checked: prefEasy, disabled: false };
  return {
    // `?? prefEasy` covers the sliver between "we joined a room" and "welcome
    // landed": show the local preference rather than flicker through off.
    checked: roomEasy ?? prefEasy,
    disabled: !isHost || !boardUntouched,
  };
}

/**
 * Wire the "No statistics" burger switch on the offline and solo boards.
 *
 * Shared rather than inlined twice because both pages mount the identical
 * control, and the repo's rule is that the same mechanism is the same code —
 * two copies of this would drift, and a partial copy (the storage write without
 * the re-deal, say) is how the toggle ends up behaving differently depending on
 * which board you're on.
 *
 * **Not for `ticTacToe/index.html`.** The PartyKit server deals online puzzles,
 * so this switch cannot affect an online board — see `flags/tttSettings.js`.
 *
 * @param {{
 *   inputEl: HTMLInputElement | null,
 *   isBoardUntouched: () => boolean,
 *   redeal: () => void,
 *   storage?: { getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void },
 *   defer?: (fn: () => void, ms: number) => unknown,
 * }} args
 */
export function wireEasyToggle({ inputEl, isBoardUntouched, redeal, storage, defer }) {
  if (!inputEl) return;
  const store = storage ?? window.localStorage;
  const schedule = defer ?? ((fn, ms) => setTimeout(fn, ms));

  inputEl.checked = isTttEasy(store);

  inputEl.addEventListener('change', () => {
    setTttEasy(store, inputEl.checked);
    // The board is dealt at boot, so re-dealing IS a reload — same mechanism the
    // page's own "Play again" uses. Only when the board is still empty, though:
    // on a board with moves down, a reload would destroy the player's progress
    // to apply a preference, which is the one thing a settings switch must not
    // do. There the setting takes effect on the next board instead.
    if (!isBoardUntouched()) return;
    // Let the thumb finish its 150 ms slide and give the eye a beat to register
    // the new position before the page goes away — an instant reload eats the
    // animation and reads as a random flash. Same 350 ms findFlag's toggle uses.
    schedule(() => redeal(), 350);
  });
}
