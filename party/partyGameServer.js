import rawCountries from '../flags/countries.json' with { type: 'json' };
import { loadCountries } from '../flags/group.js';
import { sovereignPool, nonSovereignPool } from '../flags/flagPools.js';
import { DEFAULT_PLAN, totalRounds, poolIdForRound, roundIdForRound, validatePlan, PARTY_MODES, BLOCK_ROUNDS } from '../flags/partyPlan.js';
import { DEFAULT_REVEAL, revealCategoryFor, validateReveal, isMetricRound } from '../flags/partyTiming.js';
import { blockCountFor, pickerFor, handFor, isValidPick, OPENING_MODE_ID } from '../flags/partyDraft.js';
import {
  createRoom,
  applyHello,
  applyStart,
  applyBuzz,
  applyForceReveal,
  applyNext,
  applyPlayAgain,
  applyReturnToLobby,
  applyDisconnect,
  pendingPickAfterReveal,
  applyEnterPicking,
  applyPick,
  serializeRoom,
  deserializeRoom,
} from '../flags/partyRoom.js';
import * as flagPick from '../flags/partyRounds/flagPick.js';
import * as mapPick from '../flags/partyRounds/mapPick.js';
import * as superlative from '../flags/partyRounds/superlative.js';

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
 * Round-type registry, keyed by each module's own `id` so the registry key can
 * never drift from the plan's `roundId`. Adding a mode = one import + one entry.
 * @type {Record<string, { generate: Function, isCorrect: Function }>}
 */
const ROUNDS = Object.fromEntries([flagPick, mapPick, superlative, superlative.areaRound, superlative.densityRound, superlative.gdpRound, superlative.gdpPerCapitaRound, superlative.coffeeRound, superlative.wineRound, superlative.cocoaRound, superlative.bananaRound, superlative.appleRound, superlative.elevationRound, superlative.coastlineRound, superlative.forestRound, superlative.oilRound, superlative.riceRound, superlative.coalRound, superlative.sheepPerCapitaRound, superlative.cattlePerCapitaRound, superlative.beerPerCapitaRound, superlative.teaRound, superlative.sugarcaneRound, superlative.goldRound, superlative.alcoholPerCapitaRound, superlative.meatPerCapitaRound, superlative.bordersRound, superlative.oliveOilRound, superlative.honeyRound, superlative.temperatureRound, superlative.happinessRound, superlative.corruptionRound, superlative.tourismPerCapitaRound, superlative.electricityPerCapitaRound].map((m) => [m.id, m]));

const TOTAL_ROUNDS = totalRounds(DEFAULT_PLAN);

/** Mode id -> catalog mode ({ poolId, roundId }), so a draft pick (a mode id off
 *  the wire) resolves to the block segment + round type to generate. */
const MODE_BY_ID = Object.fromEntries(PARTY_MODES.map((m) => [m.id, m]));

/** Reverse lookup: a segment's (roundId, poolId) -> its mode id. Every catalog
 *  mode has a unique pair, so this recovers the mode a plan segment came from
 *  (used to rebuild `usedModes` after an eviction). */
const MODE_ID_BY_SEG = Object.fromEntries(PARTY_MODES.map((m) => [`${m.roundId}|${m.poolId}`, m.id]));
/** @param {{ roundId: string, poolId: string }} seg @returns {string | undefined} */
function modeIdForSegment(seg) {
  return MODE_ID_BY_SEG[`${seg.roundId}|${seg.poolId}`];
}

/** The opening block every draft plays: one Flags block (see `partyDraft`). */
const OPENING_MODE = MODE_BY_ID[OPENING_MODE_ID];

/**
 * Flag Party durable object — the live show's room. Thin shell around the pure
 * reducer in `flags/partyRoom.js`: it owns sockets, persistence, and the two
 * round-specific facts the room stays agnostic about — which question to hand
 * out (via the round's `generate`) and whether a buzz was correct (via the
 * round's `isCorrect`). Everything else is a reducer call + dispatch, mirroring
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
    /** Answer codes used in the current game, so rounds don't repeat a country. */
    this.usedCodes = new Set();
    /** Mode ids already played this game (draft mode), so the pick hand and the
     *  no-repeat clause never offer a mode twice. */
    this.usedModes = new Set();
  }

  /**
   * Generate the question for a round: the plan picks the round type (flag-pick
   * vs map) and the pool (sovereign vs non-sovereign); the round module builds
   * the question, avoiding countries already used this game. The question is
   * stamped with its `roundId` so the room and clients know how to render and
   * judge it. Records the answer as used.
   *
   * The plan and reveal config are the host's chosen ones (passed explicitly at
   * start, before they're stored on the room), otherwise the room's stored ones,
   * otherwise the built-in defaults. Reading them from the room keeps generation
   * correct after a durable-object eviction mid-game. The question is stamped with
   * `clearFrac` — the veil timing for its category — so a tricky-mode client
   * clears the tile on schedule.
   * @param {number} roundIndex
   * @param {import('../flags/partyPlan.js').Segment[]} [plan]
   * @param {import('../flags/partyRoom.js').Room['reveal']} [reveal]
   */
  generateQuestion(roundIndex, plan, reveal) {
    const p = plan ?? (this.room && this.room.plan) ?? DEFAULT_PLAN;
    return this.generateForRound(roundIdForRound(p, roundIndex), poolIdForRound(p, roundIndex), reveal);
  }

  /**
   * Generate a question for an explicit round type + pool, independent of the
   * plan. Shared by {@link generateQuestion} (plan-driven) and the draft pick
   * path (mode-driven, where the block isn't in the plan yet). Stamps `roundId`,
   * the veil `clearFrac`, and the metric name-reveal `nameFrac`, and records the
   * answer as used.
   * @param {string} roundId
   * @param {string} poolId
   * @param {import('../flags/partyRoom.js').Room['reveal']} [reveal]
   */
  generateForRound(roundId, poolId, reveal) {
    const rev = reveal ?? (this.room && this.room.reveal) ?? DEFAULT_REVEAL;
    const round = ROUNDS[roundId];
    const pool = POOLS[poolId];
    const q = round.generate(pool, this.usedCodes);
    this.usedCodes.add(q.answer);
    // World-facts (metric) rounds carry the name-reveal fraction so clients fade
    // the country names on at the host's chosen point; other rounds never do (flag
    // / outline recognition is the whole point there). `rev.name` may be null (the
    // host turned names off), in which case nameFrac stays undefined.
    const nameFrac = isMetricRound(roundId) ? (rev.name ?? undefined) : undefined;
    return { ...q, roundId, clearFrac: rev[revealCategoryFor(roundId)], nameFrac };
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
      // loses it — rebuild from the persisted plan (each block is one mode) so a
      // later hand can't offer a mode already played.
      if (this.room.draft && Array.isArray(this.room.plan)) {
        for (const seg of this.room.plan) {
          const id = modeIdForSegment(seg);
          if (id) this.usedModes.add(id);
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
        this.room = createRoom(TOTAL_ROUNDS, DEFAULT_PLAN);
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
          this.usedCodes = new Set();
          this.usedModes = new Set();
          // Tricky mode is a client render flag the host chooses; coerce to a
          // strict boolean so a malformed value can't reach the room. The
          // per-category reveal timing is snapped to the allowed option set.
          const tricky = parsed.tricky === true;
          const reveal = validateReveal(parsed.reveal);
          if (parsed.draft === true) {
            // Draft: the plan grows one block per pick. Open with a single Flags
            // block; the game runs `targetBlocks` blocks, sized from the present
            // seat count (`players + 1`, capped). Round 0 comes from the opening
            // block, not a host plan.
            const targetBlocks = blockCountFor(this.room.present.size);
            const openingPlan = [{ poolId: OPENING_MODE.poolId, roundId: OPENING_MODE.roundId, rounds: BLOCK_ROUNDS }];
            this.usedModes.add(OPENING_MODE_ID);
            const question = this.generateForRound(OPENING_MODE.roundId, OPENING_MODE.poolId, reveal);
            result = applyStart(this.room, playerId, question, openingPlan, targetBlocks * BLOCK_ROUNDS, tricky, reveal, { draft: true, targetBlocks });
            break;
          }
          // Setlist: the host's plan rides in on the start message; never trust it
          // raw. validatePlan strips anything malformed and returns null if nothing
          // valid survives, so a missing / bad plan cleanly falls back to the
          // default. Generate round 0 from the same validated plan.
          const plan = validatePlan(parsed.plan) ?? DEFAULT_PLAN;
          result = applyStart(this.room, playerId, this.generateQuestion(0, plan, reveal), plan, totalRounds(plan), tricky, reveal);
          break;
        }
        case 'buzz': {
          const choice = String(parsed.choice ?? '');
          const q = this.room.question;
          const round = q ? ROUNDS[q.roundId] : null;
          const correct = q && round ? round.isCorrect(q, choice) : false;
          result = applyBuzz(this.room, playerId, choice, correct);
          break;
        }
        case 'reveal':
          result = applyForceReveal(this.room, playerId);
          break;
        case 'next': {
          // In a draft, a `next` that lands on a block boundary opens a pick
          // instead of dealing the next question: the lowest-ranked seat that
          // hasn't picked chooses the next block from a dealt hand. Otherwise
          // (and always in setlist) it advances the round or ends the game.
          const picker = pendingPickAfterReveal(this.room)
            ? pickerFor(this.scoreboard(), this.room.pickedBy) : null;
          if (picker) {
            result = applyEnterPicking(this.room, playerId, picker, handFor(this.usedModes));
          } else {
            // Not a pick boundary, or (defensively) no eligible picker — the
            // block-count formula guarantees one, but never freeze the room on a
            // null picker: fall through to the ordinary advance / final board.
            result = applyNext(this.room, playerId, this.generateQuestion(this.room.roundIndex + 1));
          }
          break;
        }
        case 'pick': {
          // The designated picker chooses their block. Guard the phase + picker
          // here so a stale / spoofed pick never generates a question, then
          // validate the mode against the no-repeat set before building its block.
          if (this.room.phase !== 'picking' || this.room.picker !== playerId) return;
          const modeId = String(parsed.modeId ?? '');
          if (!isValidPick(modeId, this.usedModes)) return;
          const mode = MODE_BY_ID[modeId];
          const segment = { poolId: mode.poolId, roundId: mode.roundId, rounds: BLOCK_ROUNDS };
          const question = this.generateForRound(mode.roundId, mode.poolId);
          result = applyPick(this.room, playerId, modeId, segment, question);
          if (result.broadcasts.length > 0) this.usedModes.add(modeId);
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
          const modeId = hand[Math.floor(Math.random() * hand.length)];
          const mode = MODE_BY_ID[modeId];
          const segment = { poolId: mode.poolId, roundId: mode.roundId, rounds: BLOCK_ROUNDS };
          const question = this.generateForRound(mode.roundId, mode.poolId);
          result = applyPick(this.room, picker, modeId, segment, question);
          if (result.broadcasts.length > 0) this.usedModes.add(modeId);
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
      await this.saveRoom();
      this.dispatch(result.broadcasts);
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
