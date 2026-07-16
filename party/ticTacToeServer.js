import {
  createRoom,
  applyHello,
  applyClaim,
  applyGiveUp,
  applyDisconnect,
  applyStartRematch,
  applySetEasy,
  serializeRoom,
  deserializeRoom,
} from '../flags/onlineRoom.js';
import { generateRandomPuzzle, buildEasyCategoryPool } from '../flags/engine.js';

/** @typedef {import('../flags/onlineRoom.js').Room} Room */
/** @typedef {import('../flags/onlineRoom.js').Broadcast} Broadcast */
/** @typedef {import('../flags/group.js').Country} Country */

const STORAGE_KEY = 'room';

/**
 * Room durable object.
 *
 * Identity rules:
 *   - Clients pass a stable playerId in the WebSocket URL as ?pid=...
 *     The browser persists this id in localStorage, so refreshes and
 *     reconnects keep the same role.
 *   - Clients pass ?intent=create when opening a freshly generated code,
 *     and omit it (or use ?intent=join) when joining a known code.
 *   - The creator passes ?easy=1 to deal the room's board from the
 *     no-statistics pool. Only read while actually creating the room: a
 *     joiner appending it to their own URL changes nothing, because by then
 *     the board exists. Changing it later is a `set-easy` message, which
 *     applySetEasy authorizes.
 *
 * Persistence:
 *   - The Room is stored in party.storage under one key, so the puzzle and
 *     role assignments survive a Durable Object eviction. Without this,
 *     two users joining the same code at different times could land in
 *     two completely different rooms with the same name.
 */
export class TicTacToeServer {
  /**
   * @param {any} party
   * @param {Country[]} countries
   * @param {import('../flags/engine.js').Puzzle} [puzzle]
   */
  constructor(party, countries, puzzle) {
    this.party = party;
    this.countries = countries;
    /** Forced puzzle for tests; real runs generate per fresh room. */
    this.forcedPuzzle = puzzle;
    /** Easy pool, built once per DO rather than per deal. 25 categories out of
     * the full pool's 142, and `generateRandomPuzzle` retries up to 200 times,
     * so rebuilding it per call is pure waste. */
    /** @type {import('../flags/engine.js').Category[] | null} */
    this.easyPool = null;
    /** @type {Room | null} */
    this.room = null;
    this.loaded = false;
    /** conn -> playerId, so onClose can map back without parsing the URL again. */
    /** @type {Map<any, string>} */
    this.playerByConn = new Map();
    /** playerId -> conn, for routing addressed broadcasts. */
    /** @type {Map<string, any>} */
    this.connByPlayer = new Map();
  }

  async onStart() {
    await this.loadRoom();
  }

  /**
   * Deal a board from the pool the room's mode calls for. Every puzzle this
   * server hands out goes through here, so a new deal site can't quietly
   * ignore the room setting.
   *
   * @param {boolean} easy
   * @returns {import('../flags/engine.js').Puzzle}
   */
  dealPuzzle(easy) {
    if (this.forcedPuzzle) return this.forcedPuzzle;
    if (!easy) return generateRandomPuzzle(this.countries);
    if (!this.easyPool) this.easyPool = buildEasyCategoryPool();
    return generateRandomPuzzle(this.countries, { pool: this.easyPool });
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
      // Parse with a base so a relative path still resolves (PartyKit dev
      // sometimes hands us just the path, not the full URL).
      const url = new URL(ctx.request.url, 'http://localhost');
      const playerId = url.searchParams.get('pid');
      const intent = url.searchParams.get('intent') === 'create' ? 'create' : 'join';
      const easy = url.searchParams.get('easy') === '1';

      if (!playerId) {
        this.rejectConnection(conn, 'missing-player-id');
        return;
      }

      if (this.room === null) {
        if (intent !== 'create') {
          this.rejectConnection(conn, 'room-not-found');
          return;
        }
        this.room = createRoom(this.dealPuzzle(easy), { easy });
      } else if (intent === 'create' && !this.room.roles.has(playerId)) {
        this.rejectConnection(conn, 'code-collision');
        return;
      }

      this.playerByConn.set(conn, playerId);
      this.connByPlayer.set(playerId, conn);

      const result = applyHello(this.room, playerId);
      this.room = result.room;
      await this.saveRoom();
      this.dispatch(result.broadcasts);
      if (result.rejectConnection) {
        try { conn.close(); } catch {}
        this.playerByConn.delete(conn);
        this.connByPlayer.delete(playerId);
      }
    } catch (err) {
      console.error('[ticTacToeServer] onConnect failed:', err);
      try { conn.close(); } catch {}
    }
  }

  /**
   * Send a rejection and close. The client's reducer also closes on the
   * 'rejected' message, but we close here too so dead connections don't
   * linger on the server side.
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
        const result = applyClaim(this.room, playerId, parsed.row, parsed.col, country);
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      } else if (parsed && parsed.type === 'give-up') {
        const playerId = this.playerByConn.get(sender);
        if (!playerId) return;
        const result = applyGiveUp(this.room, playerId, this.countries);
        if (result.broadcasts.length === 0) return;
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      } else if (parsed && parsed.type === 'rematch') {
        const playerId = this.playerByConn.get(sender);
        if (!playerId) return;
        // The room's mode outlives the game: agreeing to a no-statistics board
        // and then getting a metrics board on "Play again" would be a bait.
        const result = applyStartRematch(this.room, playerId, this.dealPuzzle(this.room.easy));
        if (result.broadcasts.length === 0) return;
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      } else if (parsed && parsed.type === 'set-easy') {
        const playerId = this.playerByConn.get(sender);
        if (!playerId) return;
        const easy = parsed.easy === true;
        // Deal before authorizing: applySetEasy needs a board to install, and
        // it may refuse (not the host, board already touched, mode unchanged),
        // in which case the puzzle is simply dropped. Wasting a generate on a
        // refusal is cheaper than teaching this handler the room's rules and
        // having them drift from the reducer's.
        const result = applySetEasy(this.room, playerId, easy, this.dealPuzzle(easy));
        if (result.broadcasts.length === 0) return;
        this.room = result.room;
        await this.saveRoom();
        this.dispatch(result.broadcasts);
      }
    } catch (err) {
      console.error('[ticTacToeServer] onMessage failed:', err);
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
      console.error('[ticTacToeServer] onClose failed:', err);
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
