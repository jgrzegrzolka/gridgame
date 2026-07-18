/**
 * The **draft** mode for Flag Party (Iteration 9): instead of the host building
 * the whole show up front, the players choose it a round at a time. Round 1 is
 * always Flags; from round 2 on, the lowest-ranked player who hasn't picked yet
 * chooses the next round from a small hand of unused modes.
 *
 * Pure helpers, so the room reducer (`flags/partyRoom.js`) and the page stay thin
 * and the draft's arithmetic (how many rounds, who picks, what's in the hand) is
 * unit-tested. No DOM, no I/O.
 */

import { PARTY_MODES, PICTURE_MODES, METRIC_MODES } from './partyPlan.js';

/** The round every draft opens with — establishes the loop before anyone picks,
 *  and closes the cold-start hole (no scores yet means no last place means no
 *  picker). */
export const OPENING_MODE_ID = 'flags-all';

/** Hard ceiling on rounds in a draft. At a ~2-minute-per-round pace 10 rounds is
 *  about 20 minutes — the top of Jackbox's range, and long enough that the host
 *  has to have chosen it deliberately. The auto default lands well below this for
 *  small rooms; the ceiling exists so a typo can't deal a 3-hour game. */
export const MAX_DRAFT_ROUNDS = 10;

/** Floor on rounds. One round is a legitimate (if odd) choice: a single Flags
 *  opener with no picking at all — a 5-question warm-up. */
export const MIN_DRAFT_ROUNDS = 1;

/** How many cards a picker chooses from. Wide enough to give real choice across
 *  the picture modes and a good spread of statistics, still a glance not a form. */
export const HAND_SIZE = 10;

/**
 * The **suggested** round count for a draft of `playerCount` seats: `2 × players
 * + 1`, capped at {@link MAX_DRAFT_ROUNDS}. The `+1` is the fixed opening Flags
 * round; the `2 ×` gives every seat two picks, so a player who drew a bad round
 * first gets a second shot at steering the game. The host can override this — see
 * {@link validateRoundCount} — so it is a default, not a rule. At least 1 round
 * always.
 *
 * @param {number} playerCount
 * @returns {number}
 */
export function roundCountFor(playerCount) {
  const n = Number.isFinite(playerCount) ? Math.floor(playerCount) : 0;
  return Math.max(MIN_DRAFT_ROUNDS, Math.min(n * 2 + 1, MAX_DRAFT_ROUNDS));
}

/**
 * Coerce a host-supplied round count to a legal one, or fall back. The host's
 * number arrives over the wire, so it is untrusted: anything non-finite,
 * fractional, or outside [{@link MIN_DRAFT_ROUNDS}, {@link MAX_DRAFT_ROUNDS}] is
 * rejected in favour of `fallback` (itself clamped) rather than clamped silently
 * — a client sending `999` has a bug, and dealing it 10 rounds would hide that.
 *
 * @param {unknown} value  the host's requested round count
 * @param {number} fallback  the auto suggestion to use when `value` is unusable
 * @returns {number}
 */
export function validateRoundCount(value, fallback) {
  const safeFallback = Math.max(MIN_DRAFT_ROUNDS, Math.min(
    Number.isFinite(fallback) ? Math.floor(/** @type {number} */ (fallback)) : MIN_DRAFT_ROUNDS,
    MAX_DRAFT_ROUNDS,
  ));
  if (typeof value !== 'number' || !Number.isInteger(value)) return safeFallback;
  if (value < MIN_DRAFT_ROUNDS || value > MAX_DRAFT_ROUNDS) return safeFallback;
  return value;
}

/**
 * Who picks the next round: the **lowest-ranked player who hasn't picked yet**.
 * `scoreboard` is descending by score (as the room sends it), so the lowest rank
 * is the last entry; we scan from the bottom for the first seat not already in
 * `alreadyPicked`. Not merely "last place": the no-repeat clause means a player
 * who lost two rounds running doesn't pick twice while someone else never picks.
 *
 * **The rotation wraps.** Once every seated player has picked, the question resets
 * and the lowest-ranked seat picks again — the host can set more rounds than
 * there are players (see {@link validateRoundCount}), and honouring that number
 * matters more than "everyone picks exactly once", which is a nicety of the
 * default sizing rather than a rule anyone is told. Only `alreadyPicked` entries
 * that are still on the board count, so a player who left mid-game doesn't hold
 * the rotation open forever.
 *
 * Returns null only when there is nobody to pick (an empty board).
 *
 * @param {Array<{ playerId: string }>} scoreboard  descending by score
 * @param {Iterable<string>} alreadyPicked  playerIds that have already picked
 * @returns {string | null}
 */
export function pickerFor(scoreboard, alreadyPicked) {
  const board = Array.isArray(scoreboard) ? scoreboard : [];
  if (board.length === 0) return null;
  // How many rounds each seated player has already picked. `alreadyPicked` is the
  // whole game's pick history and keeps growing, so the rotation is expressed as
  // "fewest picks so far" rather than "not in the picked set" — the latter would
  // wrap once and then hand every remaining round to the same seat.
  /** @type {Map<string, number>} */
  const counts = new Map(board.map((e) => [e.playerId, 0]));
  for (const id of alreadyPicked) {
    // Entries for seats that have since left are ignored: a departed player must
    // not pin the minimum at 0 and stall the rotation.
    if (counts.has(id)) counts.set(id, /** @type {number} */ (counts.get(id)) + 1);
  }
  const fewest = Math.min(...counts.values());
  for (let i = board.length - 1; i >= 0; i--) {
    if (counts.get(board[i].playerId) === fewest) return board[i].playerId;
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
