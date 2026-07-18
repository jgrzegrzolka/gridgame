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

/** Hard ceiling on rounds in a draft — a backstop against an absurd room, not a
 *  knob. The host never hits it at 4 picks x 4 seats (17); it only bites in a
 *  very large room, and the lobby shows the real total either way so a long game
 *  is a visible choice rather than a silent truncation. */
export const MAX_DRAFT_ROUNDS = 25;

/** The fixed set of picks-per-player the host chooses from. Each player picks
 *  this many rounds, so the game is `players x picks + 1` rounds — the `+1` being
 *  the opening Flags round. Expressing length as "how many rounds each of you
 *  picks" is what makes it legible: the old dial said "3" and left the player to
 *  work out what that bought them. */
export const PICKS_PER_PLAYER_OPTIONS = [1, 2, 3, 4];

/** What a fresh host gets: one pick each. Reproduces the original `players + 1`
 *  sizing, which is the right length for a first game. */
export const DEFAULT_PICKS_PER_PLAYER = 1;

/** How many cards a picker chooses from. Wide enough to give real choice across
 *  the picture modes and a good spread of statistics, still a glance not a form. */
export const HAND_SIZE = 10;

/**
 * How many rounds a draft runs: `players x picksPerPlayer + 1`. The `+1` is the
 * fixed opening Flags round, which closes the cold-start hole (no scores yet
 * means no last place means no picker) and gives everyone a warm-up before the
 * first choice. Every seat then picks exactly `picksPerPlayer` times.
 *
 * Capped at {@link MAX_DRAFT_ROUNDS} as a backstop only; at the offered pick
 * counts a normal room never reaches it.
 *
 * @param {number} playerCount
 * @param {number} picksPerPlayer
 * @returns {number}
 */
export function roundCountFor(playerCount, picksPerPlayer = DEFAULT_PICKS_PER_PLAYER) {
  const seats = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  const picks = validatePicksPerPlayer(picksPerPlayer);
  return Math.max(1, Math.min(seats * picks + 1, MAX_DRAFT_ROUNDS));
}

/**
 * Coerce a host-supplied picks-per-player to one of {@link PICKS_PER_PLAYER_OPTIONS}.
 * The value arrives over the wire, so it is untrusted: anything outside the fixed
 * set falls back to {@link DEFAULT_PICKS_PER_PLAYER} rather than being clamped to
 * the nearest option — a client sending `99` has a bug, and quietly dealing it 4
 * picks each would hide that.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function validatePicksPerPlayer(value) {
  return PICKS_PER_PLAYER_OPTIONS.includes(/** @type {number} */ (value))
    ? /** @type {number} */ (value)
    : DEFAULT_PICKS_PER_PLAYER;
}

/**
 * Who picks the next round: the **lowest-ranked player who hasn't picked yet**.
 * `scoreboard` is descending by score (as the room sends it), so the lowest rank
 * is the last entry; we scan from the bottom for the first seat not already in
 * `alreadyPicked`. Not merely "last place": the no-repeat clause means a player
 * who lost two rounds running doesn't pick twice while someone else never picks.
 *
 * **The rotation wraps.** Once every seated player has picked, a fresh rotation
 * starts and the lowest-ranked seat picks again — the host chooses how many
 * rounds each player picks (see {@link validatePicksPerPlayer}), so more than one
 * rotation is the normal case, not an edge. Only `alreadyPicked` entries that are
 * still on the board count, so a player who left mid-game doesn't hold the
 * rotation open forever.
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
 * modes **not yet played this game** (`usedModeIds`) — no mode twice.
 *
 * **The picture modes always lead, in catalog order** (Flags, Weird flags,
 * Outlines), with a random draw of unused statistics filling the rest. They are
 * the modes everyone recognises and the ones a picker most often wants, so
 * burying them at a random depth in a list of ten made the common choice a
 * search. Their fixed order also means a returning player finds them where they
 * were last time, which a shuffle actively prevents.
 *
 * The statistics below them stay shuffled: there are 30-odd and no reason to
 * privilege any, so a fixed order there would just favour whatever sorts first.
 *
 * @param {Iterable<string>} usedModeIds  modes already played (excluded)
 * @param {() => number} [rng]
 * @returns {string[]}  up to HAND_SIZE mode ids, in display order
 */
export function handFor(usedModeIds, rng = Math.random) {
  const used = new Set(usedModeIds);
  const pics = PICTURE_MODES.filter((m) => !used.has(m.id)).map((m) => m.id);
  const mets = shuffle(METRIC_MODES.filter((m) => !used.has(m.id)).map((m) => m.id), rng);
  return [...pics, ...mets].slice(0, HAND_SIZE);
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
