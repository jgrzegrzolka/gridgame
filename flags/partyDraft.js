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

import { PARTY_MODES, PICTURE_MODES, METRIC_MODES, isFinalRound } from './partyPlan.js';
import { veilActive } from './partyTiming.js';

/** The round every draft opens with — establishes the loop before anyone picks,
 *  and closes the cold-start hole (no scores yet means no last place means no
 *  picker). */
export const OPENING_MODE_ID = 'flags-all';

/** Modes exempt from the no-repeat rule: they stay in the hand and stay pickable
 *  however many times they have already been played.
 *
 *  Flags is the game — the thing everyone came to play and the one round nobody
 *  is bored of — and it is also the fixed opener, so the no-repeat rule retired
 *  it before anyone got to choose it even once. Weird flags is the same game with
 *  a different pool. Everything else (outlines, the 30-odd statistics) still
 *  plays once per game, which is what keeps a draft varied; these two are the
 *  staple you are allowed to order twice. */
export const REPEATABLE_MODE_IDS = ['flags-all', 'flags-weird'];

/** Hard ceiling on rounds in a draft — a backstop against an absurd room, not a
 *  knob. The host never hits it at 4 picks x 4 seats (17); it only bites in a
 *  very large room, and the lobby shows the real total either way so a long game
 *  is a visible choice rather than a silent truncation. */
export const MAX_DRAFT_ROUNDS = 25;

/** The fixed set of picks-per-player the host chooses from. Each player picks
 *  this many rounds, so the game is `players x picks + 2` rounds — the fixed
 *  Flags opener and {@link isDeciderPick the Decider} bookending the draft.
 *  Expressing length as "how many rounds each of you picks" is what makes it
 *  legible: the old dial said "3" and left the player to work out what that
 *  bought them. */
export const PICKS_PER_PLAYER_OPTIONS = [1, 2, 3, 4];

/** What a fresh host gets: one pick each — a short game everyone shapes once. */
export const DEFAULT_PICKS_PER_PLAYER = 1;

/** How many cards a picker chooses from. Wide enough to give real choice across
 *  the picture modes and a good spread of statistics, still a glance not a form. */
export const HAND_SIZE = 10;

/**
 * How many rounds a draft runs: `players x picksPerPlayer + 2` — the rotation
 * plus the two fixed bookends.
 *
 * The **opener** is a Flags round that closes the cold-start hole (no scores yet
 * means no last place means no picker) and gives everyone a warm-up before the
 * first choice. The **Decider** is the closing act (see {@link isDeciderPick}),
 * which sits outside the rotation so that "everyone picks exactly
 * `picksPerPlayer` times" stays true by construction rather than by a rule the
 * final round quietly breaks.
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
  return Math.max(1, Math.min(seats * picks + 2, MAX_DRAFT_ROUNDS));
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
 * The seats eligible to be handed a pick: those actually **in the room right
 * now**. Both picker rules run over this rather than over the raw scoreboard.
 *
 * A seat outlives its socket on purpose — the score is sticky so a player can
 * drop and reconnect without losing their game — so the scoreboard still lists
 * players who have left. Picking one of them stalls the room on a turn nobody
 * can take, until the host's anti-stall timer fires. And it is not a rare
 * accident: a player who leaves stops scoring, so they *sink toward last place*,
 * which is precisely who both picker rules aim at. The Decider aims there hardest
 * and at the worst moment — it would structurally hand the round that decides the
 * game to whoever was most likely to have just quit.
 *
 * Filtering here (rather than inside either picker rule) keeps the two rules
 * about *ranking* and puts "can this seat actually act" in one place they share.
 * The scoreboard the players SEE is untouched — a departed player keeps their row
 * and their score, they simply stop being dealt turns.
 *
 * A skipped player does not get the pick back on reconnect: the game's length was
 * fixed when it started, so restoring their turn would have to take someone
 * else's or grow the game, and the lobby already promised neither.
 *
 * @param {Array<{ playerId: string }>} scoreboard  descending by score
 * @param {Iterable<string>} present  playerIds with a live socket
 * @returns {Array<{ playerId: string }>}  same order, absent seats removed
 */
export function eligiblePickers(scoreboard, present) {
  const here = present instanceof Set ? present : new Set(present);
  return (Array.isArray(scoreboard) ? scoreboard : []).filter((e) => here.has(e.playerId));
}

/**
 * Whether the pick opening at this reveal is for **the Decider** — the closing
 * double-points round — rather than an ordinary rotation slot.
 *
 * Asked at a round boundary, where the round about to be chosen starts at
 * `questionIndex + 1`; the Decider is always the game's last round, so this is
 * {@link isFinalRound} asked one question ahead. Derived rather than counted so
 * there is exactly one definition of "which round is the Decider", shared with
 * the double-points multiplier and the client's title card.
 *
 * @param {number} questionIndex  the 0-based question the reveal is sitting on
 * @param {number} totalQuestions
 * @returns {boolean}
 */
export function isDeciderPick(questionIndex, totalQuestions) {
  return isFinalRound(questionIndex + 1, totalQuestions);
}

/**
 * Who picks the Decider: **whoever is in last place when it starts**, full stop.
 *
 * Deliberately NOT {@link pickerFor}. The rotation's "lowest-ranked player who
 * hasn't picked yet" is right round by round, but it pushes the leader — who
 * loses that tie-break every round — to the back of the rotation and therefore
 * onto the last slot: over 2000 simulated four-player games the player choosing
 * the decisive round was in 1st place 84.6% of the time, so the comeback rule
 * inverted itself exactly where the stakes doubled. The Decider sits outside the
 * rotation, so it ignores pick history entirely and simply reads the board.
 *
 * `scoreboard` is descending by score (as the room sends it), so last place is
 * the last entry. Returns null only for an empty board.
 *
 * @param {Array<{ playerId: string }>} scoreboard  descending by score
 * @returns {string | null}
 */
export function deciderPickerFor(scoreboard) {
  const board = Array.isArray(scoreboard) ? scoreboard : [];
  return board.length === 0 ? null : board[board.length - 1].playerId;
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
 * modes **not yet played this game** (`usedModeIds`) — no mode twice, except the
 * {@link REPEATABLE_MODE_IDS}, which are always on offer.
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
  const pics = PICTURE_MODES
    .filter((m) => REPEATABLE_MODE_IDS.includes(m.id) || !used.has(m.id))
    .map((m) => m.id);
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
  if (typeof modeId !== 'string' || !MODE_IDS.has(modeId)) return false;
  if (REPEATABLE_MODE_IDS.includes(modeId)) return true;
  return !new Set(usedModeIds).has(modeId);
}

/**
 * Whether the picker may veil this mode's round. Only the picture trio can:
 * on a statistics question the flag is incidental, so hiding it tests the wrong
 * skill — the same rule {@link veilActive} enforces at question time, asked one
 * step earlier so the pick card can offer the chip on exactly the cards where
 * arming it will do something. The two are pinned to each other by test; this
 * derives from the mode's own questionId rather than a second hand-kept list so
 * a new picture mode picks the chip up for free.
 *
 * @param {string} modeId
 * @returns {boolean}
 */
export function canVeilMode(modeId) {
  const mode = PARTY_MODES.find((m) => m.id === modeId);
  return mode ? veilActive(true, mode.questionId) : false;
}
