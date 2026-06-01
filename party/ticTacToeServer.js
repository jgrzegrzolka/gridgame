import { createRoom, applyHello, applyClaim, applyDisconnect } from '../flags/onlineRoom.js';
import { generateRandomPuzzle } from '../flags/grid.js';

/** @typedef {import('../flags/onlineRoom.js').Room} Room */
/** @typedef {import('../flags/onlineRoom.js').Broadcast} Broadcast */
/** @typedef {import('../flags/group.js').Country} Country */

/**
 * The actual room class. Accepts `countries` so it can be unit-tested
 * without depending on the runtime JSON import. party/server.js is the
 * thin PartyKit entry point that loads countries.json and subclasses this.
 */
export class TicTacToeServer {
  /**
   * @param {any} party
   * @param {Country[]} countries
   * @param {import('../flags/grid.js').Puzzle} [puzzle]
   */
  constructor(party, countries, puzzle) {
    this.party = party;
    this.countries = countries;
    this.room = createRoom(puzzle ?? generateRandomPuzzle(countries));
  }

  /** @param {any} conn */
  onConnect(conn) {
    const result = applyHello(this.room, conn.id);
    this.room = result.room;
    this.dispatch(result.broadcasts);
    if (result.rejectConnection) conn.close();
  }

  /**
   * @param {string} message
   * @param {any} sender
   */
  onMessage(message, sender) {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (parsed && parsed.type === 'claim') {
      const country = this.countries.find((c) => c.code === parsed.countryCode);
      if (!country) return;
      const result = applyClaim(this.room, sender.id, parsed.row, parsed.col, country);
      this.room = result.room;
      this.dispatch(result.broadcasts);
    }
  }

  /** @param {any} conn */
  onClose(conn) {
    const result = applyDisconnect(this.room, conn.id);
    this.room = result.room;
    this.dispatch(result.broadcasts);
  }

  /** @param {Broadcast[]} broadcasts */
  dispatch(broadcasts) {
    for (const bc of broadcasts) {
      const payload = JSON.stringify(bc.message);
      if (bc.to === 'all') {
        for (const c of this.party.getConnections()) c.send(payload);
      } else {
        const c = this.party.getConnection(bc.to);
        if (c) c.send(payload);
      }
    }
  }
}
