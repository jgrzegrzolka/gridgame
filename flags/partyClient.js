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
 * @typedef {{ playerId: string, nickname: string, score: number, present: boolean }} RosterEntry
 * @typedef {{ prompt: string, options: string[], roundId?: string, clearFrac?: number, nameFrac?: number }} PublicQuestion
 * @typedef {{ key: string, fallback: string, params?: Record<string, string> }} StatusOverride
 *
 * @typedef {Object} PartyClientState
 * @property {Phase} phase
 * @property {string | null} you
 * @property {boolean} isHost
 * @property {RosterEntry[]} roster
 * @property {number} totalRounds
 * @property {number} roundIndex
 * @property {boolean} tricky  host's tricky-mode choice, learned from the server;
 *   when true the page veils each question tile and clears it over the clock.
 * @property {PublicQuestion | null} question
 * @property {number} buzzedCount
 * @property {number} seatCount
 * @property {string | null} myChoice
 * @property {{ answer: string, picks: Record<string, string>, points: Record<string, number> } | null} reveal
 * @property {Array<{ playerId: string, nickname: string, score: number }> | null} scoreboard
 * @property {string | null} picker  during the `picking` phase (draft mode), the
 *   seat whose turn it is to choose the next block; null otherwise.
 * @property {string[] | null} hand  during `picking`, the mode ids the picker may
 *   choose from; null otherwise.
 * @property {{ picker: string, modeId: string } | null} lastPick  who picked the
 *   current block and which mode, for the "Zosia's pick" attribution; null in a
 *   non-drafted block.
 * @property {StatusOverride | null} statusOverride
 *
 * @typedef {{ type: 'close' }} Effect
 */

/** @returns {PartyClientState} */
export function initialPartyClientState() {
  return {
    phase: 'connecting',
    you: null,
    isHost: false,
    roster: [],
    totalRounds: 0,
    roundIndex: 0,
    tricky: false,
    question: null,
    buzzedCount: 0,
    seatCount: 0,
    myChoice: null,
    reveal: null,
    scoreboard: null,
    picker: null,
    hand: null,
    lastPick: null,
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
  switch (message.type) {
    case 'welcome': {
      return {
        state: {
          ...state,
          you: message.you,
          isHost: !!message.isHost,
          phase: message.phase,
          roster: message.roster ?? [],
          totalRounds: message.totalRounds ?? state.totalRounds,
          roundIndex: message.roundIndex ?? 0,
          tricky: message.tricky ?? state.tricky,
          question: message.question ?? null,
          scoreboard: message.scoreboard ?? null,
          // A reconnect mid-pick resumes the draft turn (picker + hand ride the
          // welcome); otherwise these are null.
          picker: message.picker ?? null,
          hand: message.hand ?? null,
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
    case 'lobby': {
      // Sent on Play again: back to the lobby with a clean slate.
      return {
        state: {
          ...state,
          phase: 'lobby',
          roster: message.roster ?? state.roster,
          isHost: message.hostId != null ? message.hostId === state.you : state.isHost,
          question: null,
          reveal: null,
          scoreboard: null,
          myChoice: null,
          picker: null,
          hand: null,
          lastPick: null,
        },
        effects: [],
      };
    }
    case 'picking': {
      // Draft: the room paused to let one seat choose the next block.
      return {
        state: {
          ...state,
          phase: 'picking',
          picker: message.picker ?? null,
          hand: Array.isArray(message.hand) ? message.hand : [],
          roundIndex: message.roundIndex ?? state.roundIndex,
          totalRounds: message.totalRounds ?? state.totalRounds,
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
          question: { prompt: message.prompt, options: message.options ?? [], roundId: message.roundId, clearFrac: message.clearFrac, nameFrac: message.nameFrac },
          roundIndex: message.roundIndex ?? state.roundIndex,
          totalRounds: message.totalRounds ?? state.totalRounds,
          tricky: message.tricky ?? state.tricky,
          myChoice: null,
          reveal: null,
          buzzedCount: 0,
          seatCount: presentCount(state.roster),
          // The picking turn is over; a drafted block's first question carries who
          // picked it (for the attribution card), else this clears.
          picker: null,
          hand: null,
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
          },
          scoreboard: message.scoreboard ?? state.scoreboard,
          roundIndex: message.roundIndex ?? state.roundIndex,
          totalRounds: message.totalRounds ?? state.totalRounds,
        },
        effects: [],
      };
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
 * answer? Drives the reveal pace (see `flags/partyTiming.js`): a clean round has
 * nothing to study, so it snaps on; any wrong pick or a timeout (a present seat
 * with no matching pick) counts as a miss and holds longer, so players see the
 * flag they didn't land. Mirrors flagQuiz's correct-fast / wrong-slow feel.
 *
 * A no-answer is a miss: a seat that never buzzed has no entry in `picks`, so
 * the `=== answer` test fails for it and the round isn't clean. An empty room
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
