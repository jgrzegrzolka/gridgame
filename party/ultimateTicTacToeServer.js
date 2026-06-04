import {
  createUltimateRoom,
  applyUltimateHello,
  applyUltimateClaim,
  applyUltimateRoomGiveUp,
  applyUltimateDisconnect,
  applyUltimateStartRematch,
  serializeUltimateRoom,
  deserializeUltimateRoom,
} from '../flags/ultimateOnlineRoom.js';
import { generateUltimateRandomPuzzle } from '../flags/grid.js';

/** @typedef {import('../flags/ultimateOnlineRoom.js').UltimateRoom} UltimateRoom */
/** @typedef {import('../flags/ultimateOnlineRoom.js').UltimateBroadcast} UltimateBroadcast */
/** @typedef {import('../flags/group.js').Country} Country */

const STORAGE_KEY = 'ultimate-room';

/**
 * Durable object for 9×9 rooms. Identity rules and persistence mirror
 * TicTacToeServer 1:1 — the only differences are the engine (ultimate
 * room reducer + ultimate puzzle generator), the wire message shape
 * (claim takes bigRow/bigCol/smallRow/smallCol instead of row/col),
 * and the storage key (so a server instance restoring state can't
 * cross-contaminate a 3×3 room snapshot).
 */
export class UltimateTicTacToeServer {
  /**
   * @param {any} party
   * @param {Country[]} countries
   * @param {import('../flags/grid.js').Puzzle} [puzzle]
   */
  constructor(party, countries, puzzle) {
    this.party = party;
    this.countries = countries;
    this.forcedPuzzle = puzzle;
    /** @type {UltimateRoom | null} */
    this.room = null;
    this.loaded = false;
    /** @type {Map<any, string>} */
    this.playerByConn = new Map();
    /** @type {Map<string, any>} */
    this.connByPlayer = new Map();
  }

  async onStart() {
    await this.loadRoom();
  }

  async loadRoom() {
    if (this.loaded) return;
    const snapshot = await this.party.storage.get(STORAGE_KEY);
    if (snapshot) this.room = deserializeUltimateRoom(snapshot);
    this.loaded = true;
  }

  async saveRoom() {
    if (!this.room) return;
    await this.party.storage.put(STORAGE_KEY, serializeUltimateRoom(this.room));
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
        const puzzle = this.forcedPuzzle ?? generateUltimateRandomPuzzle(this.countries);
        this.room = createUltimateRoom(puzzle);
      } else if (intent === 'create' && !this.room.roles.has(playerId)) {
        this.rejectConnection(conn, 'code-collision');
        return;
      }

      this.playerByConn.set(conn, playerId);
      this.connByPlayer.set(playerId, conn);

      const result = applyUltimateHello(this.room, playerId);
      this.room = result.room;
      await this.saveRoom();
      this.dispatch(result.broadcasts);
      if (result.rejectConnection) {
        try { conn.close(); } catch {}
        this.playerByConn.delete(conn);
        this.connByPlayer.delete(playerId);
      }
    } catch (err) {
      console.error('[ultimateTicTacToeServer] onConnect failed:', err);
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
      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      if (parsed && parsed.type === 'claim') {
        const playerId = this.playerByConn.get(sender);
        if (!playerId) return;
        const country = this.countries.find((c) => c.code === parsed.countryCode);
        if (!country) return;
        const result = applyUltimateClaim(
          this.room, playerId,
          parsed.bigRow, parsed.bigCol, parsed.smallRow, parsed.smallCol,
          country, this.countries,
        );
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      } else if (parsed && parsed.type === 'give-up') {
        const playerId = this.playerByConn.get(sender);
        if (!playerId) return;
        const result = applyUltimateRoomGiveUp(this.room, playerId, this.countries);
        if (result.broadcasts.length === 0) return;
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      } else if (parsed && parsed.type === 'rematch') {
        const playerId = this.playerByConn.get(sender);
        if (!playerId) return;
        const newPuzzle = this.forcedPuzzle ?? generateUltimateRandomPuzzle(this.countries);
        const result = applyUltimateStartRematch(this.room, playerId, newPuzzle);
        if (result.broadcasts.length === 0) return;
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      }
    } catch (err) {
      console.error('[ultimateTicTacToeServer] onMessage failed:', err);
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
      const result = applyUltimateDisconnect(this.room, playerId);
      this.room = result.room;
      await this.saveRoom();
      this.dispatch(result.broadcasts);
    } catch (err) {
      console.error('[ultimateTicTacToeServer] onClose failed:', err);
    }
  }

  /** @param {UltimateBroadcast[]} broadcasts */
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
