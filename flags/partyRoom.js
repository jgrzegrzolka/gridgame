import { scoreQuestionDetailed, FINAL_ROUND_MULTIPLIER } from './partyScore.js';
import { isRoundBoundary, isFinalRound } from './partyPlan.js';

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
 * @typedef {{ nickname: string, score: number }} Seat
 * @typedef {{ prompt: string, options: string[], answer: string, questionId?: string, clearFrac?: number }} Question
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
 *   from the seat count (`roundCountFor`). The game ends after this many rounds;
 *   `totalQuestions` is `targetRounds * ROUND_QUESTIONS`. 0 in a non-draft game.
 * @property {string[]} pickedBy  playerIds that have already picked a round, in
 *   pick order — the no-repeat set the draft's picker selection reads.
 * @property {string | null} picker  during `picking`, the seat whose turn it is to
 *   choose the next round; null otherwise.
 * @property {string[] | null} hand  during `picking`, the mode ids the picker may
 *   choose from (server-dealt); null otherwise. Stored so a reconnect mid-pick
 *   sees the same hand.
 * @property {boolean} decider  during `picking`, whether this pick is for **the
 *   Decider** — the closing double-points round, which sits outside the rotation
 *   and is picked by whoever is in last place (see `deciderPickerFor`). Held on
 *   the room rather than re-derived so a reconnect mid-pick paints the right
 *   screen, and so {@link applyPick} knows not to spend a rotation slot on it.
 *   False outside `picking`.
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
    questionIndex: 0,
    tricky: false,
    reveal: null,
    question: null,
    buzzes: [],
    draft: false,
    targetRounds: 0,
    pickedBy: [],
    picker: null,
    hand: null,
    decider: false,
  };
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
    if (hostId === null) hostId = playerId;
  } else if (name) {
    const existing = /** @type {Seat} */ (seats.get(playerId));
    seats.set(playerId, { ...existing, nickname: name });
  }
  present.add(playerId);

  const nextRoom = { ...room, seats, present, hostId };
  /** @type {Broadcast[]} */
  const broadcasts = [welcomeBroadcast(nextRoom, playerId)];
  const roster = rosterMessage(nextRoom);
  for (const pid of present) {
    if (pid !== playerId) broadcasts.push({ to: pid, message: roster });
  }
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
 * In **draft** mode the caller passes `draft: true` with the opening plan (a
 * single Flags round), `totalQuestionsValue = targetRounds * ROUND_QUESTIONS`, and
 * `targetRounds`; the plan then grows one round per pick (see {@link applyPick}).
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
 * @param {{ draft?: boolean, targetRounds?: number }} [draftOpts]  draft-mode setup;
 *   omit for an ordinary setlist game.
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
    pickedBy: [],
    picker: null,
    hand: null,
    decider: false,
  };
  return { room: nextRoom, broadcasts: [questionBroadcast(nextRoom)] };
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
 * @returns {ApplyResult}
 */
export function applyBuzz(room, playerId, choice, correct) {
  if (room.phase !== 'question') return { room, broadcasts: [] };
  if (!room.seats.has(playerId)) return { room, broadcasts: [] };
  if (room.buzzes.some((b) => b.playerId === playerId)) return { room, broadcasts: [] };

  const buzzes = [...room.buzzes, { playerId, choice, correct: !!correct }];
  const nextRoom = { ...room, buzzes };
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
    const nextRoom = { ...room, phase: /** @type {Phase} */ ('final'), question: null, buzzes: [] };
    return {
      room: nextRoom,
      broadcasts: [{ to: 'all', message: { type: 'final', scoreboard: scoreboardOf(nextRoom) } }],
    };
  }
  const nextRoom = {
    ...room,
    phase: /** @type {Phase} */ ('question'),
    questionIndex: room.questionIndex + 1,
    question: nextQuestion,
    buzzes: [],
  };
  return { room: nextRoom, broadcasts: [questionBroadcast(nextRoom)] };
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
 * **Who the picker is depends on which pick this is**, and the caller resolves it
 * before calling: a rotation pick goes to the lowest-ranked seat that hasn't
 * picked yet (`pickerFor`), the closing Decider to whoever is in last place
 * outright (`deciderPickerFor`). The room stays out of that choice — it is told
 * the seat and the `decider` flag, and only enforces what follows from them.
 *
 * @param {Room} room
 * @param {string} playerId  must be the host
 * @param {string | null} picker  the seat whose turn it is
 * @param {string[]} hand  the mode ids the picker may choose from
 * @param {boolean} [decider]  whether this pick is for the closing Decider round
 *   (the caller decides via `isDeciderPick`, and chose the picker accordingly).
 * @returns {ApplyResult}
 */
export function applyEnterPicking(room, playerId, picker, hand, decider = false) {
  if (room.phase !== 'reveal') return { room, broadcasts: [] };
  if (room.hostId !== playerId) return { room, broadcasts: [] };
  if (!picker) return { room, broadcasts: [] };
  const isDecider = decider === true;
  const nextRoom = { ...room, phase: /** @type {Phase} */ ('picking'), picker, hand: hand.slice(), decider: isDecider };
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
    // The Decider is outside the rotation, so choosing it does NOT spend a
    // rotation slot: recording it would say this seat has picked one more time
    // than everyone else, which is the exact promise ("everyone picks the same
    // number of times") the closing round was moved out of the rotation to keep.
    pickedBy: room.decider ? room.pickedBy : [...room.pickedBy, pickerId],
    picker: null,
    hand: null,
    decider: false,
  };
  const bc = questionBroadcast(nextRoom);
  /** @type {any} */ (bc.message).draftPick = { picker: pickerId, modeId };
  return { room: nextRoom, broadcasts: [bc] };
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
    draft: false,
    targetRounds: 0,
    pickedBy: [],
    picker: null,
    hand: null,
    decider: false,
  };
  return {
    room: nextRoom,
    broadcasts: [{ to: 'all', message: { type: 'lobby', hostId: nextRoom.hostId, roster: rosterList(nextRoom) } }],
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
  const nextRoom = { ...room, present };
  /** @type {Broadcast[]} */
  const broadcasts = [{ to: 'all', message: rosterMessage(nextRoom) }];
  if (nextRoom.phase === 'question' && allPresentBuzzed(nextRoom)) {
    const reveal = toReveal(nextRoom);
    return { room: reveal.room, broadcasts: [...broadcasts, ...reveal.broadcasts] };
  }
  return { room: nextRoom, broadcasts };
}

/**
 * Hand the current pick to a different seat, because the one whose turn it was
 * left the room. Same shape as {@link applyEnterPicking} but from `picking` to
 * `picking`, and it keeps the pick's identity (`decider`) and its dealt `hand` —
 * only the seat holding the turn changes.
 *
 * Without this the room waits on someone who is gone until the host's anti-stall
 * timer fires, which is up to 45 s of "Bob chooses The Decider" with Bob no
 * longer in the room. `eligiblePickers` stops an ALREADY-absent seat being
 * chosen; this covers the seat that leaves once the pick is open.
 *
 * The caller re-runs the same selection it used to open the pick (rotation vs
 * Decider) over whoever is left, so the rule that picked the original seat is the
 * rule that picks the replacement. A null `picker` is a no-op: with nobody left
 * to pick there is nothing better to do than hold the turn.
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
 * @param {Room} room  already in `picking`, with `picker` / `hand` / `decider` set
 * @returns {Broadcast[]}
 */
function pickingBroadcasts(room) {
  const picker = /** @type {string} */ (room.picker);
  const hand = room.hand ?? [];
  const base = { type: 'picking', picker, questionIndex: room.questionIndex, totalQuestions: room.totalQuestions, decider: room.decider === true };
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
  // The final round (the one that decides the game) scores double, so a trailing
  // player can still swing it. `doubled` rides the reveal so clients can badge it.
  const doubled = isFinalRound(room.questionIndex, room.totalQuestions);
  // Score itemised, then project to totals. The reveal carries both: `points`
  // for the seat arithmetic and every client that only wants the number, and
  // `breakdown` so the break's chips can say what earned each point instead of
  // inferring it from the total (undecidable now that the solo bonus and the
  // first speed bonus are both 5).
  const awards = scoreQuestionDetailed(room.buzzes, {
    applySpeedBonus: room.seats.size > 1,
    multiplier: doubled ? FINAL_ROUND_MULTIPLIER : 1,
  });
  /** @type {Record<string, number>} */
  const points = {};
  /** @type {Record<string, { base: number, speed: number, solo: number }>} */
  const breakdown = {};
  for (const [pid, award] of Object.entries(awards)) {
    points[pid] = award.total;
    breakdown[pid] = { base: award.base, speed: award.speed, solo: award.solo };
  }
  const seats = new Map();
  for (const [pid, seat] of room.seats) {
    seats.set(pid, { ...seat, score: seat.score + (points[pid] ?? 0) });
  }
  const nextRoom = { ...room, phase: /** @type {Phase} */ ('reveal'), seats };
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
        picks,
        points,
        breakdown,
        doubled,
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
    out.push({ playerId, nickname: seat.nickname, score: seat.score, present: room.present.has(playerId) });
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
 * @param {Room} room
 * @returns {Broadcast}
 */
function questionBroadcast(room) {
  const q = room.question;
  const pub = q ? publicQuestion(q) : { prompt: '', options: [] };
  return {
    to: 'all',
    message: { type: 'question', ...pub, questionIndex: room.questionIndex, totalQuestions: room.totalQuestions, tricky: room.tricky },
  };
}

/**
 * Full resume snapshot for one player — enough to paint whatever phase the
 * room is in when they (re)connect.
 * @param {Room} room
 * @param {string} playerId
 * @returns {Broadcast}
 */
function welcomeBroadcast(room, playerId) {
  return {
    to: playerId,
    message: {
      type: 'welcome',
      you: playerId,
      isHost: room.hostId === playerId,
      phase: room.phase,
      questionIndex: room.questionIndex,
      totalQuestions: room.totalQuestions,
      tricky: room.tricky,
      roster: rosterList(room),
      question: room.question ? publicQuestion(room.question) : null,
      scoreboard: scoreboardOf(room),
      // Draft: a reconnect mid-pick needs the current picker to paint the pick
      // screen. `youPick` is server-authoritative (this seat vs the picker), and
      // the hand is sent only to the picker (never leaked to a watcher). All null
      // / false in a non-draft or non-picking room.
      picker: room.picker,
      youPick: room.phase === 'picking' && room.picker === playerId,
      hand: (room.phase === 'picking' && room.picker === playerId) ? room.hand : null,
      decider: room.phase === 'picking' && room.decider === true,
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
    questionIndex: room.questionIndex,
    tricky: room.tricky,
    reveal: room.reveal,
    question: room.question,
    buzzes: room.buzzes,
    draft: room.draft,
    targetRounds: room.targetRounds,
    pickedBy: room.pickedBy,
    picker: room.picker,
    hand: room.hand,
    decider: room.decider,
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
    seats: new Map(snapshot.seats ?? []),
    present: new Set(),
    totalQuestions: snapshot.totalQuestions ?? DEFAULT_QUESTIONS,
    plan: snapshot.plan ?? null,
    questionIndex: snapshot.questionIndex ?? 0,
    tricky: snapshot.tricky ?? false,
    reveal: snapshot.reveal ?? null,
    question: snapshot.question ?? null,
    buzzes: snapshot.buzzes ?? [],
    draft: snapshot.draft ?? false,
    targetRounds: snapshot.targetRounds ?? 0,
    pickedBy: snapshot.pickedBy ?? [],
    picker: snapshot.picker ?? null,
    hand: snapshot.hand ?? null,
    decider: snapshot.decider ?? false,
  };
}
