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
export const DEFAULT_FIRST_PICK = 'flags-all';

/** Modes exempt from the no-repeat rule: they stay in the hand and stay pickable
 *  however many times they have already been played.
 *
 *  Flags is the game — the thing everyone came to play and the one round nobody
 *  is bored of — and it is also the fixed first round, so the no-repeat rule retired
 *  it before anyone got to choose it even once. Weird flags is the same game with
 *  a different pool.
 *
 *  Spot the flag joins them because a second helping of it is not a repeat: every
 *  round is a freshly generated puzzle out of ~983 distinct specs, so playing it
 *  twice is two different puzzles, not the same round again. That is what separates
 *  it from outlines, which is one fixed game whatever order it comes in. The
 *  no-repeat rule exists to keep a draft varied, and this mode supplies its own
 *  variety.
 *
 *  Everything else (outlines, the 30-odd statistics) still plays once per game;
 *  these three are the staples you are allowed to order twice. */
export const REPEATABLE_MODE_IDS = ['flags-all', 'flags-weird', 'spot-flag'];

/** @typedef {'short' | 'medium' | 'long'} GameLength */

/** The three game lengths the host chooses from, shortest first. */
export const GAME_LENGTHS = /** @type {const} */ (['short', 'medium', 'long']);

/** What a fresh host gets. Medium is the middle of the table and the length that
 *  divides evenly across the most seat counts. */
export const DEFAULT_GAME_LENGTH = 'medium';

/**
 * Rounds per (length, seats). **A table, not a formula**, because the two things
 * a formula has to trade off cannot both be had:
 *
 * - picks divide evenly exactly when `rounds = seats * k + 1` (round 1 is the
 *   host's own first pick and the Decider sits outside the rotation, so `rounds - 1`
 *   picks are shared out, `k` per seat), and
 * - a length worth naming has to mean roughly the same wall-clock at every table
 *   size.
 *
 * The old `seats x picks + 1` was the first of those, which is why a single
 * setting meant 7 minutes at two players and 45 at ten. Every cell here sits on
 * that same lattice — so "you each pick k" stays literally true — while being
 * hand-picked to land near 10 / 20 / 30 minutes rather than wherever the
 * arithmetic fell. Pinned cell-for-cell by `partyDraft.test.js`.
 *
 * **Seven or more seats reuse the six-seat column.** Growing past that is what
 * made a big room unable to play a short game at all: the old floor was
 * `seats + 1` rounds, so twenty players could not have anything under 21 rounds.
 * The cost is that past six seats the rotation no longer reaches everyone — see
 * {@link pickShareFor}.
 */
/** @type {Record<GameLength, Record<number, number>>} */
const LENGTH_ROUNDS = {
  short:  { 2: 5,  3: 4,  4: 5,  5: 6,  6: 7  },
  medium: { 2: 7,  3: 7,  4: 9,  5: 11, 6: 13 },
  long:   { 2: 11, 3: 13, 4: 13, 5: 16, 6: 19 },
};

/** How many cards a picker chooses from. Wide enough to give real choice across
 *  the picture modes and a good spread of statistics, still a glance not a form. */
export const HAND_SIZE = 10;

/**
 * How many rounds a draft runs, from {@link LENGTH_ROUNDS}.
 *
 * **Round 1 is the host's own first pick** — chosen in the lobby, which is how the
 * cold-start hole is closed (no scores yet means no last place means no rotation
 * picker, so the host picks first by fiat). It is a share like any other, not a
 * separate warm-up round on top. The **Decider** is the closing act (see
 * {@link isDeciderPick}), which sits outside the rotation so the pick share stays
 * predictable rather than being quietly bent by the final round.
 *
 * Seat counts below 2 read the 2-seat column (a solo host testing the flow) and
 * 7+ read the 6-seat column.
 *
 * @param {number} playerCount
 * @param {string} [length]  one of {@link GAME_LENGTHS}
 * @returns {number}
 */
export function roundCountFor(playerCount, length = DEFAULT_GAME_LENGTH) {
  const seats = Number.isFinite(playerCount) ? Math.floor(playerCount) : 0;
  const column = Math.min(6, Math.max(2, seats));
  return LENGTH_ROUNDS[validateGameLength(length)][column];
}

/**
 * Coerce a host-supplied length to one of {@link GAME_LENGTHS}. The value arrives
 * over the wire, so it is untrusted: anything else falls back to
 * {@link DEFAULT_GAME_LENGTH} rather than being guessed at. A stale client still
 * sending the retired `picks` number lands here too, and gets a medium game.
 *
 * @param {unknown} value
 * @returns {GameLength}
 */
export function validateGameLength(value) {
  return /** @type {readonly string[]} */ (GAME_LENGTHS).includes(/** @type {string} */ (value))
    ? /** @type {GameLength} */ (value)
    : DEFAULT_GAME_LENGTH;
}

/**
 * How the rotation picks split across the seats: `each` per player, with `extra`
 * players getting one more. Purely for the lobby hint — the actual order is
 * {@link pickerFor}'s job.
 *
 * Up to six seats every cell of {@link LENGTH_ROUNDS} divides evenly, so this
 * returns `extra: 0` and the hint can say "you each pick N". Past six it cannot:
 * a short game at eight seats has six rotation picks to share, so two players do
 * not pick at all. That is the deliberate trade for letting a big room choose a
 * short game, and it lands on the right people — {@link pickerFor} hands picks
 * to the lowest-ranked first, so the seats that miss out are the ones ahead.
 *
 * @param {number} rounds
 * @param {number} playerCount
 * @returns {{ each: number, extra: number }}
 */
export function pickShareFor(rounds, playerCount) {
  const seats = Number.isFinite(playerCount) ? Math.max(1, Math.floor(playerCount)) : 1;
  // `- 1`: only the Decider sits outside the count. Round 1 is the host's own first
  // pick (chosen in the lobby), so it is one of the shares, not a warm-up on top.
  // Every cell of LENGTH_ROUNDS sits on `seats * k + 1`, so up to six seats
  // `rounds - 1` divides evenly and `extra` is 0 — the hint says "you each pick k"
  // and it is literally true. The `extra` branch only fires past six seats, where
  // the six-seat column can't stretch to reach everyone (see the doc above).
  const rotation = Math.max(0, (Number.isFinite(rounds) ? Math.floor(rounds) : 0) - 1);
  return { each: Math.floor(rotation / seats), extra: rotation % seats };
}

/**
 * Coerce a host-supplied first-round id to a legal one, defaulting to
 * {@link DEFAULT_FIRST_PICK}.
 *
 * **Picture modes only.** The first round exists to warm the room up before any score
 * exists, and a niche statistic ("Honey production") is a poor first impression
 * and a worse warm-up — the round everyone plays cold should be one everyone
 * immediately understands. It is also what keeps the lobby control a four-segment
 * row rather than a scrolling list of thirty.
 *
 * Untrusted like {@link validateGameLength}: the value arrives over the wire, so
 * anything unrecognised falls back to the default rather than being guessed at.
 * A client that predates this setting sends nothing and gets Flags, which is
 * exactly the fixed first round it was built against.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function validateFirstPickMode(value) {
  return PICTURE_MODES.some((m) => m.id === value) ? /** @type {string} */ (value) : DEFAULT_FIRST_PICK;
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
 * the client's title card.
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
 * inverted itself exactly where it mattered most. The Decider sits outside the
 * rotation, so it ignores pick history entirely and simply reads the board.
 *
 * **This pick is now the whole comeback mechanic.** The Decider used to also
 * score double, on the theory that a trailing player could swing the game there.
 * Measured, it could not: doubling scales the expected drift and the variance
 * together, so the leader pulls away exactly as fast as the swing grows, and
 * last place won 0.0% of simulated games at 2x (and 1.4% at 3x). The multiplier
 * is gone; choosing the ground the game ends on is the real asymmetry, and it is
 * this function.
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
 * Metric modes that share a card, because they ask the same question twice.
 *
 * A player picking a round is choosing a SUBJECT, not a formula. Offering "GDP"
 * and "GDP per capita" as two of the ten cards spends a fifth of the hand on one
 * subject and asks the picker to arbitrate a distinction they did not come to the
 * party to think about. Collapsing them frees a slot for a statistic the hand
 * doesn't have yet, which is the real win — the hand gets wider, not just tidier.
 *
 * **Only genuinely-redundant pairs belong here.** The bar is "two ways of asking
 * one question", not "related subjects". Meat / cattle / sheep per person stay
 * separate: "most sheep per person" and "most meat eaten per person" are
 * different questions that happen to share a barn. Beer / alcohol per person is
 * the closest remaining candidate and is deliberately NOT grouped yet: each
 * grouping is a judgement call worth making on its own.
 *
 * Nobel laureates / Nobel laureates per million clears the bar for the same
 * reason economy does. They are one subject counted two ways, off one data
 * source, and the per-million cut exists precisely to answer the objection the
 * absolute count raises. Two cards would spend a fifth of the hand asking the
 * picker to arbitrate "total or per head", which is the distinction the round
 * itself is there to reveal.
 *
 * `representativeId` is the member whose icon, hue and metric identity the card
 * wears. It must be a member. Nothing else about the members changes: each keeps
 * its own question id, data file, hints and per-metric visuals, and a round that
 * resolves to one is indistinguishable from one picked directly.
 *
 * @typedef {{ id: string, memberIds: string[], representativeId: string }} MetricFamily
 * @type {MetricFamily[]}
 */
const GROUPED_FAMILIES = [
  {
    id: 'economy',
    memberIds: ['superlative-gdp', 'superlative-gdppc'],
    // The coin stack rather than the $ coin: it reads as "an economy" at 24px,
    // where the per-capita coin reads as "money" and would make the total-GDP
    // round feel like the substitution.
    representativeId: 'superlative-gdp',
  },
  {
    id: 'nobel',
    memberIds: ['superlative-nobel', 'superlative-nobel-pc'],
    // The medal rather than the laurel wreath, matching economy's choice of the
    // total over the per-head cut: the absolute count is the subject a player
    // recognises, and the per-million round then lands as the twist.
    representativeId: 'superlative-nobel',
  },
  {
    // All four Olympic metrics on ONE card, the widest family so far. Jan's call,
    // and it overrides the first cut of this (Summer and Winter as two cards, on
    // the reasoning that they are two subjects rather than one question asked
    // twice). The hand-breadth argument wins: a ten-card hand carrying two Olympic
    // cards spends a fifth of itself on Olympics, which is precisely the crowding
    // `economy` was introduced to stop. Collapsing to one frees a slot for a
    // statistic the hand doesn't have yet, and the four members still deal as four
    // distinct rounds once picked.
    //
    // The `sub` disclosure carries more weight here than on any other family,
    // because the range is genuinely wide: a player picking this card must be told
    // they might get Winter per-person, not just "medals".
    id: 'olympicMedals',
    memberIds: [
      'superlative-summer-medals',
      'superlative-summer-medals-pc',
      'superlative-winter-medals',
      'superlative-winter-medals-pc',
    ],
    representativeId: 'superlative-summer-medals',
  },
  {
    // Population and density are the same count read two ways: how many people,
    // and how many people per square kilometre. Same source column, and density
    // exists precisely to answer the "yes but it's a big country" objection the
    // raw total raises, which is the economy / nobel test exactly.
    //
    // Population is the representative even though it is the flagship metric of
    // the whole catalog, for that same reason: it is the subject a player
    // recognises, and density then lands as the twist rather than the header.
    id: 'population',
    memberIds: ['superlative-pop', 'superlative-density'],
    representativeId: 'superlative-pop',
  },
];

/**
 * Every metric family, in catalog order: the grouped ones above plus a
 * single-member family for each metric that has no sibling.
 *
 * **A singleton family's id IS its mode id.** That is what keeps this change
 * small: the hand, the no-repeat set and the pick wire message all speak family
 * ids, and for all but the grouped metrics that is the string they always were.
 * Only `economy` and `nobel` are genuinely new ids, and only they need the
 * resolve step to mean anything.
 *
 * @type {MetricFamily[]}
 */
export const METRIC_FAMILIES = (() => {
  const grouped = new Set(GROUPED_FAMILIES.flatMap((f) => f.memberIds));
  /** @type {MetricFamily[]} */
  const singles = METRIC_MODES
    .filter((m) => !grouped.has(m.id))
    .map((m) => ({ id: m.id, memberIds: [m.id], representativeId: m.id }));
  return [...GROUPED_FAMILIES, ...singles];
})();

/** @type {Record<string, MetricFamily>} */
const FAMILY_BY_ID = Object.fromEntries(METRIC_FAMILIES.map((f) => [f.id, f]));

/** @type {Record<string, MetricFamily>} */
const FAMILY_BY_MEMBER = Object.fromEntries(
  METRIC_FAMILIES.flatMap((f) => f.memberIds.map((id) => [id, f])),
);

/**
 * The family a mode belongs to, or null for a mode outside the metric catalog
 * (the picture trio, or an id from a newer build).
 *
 * @param {string} modeId
 * @returns {MetricFamily | null}
 */
export function familyForMode(modeId) {
  return FAMILY_BY_MEMBER[modeId] ?? null;
}

/**
 * The id to record as played when `modeId` is dealt: its family, so a family
 * plays once per game however many members it has. For a picture mode (no
 * family) that is the mode id itself.
 *
 * Used both when a pick lands and when `usedModes` is rebuilt from the plan after
 * a durable-object eviction — the two must agree, or a rebuilt room re-offers a
 * family it already played.
 *
 * @param {string} modeId
 * @returns {string}
 */
export function usedIdForMode(modeId) {
  return FAMILY_BY_MEMBER[modeId]?.id ?? modeId;
}

/**
 * The mode whose visuals a card wears: a family's `representativeId`, or the id
 * itself for a picture mode / bare mode id.
 *
 * The client's icon, hue and metric-identity lookups are all keyed on catalog
 * modes, and a family id is not one. Rather than teach each of them about
 * families, they resolve through here first — so a family card needs no visual
 * data of its own and can never drift from the metric it stands for.
 *
 * This is presentation only. It is NOT how a round's variant is chosen: that is
 * {@link resolveFamilyPick}, which is random and server-side. A card showing the
 * coin stack does not mean the round will be total GDP.
 *
 * @param {string} cardId
 * @returns {string}
 */
export function representativeModeFor(cardId) {
  return FAMILY_BY_ID[cardId]?.representativeId ?? cardId;
}

/**
 * Resolve a picked family to the concrete mode its round plays.
 *
 * The variant is chosen HERE, at deal time, rather than by the picker — the same
 * shape the direction ('most' / 'least') has always had, one level up. The player
 * chose the subject; which cut of it they get is the round's reveal.
 *
 * Members are drawn uniformly and none are filtered as "already used": the whole
 * family is marked played the moment any member is dealt, so no member can come
 * back later wearing the family's label.
 *
 * @param {string} familyOrModeId  a family id (from the hand) or a bare mode id
 * @param {() => number} [rng]
 * @returns {string | null}  a catalog mode id, or null if the id is unknown
 */
export function resolveFamilyPick(familyOrModeId, rng = Math.random) {
  const family = FAMILY_BY_ID[familyOrModeId];
  if (!family) return MODE_IDS.has(familyOrModeId) ? familyOrModeId : null;
  const { memberIds } = family;
  return memberIds[Math.min(memberIds.length - 1, Math.floor(rng() * memberIds.length))];
}

/**
 * The hand a picker chooses from: up to {@link HAND_SIZE} ids drawn from the
 * cards **not yet played this game** (`usedModeIds`) — nothing twice, except the
 * {@link REPEATABLE_MODE_IDS}, which are always on offer.
 *
 * Metric cards are FAMILIES ({@link METRIC_FAMILIES}), not modes, so the two
 * economy metrics occupy one slot rather than two.
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
 * @param {Iterable<string>} usedModeIds  families / modes already played (excluded)
 * @param {() => number} [rng]
 * @returns {string[]}  up to HAND_SIZE card ids, in display order
 */
export function handFor(usedModeIds, rng = Math.random) {
  const used = new Set(usedModeIds);
  const pics = PICTURE_MODES
    .filter((m) => REPEATABLE_MODE_IDS.includes(m.id) || !used.has(m.id))
    .map((m) => m.id);
  const mets = shuffle(METRIC_FAMILIES.filter((f) => !used.has(f.id)).map((f) => f.id), rng);
  return [...pics, ...mets].slice(0, HAND_SIZE);
}

/** The set of all catalog mode ids, for validating a pick came from the catalog. */
const MODE_IDS = new Set(PARTY_MODES.map((m) => m.id));

/** Every id a hand can legally contain: the picture modes plus the metric
 *  FAMILIES. Deliberately excludes the grouped members' own ids — a client that
 *  sends `superlative-gdppc` instead of `economy` is pinning the variant that the
 *  server is supposed to choose, which is exactly what validation is for. */
const PICKABLE_IDS = new Set([
  ...PICTURE_MODES.map((m) => m.id),
  ...METRIC_FAMILIES.map((f) => f.id),
]);

/**
 * Whether `cardId` is a legal pick right now: a real pickable card (a picture
 * mode or a metric family) that hasn't already been played. The hand the client
 * shows is advisory; the room validates the pick against this so a malformed /
 * stale choice can't inject a repeat, an unknown card, or a pinned variant.
 *
 * @param {string} cardId
 * @param {Iterable<string>} usedModeIds
 * @returns {boolean}
 */
export function isValidPick(cardId, usedModeIds) {
  if (typeof cardId !== 'string' || !PICKABLE_IDS.has(cardId)) return false;
  if (REPEATABLE_MODE_IDS.includes(cardId)) return true;
  return !new Set(usedModeIds).has(cardId);
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
