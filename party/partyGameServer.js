import rawCountries from '../flags/countries.json' with { type: 'json' };
import { loadCountries } from '../flags/group.js';
import { sovereignPool, nonSovereignPool } from '../flags/flagPools.js';
import { DEFAULT_PLAN, totalQuestions, poolIdAt, questionIdAt, PARTY_MODES, ROUND_QUESTIONS } from '../flags/partyPlan.js';
import { DEFAULT_REVEAL, revealCategoryFor } from '../flags/partyTiming.js';
import { roundCountFor, validateGameLength, pickerFor, handFor, isValidPick, canVeilMode, resolveFamilyPick, usedIdForMode, OPENING_MODE_ID, isDeciderPick, deciderPickerFor, eligiblePickers } from '../flags/partyDraft.js';
import {
  createRoom,
  applyHello,
  applyStart,
  canStart,
  applyBuzz,
  applyForceReveal,
  applyHold,
  applyNext,
  applyPlayAgain,
  applyReturnToLobby,
  applyDisconnect,
  pendingPickAfterReveal,
  applyEnterPicking,
  applyRepick,
  applySetLength,
  applyPick,
  serializeRoom,
  deserializeRoom,
} from '../flags/partyRoom.js';
import * as flagPick from '../flags/partyQuestions/flagPick.js';
import * as mapPick from '../flags/partyQuestions/mapPick.js';
import * as superlative from '../flags/partyQuestions/superlative.js';

/** @typedef {import('../flags/partyRoom.js').Room} Room */
/** @typedef {import('../flags/partyRoom.js').Broadcast} Broadcast */

const STORAGE_KEY = 'room';

/** Flag pools by the plan's poolId — sovereign for the first segment, non-sovereign for the second. */
const ALL_COUNTRIES = loadCountries(rawCountries);
/** @type {Record<string, ReturnType<typeof sovereignPool>>} */
const POOLS = {
  sovereign: sovereignPool(ALL_COUNTRIES),
  nonSovereign: nonSovereignPool(ALL_COUNTRIES),
};

/**
 * Question-type registry, keyed by each module's own `id` so the registry key can
 * never drift from the plan's `questionId`. Adding a mode = one import + one entry.
 * @type {Record<string, { generate: Function, isCorrect: Function }>}
 */
const QUESTIONS = Object.fromEntries([flagPick, mapPick, superlative, superlative.areaQuestion, superlative.densityQuestion, superlative.gdpQuestion, superlative.gdpPerCapitaQuestion, superlative.coffeeQuestion, superlative.wineQuestion, superlative.cocoaQuestion, superlative.bananaQuestion, superlative.appleQuestion, superlative.elevationQuestion, superlative.coastlineQuestion, superlative.forestQuestion, superlative.oilQuestion, superlative.riceQuestion, superlative.coalQuestion, superlative.sheepPerCapitaQuestion, superlative.cattlePerCapitaQuestion, superlative.beerPerCapitaQuestion, superlative.teaQuestion, superlative.sugarcaneQuestion, superlative.goldQuestion, superlative.alcoholPerCapitaQuestion, superlative.meatPerCapitaQuestion, superlative.bordersQuestion, superlative.oliveOilQuestion, superlative.honeyQuestion, superlative.temperatureQuestion, superlative.happinessQuestion, superlative.corruptionQuestion, superlative.tourismPerCapitaQuestion, superlative.electricityPerCapitaQuestion, superlative.mcdonaldsPerMillionQuestion, superlative.nobelQuestion, superlative.nobelPerCapitaQuestion, superlative.summerMedalsQuestion, superlative.summerMedalsPerCapitaQuestion, superlative.winterMedalsQuestion, superlative.winterMedalsPerCapitaQuestion].map((m) => [m.id, m]));

const TOTAL_QUESTIONS = totalQuestions(DEFAULT_PLAN);

/** Mode id -> catalog mode ({ poolId, questionId }), so a draft pick (a mode id off
 *  the wire) resolves to the round segment + question type to generate. */
const MODE_BY_ID = Object.fromEntries(PARTY_MODES.map((m) => [m.id, m]));

/** Reverse lookup: a segment's (questionId, poolId) -> its mode id. Every catalog
 *  mode has a unique pair, so this recovers the mode a plan segment came from
 *  (used to rebuild `usedModes` after an eviction). */
const MODE_ID_BY_SEG = Object.fromEntries(PARTY_MODES.map((m) => [`${m.questionId}|${m.poolId}`, m.id]));
/** @param {{ questionId: string, poolId: string }} seg @returns {string | undefined} */
function modeIdForSegment(seg) {
  return MODE_ID_BY_SEG[`${seg.questionId}|${seg.poolId}`];
}

/** The opening round every draft plays: one Flags round (see `partyDraft`). */
const OPENING_MODE = MODE_BY_ID[OPENING_MODE_ID];

/**
 * Flag Party durable object — the live show's room. Thin shell around the pure
 * reducer in `flags/partyRoom.js`: it owns sockets, persistence, and the two
 * question-specific facts the room stays agnostic about — which question to hand
 * out (via the question's `generate`) and whether a buzz was correct (via the
 * question's `isCorrect`). Everything else is a reducer call + dispatch, mirroring
 * `party/ticTacToeServer.js`.
 *
 * Identity: clients pass a stable `?pid=` (persisted client-side) so refreshes
 * keep their seat, a `?nick=` display name, and `?intent=create` when opening a
 * freshly minted room code (omitted / `join` otherwise).
 */
export default class PartyGameServer {
  /** @param {any} party */
  constructor(party) {
    this.party = party;
    /** @type {Room | null} */
    this.room = null;
    this.loaded = false;
    /** @type {Map<any, string>} conn -> playerId */
    this.playerByConn = new Map();
    /** @type {Map<string, any>} playerId -> conn */
    this.connByPlayer = new Map();
    /** Answer codes used in the current game, so questions don't repeat a country. */
    this.usedCodes = new Set();
    /** Mode ids already played this game (draft mode), so the pick hand and the
     *  no-repeat clause never offer a mode twice. */
    this.usedModes = new Set();
  }

  /**
   * Generate the question for a question: the plan picks the question type (flag-pick
   * vs map) and the pool (sovereign vs non-sovereign); the question module builds
   * the question, avoiding countries already used this game. The question is
   * stamped with its `questionId` so the room and clients know how to render and
   * judge it. Records the answer as used.
   *
   * The plan and reveal config are the host's chosen ones (passed explicitly at
   * start, before they're stored on the room), otherwise the room's stored ones,
   * otherwise the built-in defaults. Reading them from the room keeps generation
   * correct after a durable-object eviction mid-game. The question is stamped with
   * `clearFrac` — the veil timing for its category — so a tricky-mode client
   * clears the tile on schedule.
   * @param {number} questionIndex
   * @param {import('../flags/partyPlan.js').Segment[]} [plan]
   * @param {import('../flags/partyRoom.js').Room['reveal']} [reveal]
   */
  generateQuestion(questionIndex, plan, reveal) {
    const p = plan ?? (this.room && this.room.plan) ?? DEFAULT_PLAN;
    return this.generateForQuestion(questionIdAt(p, questionIndex), poolIdAt(p, questionIndex), reveal);
  }

  /**
   * Generate a question for an explicit question type + pool, independent of the
   * plan. Shared by {@link generateQuestion} (plan-driven) and the draft pick
   * path (mode-driven, where the round isn't in the plan yet). Stamps `questionId`,
   * the veil `clearFrac`, and records the
   * answer as used.
   * @param {string} questionId
   * @param {string} poolId
   * @param {import('../flags/partyRoom.js').Room['reveal']} [reveal]
   */
  generateForQuestion(questionId, poolId, reveal) {
    const rev = reveal ?? (this.room && this.room.reveal) ?? DEFAULT_REVEAL;
    const question = QUESTIONS[questionId];
    const pool = POOLS[poolId];
    const q = question.generate(pool, this.usedCodes);
    this.usedCodes.add(q.answer);
    // World-facts (metric) questions carry the name-reveal fraction so clients fade
    // the country names on at the host's chosen point; other questions never do (flag
    // / outline recognition is the whole point there). The metric name-reveal
    // needs no stamp: it fires at a fixed NAME_REVEAL_SECONDS, and whether a
    // question gets names at all is derivable client-side from its questionId.
    return { ...q, questionId, clearFrac: rev[revealCategoryFor(questionId)] };
  }

  async onStart() {
    await this.loadRoom();
  }

  async loadRoom() {
    if (this.loaded) return;
    const snapshot = await this.party.storage.get(STORAGE_KEY);
    if (snapshot) {
      this.room = deserializeRoom(snapshot);
      // usedModes lives only in memory, so a durable-object eviction mid-draft
      // loses it — rebuild from the persisted plan (each round is one mode) so a
      // later hand can't offer a mode already played.
      if (this.room.draft && Array.isArray(this.room.plan)) {
        for (const seg of this.room.plan) {
          const id = modeIdForSegment(seg);
          // Through `usedIdForMode`, exactly as the live pick path records it: the
          // plan stores the RESOLVED member ('superlative-gdppc'), but what was
          // consumed is its family ('economy'). Recording the member here would
          // re-offer the Economy card after an eviction and let one game ask about
          // GDP twice.
          if (id) this.usedModes.add(usedIdForMode(id));
        }
      }
    }
    this.loaded = true;
  }

  /** The room's scoreboard as a plain descending-by-score list — the shape
   *  `pickerFor` reads to choose the draft's next picker. */
  scoreboard() {
    if (!this.room) return [];
    return [...this.room.seats.entries()]
      .map(([playerId, seat]) => ({ playerId, score: seat.score }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Who should be holding the pick right now. Both picker rules run over the
   * seats actually in the room (`eligiblePickers`), so a player who has left is
   * never handed a turn they cannot take — see that helper for why absent seats
   * are exactly the ones both rules would otherwise aim at.
   *
   * One method, used both when the pick opens and when the picker leaves
   * mid-pick, so the rule that chose the original seat is the rule that chooses
   * the replacement.
   *
   * @param {boolean} decider  whether this pick is for the closing Decider round
   * @returns {string | null}
   */
  choosePicker(decider) {
    if (!this.room) return null;
    const board = eligiblePickers(this.scoreboard(), this.room.present);
    return decider ? deciderPickerFor(board) : pickerFor(board, this.room.pickedBy);
  }

  async saveRoom() {
    if (!this.room) return;
    await this.party.storage.put(STORAGE_KEY, serializeRoom(this.room));
  }

  /**
   * @param {any} conn
   * @param {{ request: { url: string } }} ctx
   */
  async onConnect(conn, ctx) {
    try {
      await this.loadRoom();
      const url = new URL(ctx.request.url, 'http://localhost');
      const playerId = url.searchParams.get('pid');
      const nickname = url.searchParams.get('nick') || '';
      const intent = url.searchParams.get('intent') === 'create' ? 'create' : 'join';

      if (!playerId) {
        this.rejectConnection(conn, 'missing-player-id');
        return;
      }

      if (this.room === null) {
        if (intent !== 'create') {
          this.rejectConnection(conn, 'room-not-found');
          return;
        }
        this.room = createRoom(TOTAL_QUESTIONS, DEFAULT_PLAN);
      } else if (intent === 'create' && !this.room.seats.has(playerId)) {
        this.rejectConnection(conn, 'code-collision');
        return;
      }

      this.playerByConn.set(conn, playerId);
      this.connByPlayer.set(playerId, conn);

      const result = applyHello(this.room, playerId, nickname);
      this.room = result.room;
      await this.saveRoom();
      this.dispatch(result.broadcasts);
      if (result.rejectConnection) {
        try { conn.close(); } catch {}
        this.playerByConn.delete(conn);
        this.connByPlayer.delete(playerId);
      }
    } catch (err) {
      console.error('[partyGameServer] onConnect failed:', err);
      try { conn.close(); } catch {}
    }
  }

  /**
   * @param {any} conn
   * @param {string} reason
   */
  rejectConnection(conn, reason) {
    try { conn.send(JSON.stringify({ type: 'rejected', reason })); } catch {}
    try { conn.close(); } catch {}
  }

  /**
   * @param {string} message
   * @param {any} sender
   */
  async onMessage(message, sender) {
    try {
      if (!this.room) return;
      const playerId = this.playerByConn.get(sender);
      if (!playerId) return;
      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      if (!parsed || typeof parsed.type !== 'string') return;

      /** @type {import('../flags/partyRoom.js').ApplyResult | null} */
      let result = null;
      switch (parsed.type) {
        case 'start': {
          // Ask before touching anything. Clearing the no-repeat sets and
          // generating question 0 are real side effects, and applyStart's refusal
          // comes too late to undo them: a guest (or a stale tab re-sending its
          // lobby Start) would leave the running game with no memory of the
          // countries and modes it had already used. `canStart` is the same three
          // conditions the reducer applies.
          if (!canStart(this.room, playerId)) break;
          this.usedCodes = new Set();
          this.usedModes = new Set();
          // Draft is the only way a game starts. The plan grows one round per
          // pick: open with a single Flags round, then run one round per pick,
          // with that opener and the closing Decider bookending the draft.
          // Question 0 comes from the opening round.
          //
          // The host sends a LENGTH ('short' / 'medium' / 'long'), not a pick
          // count: `roundCountFor` reads the round total off a table and the
          // picks are what falls out. The other way round — which is what the
          // retired `picks` field did — meant the same setting bought a 7-minute
          // game at two seats and a 45-minute one at ten.
          //
          // The host's "Custom setup" door (a plan + a tricky toggle + per-category
          // reveal timing riding on this message) was retired. Tricky is now a
          // per-round choice the picker arms (`segment.veil`), not a game-wide
          // host flag, so start always applies false and lets the pick set it.
          // Reveal timing is the fixed DEFAULT_REVEAL constant.
          // The length is room state now, set from the lobby and seen by every
          // player. `parsed.length` is still honoured as a fallback for one
          // deploy cycle: PartyKit and the SWA site ship on separate workflows,
          // so a client that predates `setLength` can still reach this server and
          // would otherwise silently get a medium game whatever it chose.
          const length = validateGameLength(this.room.length ?? parsed.length);
          const targetRounds = roundCountFor(this.room.present.size, length);
          const openingPlan = [{ poolId: OPENING_MODE.poolId, questionId: OPENING_MODE.questionId, questions: ROUND_QUESTIONS }];
          this.usedModes.add(OPENING_MODE_ID);
          const question = this.generateForQuestion(OPENING_MODE.questionId, OPENING_MODE.poolId, DEFAULT_REVEAL);
          result = applyStart(this.room, playerId, question, openingPlan, targetRounds * ROUND_QUESTIONS, false, DEFAULT_REVEAL, { draft: true, targetRounds });
          break;
        }
        case 'setLength': {
          // Validated in the reducer (which also owns the host and phase
          // guards), so the raw value goes straight through.
          result = applySetLength(this.room, playerId, parsed.length);
          break;
        }
        case 'buzz': {
          const choice = String(parsed.choice ?? '');
          const q = this.room.question;
          const question = q ? QUESTIONS[q.questionId] : null;
          const correct = q && question ? question.isCorrect(q, choice) : false;
          result = applyBuzz(this.room, playerId, choice, correct);
          break;
        }
        case 'reveal':
          result = applyForceReveal(this.room, playerId);
          break;
        case 'hold':
          // Any seat can freeze the reveal's countdown while it reads the chart.
          // Pure relay — the reducer keeps no hold state, and the clients' own
          // cap (partyTiming.MAX_HOLD_SECONDS) bounds a hold that never ends, so
          // the server has nothing to expire and nothing to clean up on a drop.
          result = applyHold(this.room, playerId, parsed.on === true);
          break;
        case 'next': {
          // In a draft, a `next` that lands on a round boundary opens a pick
          // instead of dealing the next question: the lowest-ranked seat that
          // hasn't picked chooses the next round from a dealt hand. Otherwise
          // it advances the question or ends the game.
          //
          // The LAST boundary is different: it opens **the Decider**, the closing
          // double-points act, which sits outside the rotation and goes to
          // whoever is in last place right now — pick history and all. The
          // rotation's tie-break would hand this exact round to the leader 85% of
          // the time (see PARTY.md Iteration 12), which is the one thing here a
          // player could call unfair.
          const pending = pendingPickAfterReveal(this.room);
          const decider = pending && isDeciderPick(this.room.questionIndex, this.room.totalQuestions);
          const picker = pending ? this.choosePicker(decider) : null;
          if (picker) {
            result = applyEnterPicking(this.room, playerId, picker, handFor(this.usedModes), decider);
          } else {
            // Not a pick boundary, or (defensively) no eligible picker — the
            // round-count formula guarantees one, but never freeze the room on a
            // null picker: fall through to the ordinary advance / final board.
            result = applyNext(this.room, playerId, this.generateQuestion(this.room.questionIndex + 1));
          }
          break;
        }
        case 'pick': {
          // The designated picker chooses their round. Guard the phase + picker
          // here so a stale / spoofed pick never generates a question, then
          // validate the mode against the no-repeat set before building its round.
          if (this.room.phase !== 'picking' || this.room.picker !== playerId) return;
          const cardId = String(parsed.modeId ?? '');
          if (!isValidPick(cardId, this.usedModes)) return;
          // A card is a metric FAMILY, and a family with more than one member
          // (today: `economy`) resolves to one of them here, at deal time. The
          // player chose the subject; which cut of it they get is the round's
          // reveal, the same way the 'most' / 'least' direction already is.
          const modeId = resolveFamilyPick(cardId);
          if (!modeId) return;
          const mode = MODE_BY_ID[modeId];
          // The picker may veil their own round, but only on a mode where the
          // veil does anything — `canVeilMode` is the same rule the pick card
          // shows the chip by, re-checked here because the client's is advisory.
          // Note this is a per-round choice made in the moment; it is NOT the
          // Custom-setup tricky toggle, which draft still forces off at start.
          const veil = parsed.veil === true && canVeilMode(modeId);
          const segment = { poolId: mode.poolId, questionId: mode.questionId, questions: ROUND_QUESTIONS, ...(veil ? { veil: true } : {}) };
          const question = this.generateForQuestion(mode.questionId, mode.poolId);
          // Attribution carries the RESOLVED mode, so the round title card and the
          // "Zosia's pick" pill name the statistic actually being played rather
          // than the family the picker tapped.
          result = applyPick(this.room, playerId, modeId, segment, question);
          if (result.broadcasts.length > 0) this.usedModes.add(usedIdForMode(modeId));
          break;
        }
        case 'forcePick': {
          // The picker's clock ran out (the host page fires this, authoritative
          // for timing like `reveal`/`next`). Pick a random card from the dealt
          // hand for the current picker so an idle / absent picker can't stall.
          if (this.room.phase !== 'picking' || this.room.hostId !== playerId) return;
          const picker = this.room.picker;
          const hand = (this.room.hand ?? []).filter((id) => isValidPick(id, this.usedModes));
          if (!picker || hand.length === 0) return;
          const cardId = hand[Math.floor(Math.random() * hand.length)];
          const modeId = resolveFamilyPick(cardId);
          if (!modeId) return;
          const mode = MODE_BY_ID[modeId];
          // No veil on a forced pick: the veil is a deliberate bet by the picker,
          // and an idle picker never placed it.
          const segment = { poolId: mode.poolId, questionId: mode.questionId, questions: ROUND_QUESTIONS };
          const question = this.generateForQuestion(mode.questionId, mode.poolId);
          result = applyPick(this.room, picker, modeId, segment, question);
          if (result.broadcasts.length > 0) this.usedModes.add(usedIdForMode(modeId));
          break;
        }
        case 'playAgain':
          this.usedCodes = new Set();
          this.usedModes = new Set();
          result = applyPlayAgain(this.room, playerId);
          break;
        case 'backToLobby':
          // Host bails on the current game and returns the room to settings.
          // Fresh code pool, same as a play-again reset.
          this.usedCodes = new Set();
          this.usedModes = new Set();
          result = applyReturnToLobby(this.room, playerId);
          break;
        default:
          return;
      }
      if (!result || result.broadcasts.length === 0) {
        // Reducer ignored the event (wrong phase / not host / etc.) — still
        // persist in case room identity was just created, but nothing to send.
        if (result) this.room = result.room;
        return;
      }
      this.room = result.room;
      await this.saveRoom();
      this.dispatch(result.broadcasts);
    } catch (err) {
      console.error('[partyGameServer] onMessage failed:', err);
    }
  }

  /** @param {any} conn */
  async onClose(conn) {
    try {
      if (!this.room) return;
      const playerId = this.playerByConn.get(conn);
      if (!playerId) return;
      this.playerByConn.delete(conn);
      if (this.connByPlayer.get(playerId) === conn) {
        this.connByPlayer.delete(playerId);
      }
      const result = applyDisconnect(this.room, playerId);
      this.room = result.room;
      /** @type {Array<{ to: string | 'all', message: object }>} */
      const broadcasts = [...result.broadcasts];
      // If the seat that just left was the one holding a pick, hand the turn to
      // whoever is still here rather than waiting out the host's anti-stall
      // timer. Re-run the SAME rule that opened this pick — `room.decider` says
      // which one that was — so the replacement is chosen the way the original
      // was.
      if (this.room.phase === 'picking' && this.room.picker === playerId) {
        const repick = applyRepick(this.room, this.choosePicker(this.room.decider === true));
        this.room = repick.room;
        broadcasts.push(...repick.broadcasts);
      }
      await this.saveRoom();
      this.dispatch(broadcasts);
    } catch (err) {
      console.error('[partyGameServer] onClose failed:', err);
    }
  }

  /** @param {Broadcast[]} broadcasts */
  dispatch(broadcasts) {
    for (const bc of broadcasts) {
      const payload = JSON.stringify(bc.message);
      if (bc.to === 'all') {
        for (const c of this.party.getConnections()) c.send(payload);
      } else {
        const c = this.connByPlayer.get(bc.to);
        if (c) c.send(payload);
      }
    }
  }
}
