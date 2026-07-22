/**
 * Client-side state for a Flag Party player. Pure reducer over the messages the
 * server broadcasts (`flags/partyRoom.js` produces them), same shape as the TTT
 * `reduceServerMessage`: state on the left, side effects on the right, so the
 * page (`flagParty/page.js`) stays thin DOM glue and this stays unit-testable.
 *
 * The server is authoritative for the shared game; this only tracks what one
 * player's screen needs to render, plus `myChoice` — the option this device
 * tapped, which is local until reveal (the server never echoes picks early).
 *
 * @typedef {'connecting' | 'lobby' | 'question' | 'reveal' | 'picking' | 'final'} Phase
 * @typedef {{ playerId: string, nickname: string, score: number, present: boolean, bot?: boolean, skill?: string }} RosterEntry
 *   `bot` / `skill` are present only on bot seats (server-driven, see
 *   `flags/partyBot.js`); the page badges the chip and offers the host a remove.
 * @typedef {{ prompt: string, options: string[], questionId?: string, clearFrac?: number }} PublicQuestion
 * @typedef {{ key: string, fallback: string, params?: Record<string, string> }} StatusOverride
 *
 * @typedef {Object} PartyClientState
 * @property {Phase} phase
 * @property {string | null} you
 * @property {boolean} isHost
 * @property {RosterEntry[]} roster
 * @property {number} totalQuestions
 * @property {number} questionIndex
 * @property {boolean} tricky  host's tricky-mode choice, learned from the server;
 *   when true the page veils each question tile and clears it over the clock.
 * @property {string} firstPick  the host's chosen first round (a picture mode id),
 *   learned the same way as `length` and painted by every seat. Defaults to the
 *   Flags firstPick that was fixed before the host could choose, so a client talking
 *   to a server that never sends it behaves exactly as it used to.
 * @property {boolean} firstPickVeil  whether the host armed the veil on the first
 *   round, painted beside the first pick control (host toggles it, guests see it).
 *   Defaults off, and an older server never sends it, so it simply stays off.
 * @property {string} length  the host's game-length choice, learned from the
 *   server. Every seat renders it in the lobby — the host as a control, everyone
 *   else read-only — so a guest can see what they are in for before it starts.
 * @property {PublicQuestion | null} question
 * @property {number} buzzedCount
 * @property {number} seatCount
 * @property {string | null} myChoice
 * @property {{ answer: string, picks: Record<string, string>, points: Record<string, number>,
 *   breakdown?: Record<string, { base: number, speed: number, solo: number, closeness: number, fastest?: boolean }>,
 *   ranking?: string[] | null, values?: Record<string, number> | null } | null} reveal
 * @property {string[]} holders  seats currently pressing "hold to read" on the
 *   chart reveal, freezing everyone's countdown. A set rather than a boolean so
 *   two players holding at once resume the clock only when BOTH let go, and so
 *   the page can name who the room is waiting for. Always emptied when the phase
 *   changes: holds belong to one reveal and never carry into the next.
 * @property {Array<{ playerId: string, nickname: string, score: number }> | null} scoreboard
 * @property {string | null} picker  during the `picking` phase (draft mode), the
 *   seat whose turn it is to choose the next round; null otherwise.
 * @property {boolean} youPick  whether THIS client is the picker — set
 *   server-authoritatively (not re-derived from `you === picker`), so a stale
 *   identity can't make the picker miss their own hand. False off the pick phase.
 * @property {string[] | null} hand  during `picking`, the mode ids the picker may
 *   choose from; null otherwise (and never sent to a watcher).
 * @property {boolean} decider  during `picking`, whether the round being chosen is
 *   **the Decider** — the closing double-points act, picked by last place from
 *   outside the rotation. Server-set and sent to watchers too (unlike the hand):
 *   naming the closing act is the point of it. False off the pick phase. The
 *   round card doesn't need this — once the round is playing it is simply the
 *   final round, which `isFinalRound` already answers from the question alone.
 * @property {{ picker: string, modeId: string } | null} lastPick  who picked the
 *   current round and which mode, for the "Zosia's pick" attribution; null in a
 *   non-drafted round.
 * @property {StatusOverride | null} statusOverride
 *
 * @typedef {{ type: 'close' }} Effect
 */

import { DEFAULT_GAME_LENGTH, DEFAULT_FIRST_PICK } from './partyDraft.js';

/** @returns {PartyClientState} */
export function initialPartyClientState() {
  return {
    phase: 'connecting',
    you: null,
    isHost: false,
    roster: [],
    totalQuestions: 0,
    questionIndex: 0,
    tricky: false,
    length: DEFAULT_GAME_LENGTH,
    firstPick: DEFAULT_FIRST_PICK,
    firstPickVeil: false,
    question: null,
    buzzedCount: 0,
    seatCount: 0,
    myChoice: null,
    reveal: null,
    holders: [],
    scoreboard: null,
    picker: null,
    youPick: false,
    hand: null,
    lastPick: null,
    decider: false,
    statusOverride: null,
  };
}

/**
 * @param {RosterEntry[]} roster
 * @returns {number}
 */
function presentCount(roster) {
  return roster.filter((r) => r.present).length;
}

/**
 * Reject reasons keyed by wire-protocol code → i18n key + English fallback.
 * Translation happens at paint time (the strings cache may not be loaded when
 * this module is imported), matching the TTT client's approach.
 *
 * @type {Record<string, { key: string, fallback: string }>}
 */
const REJECT_MESSAGES = {
  'room-not-found': { key: 'party.reject.roomNotFound', fallback: 'Room not found, ask for the code or create a new room' },
  'code-collision': { key: 'party.reject.codeCollision', fallback: 'That code is already taken, try creating a new one' },
  'in-progress': { key: 'party.reject.inProgress', fallback: 'That game has already started, wait for the next one' },
  'room-full': { key: 'party.reject.roomFull', fallback: 'That room is full, ask the host to start or create a new room' },
  'missing-player-id': { key: 'party.reject.missingPlayerId', fallback: 'Connection error, please reload the page' },
};

/**
 * @param {PartyClientState} state
 * @param {any} message
 * @returns {{ state: PartyClientState, effects: Effect[] }}
 */
export function reducePartyMessage(state, message) {
  const next = reduceOne(state, message);
  // Holds belong to the reveal they were pressed on. Clearing them here, on any
  // phase change, rather than in each of the six cases that can move the phase,
  // means a hold cannot survive into the next question however the room got
  // there -- including the paths nobody thinks about, like the last question's
  // reveal jumping straight to the final board while a finger is still down.
  //
  // The SERVER enforces the same rule over its own holders set
  // (`party/partyGameServer.js`, on any phase change). Two copies because they
  // guard different things -- this one keeps a client's clock from staying
  // frozen, that one keeps a departed seat from earning a phantom release -- but
  // they must agree on WHEN a hold dies. Change one, change the other.
  if (next.state.phase !== state.phase && next.state.holders.length > 0) {
    return { ...next, state: { ...next.state, holders: [] } };
  }
  return next;
}

/**
 * @param {PartyClientState} state
 * @param {any} message
 * @returns {{ state: PartyClientState, effects: Effect[] }}
 */
function reduceOne(state, message) {
  switch (message.type) {
    case 'welcome': {
      return {
        state: {
          ...state,
          you: message.you,
          isHost: !!message.isHost,
          phase: message.phase,
          roster: message.roster ?? [],
          totalQuestions: message.totalQuestions ?? state.totalQuestions,
          questionIndex: message.questionIndex ?? 0,
          tricky: message.tricky ?? state.tricky,
          // `?? state.length` rather than a default: an older server omits the
          // field entirely, and falling back to the default would stamp 'medium'
          // over whatever the host had already told us.
          length: message.length ?? state.length,
          firstPick: message.firstPick ?? state.firstPick,
          firstPickVeil: message.firstPickVeil ?? state.firstPickVeil,
          question: message.question ?? null,
          scoreboard: message.scoreboard ?? null,
          // A reconnect mid-pick resumes the draft turn (picker + hand ride the
          // welcome); otherwise these are null. `youPick` is server-authoritative,
          // with the same old-server fallback as the `picking` case.
          picker: message.picker ?? null,
          youPick: message.youPick !== undefined
            ? message.youPick === true
            : (message.you != null && message.you === message.picker),
          hand: message.hand ?? null,
          decider: message.decider === true,
          // A reconnect can't recover whether we already buzzed this question;
          // treat as fresh — the server ignores a duplicate buzz anyway.
          myChoice: null,
          reveal: null,
        },
        effects: [],
      };
    }
    case 'roster': {
      return {
        state: {
          ...state,
          roster: message.roster ?? state.roster,
          isHost: message.hostId != null ? message.hostId === state.you : state.isHost,
        },
        effects: [],
      };
    }
    case 'settings': {
      // The host changed a lobby setting -- `length` or `firstPick`, the two pieces
      // of room state that move while nobody is playing. Each falls back to what
      // we already hold, so a message naming only one does not blank the other.
      return {
        state: {
          ...state,
          length: message.length ?? state.length,
          firstPick: message.firstPick ?? state.firstPick,
          firstPickVeil: message.firstPickVeil ?? state.firstPickVeil,
        },
        effects: [],
      };
    }
    case 'lobby': {
      // Sent on Play again: back to the lobby with a clean slate.
      return {
        state: {
          ...state,
          phase: 'lobby',
          roster: message.roster ?? state.roster,
          length: message.length ?? state.length,
          firstPick: message.firstPick ?? state.firstPick,
          firstPickVeil: message.firstPickVeil ?? state.firstPickVeil,
          isHost: message.hostId != null ? message.hostId === state.you : state.isHost,
          question: null,
          reveal: null,
          scoreboard: null,
          myChoice: null,
          picker: null,
          youPick: false,
          hand: null,
          lastPick: null,
          decider: false,
        },
        effects: [],
      };
    }
    case 'picking': {
      // Draft: the room paused to let one seat choose the next round. `youPick`
      // is server-authoritative — the client shows the hand because the server
      // told it it's the picker, not because it matched its own id.
      return {
        state: {
          ...state,
          phase: 'picking',
          picker: message.picker ?? null,
          // Server-authoritative when present; fall back to the old id comparison
          // only for an older server that predates `youPick` (client and PartyKit
          // deploy independently, so they can be briefly out of sync).
          youPick: message.youPick !== undefined
            ? message.youPick === true
            : (state.you != null && state.you === message.picker),
          hand: Array.isArray(message.hand) ? message.hand : null,
          decider: message.decider === true,
          questionIndex: message.questionIndex ?? state.questionIndex,
          totalQuestions: message.totalQuestions ?? state.totalQuestions,
          reveal: null,
        },
        effects: [],
      };
    }
    case 'question': {
      return {
        state: {
          ...state,
          phase: 'question',
          question: {
            prompt: message.prompt,
            options: message.options ?? [],
            questionId: message.questionId,
            clearFrac: message.clearFrac,
          },
          questionIndex: message.questionIndex ?? state.questionIndex,
          totalQuestions: message.totalQuestions ?? state.totalQuestions,
          tricky: message.tricky ?? state.tricky,
          myChoice: null,
          reveal: null,
          buzzedCount: 0,
          seatCount: presentCount(state.roster),
          // The picking turn is over; a drafted round's first question carries who
          // picked it (for the attribution card), else this clears.
          picker: null,
          youPick: false,
          hand: null,
          decider: false,
          lastPick: message.draftPick ?? null,
        },
        effects: [],
      };
    }
    case 'buzzed': {
      return {
        state: {
          ...state,
          buzzedCount: message.buzzedCount ?? state.buzzedCount,
          seatCount: message.seatCount ?? state.seatCount,
        },
        effects: [],
      };
    }
    case 'reveal': {
      return {
        state: {
          ...state,
          phase: 'reveal',
          reveal: {
            answer: message.answer,
            picks: message.picks ?? {},
            points: message.points ?? {},
            // What earned each point, itemised server-side. Absent from a server
            // older than this build, in which case the break simply shows no
            // chips — the totals it counts up come from `scoreboard` either way.
            breakdown: message.breakdown ?? {},
            // World-facts questions only: the true order of the four options
            // (best-first in the question's direction, so index 0 is the
            // answer) and their raw values, for the ranked reveal chart.
            // Absent on every other question type and on any server older
            // than this build, in which case the reveal falls back to the
            // plain tile treatment rather than drawing an empty chart.
            ranking: Array.isArray(message.ranking) ? message.ranking : null,
            values: message.values && typeof message.values === 'object' ? message.values : null,
          },
          scoreboard: message.scoreboard ?? state.scoreboard,
          questionIndex: message.questionIndex ?? state.questionIndex,
          totalQuestions: message.totalQuestions ?? state.totalQuestions,
        },
        effects: [],
      };
    }
    case 'holding': {
      // Someone pressed or released "hold to read". Tracked as a set so the
      // clock resumes only when the LAST holder lets go, and so a repeated press
      // from the same seat (a jittery pointer, a duplicated message) cannot
      // stack up entries that a single release then fails to clear.
      const id = String(message.playerId ?? '');
      if (!id) return { state, effects: [] };
      const on = message.on === true;
      const has = state.holders.includes(id);
      if (on === has) return { state, effects: [] };
      const holders = on ? [...state.holders, id] : state.holders.filter((h) => h !== id);
      return { state: { ...state, holders }, effects: [] };
    }
    case 'final': {
      return {
        state: { ...state, phase: 'final', scoreboard: message.scoreboard ?? state.scoreboard },
        effects: [],
      };
    }
    case 'rejected': {
      const mapped = REJECT_MESSAGES[message.reason];
      /** @type {StatusOverride} */
      const statusOverride = mapped
        ? { key: mapped.key, fallback: mapped.fallback }
        : { key: 'party.reject.fallback', fallback: 'Rejected: {reason}', params: { reason: String(message.reason) } };
      return { state: { ...state, statusOverride }, effects: [{ type: 'close' }] };
    }
    default:
      return { state, effects: [] };
  }
}

/**
 * Record this device's tap locally. Ignored unless we're mid-question and
 * haven't already locked a pick — one buzz per question, first answer counts.
 *
 * @param {PartyClientState} state
 * @param {string} choice
 * @returns {PartyClientState}
 */
export function withLocalBuzz(state, choice) {
  if (state.phase !== 'question') return state;
  if (state.myChoice !== null) return state;
  if (!state.question || !state.question.options.includes(choice)) return state;
  return { ...state, myChoice: choice };
}

/**
 * Was the reveal a clean sweep — did every present player pick the correct
 * answer? Drives the reveal pace (see `flags/partyTiming.js`): a clean question has
 * nothing to study, so it snaps on; any wrong pick or a timeout (a present seat
 * with no matching pick) counts as a miss and holds longer, so players see the
 * flag they didn't land. Mirrors flagQuiz's correct-fast / wrong-slow feel.
 *
 * A no-answer is a miss: a seat that never buzzed has no entry in `picks`, so
 * the `=== answer` test fails for it and the question isn't clean. An empty room
 * (never happens mid-reveal — the host is present) is treated as not-clean.
 *
 * @param {RosterEntry[]} roster
 * @param {{ answer: string, picks: Record<string, string> } | null} reveal
 * @returns {boolean}
 */
export function isCleanReveal(roster, reveal) {
  if (!reveal) return false;
  const present = roster.filter((r) => r.present);
  if (present.length === 0) return false;
  return present.every((r) => reveal.picks[r.playerId] === reveal.answer);
}

/**
 * The mirror of {@link isCleanReveal}: did the question beat the whole room?
 *
 * Drives the reveal's "Nobody knew" beat — no points change hands, but a shared
 * groan is a party moment and it costs nothing to name. A timeout counts: a seat
 * that never buzzed didn't know it either, so a question nobody even answered is
 * the loudest version of this.
 *
 * Deliberately derived from the picks rather than the points, so it means "nobody
 * got it right" and not "nobody scored" — those are the same today, and would
 * quietly stop being the same if a question ever paid out on a wrong answer.
 *
 * Solo play is excluded: with one seat "nobody knew" is just "you were wrong",
 * which the reveal already says plainly, and naming it would read as the game
 * being smug at a lone player.
 *
 * @param {RosterEntry[]} roster
 * @param {{ answer: string, picks: Record<string, string> } | null} reveal
 * @returns {boolean}
 */
export function isBlankReveal(roster, reveal) {
  if (!reveal) return false;
  const present = roster.filter((r) => r.present);
  if (present.length < 2) return false;
  return present.every((r) => reveal.picks[r.playerId] !== reveal.answer);
}

/**
 * Order the reveal's per-player rows highest-first BY THIS QUESTION'S points, so
 * the reveal reads as "who nailed this one" — the biggest `+N` on top. The server
 * sends the scoreboard descending by cumulative total, which instead parks the
 * overall leader on top even on a question they scored nothing on, and leaves the
 * visible `+N` column jumbled.
 *
 * Ties break by cumulative score, then playerId, so the order is stable and
 * deterministic (a re-render can't reshuffle equal rows). Non-mutating.
 *
 * @param {Array<{ playerId: string, nickname: string, score: number }> | null} scoreboard
 * @param {Record<string, number> | null | undefined} points  this question's points, by playerId
 * @returns {Array<{ playerId: string, nickname: string, score: number }>}
 */
export function revealOrder(scoreboard, points) {
  const pts = points || {};
  return [...(scoreboard || [])].sort((a, b) => (
    (pts[b.playerId] || 0) - (pts[a.playerId] || 0)
    || b.score - a.score
    || a.playerId.localeCompare(b.playerId)
  ));
}

/**
 * Pick the finish-screen celebration tier for the LOCAL player on the Flag
 * Party final screen. The scoreboard is descending by score (index 0 is the
 * top scorer), matching how `renderFinal` reads it.
 *
 * - `fireworks` — you are the sole winner. Your big moment, so the rare-event
 *   tier (same split as Tic-Tac-Toe: the winner gets the loud one).
 * - `confetti`  — someone else won, or you're tied at the top. The party still
 *   ends on a high note for everyone; a tie has no single winner so nobody
 *   gets the solo fireworks.
 * - `none`      — no scoreboard, or a scoreless finish (top score 0). Matches
 *   `pickCelebration`'s "found nothing → celebrate nothing" rule.
 *
 * @param {{ scoreboard: Array<{ playerId: string, score: number }> | null, you: string | null }} params
 * @returns {'fireworks' | 'confetti' | 'none'}
 */
export function pickPartyCelebration({ scoreboard, you }) {
  if (!scoreboard || scoreboard.length === 0) return 'none';
  const top = scoreboard[0];
  if (!top || top.score <= 0) return 'none';
  const tie = scoreboard.length > 1 && scoreboard[1].score === top.score;
  if (!tie && you != null && top.playerId === you) return 'fireworks';
  return 'confetti';
}
