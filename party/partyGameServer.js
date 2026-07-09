import rawCountries from '../flags/countries.json' with { type: 'json' };
import { loadCountries, flagsGamePool } from '../flags/group.js';
import {
  createRoom,
  applyHello,
  applyStart,
  applyBuzz,
  applyForceReveal,
  applyNext,
  applyPlayAgain,
  applyDisconnect,
  serializeRoom,
  deserializeRoom,
} from '../flags/partyRoom.js';
import * as flagPick from '../flags/partyRounds/flagPick.js';

/** @typedef {import('../flags/partyRoom.js').Room} Room */
/** @typedef {import('../flags/partyRoom.js').Broadcast} Broadcast */

const STORAGE_KEY = 'room';

/** 195 sovereign flags — the pool the flag-pick round draws from. */
const POOL = flagsGamePool(loadCountries(rawCountries), false);

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
        this.room = createRoom();
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
        case 'start':
          result = applyStart(this.room, playerId, flagPick.generate(POOL));
          break;
        case 'buzz': {
          const choice = String(parsed.choice ?? '');
          const correct = this.room.question ? flagPick.isCorrect(this.room.question, choice) : false;
          result = applyBuzz(this.room, playerId, choice, correct);
          break;
        }
        case 'reveal':
          result = applyForceReveal(this.room, playerId);
          break;
        case 'next':
          result = applyNext(this.room, playerId, flagPick.generate(POOL));
          break;
        case 'playAgain':
          result = applyPlayAgain(this.room, playerId);
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
