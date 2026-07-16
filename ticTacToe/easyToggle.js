import { isTttEasy, setTttEasy } from '../flags/tttSettings.js';

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
