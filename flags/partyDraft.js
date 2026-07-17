/**
 * The **draft** mode for Flag Party (Iteration 9): instead of the host building
 * the whole show up front, the players choose it a block at a time. Block 1 is
 * always Flags; from block 2 on, the lowest-ranked player who hasn't picked yet
 * chooses the next block from a small hand of unused modes.
 *
 * Pure helpers, so the room reducer (`flags/partyRoom.js`) and the page stay thin
 * and the draft's arithmetic (how many blocks, who picks, what's in the hand) is
 * unit-tested. No DOM, no I/O.
 */

import { PARTY_MODES, PICTURE_MODES, METRIC_MODES } from './partyPlan.js';

/** The block every draft opens with — establishes the loop before anyone picks,
 *  and closes the cold-start hole (no scores yet means no last place means no
 *  picker). */
export const OPENING_MODE_ID = 'flags-all';

/** Hard ceiling on blocks in a draft, matched to the phone-only surface and a
 *  ~2-minute-per-block pace: 5 blocks is about 10 minutes, inside Jackbox's 15-20.
 *  Also the point past which "everyone picks once" stops holding anyway. */
export const MAX_DRAFT_BLOCKS = 5;

/** How many cards a picker chooses from. Small enough to be a beat, not a form. */
export const HAND_SIZE = 5;

/**
 * How many blocks a draft of `playerCount` seats plays: `players + 1`, capped at
 * {@link MAX_DRAFT_BLOCKS}. The `+1` is the fixed opening Flags block, which makes
 * **"everyone picks exactly once" true for 2-to-4-player games** (picks = blocks
 * − 1 = players) without anyone being told a rule, while a big room still caps at
 * 5 blocks rather than one-per-seat. At least 1 block always.
 *
 * @param {number} playerCount
 * @returns {number}
 */
export function blockCountFor(playerCount) {
  const n = Number.isFinite(playerCount) ? Math.floor(playerCount) : 0;
  return Math.max(1, Math.min(n + 1, MAX_DRAFT_BLOCKS));
}

/**
 * Who picks the next block: the **lowest-ranked player who hasn't picked yet**.
 * `scoreboard` is descending by score (as the room sends it), so the lowest rank
 * is the last entry; we scan from the bottom for the first seat not already in
 * `alreadyPicked`. Not merely "last place": the no-repeat clause means a player
 * who lost two blocks running doesn't pick twice while someone else never picks.
 * Returns null when everyone eligible has already picked (the caller then has no
 * pick to run — it shouldn't, since picks never exceed the seat count).
 *
 * @param {Array<{ playerId: string }>} scoreboard  descending by score
 * @param {Iterable<string>} alreadyPicked  playerIds that have already picked
 * @returns {string | null}
 */
export function pickerFor(scoreboard, alreadyPicked) {
  const board = Array.isArray(scoreboard) ? scoreboard : [];
  const picked = new Set(alreadyPicked);
  for (let i = board.length - 1; i >= 0; i--) {
    if (!picked.has(board[i].playerId)) return board[i].playerId;
  }
  return null;
}

/**
 * Fisher-Yates shuffle with an injectable RNG (seedable in tests). Returns a new
 * array; the input is untouched.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * The hand a picker chooses from: up to {@link HAND_SIZE} mode ids drawn from the
 * modes **not yet played this game** (`usedModeIds`) — no mode twice. Unused
 * picture modes are included first (they're few and characterful), then the rest
 * is filled with a random draw of unused statistics, and the whole hand is
 * shuffled so the picture cards don't always lead. A list of 30-odd metrics would
 * be a form; a hand of five is a three-second choice.
 *
 * @param {Iterable<string>} usedModeIds  modes already played (excluded)
 * @param {() => number} [rng]
 * @returns {string[]}  up to HAND_SIZE mode ids, in display order
 */
export function handFor(usedModeIds, rng = Math.random) {
  const used = new Set(usedModeIds);
  const pics = PICTURE_MODES.filter((m) => !used.has(m.id)).map((m) => m.id);
  const mets = shuffle(METRIC_MODES.filter((m) => !used.has(m.id)).map((m) => m.id), rng);
  const hand = [...pics, ...mets].slice(0, HAND_SIZE);
  return shuffle(hand, rng);
}

/** The set of all catalog mode ids, for validating a pick came from the catalog. */
const MODE_IDS = new Set(PARTY_MODES.map((m) => m.id));

/**
 * Whether `modeId` is a legal pick right now: a real catalog mode that hasn't
 * already been played. The hand the client shows is advisory; the room validates
 * the pick against this so a malformed / stale choice can't inject a repeat or an
 * unknown mode.
 *
 * @param {string} modeId
 * @param {Iterable<string>} usedModeIds
 * @returns {boolean}
 */
export function isValidPick(modeId, usedModeIds) {
  return typeof modeId === 'string' && MODE_IDS.has(modeId) && !new Set(usedModeIds).has(modeId);
}
