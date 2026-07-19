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
 * @typedef {{ playerId: string, nickname: string, score: number, present: boolean, kid?: boolean }} RosterEntry
 *
 * `easy` is kid mode: the two wrong options this device must disable, leaving a
 * 50/50. Server-chosen (only it knows the answer) and sent only to a seat the
 * host marked as a kid, so its absence is the normal case. It rides inside the
 * question on both the `question` and `welcome` messages, so there is one place
 * to read it from regardless of which one arrived.
 *
 * @typedef {{ prompt: string, options: string[], questionId?: string, clearFrac?: number,
 *   easy?: string[] | null }} PublicQuestion
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
 * @property {PublicQuestion | null} question
 * @property {number} buzzedCount
 * @property {number} seatCount
 * @property {string | null} myChoice
 * @property {{ answer: string, picks: Record<string, string>, points: Record<string, number>,
 *   breakdown?: Record<string, { base: number, speed: number, solo: number, closeness: number }>,
 *   ranking?: string[] | null, values?: Record<string, number> | null } | null} reveal
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
    question: null,
    buzzedCount: 0,
    seatCount: 0,
    myChoice: null,
    reveal: null,
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
            easy: Array.isArray(message.easy) ? message.easy : null,
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
  // Kid mode: the two options the server disabled are not pickable. Enforced
  // here rather than only by rendering them as un-clickable divs, so a stray
  // keyboard / assistive-tech activation can't buzz a tile that is visibly out.
  if (isDisabledOption(state, choice)) return state;
  return { ...state, myChoice: choice };
}

/**
 * The options this player's grid should draw.
 *
 * For a grown-up, and for every reveal, that is simply the question's four.
 * For a kid mid-question it is the two live ones: their dead pair is **removed**
 * rather than greyed out.
 *
 * Removal, not dimming, because dimming did not survive tricky mode. `.opt.dim`
 * is `opacity: .42`, and a veiled tile is already greyed, blurred and covered by
 * the reveal panels, so a disabled tile read as "slightly fainter mush" and the
 * handicap was invisible exactly when the round was hardest. Rendering two tiles
 * is also the literal 50/50 instead of one the player has to infer, which is the
 * point for the small child this exists for.
 *
 * The reveal deliberately shows all four again, so a kid sees the whole board
 * they were shielded from, including the two they never had.
 *
 * @param {PartyClientState} state
 * @param {boolean} isReveal
 * @returns {string[]}
 */
export function visibleOptions(state, isReveal) {
  const options = state.question ? state.question.options : [];
  if (isReveal) return options.slice();
  return options.filter((code) => !isDisabledOption(state, code));
}

/**
 * Whether an option is greyed out for this player — kid mode's half of the
 * board. Always false for a grown-up (no `easy` on their question) and for
 * every option once the question is over.
 *
 * @param {PartyClientState} state
 * @param {string} code
 * @returns {boolean}
 */
export function isDisabledOption(state, code) {
  const easy = state.question ? state.question.easy : null;
  return Array.isArray(easy) && easy.includes(code);
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
