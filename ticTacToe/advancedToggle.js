import { isTttAdvanced, setTttAdvanced } from '../flags/tttSettings.js';

/**
 * The "Advanced mode" switch. Every board mounts **two** copies of it: one in
 * the burger (quick access) and one in the "How to play" dialog (where the mode
 * is actually explained, and the only place solo / offline players can discover
 * it, since they get no room chip). Two controls, one setting — so every path
 * here writes to all of them rather than only the one that was clicked.
 *
 * See `flags/tttSettings.js` for what the mode does and why it defaults off.
 */

/**
 * What the online board's Advanced switch should show, and whether the player
 * may touch it.
 *
 * The whole rule, in one place, because it is what makes the online switch
 * honest rather than decorative:
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
 * The payoff of the second rule is that the switch always describes the board in
 * front of you. The alternative (mid-game flips applying to the next board, as
 * offline does) would have the joiner's switch reading "Advanced" while they
 * look at a board with no country data on it.
 *
 * Disabling is a courtesy, not a defence: `applySetAdvanced` re-checks all of
 * this server-side, since anyone can send a WebSocket frame.
 *
 * @param {{
 *   inRoom: boolean,
 *   isHost: boolean,
 *   boardUntouched: boolean,
 *   roomAdvanced: boolean | null,
 *   prefAdvanced: boolean,
 * }} args
 * @returns {{ checked: boolean, disabled: boolean }}
 */
export function decideAdvancedToggleState({ inRoom, isHost, boardUntouched, roomAdvanced, prefAdvanced }) {
  if (!inRoom) return { checked: prefAdvanced, disabled: false };
  return {
    // `?? prefAdvanced` covers the sliver between "we joined a room" and
    // "welcome landed": show the local preference rather than flicker through
    // off.
    checked: roomAdvanced ?? prefAdvanced,
    disabled: !isHost || !boardUntouched,
  };
}

/**
 * Wire the Advanced switches on the offline and solo boards, where the page
 * itself deals the puzzle at boot.
 *
 * **Not for `ticTacToe/index.html`.** Online the mode belongs to the room rather
 * than the device, so that board drives its switches from server state via
 * `decideAdvancedToggleState` instead — see `ticTacToe/page.js`.
 *
 * @param {{
 *   inputEls: Array<HTMLInputElement | null>,
 *   isBoardUntouched: () => boolean,
 *   redeal: () => void,
 *   storage?: { getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void },
 *   defer?: (fn: () => void, ms: number) => unknown,
 * }} args
 */
export function wireAdvancedToggle({ inputEls, isBoardUntouched, redeal, storage, defer }) {
  const inputs = /** @type {HTMLInputElement[]} */ ((inputEls ?? []).filter(Boolean));
  if (inputs.length === 0) return;
  const store = storage ?? window.localStorage;
  const schedule = defer ?? ((fn, ms) => setTimeout(fn, ms));

  /** @param {boolean} value */
  const paintAll = (value) => { for (const el of inputs) el.checked = value; };

  paintAll(isTttAdvanced(store));

  for (const el of inputs) {
    el.addEventListener('change', () => {
      const value = el.checked;
      setTttAdvanced(store, value);
      // Keep the other copy in step. It is usually off-screen (a closed burger,
      // a closed dialog), which is exactly why this is easy to forget — and why
      // the stale one would be believed the moment it next opens.
      paintAll(value);
      // The board is dealt at boot, so re-dealing IS a reload — same mechanism
      // the page's own "Play again" uses. Only when the board is still empty,
      // though: on a board with moves down, a reload would destroy the player's
      // progress to apply a preference, which is the one thing a settings switch
      // must not do. There the setting takes effect on the next board instead.
      if (!isBoardUntouched()) return;
      // Let the thumb finish its 150 ms slide and give the eye a beat to register
      // the new position before the page goes away — an instant reload eats the
      // animation and reads as a random flash. Same 350 ms findFlag's toggle uses.
      schedule(() => redeal(), 350);
    });
  }
}
