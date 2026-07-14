import rawCountries from '../flags/countries.json' with { type: 'json' };
import { loadCountries } from '../flags/group.js';
import { sovereignPool, nonSovereignPool } from '../flags/flagPools.js';
import { DEFAULT_PLAN, totalRounds, poolIdForRound, roundIdForRound, validatePlan } from '../flags/partyPlan.js';
import {
  DEFAULT_REVEAL, revealCategoryFor, validateReveal, isMetricRound,
  QUESTION_WATCHDOG_SECONDS, REVEAL_WATCHDOG_SECONDS,
} from '../flags/partyTiming.js';
import {
  createRoom,
  applyHello,
  applyStart,
  applyBuzz,
  applyForceReveal,
  applyNext,
  applyRevealTimeout,
  applyNextTimeout,
  applyPlayAgain,
  applyReturnToLobby,
  applyDisconnect,
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
const ROUNDS = Object.fromEntries([flagPick, mapPick, superlative, superlative.areaRound, superlative.densityRound, superlative.gdpRound, superlative.gdpPerCapitaRound, superlative.coffeeRound, superlative.wineRound, superlative.cocoaRound, superlative.bananaRound, superlative.appleRound, superlative.elevationRound, superlative.coastlineRound, superlative.forestRound, superlative.oilRound, superlative.riceRound, superlative.coalRound, superlative.sheepPerCapitaRound, superlative.cattlePerCapitaRound, superlative.beerPerCapitaRound, superlative.teaRound, superlative.sugarcaneRound, superlative.goldRound, superlative.alcoholPerCapitaRound, superlative.meatPerCapitaRound, superlative.bordersRound, superlative.oliveOilRound, superlative.honeyRound].map((m) => [m.id, m]));

const TOTAL_ROUNDS = totalRounds(DEFAULT_PLAN);

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
    const rev = reveal ?? (this.room && this.room.reveal) ?? DEFAULT_REVEAL;
    const roundId = roundIdForRound(p, roundIndex);
    const round = ROUNDS[roundId];
    const pool = POOLS[poolIdForRound(p, roundIndex)];
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
    if (snapshot) this.room = deserializeRoom(snapshot);
    this.loaded = true;
  }

  async saveRoom() {
    if (!this.room) return;
    await this.party.storage.put(STORAGE_KEY, serializeRoom(this.room));
  }

  /**
   * Point the durable object's single alarm at the current phase's watchdog
   * deadline. The host's page drives the snappy pace when it's awake; this alarm
   * is the fallback that force-advances the room when the host's tab is gone
   * (backgrounded, phone locked, closed) and the `reveal` / `next` message never
   * arrives — so a game can never stall at a reveal, the final board included.
   * Question and reveal each get a deadline generously past their normal
   * duration ({@link QUESTION_WATCHDOG_SECONDS} / {@link REVEAL_WATCHDOG_SECONDS})
   * so a present host always transitions first. Lobby and final auto-advance from
   * nothing, so the alarm is cleared there. Call after every phase change.
   *
   * PartyKit exposes one alarm per room; `setAlarm` replaces any pending one, so
   * each phase change simply re-points it. The alarm persists in storage, so it
   * still fires after a durable-object eviction (handled in {@link onAlarm}).
   */
  async scheduleWatchdog() {
    if (!this.room) return;
    const phase = this.room.phase;
    if (phase === 'question') {
      await this.party.storage.setAlarm(Date.now() + QUESTION_WATCHDOG_SECONDS * 1000);
    } else if (phase === 'reveal') {
      await this.party.storage.setAlarm(Date.now() + REVEAL_WATCHDOG_SECONDS * 1000);
    } else {
      await this.party.storage.deleteAlarm();
    }
  }

  /**
   * The watchdog deadline hit: the host's tab hasn't advanced the room, so the
   * server does it — reveal a lingering question, or move a lingering reveal on
   * to the next round / the final board. Loads first, since the alarm can wake a
   * fresh instance after an eviction (`this.room` would be null otherwise). The
   * reducers are no-ops if the room already moved on (the host or the all-buzzed
   * auto-reveal beat us), so a late fire is harmless. Always reschedules for the
   * phase we end in, because the fired alarm is now spent.
   */
  async onAlarm() {
    try {
      await this.loadRoom();
      if (!this.room) return;
      /** @type {import('../flags/partyRoom.js').ApplyResult | null} */
      let result = null;
      if (this.room.phase === 'question') {
        result = applyRevealTimeout(this.room);
      } else if (this.room.phase === 'reveal') {
        result = applyNextTimeout(this.room, this.generateQuestion(this.room.roundIndex + 1));
      }
      if (result && result.broadcasts.length > 0) {
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      }
      await this.scheduleWatchdog();
    } catch (err) {
      console.error('[partyGameServer] onAlarm failed:', err);
    }
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
      // Snapshot before applying so we only re-point the watchdog on a real phase
      // change (start / reveal / next / all-buzzed). A mid-question buzz keeps the
      // phase, so it must not reset the question deadline.
      const prevPhase = this.room.phase;
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
          // The host's plan rides in on the start message; never trust it raw.
          // validatePlan strips anything malformed and returns null if nothing
          // valid survives, so a missing / bad plan cleanly falls back to the
          // default. Generate round 0 from the same validated plan, then hand
          // both the question and the plan (+ its round count) to the room.
          this.usedCodes = new Set();
          const plan = validatePlan(parsed.plan) ?? DEFAULT_PLAN;
          // Tricky mode is a client render flag the host chooses; coerce to a
          // strict boolean so a malformed value can't reach the room. The
          // per-category reveal timing is snapped to the allowed option set.
          const tricky = parsed.tricky === true;
          const reveal = validateReveal(parsed.reveal);
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
        case 'next':
          result = applyNext(this.room, playerId, this.generateQuestion(this.room.roundIndex + 1));
          break;
        case 'playAgain':
          this.usedCodes = new Set();
          result = applyPlayAgain(this.room, playerId);
          break;
        case 'backToLobby':
          // Host bails on the current game and returns the room to settings.
          // Fresh code pool, same as a play-again reset.
          this.usedCodes = new Set();
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
      if (this.room.phase !== prevPhase) await this.scheduleWatchdog();
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
      const prevPhase = this.room.phase;
      const result = applyDisconnect(this.room, playerId);
      this.room = result.room;
      await this.saveRoom();
      this.dispatch(result.broadcasts);
      // A departing seat can be the last un-buzzed one, auto-revealing the
      // question — re-point the watchdog if that moved us to the reveal phase.
      if (this.room.phase !== prevPhase) await this.scheduleWatchdog();
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
