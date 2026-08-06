import { scoreQuestionDetailed } from './partyScore.js';
import { isRoundBoundary, isFinalRound, isRoundStart, roundIndexAt } from './partyPlan.js';
import { computeHonours, winnerIdsOf } from './partyHonours.js';
import { DEFAULT_GAME_LENGTH, validateGameLength, validateFirstPickMode, validatePicksPerPlayer } from './partyDraft.js';

/**
 * Flag Party room — the pure state machine behind the live show. Same shape as
 * `flags/onlineRoom.js` (TTT): every mutation is a reducer that takes a room
 * plus an event and returns `{ room, broadcasts }`, with no DOM and no I/O. The
 * PartyKit server (`party/partyGameServer.js`) is the shell that owns sockets,
 * persistence, and question generation; it resolves question-specific facts
 * (which pool, whether a buzz was correct) and hands the room plain data.
 *
 * The room is deliberately question-agnostic: it never imports a question module.
 * A question is just `{ prompt, options, answer }`; correctness is resolved by
 * the server via the question's `isCorrect` and passed into {@link applyBuzz} as a
 * boolean. That keeps one room engine serving every question type.
 *
 * Phase machine: `lobby` → `question` → `reveal` → (`question` | `final`),
 * and `final` → `lobby` on Play again.
 *
 * @typedef {'lobby' | 'question' | 'reveal' | 'picking' | 'final'} Phase
 * @typedef {{ nickname: string, score: number, bot?: boolean, skill?: string }} Seat
 * A seat with `bot: true` is a server-driven bot (see `flags/partyBot.js`): it has
 * no socket, so it never joins `present` from a connection and never leaves on a
 * disconnect — the server keeps it present for its whole life (added at
 * {@link applyAddBot}, restored to `present` on load). `skill` is a bot difficulty
 * id the server validated before it reached here. Everything downstream treats a
 * bot seat like any other: it buzzes (the server schedules it), it scores, and it
 * can be the draft picker. Humans carry neither field.
 * `ranking` / `values` are present only on questions that rank their options
 * (world facts). `ranking` is best-first in the question's own direction, so
 * `ranking[0]` is the answer whether it asked for the most or the least. Both
 * are answer-bearing: they go out on the reveal and never on the question.
 *
 * @typedef {{ prompt: string, options: string[], answer: string, questionId?: string,
 *   clearFrac?: number, ranking?: string[], values?: Record<string, number> }} Question
 * @typedef {{ playerId: string, choice: string, correct: boolean }} Buzz
 *
 * @typedef {Object} Room
 * @property {Phase} phase
 * @property {string | null} hostId  playerId of the creator; the only seat that
 *   can start / advance / restart. Sticky across reconnects.
 * @property {Map<string, Seat>} seats  playerId -> seat; insertion order is the
 *   stable display order.
 * @property {Set<string>} present  playerIds with a live socket right now; reset
 *   to empty on every load (a socket can't survive a DO eviction).
 * @property {number} totalQuestions
 * @property {Array<{ poolId: string, questionId: string, questions: number }> | null} plan
 *   the host's chosen game plan (which modes, how many questions each). Set when
 *   the host starts; null before then and the server falls back to
 *   `DEFAULT_PLAN`. The room only stores it (so it survives a durable-object
 *   eviction mid-game and the server can generate the right question type); the
 *   room never reads it.
 * @property {string | null} length  the host's game-length choice ('short' /
 *   'medium' / 'long'), the one setting shared during the lobby rather than
 *   riding `start`. Every player renders it — guests read-only — so a joiner sees
 *   what they are signing up for. **null means no client has ever set it**, which
 *   is how a room hosted by a pre-`setLength` build looks; the server reads that
 *   as permission to size the game from the start message instead.
 * @property {1 | 2 | 3 | null} picksPerPlayer  the host's **even-picks** sizing:
 *   when 1/2/3 it overrides {@link length}, and the game runs `seats * picksPerPlayer`
 *   rounds so every seat picks exactly that many (see `resolveRoundCount`). Null is
 *   the default and means "size by length" — both a fresh room and one hosted by a
 *   build that predates this setting. Shared during the lobby exactly like `length`,
 *   which stays set underneath so toggling the mode off restores the host's length.
 * @property {string | null} firstPick  the host's chosen first round (a picture
 *   mode id), the second lobby-shared setting. Null is *shaped* like `length`'s
 *   null but is **not** load-bearing the way that one is: a null `length` tells
 *   the server "an old client is hosting, size the game from the start message
 *   instead", whereas every reader here runs the first pick through
 *   `validateFirstPickMode`, which maps null and `'flags-all'` to the same result.
 *   So null here means only "nobody has chosen yet", and the fallback is the
 *   Flags round that was the fixed first round before the host could choose at all.
 *   It counts as the host's first pick, so `applyStart` seeds `pickedBy`.
 * @property {boolean} firstPickVeil  whether the host armed the veil on the first
 *   round. Every firstPick mode can be veiled (the picture trio and spot-the-flag),
 *   so it is a single flag independent of which first pick is chosen. Reaches the
 *   first round as `applyStart`'s `tricky` argument.
 * @property {number} questionIndex  0-based index of the current question.
 * @property {boolean} tricky  the host's tricky-mode choice: when true, clients
 *   veil each tile (grey + blur + panel wipe) and clear it over the question
 *   clock. Purely a client render flag — the room stores it (so it survives an
 *   eviction and rides every question / welcome broadcast) but never acts on it;
 *   scoring, the answer, and the question contract are untouched.
 * @property {{ flag: number, map: number, metric: number, name: number | null } | null} reveal  the
 *   host's per-category reveal timing (fraction of the window each category's veil
 *   clears at) plus `name`, the world-facts name-reveal fraction (null = off).
 *   Stored like `plan` so the server can stamp the right `clearFrac`
 *   on every question, including questions generated after an eviction; null before
 *   start, when the server falls back to `DEFAULT_REVEAL`. The room never reads it.
 * @property {Question | null} question  the live question; `answer` never leaves
 *   the server until reveal.
 * @property {Buzz[]} buzzes  this question's buzzes in server arrival order.
 * @property {boolean} draft  draft mode (Iteration 9): the plan grows one round
 *   at a time as players pick, instead of being fixed at start. When true the
 *   room enters a `picking` phase at each round boundary; when false it's the
 *   ordinary setlist show. Stored so it survives an eviction and rides welcome.
 * @property {number} targetRounds  the draft's total round count, fixed at start
 *   from the chosen length (`roundCountFor`, a flat 4/7/10) or from
 *   `seats * picksPerPlayer` in even-picks mode. The game ends after this many
 *   rounds; `totalQuestions` is `targetRounds * ROUND_QUESTIONS`. 0 in a
 *   non-draft game.
 * @property {string[]} pickedBy  playerIds that have already picked a round, in
 *   pick order — the no-repeat set the draft's picker selection reads.
 * @property {string | null} picker  during `picking`, the seat whose turn it is to
 *   choose the next round; null otherwise.
 * @property {string | null} roundPicker  the seat whose pick the **live round**
 *   is — set when a round starts and held for its whole five questions, where
 *   `picker` is cleared the moment the choice is made. Read by the server so a bot
 *   playing its own drafted round gets the picker's edge (`flags/partyBot.js`).
 *   Held explicitly rather than derived from `pickedBy`'s tail so it stays correct
 *   across a reconnect. Null in a non-draft game, where nobody picked anything.
 * @property {string | null} roundMode  the **mode id** the live round is playing
 *   (`flags/partyPlan.js`'s `PARTY_MODES`), the sibling of `roundPicker`. Set the
 *   same two places a round can start — {@link applyStart} and {@link applyPick} —
 *   and read only by the honour records, so the finish can say "Best in Flags"
 *   with the client's own mode labels. The plan's segments carry the *question*
 *   id, which is not the same thing (several modes share one question type).
 * @property {string[] | null} hand  during `picking`, the mode ids the picker may
 *   choose from (server-dealt); null otherwise. Stored so a reconnect mid-pick
 *   sees the same hand.
 * @property {string | null} pausedFor  the absent seat the room is waiting for,
 *   or null when the game is running. Set when a human seat drops mid-game
 *   ({@link applyDisconnect}), cleared when they come back ({@link applyHello})
 *   or when the host carries on without them ({@link applyResume}). The room
 *   stays time-free: this is a flag every client's clock respects — the same
 *   shape as the `holding` relay — not a duration the room counts down.
 * @property {string | null} breakBy  the seat that asked the room to take a
 *   **break**, or null when nobody has. The other half of the freeze `pausedFor`
 *   drives, and deliberately a separate field rather than a reuse of it: a drop
 *   and a break are the same stop for opposite reasons (one the room was forced
 *   into, one it chose), they can be true at the same time, and only one of them
 *   is something a seat can end. Time-free like `pausedFor` — a flag every
 *   client's clock respects, never a duration the room counts.
 * @property {import('./partyHonours.js').HonourStats} honourStats  the buzz and per-round records the finish
 *   ceremony reads (`flags/partyHonours.js`). Accumulated as the game runs and
 *   discarded on reset — the room never reads it back, it only carries it to the
 *   final broadcast.
 * @property {string[]} waived  playerIds whose continued absence no longer
 *   pauses the room, because the host already chose to carry on without them.
 *   Without it {@link applyResume} would re-pause for the same seat the instant
 *   it recomputed. A seat is un-waived when it reconnects, so someone who is
 *   left behind, returns, and drops again pauses the room afresh.
 * @property {number | null} lastActiveAt  epoch-ms of the last inbound traffic
 *   the server saw for this room (any onMessage, plus onConnect). The reducer
 *   never sets this — the server (`party/partyGameServer.js`) stamps it before
 *   every save. Read by `flags/roomLiveness.js` to decide whether the room is
 *   still worth offering back to a returning player. Persisted so a woken DO
 *   after eviction knows whether the room went cold or the eviction itself is
 *   the reason nobody has said anything. Null means the server has never
 *   stamped it — a brand-new room or an old snapshot from before this field.
 *
 * @typedef {{ to: string | 'all', message: object }} Broadcast
 * @typedef {{ room: Room, broadcasts: Broadcast[], rejectConnection?: boolean }} ApplyResult
 */

export const DEFAULT_QUESTIONS = 5;

/**
 * Hard cap on seats in a room. Not a platform limit (the Durable Object would
 * take far more): it's a sane bound for the phone-only surface (every player is
 * on their own screen, so the scoreboard and per-tile pick avatars stay
 * readable) and a cheap guard against a scripted flood of connections bloating
 * the serialized room. Reconnects are always welcomed regardless, so a full
 * room's existing players can still drop and come back. Raise this if a
 * TV/Display surface lands, where players look at one screen and the phone
 * readability constraint relaxes.
 */
export const MAX_SEATS = 20;

/**
 * @param {number} [totalQuestions]
 * @param {Room['plan']} [plan]  the default plan the room opens with; the host
 *   can replace it (with a matching `totalQuestions`) at start.
 * @returns {Room}
 */
export function createRoom(totalQuestions = DEFAULT_QUESTIONS, plan = null) {
  return {
    phase: 'lobby',
    hostId: null,
    seats: new Map(),
    present: new Set(),
    totalQuestions,
    plan,
    // The host's game-length choice, and the room's ONLY lobby-phase setting.
    // It lives here rather than on the host's device because every player sees
    // it: a guest reads it (read-only) while deciding whether to stay for a Long
    // game. Everything else the host once configured — the plan, tricky, reveal —
    // rode on `start` and was never shared, which is why nothing like this
    // existed before.
    //
    // `null`, not the default, and the distinction is load-bearing: it means "no
    // client has ever told this room a length", which is exactly the state a room
    // hosted by a build older than `setLength` stays in. `applyStart` reads that
    // as permission to fall back to the length riding the start message. Readers
    // that just want a value run it through `validateGameLength`, which turns
    // null into the default.
    length: null,
    // Even-picks sizing, off by default. Null means "size by length" (both a
    // fresh room and one hosted by a build that predates the setting); 1/2/3
    // overrides length. `length` stays set underneath so switching the mode off
    // restores it.
    picksPerPlayer: null,
    // Same "nobody has said" null as `length` above, for the same reason: a room
    // hosted by a pre-setFirstPick build must be distinguishable from one whose host
    // deliberately chose Flags.
    firstPick: null,
    // Whether the host armed the veil on the first round (any firstPick mode can
    // be veiled — the picture trio and spot-the-flag). A plain boolean, not
    // null: unlike `firstPick`/`length` there is nothing to distinguish from an old
    // client, and "off" is the honest default for a room nobody has touched.
    firstPickVeil: false,
    questionIndex: 0,
    tricky: false,
    reveal: null,
    question: null,
    buzzes: [],
    draft: false,
    targetRounds: 0,
    pickedBy: [],
    picker: null,
    roundPicker: null,
    roundMode: null,
    hand: null,
    pausedFor: null,
    // Nobody has asked for a break yet. Separate from `pausedFor` (see the
    // typedef): the two freezes coexist and only this one is seat-endable.
    breakBy: null,
    honourStats: emptyHonourStats(),
    waived: [],
    // The server stamps this on every inbound message before saving. Null here
    // is honest — a room nobody has yet touched has no activity time — and
    // `flags/roomLiveness.js` reads null as dead, so a room in this state is
    // not offered back to a returning player. The moment a client connects,
    // the server bumps it and the room reads as alive.
    lastActiveAt: null,
  };
}

/**
 * Phases where losing a player is worth stopping for. The lobby has no game to
 * protect and the final board has none left; everything between them does.
 * @param {Room} room
 */
function pausablePhase(room) {
  return room.phase === 'question' || room.phase === 'reveal' || room.phase === 'picking';
}

/**
 * Whether `playerId`'s absence is a reason to hold the game right now: a human
 * seat, in the room, currently gone, not already left behind by the host.
 * @param {Room} room
 * @param {string} playerId
 */
function pausableSeat(room, playerId) {
  const seat = room.seats.get(playerId);
  if (!seat || seat.bot === true) return false;
  return !room.present.has(playerId) && !room.waived.includes(playerId);
}

/**
 * The seat the room should be waiting for, given who is present right now.
 *
 * An existing pause wins over seat order: once the room says "waiting for Anna"
 * it keeps saying that until Anna is back or waived, even if someone earlier in
 * the seat list drops too. Swapping the name on screen for a second absentee
 * would read as the pause having ended and restarted when nothing changed.
 *
 * @param {Room} room
 * @returns {string | null}
 */
export function pauseTargetFor(room) {
  if (!pausablePhase(room)) return null;
  if (room.pausedFor !== null && pausableSeat(room, room.pausedFor)) return room.pausedFor;
  for (const pid of room.seats.keys()) {
    if (pausableSeat(room, pid)) return pid;
  }
  return null;
}

/**
 * The seat that should take over hosting, because the host's socket dropped:
 * the first present human, in seat order. Bots are skipped — hosting means
 * running the game clock in a real tab, and a bot has no tab.
 *
 * Null when nobody is left to hand it to. That is not a stuck room: `applyHello`
 * gives the host to the first player through the door, so an empty room heals
 * itself the moment anyone (including the original host) reconnects.
 *
 * @param {Room} room
 * @returns {string | null}
 */
function nextHostFor(room) {
  for (const [pid, seat] of room.seats) {
    if (seat.bot !== true && room.present.has(pid)) return pid;
  }
  return null;
}

/** A room whose ceremony has nothing recorded yet.
 *  @returns {import('./partyHonours.js').HonourStats} */
function emptyHonourStats() {
  return { seats: {}, rounds: [] };
}

/**
 * Whether a seat may start a **break** right now.
 *
 * The room's phases are coarser than the client's screens
 * ({@link module:partyTiming.BREAK_PHASES}): `break` and `roundcard` are beats
 * the client paints inside `reveal` and `question`. `reveal` and `picking` map
 * straight across. The round card is the awkward one — it sits at the head of
 * the question phase, where nothing is answerable yet and no clock is running,
 * and it is a natural "hold on, before this round starts" moment. The room can
 * see that it is at a round START but not that the 2 s card is still up, so the
 * window here is wider than the card: the whole first question of every round.
 *
 * That is a deliberate trade, not an oversight. What makes it safe is that a
 * break is not a hold: **any** seat ends it in one tap, so the worst a seat can
 * do by freezing a question they are losing is annoy four people who can each
 * undo it instantly. The alternative — refusing the round card outright — would
 * mean the one screen most likely to be pressed on silently swallows the press.
 *
 * @param {Room} room
 * @returns {boolean}
 */
function breakablePhase(room) {
  if (room.phase === 'reveal' || room.phase === 'picking') return true;
  return room.phase === 'question' && isRoundStart(room.questionIndex, room.totalQuestions);
}

/** @param {Room} room */
function breakBroadcast(room) {
  return { to: /** @type {const} */ ('all'), message: { type: 'break', breakBy: room.breakBy } };
}

/**
 * A seat asks the room to take a break: the clock freezes for everyone until
 * somebody ends it.
 *
 * **Any seat, not just the host.** It is rarely the host who needs to leave the
 * table, and the person who walked away is the least able to press anything —
 * so gating this on hosting would put the control in the wrong hands twice over.
 *
 * One break at a time: a second request while one is running is a no-op rather
 * than a nested freeze, so `endBreak` always has exactly one thing to undo.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyRequestBreak(room, playerId) {
  if (!room.seats.has(playerId)) return { room, broadcasts: [] };
  if (!breakablePhase(room)) return { room, broadcasts: [] };
  if (room.breakBy !== null) return { room, broadcasts: [] };
  const nextRoom = { ...room, breakBy: playerId };
  return { room: nextRoom, broadcasts: [breakBroadcast(nextRoom)] };
}

/**
 * Somebody ends the break. **Anyone seated may**, including a seat that did not
 * start it: a break is a room decision, not a private lock, and the one person
 * who cannot be relied on to press play is the person who walked away. The
 * asker is not privileged here and neither is the host.
 *
 * No-op when nothing is running, so a duplicate tap from two phones that both
 * saw the same screen resolves to one resume.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyEndBreak(room, playerId) {
  if (room.breakBy === null) return { room, broadcasts: [] };
  if (!room.seats.has(playerId)) return { room, broadcasts: [] };
  const nextRoom = { ...room, breakBy: null };
  return { room: nextRoom, broadcasts: [breakBroadcast(nextRoom)] };
}

/** @param {Room} room */
function pausedBroadcast(room) {
  return { to: /** @type {const} */ ('all'), message: { type: 'paused', pausedFor: room.pausedFor } };
}

/**
 * Recompute the pause after presence changed, appending a `paused` broadcast
 * only when the answer actually moved. Callers pass the broadcast list they are
 * already building.
 *
 * @param {Room} room
 * @param {Broadcast[]} broadcasts  mutated in place
 * @returns {Room}
 */
function settlePause(room, broadcasts) {
  const target = pauseTargetFor(room);
  if (target === room.pausedFor) return room;
  const nextRoom = { ...room, pausedFor: target };
  broadcasts.push(pausedBroadcast(nextRoom));
  return nextRoom;
}

/**
 * A player connects (or reconnects). The first player becomes host. New seats
 * may only join from the lobby — arriving mid-game is rejected so the
 * scoreboard stays fair; a known playerId reconnecting is always welcomed back
 * (sticky seat, sticky host, sticky score).
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {string} nickname
 * @returns {ApplyResult}
 */
export function applyHello(room, playerId, nickname) {
  const isReconnect = room.seats.has(playerId);
  if (!isReconnect && room.phase !== 'lobby') {
    return {
      room,
      broadcasts: [{ to: playerId, message: { type: 'rejected', reason: 'in-progress' } }],
      rejectConnection: true,
    };
  }
  // A full room turns away new seats but always welcomes a reconnect (a known
  // playerId already holds a seat, so it never counts against the cap).
  if (!isReconnect && room.seats.size >= MAX_SEATS) {
    return {
      room,
      broadcasts: [{ to: playerId, message: { type: 'rejected', reason: 'room-full' } }],
      rejectConnection: true,
    };
  }

  const seats = new Map(room.seats);
  const present = new Set(room.present);
  let hostId = room.hostId;
  const name = cleanName(nickname);

  if (!isReconnect) {
    seats.set(playerId, { nickname: name, score: 0 });
  } else if (name) {
    const existing = /** @type {Seat} */ (seats.get(playerId));
    seats.set(playerId, { ...existing, nickname: name });
  }
  // An ownerless room hands hosting to whoever is first through the door,
  // reconnecting or brand new. It used to be enough to ask this of new seats
  // only, because `hostId` went null exactly once, before anyone had joined.
  // Host migration made it reachable mid-life too: everyone leaves, the last
  // departure finds nobody to migrate to, and the room sits ownerless. Skipping
  // reconnects there would strand a room whose whole roster comes back.
  if (hostId === null) hostId = playerId;
  present.add(playerId);

  // Coming back cancels having been left behind: the next time this seat drops,
  // the room stops for them again like anyone else.
  const waived = room.waived.includes(playerId)
    ? room.waived.filter((pid) => pid !== playerId)
    : room.waived;

  /** @type {Room} */
  let nextRoom = { ...room, seats, present, hostId, waived };
  // Settled before the welcome is built, because the welcome has to carry the
  // final answer: someone arriving mid-pause needs the pause in the same message
  // that gives them the phase, and a returning player is usually the reason it
  // just ended.
  /** @type {Broadcast[]} */
  const pauseBroadcasts = [];
  nextRoom = settlePause(nextRoom, pauseBroadcasts);

  /** @type {Broadcast[]} */
  const broadcasts = [welcomeBroadcast(nextRoom, playerId)];
  const roster = rosterMessage(nextRoom);
  for (const pid of present) {
    if (pid !== playerId) broadcasts.push({ to: pid, message: roster });
  }
  broadcasts.push(...pauseBroadcasts);
  return { room: nextRoom, broadcasts };
}

/**
 * Whether `playerId` may start the game right now: the host, from the lobby, with
 * at least one seat taken.
 *
 * Exported because the caller has to know BEFORE it mutates. `applyStart` is pure
 * and simply returns the room unchanged when a start is not allowed, which reads
 * as safe — but `party/partyGameServer.js` does real work on the way in (clearing
 * the `usedCodes` / `usedModes` no-repeat sets, then generating question 0, which
 * consumes a country). Doing that first and letting the reducer refuse afterwards
 * left a live game running on wiped memory. The server now asks this first, so
 * both sides of the decision read the same three conditions.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {boolean}
 */
export function canStart(room, playerId) {
  return room.phase === 'lobby' && room.hostId === playerId && room.seats.size > 0;
}

/**
 * Host starts the show from the lobby. Needs at least one seat. The question
 * is generated by the caller (server) and passed in, keeping this module free
 * of the pool and RNG. The host's chosen `plan` (already validated by the
 * server) and its `totalQuestions` ride along and are stored on the room; omit
 * them to keep whatever the room opened with.
 *
 * In **draft** mode the caller passes `draft: true` with the first-round plan (the
 * host's chosen round-1 mode), `totalQuestionsValue = targetRounds * ROUND_QUESTIONS`,
 * and `targetRounds`; the plan then grows one round per pick (see {@link applyPick}).
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {Question} question
 * @param {Room['plan']} [plan]
 * @param {number} [totalQuestionsValue]
 * @param {boolean} [tricky]  the host's tricky-mode choice; omit to keep the
 *   room's current value.
 * @param {Room['reveal']} [reveal]  the host's per-category reveal timing; omit to
 *   keep the room's current value.
 * @param {{ draft?: boolean, targetRounds?: number, firstPickMode?: string }} [draftOpts]
 *   draft-mode setup; omit for an ordinary setlist game. `firstPickMode` is the mode
 *   the host chose for round 1 in the lobby — round 1 IS the host's first pick, so its
 *   opening question carries the same `draftPick` attribution as any other picked round.
 * @returns {ApplyResult}
 */
export function applyStart(room, playerId, question, plan, totalQuestionsValue, tricky, reveal, draftOpts) {
  if (!canStart(room, playerId)) return { room, broadcasts: [] };
  const draft = draftOpts ? draftOpts.draft === true : false;
  const nextRoom = {
    ...room,
    phase: /** @type {Phase} */ ('question'),
    questionIndex: 0,
    question,
    buzzes: [],
    plan: plan ?? room.plan,
    tricky: typeof tricky === 'boolean' ? tricky : room.tricky,
    reveal: reveal ?? room.reveal,
    totalQuestions: typeof totalQuestionsValue === 'number' ? totalQuestionsValue : room.totalQuestions,
    draft,
    targetRounds: draft && draftOpts && typeof draftOpts.targetRounds === 'number' ? draftOpts.targetRounds : 0,
    // The host chose round 1 in the lobby, so it IS their first pick and the
    // rotation must skip them for a cycle. `pickerFor` counts picks per seat and
    // serves the fewest first, so seeding the host here is the whole mechanism --
    // no special case anywhere downstream, and a solo host still picks every round
    // because the minimum simply moves up with them.
    pickedBy: draft ? [playerId] : [],
    picker: null,
    // Round 1 is the host's pick (see `pickedBy` above and the `draftPick`
    // attribution below), so the host owns it exactly as a drafting player owns
    // theirs — including the picker's edge when the host is... never a bot, today.
    // Set anyway rather than left null: "the seat whose pick this round is" has
    // one answer here and encoding it now is what keeps the field honest if the
    // first pick ever moves.
    roundPicker: draft ? playerId : null,
    // Round 1's mode is the host's lobby choice, threaded in by the server on the
    // same options object the attribution below reads.
    roundMode: (draftOpts && draftOpts.firstPickMode) || null,
    hand: null,
    // A fresh game records a fresh ceremony. `applyStart` is reachable only from
    // the lobby, where `resetToLobby` has already cleared this — belt and braces,
    // because a stat carried across games would honour last game's fastest hand.
    honourStats: emptyHonourStats(),
  };
  const bcs = questionBroadcasts(nextRoom);
  // Round 1's first question carries the same `draftPick` attribution as any
  // picked round (see `applyPick`) -- who picked (the host) and which mode. That
  // is what lets the client treat round 1 as an ordinary pick (its title card,
  // its mode name) with no firstPick special case. `firstPickMode` is the lobby
  // choice, threaded in by the server.
  if (draft && draftOpts && draftOpts.firstPickMode) {
    for (const bc of bcs) /** @type {any} */ (bc.message).draftPick = { picker: playerId, modeId: draftOpts.firstPickMode };
  }
  return { room: nextRoom, broadcasts: bcs };
}

/**
 * A player buzzes with their chosen option. Correctness is resolved by the
 * caller (per the question's `isCorrect`) and passed in. Ignored unless we're in
 * the question phase, the player holds a seat, and they haven't already buzzed
 * this question — one buzz per player per question, first answer locked in.
 *
 * When every present seat has buzzed, the question auto-reveals (scores tally and
 * a `reveal` broadcast rides along).
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {string} choice  the chosen option's code
 * @param {boolean} correct
 * @param {number | null} [latencyMs]  ms from the question appearing to this
 *   buzz, measured by the caller (`party/partyGameServer.js` holds the deal time
 *   transiently). Null when it isn't known — a durable-object eviction mid-
 *   question loses it — in which case the buzz still counts toward accuracy but
 *   drops out of the fastest-hand average rather than counting as instant.
 *   Recorded, never acted on: the room stays time-free.
 * @returns {ApplyResult}
 */
export function applyBuzz(room, playerId, choice, correct, latencyMs = null) {
  if (room.phase !== 'question') return { room, broadcasts: [] };
  if (!room.seats.has(playerId)) return { room, broadcasts: [] };
  if (room.buzzes.some((b) => b.playerId === playerId)) return { room, broadcasts: [] };

  const buzzes = [...room.buzzes, { playerId, choice, correct: !!correct }];
  const nextRoom = { ...room, buzzes, honourStats: recordBuzz(room.honourStats, playerId, !!correct, latencyMs) };
  /** @type {Broadcast[]} */
  const broadcasts = [{
    to: 'all',
    message: {
      type: 'buzzed',
      playerId,
      buzzedCount: buzzes.length,
      seatCount: presentSeatCount(nextRoom),
    },
  }];

  if (allPresentBuzzed(nextRoom)) {
    const reveal = toReveal(nextRoom);
    return { room: reveal.room, broadcasts: [...broadcasts, ...reveal.broadcasts] };
  }
  return { room: nextRoom, broadcasts };
}

/**
 * Fold one buzz into the ceremony's records. Additive and total — no filtering
 * by correctness, because "fastest hand" counts every answer including the wrong
 * ones (nerve, not accuracy) and the thoughtful honour needs the denominator.
 *
 * @param {import('./partyHonours.js').HonourStats} stats
 * @param {string} playerId
 * @param {boolean} correct
 * @param {number | null} latencyMs
 * @returns {import('./partyHonours.js').HonourStats}
 */
function recordBuzz(stats, playerId, correct, latencyMs) {
  const base = stats && stats.seats ? stats : emptyHonourStats();
  const prev = base.seats[playerId] ?? { buzzes: 0, timed: 0, latencyMs: 0, correct: 0 };
  const timed = typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0;
  return {
    rounds: base.rounds,
    seats: {
      ...base.seats,
      [playerId]: {
        buzzes: prev.buzzes + 1,
        timed: prev.timed + (timed ? 1 : 0),
        latencyMs: prev.latencyMs + (timed ? /** @type {number} */ (latencyMs) : 0),
        correct: prev.correct + (correct ? 1 : 0),
      },
    },
  };
}

/**
 * Fold one question's points into the round they belong to. The round bucket is
 * created on first use, so a game that ends mid-round still has an honest entry
 * for the part of it that was played.
 *
 * @param {import('./partyHonours.js').HonourStats} stats
 * @param {number} questionIndex
 * @param {string | null} modeId  the round's mode, so "Best in Flags" can name it
 * @param {Record<string, number>} points
 * @returns {import('./partyHonours.js').HonourStats}
 */
function recordRoundGains(stats, questionIndex, modeId, points) {
  const base = stats && stats.seats ? stats : emptyHonourStats();
  const ri = roundIndexAt(questionIndex);
  const rounds = base.rounds.slice();
  while (rounds.length <= ri) rounds.push({ modeId: null, gains: {} });
  const gains = { ...rounds[ri].gains };
  for (const [pid, pts] of Object.entries(points)) gains[pid] = (gains[pid] ?? 0) + pts;
  // The mode is learned from whichever question in the round carries it; a null
  // simply leaves the last known answer alone rather than blanking it.
  rounds[ri] = { modeId: modeId ?? rounds[ri].modeId, gains };
  return { seats: base.seats, rounds };
}

/**
 * Host ends the question early (its countdown ran out on the host page). Same
 * transition as the all-buzzed auto-reveal, just triggered by the timer
 * instead. Timing lives on the page; the room only knows "reveal now".
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyForceReveal(room, playerId) {
  if (room.phase !== 'question') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  return toReveal(room);
}

/**
 * A player presses or releases "hold to read" during a reveal, freezing the
 * room's countdown while they study the ranked chart.
 *
 * Deliberately **stateless**: this changes nothing on the room and only relays
 * the press to everyone. Holds live for a few seconds inside a single reveal, so
 * putting them in room state would mean a field to serialize, deserialize,
 * migrate and clear on every phase change, to answer a question nobody asks
 * (a client joining mid-hold simply learns about the next one).
 *
 * Stateless here does **not** mean nobody tracks holders. Held time is unbounded
 * (see `partyTiming`), so a seat that drops mid-hold would freeze the room for
 * good if nothing released it -- and it cannot release itself, because its tab is
 * gone. `party/partyGameServer.js` therefore keeps a transient holders set purely
 * to emit that release from `onClose`. Do not "simplify" it away on the strength
 * of this function being pure: the disconnect path is what keeps a room
 * unfreezable, and it is pinned by tests in `party/partyGameServer.test.js`.
 *
 * Guarded on seat, phase, AND that this reveal actually draws a chart. The last
 * one matters because the guard is the only thing enforcing it: the button is
 * only ever shown on a chart, so no honest client sends a hold anywhere else,
 * but a crafted one sending `{hold, on: true}` at every reveal would otherwise
 * freeze the 0.9 s / 2.5 s flag reveals too -- for the whole room, every
 * question, all game. `question.ranking` is exactly what the client's own
 * `chartReveal()` keys on, so the two cannot drift apart.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {boolean} on  true on press, false on release
 * @returns {ApplyResult}
 */
export function applyHold(room, playerId, on) {
  if (room.phase !== 'reveal') return { room, broadcasts: [] };
  if (!room.seats.has(playerId)) return { room, broadcasts: [] };
  const ranking = room.question && room.question.ranking;
  if (!Array.isArray(ranking) || ranking.length === 0) return { room, broadcasts: [] };
  return {
    room,
    broadcasts: [{ to: 'all', message: { type: 'holding', playerId, on: on === true } }],
  };
}

/**
 * Host advances from a reveal to the next question, or to the final board if
 * the last question just finished. The next question is generated by the caller;
 * it's ignored on the final question.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {Question} nextQuestion
 * @returns {ApplyResult}
 */
export function applyNext(room, playerId, nextQuestion) {
  if (room.phase !== 'reveal') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };

  const isLast = room.questionIndex >= room.totalQuestions - 1;
  if (isLast) {
    // Any pause dies with the game. `final` isn't a pausable phase, so a flag
    // left set here would never be recomputed away — it would just ride every
    // later `welcome` telling arrivals the finished game is waiting for someone.
    // Any pause OR break dies with the game, for the same reason: `final` is
    // neither pausable nor breakable, so a flag left set here would never be
    // recomputed away and would ride every later `welcome` telling arrivals the
    // finished game is frozen.
    const nextRoom = { ...room, phase: /** @type {Phase} */ ('final'), question: null, buzzes: [], pausedFor: null, breakBy: null };
    const scoreboard = scoreboardOf(nextRoom);
    return {
      room: nextRoom,
      broadcasts: [{ to: 'all', message: { type: 'final', scoreboard, honours: honoursFor(nextRoom, scoreboard) } }],
    };
  }
  const nextRoom = {
    ...room,
    phase: /** @type {Phase} */ ('question'),
    questionIndex: room.questionIndex + 1,
    question: nextQuestion,
    buzzes: [],
  };
  return { room: nextRoom, broadcasts: questionBroadcasts(nextRoom) };
}

/**
 * The finish ceremony's honours, resolved against the board that is about to be
 * shown. Computed here rather than on the client because the raw records never
 * leave the server: a client that held them could name the fastest hand before
 * the game ended.
 *
 * Nicknames are attached at the last moment (rather than stored per honour) so a
 * seat that renamed itself mid-game is announced under the name on its row.
 *
 * @param {Room} room
 * @param {ReturnType<typeof scoreboardOf>} scoreboard
 * @returns {Array<import('./partyHonours.js').Honour & { nickname: string }>}
 */
function honoursFor(room, scoreboard) {
  const names = new Map(scoreboard.map((r) => [r.playerId, r.nickname]));
  return computeHonours(room.honourStats, winnerIdsOf(scoreboard), [...room.seats.keys()])
    .map((h) => ({ ...h, nickname: names.get(h.playerId) ?? '' }));
}

/**
 * Whether a `next` from the current reveal should open a **draft pick** rather
 * than deal the next question: true only in draft mode, at a reveal that sits on
 * a round boundary (another round follows). Pure, so the server can branch on it
 * (`next` → {@link applyEnterPicking} vs {@link applyNext}) without duplicating
 * the boundary rule. In draft `totalQuestions` is `targetRounds * ROUND_QUESTIONS`, so
 * `isRoundBoundary` is true at exactly the round ends before the last round.
 *
 * @param {Room} room
 * @returns {boolean}
 */
export function pendingPickAfterReveal(room) {
  return room.draft && room.phase === 'reveal' && isRoundBoundary(room.questionIndex, room.totalQuestions);
}

/**
 * Host opens the draft pick for the next round: the room moves from `reveal` to
 * `picking`, and the chosen `picker` chooses from `hand` (the mode ids the caller
 * dealt via `handFor`). Both are held on the room so a reconnect mid-pick sees
 * the same turn. Host-driven, same as {@link applyNext}.
 *
 * **Who the picker is the caller resolves** before calling: the lowest-ranked seat
 * that hasn't picked yet (`pickerFor`). The room stays out of that choice — it is
 * told the seat and only enforces what follows from it.
 *
 * @param {Room} room
 * @param {string} playerId  must be the host
 * @param {string | null} picker  the seat whose turn it is
 * @param {string[]} hand  the mode ids the picker may choose from
 * @returns {ApplyResult}
 */
export function applyEnterPicking(room, playerId, picker, hand) {
  if (room.phase !== 'reveal') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  if (!picker) return { room, broadcasts: [] };
  const nextRoom = { ...room, phase: /** @type {Phase} */ ('picking'), picker, hand: hand.slice() };
  return { room: nextRoom, broadcasts: pickingBroadcasts(nextRoom) };
}

/**
 * The designated picker chooses `modeId`, and its round starts. The caller has
 * already validated the pick (`isValidPick`) and built the round `segment` and
 * the first `question`; this appends the segment to the (growing) plan, advances
 * to that round's first question, records the picker in `pickedBy` (the no-repeat
 * set), and clears the picking state. Ignored unless we're in `picking` and the
 * sender is the seat whose turn it is.
 *
 * The first question of a drafted round carries `draftPick` (who picked, which
 * mode) so every client can show the "Zosia's pick" attribution.
 *
 * @param {Room} room
 * @param {string} pickerId  the seat picking; must equal `room.picker`
 * @param {string} modeId  the picked mode (for attribution)
 * @param {{ poolId: string, questionId: string, questions: number, veil?: boolean }} segment  the round to append
 * @param {Question} question  the round's first question
 * @returns {ApplyResult}
 */
export function applyPick(room, pickerId, modeId, segment, question) {
  if (room.phase !== 'picking') return { room, broadcasts: [] };
  if (room.picker !== pickerId) return { room, broadcasts: [] };
  const plan = [...(room.plan ?? []), segment];
  const nextRoom = {
    ...room,
    phase: /** @type {Phase} */ ('question'),
    questionIndex: room.questionIndex + 1,
    plan,
    question,
    buzzes: [],
    // In a draft the veil belongs to the round, not the game: it is whatever
    // THIS picker chose, so it is re-derived from the segment every pick rather
    // than carried over. Assigning unconditionally is the point — a veiled round
    // must not latch the veil on for every round after it.
    tricky: segment.veil === true,
    // Every drafted round spends a rotation slot for its picker — including the
    // last one, now an ordinary rotation pick like any other.
    pickedBy: [...room.pickedBy, pickerId],
    picker: null,
    // "Whose round is this" — the seat whose pick started it, held for its whole
    // run where `picker` is cleared the moment the choice is made. `roundMode` is
    // the same idea for WHAT is being played, kept for the finish's honours.
    roundPicker: pickerId,
    roundMode: modeId,
    hand: null,
  };
  const bcs = questionBroadcasts(nextRoom);
  for (const bc of bcs) /** @type {any} */ (bc.message).draftPick = { picker: pickerId, modeId };
  return { room: nextRoom, broadcasts: bcs };
}

/**
 * Reset the room to the lobby with every score zeroed. Shared by 'play again'
 * (from the final board) and 'back to settings' (a mid-game abort) — both drop
 * the whole room onto the setup screen for a fresh start.
 *
 * A dedicated 'lobby' message (not just 'roster') so clients move their phase
 * back — 'roster' only refreshes the player list, it doesn't reset the screen.
 *
 * @param {Room} room
 * @returns {ApplyResult}
 */
function resetToLobby(room) {
  const seats = new Map();
  for (const [pid, seat] of room.seats) seats.set(pid, { ...seat, score: 0 });
  const nextRoom = {
    ...room,
    phase: /** @type {Phase} */ ('lobby'),
    questionIndex: 0,
    question: null,
    buzzes: [],
    seats,
    // Clear any draft-in-progress state so the next game starts its draft clean.
    // `length` is deliberately NOT reset — the spread carries it through. The
    // host chose it for this room, and making them choose again after every game
    // would be the odd behaviour.
    draft: false,
    targetRounds: 0,
    pickedBy: [],
    picker: null,
    roundPicker: null,
    roundMode: null,
    hand: null,
    // A new game starts with nobody owed a wait and nobody left behind. Keeping
    // either across a reset would pause the next game for a seat that dropped
    // out of the last one. A break dies here too: it belongs to the game it was
    // called in, and a room that resets while frozen must not open its lobby
    // frozen.
    pausedFor: null,
    breakBy: null,
    honourStats: emptyHonourStats(),
    waived: [],
  };
  return {
    room: nextRoom,
    broadcasts: [{
      to: 'all',
      message: {
        type: 'lobby',
        hostId: nextRoom.hostId,
        roster: rosterList(nextRoom),
        // Stated rather than left implicit: a client that reset its own state
        // would otherwise repaint the lobby with a length nobody chose. The
        // first round rides along for the same reason -- both survive Play
        // again, so a room that liked its setup does not re-choose it every game.
        length: nextRoom.length,
        picksPerPlayer: nextRoom.picksPerPlayer,
        firstPick: nextRoom.firstPick,
        firstPickVeil: nextRoom.firstPickVeil,
      },
    }],
  };
}

/**
 * Host restarts from the final board: scores zeroed, back to the lobby so
 * people can leave or join before the next show.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyPlayAgain(room, playerId) {
  if (room.phase !== 'final') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  return resetToLobby(room);
}

/**
 * Host aborts a game in progress and returns the whole room to the settings
 * screen — the same reset as 'play again', but reachable mid-game (during a
 * question or reveal) instead of only from the final board. Scores are wiped;
 * the host reconfigures and starts fresh. No-op from the lobby / final (there's
 * nothing to abort) or for a non-host.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyReturnToLobby(room, playerId) {
  if (room.phase !== 'question' && room.phase !== 'reveal') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  return resetToLobby(room);
}

/**
 * A socket drops. The seat stays (sticky, for reconnect); the player just
 * leaves `present`. If a question was waiting only on the departed player,
 * it reveals now so the room doesn't hang.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyDisconnect(room, playerId) {
  if (!room.present.has(playerId)) return { room, broadcasts: [] };
  const present = new Set(room.present);
  present.delete(playerId);
  let nextRoom = { ...room, present };

  // Host migration. The host is not just a badge: their tab runs the game clock
  // and is the only seat allowed to send `reveal` / `next` / `forcePick`. A host
  // who drops therefore freezes the room for everyone, which is the one stall a
  // pause cannot rescue — nobody left would be allowed to un-pause it.
  if (nextRoom.hostId === playerId) nextRoom = { ...nextRoom, hostId: nextHostFor(nextRoom) };

  /** @type {Broadcast[]} */
  const broadcasts = [{ to: 'all', message: rosterMessage(nextRoom) }];

  // The in-flight question still resolves. Pausing protects the REST of the
  // game, not the question already on screen: holding that one would leave
  // everyone still here staring at a prompt they have all answered, and the
  // player who left cannot answer it either way. They lose at most this one.
  if (nextRoom.phase === 'question' && allPresentBuzzed(nextRoom)) {
    const reveal = toReveal(nextRoom);
    nextRoom = reveal.room;
    broadcasts.push(...reveal.broadcasts);
  }

  // A break ends when the seat that called it loses its socket. Not because the
  // break was theirs to hold — anyone can end it — but because the room is about
  // to freeze again for the same person under `pausedFor`, and leaving both set
  // would mean their return un-drops the room while the break they can no longer
  // see keeps it frozen. Handing the freeze over to the drop-pause keeps exactly
  // one reason on screen at a time.
  //
  // Deliberately NOT released on `visibilitychange` / `pagehide` the way a hold
  // is, which is where this differs from hold-to-read: a hold is a finger on a
  // button and cannot survive a hidden tab, whereas a break is a latch pressed by
  // someone who is walking away — ending it the moment they pocket the phone
  // would break it in exactly the case it exists for.
  if (nextRoom.breakBy === playerId) {
    nextRoom = { ...nextRoom, breakBy: null };
    broadcasts.push(breakBroadcast(nextRoom));
  }

  nextRoom = settlePause(nextRoom, broadcasts);
  return { room: nextRoom, broadcasts };
}

/**
 * The host carries on without the seat the room is waiting for. The absent
 * player is waived (their absence stops pausing the room) and the game runs
 * again from wherever it froze.
 *
 * Waiving is per-absence, not permanent: reconnecting clears it, so the seat is
 * a full member again the moment they are back — including their sticky score,
 * which never stopped being theirs.
 *
 * No-op for a non-host, or when nothing is paused. Deliberately host-only: it
 * decides for the whole room, and the host is already the seat that decides
 * when the room advances.
 *
 * @param {Room} room
 * @param {string} playerId
 * @returns {ApplyResult}
 */
export function applyResume(room, playerId) {
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  if (room.pausedFor === null) return { room, broadcasts: [] };
  const waived = room.waived.includes(room.pausedFor)
    ? room.waived
    : [...room.waived, room.pausedFor];
  // Cleared before the recompute, or `pauseTargetFor`'s "an existing pause wins"
  // rule would hand back the very seat just waived.
  const cleared = { ...room, waived, pausedFor: /** @type {string | null} */ (null) };
  // Usually null (the game runs again), but a second player who was already
  // absent takes over the pause instead of the room lurching into a question
  // two people are missing.
  const nextRoom = { ...cleared, pausedFor: pauseTargetFor(cleared) };
  // Broadcast unconditionally rather than through `settlePause`: this reducer
  // ran because the host pressed something, and the common outcome is
  // paused -> running, which `settlePause` reads as "null to null, nothing to
  // say" and would swallow the one message the room is waiting for.
  return { room: nextRoom, broadcasts: [pausedBroadcast(nextRoom)] };
}

/**
 * Hand the current pick to a different seat, because the one whose turn it was
 * left the room. Same shape as {@link applyEnterPicking} but from `picking` to
 * `picking`, and it keeps the dealt `hand` — only the seat holding the turn
 * changes.
 *
 * Without this the room waits on someone who is gone until the host's anti-stall
 * timer fires, which is up to 45 s of "Bob chooses the next round" with Bob no
 * longer in the room. `eligiblePickers` stops an ALREADY-absent seat being
 * chosen; this covers the seat that leaves once the pick is open.
 *
 * The caller re-runs the same rotation selection it used to open the pick over
 * whoever is left, so the rule that picked the original seat is the rule that
 * picks the replacement. A null `picker` is a no-op: with nobody left to pick
 * there is nothing better to do than hold the turn.
 *
 * @param {Room} room
 * @param {string | null} picker  the seat taking over
 * @returns {ApplyResult}
 */
export function applyRepick(room, picker) {
  if (room.phase !== 'picking') return { room, broadcasts: [] };
  if (!picker || picker === room.picker) return { room, broadcasts: [] };
  const nextRoom = { ...room, picker };
  return { room: nextRoom, broadcasts: pickingBroadcasts(nextRoom) };
}

/**
 * The host chooses the first round from the lobby.
 *
 * The second of the two settings a room shares before it starts (see
 * {@link applySetLength}). Same guards for the same reasons: refused off the
 * lobby, refused from anyone but the host — checked here rather than at the call
 * site so a second caller cannot forget them — and an unchanged value broadcasts
 * nothing, so a mashed arrow key does not fan out to the whole room.
 *
 * The choice counts as the host's first pick. That is applied at
 * {@link applyStart}, which seeds `pickedBy` with them, not here: until the game
 * starts there is no rotation for it to count against.
 *
 * The veil rides the same message: the host arms (or disarms) hiding the first
 * round's tiles. It is a plain boolean and applies to whatever first-round mode is chosen,
 * since every first-round mode is veilable. Coerced to a boolean here so a missing
 * field (an older host that only sends `firstPick`) reads as "off" rather than
 * blanking a value the room might already hold — the caller passes
 * `room.firstPickVeil` through when it only means to change the mode.
 *
 * Nothing broadcasts unless the mode OR the veil actually changed, so toggling
 * the veil alone still fans out, but a no-op setFirstPick stays silent.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {unknown} firstPick  a picture mode id; anything else coerces to Flags
 * @param {boolean} [veil]  whether the first round is veiled; omit to keep
 * @returns {ApplyResult}
 */
export function applySetFirstPick(room, playerId, firstPick, veil) {
  if (room.phase !== 'lobby') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  const next = validateFirstPickMode(firstPick);
  const nextVeil = typeof veil === 'boolean' ? veil : room.firstPickVeil;
  if (next === room.firstPick && nextVeil === room.firstPickVeil) return { room, broadcasts: [] };
  const nextRoom = { ...room, firstPick: next, firstPickVeil: nextVeil };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'settings', firstPick: next, firstPickVeil: nextVeil } }],
  };
}

/**
 * The host changes the game length from the lobby. Was the **only** reducer that
 * mutated the room before `start` — everything else the host once configured rode
 * on the start message and was never shared, so nothing about a lobby was
 * broadcast except who was in it. {@link applySetFirstPick} is now the second.
 *
 * Refused off the lobby (the length is fixed once a game is sized) and refused
 * from anyone but the host, checked here rather than at the call site so the
 * guard cannot be forgotten by a second caller. An unchanged value broadcasts
 * nothing, which also stops a mashed arrow key fanning out to the whole room.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {unknown} length
 * @returns {ApplyResult}
 */
export function applySetLength(room, playerId, length) {
  if (room.phase !== 'lobby') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  const next = validateGameLength(length);
  if (next === room.length) return { room, broadcasts: [] };
  const nextRoom = { ...room, length: next };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'settings', length: next } }],
  };
}

/**
 * The host switches even-picks sizing on (1/2/3) or off (null) from the lobby.
 * Sibling of {@link applySetLength} with the same guards for the same reasons:
 * refused off the lobby (sizing is fixed once a game starts) and refused from
 * anyone but the host. An unchanged value broadcasts nothing.
 *
 * `length` is deliberately left untouched — when the host toggles the mode off
 * (`picksPerPlayer` back to null) the room resizes by whatever length was already
 * chosen, so the length control comes back exactly where they left it.
 *
 * @param {Room} room
 * @param {string} playerId
 * @param {unknown} picksPerPlayer  1/2/3 for even picks, anything else for off
 * @returns {ApplyResult}
 */
export function applySetPicksPerPlayer(room, playerId, picksPerPlayer) {
  if (room.phase !== 'lobby') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  const next = validatePicksPerPlayer(picksPerPlayer);
  if (next === room.picksPerPlayer) return { room, broadcasts: [] };
  const nextRoom = { ...room, picksPerPlayer: next };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'settings', picksPerPlayer: next } }],
  };
}

/**
 * The host adds a bot seat from the lobby. A bot is a full seat with `bot: true`
 * and a difficulty `skill`, present from the moment it's added (it has no socket,
 * so nothing else would ever put it in `present`). It counts against
 * {@link MAX_SEATS} like a human, and — being a second seat — flips solo play into
 * a race (the speed bonus keys on seat count, see {@link toReveal}).
 *
 * Lobby-only and host-only, checked here so a second caller can't forget them.
 * The `botId` and `nickname` are minted by the server (the room stays free of
 * id/name generation), and `skill` is validated by the server before it arrives
 * (the room stores it verbatim, staying decoupled from `partyBot.js`). An id that
 * already holds a seat is refused rather than overwriting a live player.
 *
 * @param {Room} room
 * @param {string} playerId  must be the host
 * @param {string} botId  the server-minted seat id for the bot
 * @param {string} nickname  the server-minted display name
 * @param {string} skill  a validated bot difficulty id
 * @returns {ApplyResult}
 */
export function applyAddBot(room, playerId, botId, nickname, skill) {
  if (room.phase !== 'lobby') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  if (!botId || room.seats.has(botId)) return { room, broadcasts: [] };
  if (room.seats.size >= MAX_SEATS) return { room, broadcasts: [] };
  const seats = new Map(room.seats);
  seats.set(botId, { nickname: cleanName(nickname), score: 0, bot: true, skill });
  const present = new Set(room.present);
  present.add(botId);
  const nextRoom = { ...room, seats, present };
  return { room: nextRoom, broadcasts: [{ to: 'all', message: rosterMessage(nextRoom) }] };
}

/**
 * The host removes a bot seat from the lobby. Only a bot can be removed this way —
 * a human seat is sticky (it leaves by disconnecting), so a `removeBot` naming a
 * real player is refused. Lobby-only and host-only, same as {@link applyAddBot}.
 *
 * @param {Room} room
 * @param {string} playerId  must be the host
 * @param {string} botId  the bot seat to remove
 * @returns {ApplyResult}
 */
export function applyRemoveBot(room, playerId, botId) {
  if (room.phase !== 'lobby') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  const seat = room.seats.get(botId);
  if (!seat || seat.bot !== true) return { room, broadcasts: [] };
  const seats = new Map(room.seats);
  seats.delete(botId);
  const present = new Set(room.present);
  present.delete(botId);
  const nextRoom = { ...room, seats, present };
  return { room: nextRoom, broadcasts: [{ to: 'all', message: rosterMessage(nextRoom) }] };
}

// ---- internal helpers ----

/**
 * The per-recipient `picking` messages for a room already in the picking phase.
 *
 * Per-recipient, so "am I the picker" is **server-authoritative**: the picker's
 * own connection is told `youPick: true` and given the hand, and everyone else
 * gets `youPick: false` (and no hand — no need to leak it). The client never
 * re-derives its role by comparing its own id to the picker, which is exactly
 * what a stale / mismatched identity could get wrong (a picker seeing the
 * watcher view). Disconnected seats get their role on reconnect via `welcome`.
 *
 * Shared by opening a pick and re-electing one, so a re-elected picker is told
 * exactly what an original picker is told — a second copy of this would be the
 * obvious place for the two to drift.
 *
 * @param {Room} room  already in `picking`, with `picker` / `hand` set
 * @returns {Broadcast[]}
 */
function pickingBroadcasts(room) {
  const picker = /** @type {string} */ (room.picker);
  const hand = room.hand ?? [];
  const base = { type: 'picking', picker, questionIndex: room.questionIndex, totalQuestions: room.totalQuestions };
  /** @type {Broadcast[]} */
  const broadcasts = [{ to: picker, message: { ...base, youPick: true, hand: hand.slice() } }];
  for (const pid of room.present) {
    if (pid === picker) continue;
    broadcasts.push({ to: pid, message: { ...base, youPick: false } });
  }
  return broadcasts;
}

/**
 * Tally the current question and move to reveal. Speed bonus is off in solo
 * (one seat — no race). The reveal broadcast carries every player's pick so
 * clients can show "you vs them", not just a private right/wrong.
 *
 * @param {Room} room
 * @returns {ApplyResult}
 */
function toReveal(room) {
  const q = room.question;
  if (!q) return { room, broadcasts: [] };
  // Score itemised, then project to totals. The reveal carries both: `points`
  // for the seat arithmetic and every client that only wants the number, and
  // `breakdown` so the break's chips can say what earned each point instead of
  // inferring it from the total (undecidable now that the solo bonus and the
  // first speed bonus are both 5).
  // Questions that rank their options (world facts) pay a near miss. `ranking` is
  // best-first in the question's own direction, so index 0 is the answer either
  // way and a plain indexOf gives the scorer the rank it wants. Questions with no
  // ranking (flag-pick, map-pick) leave `rank` undefined and score as before.
  const ranking = Array.isArray(q.ranking) ? q.ranking : null;
  const scored = ranking
    ? room.buzzes.map((b) => {
      const rank = ranking.indexOf(b.choice);
      return rank >= 0 ? { ...b, rank } : b;
    })
    : room.buzzes;
  const awards = scoreQuestionDetailed(scored, {
    applySpeedBonus: room.seats.size > 1,
  });
  /** @type {Record<string, number>} */
  const points = {};
  /** @type {Record<string, { base: number, speed: number, solo: number, closeness: number, fastest: boolean }>} */
  const breakdown = {};
  for (const [pid, award] of Object.entries(awards)) {
    points[pid] = award.total;
    // `fastest` rides along so the reveal can badge the one seat that won the
    // race: the speed ladder is sized to the field now, so its winning value
    // isn't a constant the client could compare against (see `wasFastest`).
    breakdown[pid] = {
      base: award.base, speed: award.speed, solo: award.solo, closeness: award.closeness, fastest: award.fastest,
    };
  }
  const seats = new Map();
  for (const [pid, seat] of room.seats) {
    seats.set(pid, { ...seat, score: seat.score + (points[pid] ?? 0) });
  }
  const nextRoom = {
    ...room,
    phase: /** @type {Phase} */ ('reveal'),
    seats,
    // The break already tallies per-round gains and then throws them away when
    // the next round starts. Keeping a copy here is what lets the ending say
    // "best in Flags" without measuring anything new.
    honourStats: recordRoundGains(room.honourStats, room.questionIndex, room.roundMode, points),
  };
  /** @type {Record<string, string>} */
  const picks = {};
  for (const b of room.buzzes) picks[b.playerId] = b.choice;
  return {
    room: nextRoom,
    broadcasts: [{
      to: 'all',
      message: {
        type: 'reveal',
        answer: q.answer,
        // The full ranking and the raw values, for the world-facts reveal chart.
        // These ride the REVEAL and nothing else: they name the answer outright,
        // so putting them on the question message would hand it to every client
        // a beat early. `publicQuestion` is an allow-list, so that cannot happen
        // by accident — but it is the reason they are attached here and not
        // stamped onto the question when it is generated.
        ...(Array.isArray(q.ranking) ? { ranking: q.ranking, values: q.values } : {}),
        picks,
        points,
        breakdown,
        scoreboard: scoreboardOf(nextRoom),
        questionIndex: room.questionIndex,
        totalQuestions: room.totalQuestions,
        isFinalRound: room.questionIndex >= room.totalQuestions - 1,
      },
    }],
  };
}

/**
 * True once every currently-present seat has buzzed (and at least one seat is
 * present). Disconnected seats don't hold up the reveal.
 *
 * @param {Room} room
 * @returns {boolean}
 */
function allPresentBuzzed(room) {
  const buzzed = new Set(room.buzzes.map((b) => b.playerId));
  let presentSeats = 0;
  for (const pid of room.seats.keys()) {
    if (!room.present.has(pid)) continue;
    presentSeats += 1;
    if (!buzzed.has(pid)) return false;
  }
  return presentSeats > 0;
}

/**
 * @param {Room} room
 * @returns {number}
 */
function presentSeatCount(room) {
  let n = 0;
  for (const pid of room.seats.keys()) if (room.present.has(pid)) n += 1;
  return n;
}

/**
 * @param {string} nickname
 * @returns {string}
 */
function cleanName(nickname) {
  return typeof nickname === 'string' ? nickname.trim().slice(0, 24) : '';
}

/**
 * @param {Room} room
 * @returns {Array<{ playerId: string, nickname: string, score: number, present: boolean }>}
 */
function rosterList(room) {
  const out = [];
  for (const [playerId, seat] of room.seats) {
    // `bot` / `skill` ride along only for bot seats, so a human roster entry is
    // byte-identical to before this feature (nothing to migrate, no test churn).
    // The client badges a bot from this and disables its own myChoice for it.
    out.push({
      playerId,
      nickname: seat.nickname,
      score: seat.score,
      present: room.present.has(playerId),
      ...(seat.bot === true ? { bot: true, skill: seat.skill } : {}),
    });
  }
  return out;
}

/**
 * Roster sorted by score descending (seat order breaks ties, since Map
 * iteration is insertion-ordered and sort is stable).
 * @param {Room} room
 */
function scoreboardOf(room) {
  return rosterList(room).sort((a, b) => b.score - a.score);
}

/**
 * @param {Room} room
 * @returns {{ type: 'roster', hostId: string | null, roster: ReturnType<typeof rosterList> }}
 */
function rosterMessage(room) {
  return { type: 'roster', hostId: room.hostId, roster: rosterList(room) };
}

/**
 * The public view of a question — the answer is stripped so it never reaches
 * a client before reveal. `questionId` rides along so the client knows how to
 * render it (flag tiles vs contour tiles).
 * @param {Question} q
 */
function publicQuestion(q) {
  /** @type {{ prompt: string, options: string[], questionId?: string, clearFrac?: number }} */
  const pub = { prompt: q.prompt, options: q.options };
  if (q.questionId != null) pub.questionId = q.questionId;
  // The veil timing for this question rides along so a tricky-mode client clears
  // the tile on schedule; it's stamped server-side from the host's reveal config.
  if (q.clearFrac != null) pub.clearFrac = q.clearFrac;
  // The name-reveal timing (world-facts questions only) rides along the same way so
  // every client fades the country names onto the tiles at the same instant.
  return pub;
}

/**
 * The `question` message for the room's live question — one `to: 'all'`
 * broadcast, since every player sees the identical board.
 *
 * @param {Room} room
 * @returns {Broadcast[]}
 */
function questionBroadcasts(room) {
  const q = room.question;
  const pub = q ? publicQuestion(q) : { prompt: '', options: [] };
  return [{ to: 'all', message: { type: 'question', ...pub, questionIndex: room.questionIndex, totalQuestions: room.totalQuestions, tricky: room.tricky } }];
}

/**
 * Full resume snapshot for one player — enough to paint whatever phase the
 * room is in when they (re)connect.
 * @param {Room} room
 * @param {string} playerId
 * @returns {Broadcast}
 */
function welcomeBroadcast(room, playerId) {
  // Sorted once and used twice: the board itself, and the honours that have to
  // agree with it about who won. Re-deriving it for the honours would be a
  // second sort, and — worse — two answers to the same question.
  const scoreboard = scoreboardOf(room);
  return {
    to: playerId,
    message: {
      type: 'welcome',
      you: playerId,
      isHost: room.hostId === playerId,
      // WHO hosts, not just whether it is you. A joiner used to learn this only
      // from the next `roster` broadcast, which their own arrival does not send
      // them — so until someone else came or went, a guest's screen could not
      // name the host at all. That was survivable while nothing needed the name;
      // the pause card does, to tell a guest whose call it is to move on.
      hostId: room.hostId,
      phase: room.phase,
      questionIndex: room.questionIndex,
      totalQuestions: room.totalQuestions,
      tricky: room.tricky,
      // So a joiner paints the length immediately instead of waiting for the
      // host to happen to change it. Same for the first round and even-picks sizing.
      length: room.length,
      picksPerPlayer: room.picksPerPlayer,
      firstPick: room.firstPick,
      firstPickVeil: room.firstPickVeil,
      roster: rosterList(room),
      question: room.question ? publicQuestion(room.question) : null,
      scoreboard,
      // Draft: a reconnect mid-pick needs the current picker to paint the pick
      // screen. `youPick` is server-authoritative (this seat vs the picker), and
      // the hand is sent only to the picker (never leaked to a watcher). All null
      // / false in a non-draft or non-picking room.
      picker: room.picker,
      youPick: room.phase === 'picking' && room.picker === playerId,
      hand: (room.phase === 'picking' && room.picker === playerId) ? room.hand : null,
      // So a player who reconnects into a paused room paints the frozen clock
      // and the "waiting for" line immediately, instead of running a countdown
      // nobody else is running until the next `paused` broadcast happens by.
      pausedFor: room.pausedFor,
      // Same reasoning for the other freeze: a seat that reconnects into a room
      // on a break must paint the break, not run a clock nobody else is running.
      breakBy: room.breakBy,
      // A seat that reconnects onto the finished board gets the honours with it,
      // so the ceremony's mentions survive a reload rather than leaving a board
      // whose strip has nothing to cycle.
      honours: room.phase === 'final' ? honoursFor(room, scoreboard) : null,
    },
  };
}

// ---- persistence ----

/**
 * Structured-clone-safe snapshot for party storage. `present` is dropped (live
 * sockets don't survive a DO eviction) and everything else is plain data — no
 * predicates to strip, unlike TTT.
 * @param {Room} room
 */
export function serializeRoom(room) {
  return {
    phase: room.phase,
    hostId: room.hostId,
    seats: [...room.seats.entries()],
    totalQuestions: room.totalQuestions,
    plan: room.plan,
    length: room.length,
    picksPerPlayer: room.picksPerPlayer,
    firstPick: room.firstPick,
    firstPickVeil: room.firstPickVeil,
    questionIndex: room.questionIndex,
    tricky: room.tricky,
    reveal: room.reveal,
    question: room.question,
    buzzes: room.buzzes,
    draft: room.draft,
    targetRounds: room.targetRounds,
    pickedBy: room.pickedBy,
    picker: room.picker,
    roundPicker: room.roundPicker,
    roundMode: room.roundMode,
    hand: room.hand,
    pausedFor: room.pausedFor,
    breakBy: room.breakBy,
    honourStats: room.honourStats,
    waived: room.waived,
    lastActiveAt: room.lastActiveAt,
  };
}

/**
 * @param {any} snapshot
 * @returns {Room}
 */
export function deserializeRoom(snapshot) {
  return {
    phase: snapshot.phase ?? 'lobby',
    hostId: snapshot.hostId ?? null,
    // Older snapshots carry extra per-seat fields from retired features. They
    // are simply ignored — nothing reads them, so no migration is needed.
    seats: new Map(snapshot.seats ?? []),
    present: new Set(),
    totalQuestions: snapshot.totalQuestions ?? DEFAULT_QUESTIONS,
    plan: snapshot.plan ?? null,
    // A snapshot written before the lobby had a length stays null — "nobody set
    // this" — rather than being given a default nobody chose.
    length: snapshot.length ?? null,
    // A snapshot from before even-picks sizing reads as null (off), so it resizes
    // by length exactly as it did when written.
    picksPerPlayer: snapshot.picksPerPlayer ?? null,
    firstPick: snapshot.firstPick ?? null,
    firstPickVeil: snapshot.firstPickVeil ?? false,
    questionIndex: snapshot.questionIndex ?? 0,
    tricky: snapshot.tricky ?? false,
    reveal: snapshot.reveal ?? null,
    question: snapshot.question ?? null,
    buzzes: snapshot.buzzes ?? [],
    draft: snapshot.draft ?? false,
    targetRounds: snapshot.targetRounds ?? 0,
    pickedBy: snapshot.pickedBy ?? [],
    picker: snapshot.picker ?? null,
    // A snapshot from before this field existed reads as "nobody's round", so a
    // bot mid-round loses the picker's edge across an eviction and gains nothing
    // it shouldn't. The safe direction of the two.
    roundPicker: snapshot.roundPicker ?? null,
    // Same "written before this field existed" fallback as `roundPicker`: the
    // live round simply has no mode name, so a Best-in-round honour earned across
    // the eviction is announced without one rather than with a wrong one.
    roundMode: snapshot.roundMode ?? null,
    hand: snapshot.hand ?? null,
    // An eviction empties `present`, so every seat reads as absent for a moment
    // and the room would pause for whoever happens to be first in seat order.
    // Restoring the stored answer instead means the pause survives the eviction
    // as itself, and the first reconnect settles it honestly.
    pausedFor: snapshot.pausedFor ?? null,
    // A break survives an eviction as itself. The alternative — dropping it —
    // would silently un-freeze a room whose players are still away from the
    // table, which is the one thing the feature promises not to do.
    breakBy: snapshot.breakBy ?? null,
    // A snapshot from before the ceremony existed has nothing recorded, so that
    // game simply finishes with no honours rather than failing to finish.
    honourStats: snapshot.honourStats ?? emptyHonourStats(),
    waived: snapshot.waived ?? [],
    // A snapshot from before this field existed reads as "never touched" and
    // therefore dead (see `flags/roomLiveness.js`). The next inbound message
    // stamps a real time, which is the honest answer once the server can see
    // for itself.
    lastActiveAt: snapshot.lastActiveAt ?? null,
  };
}
