import { createRoom, applyHello, applyClaim, applyDisconnect } from '../flags/onlineRoom.js';
import { generateRandomPuzzle } from '../flags/grid.js';
import countries from '../flags/countries.json' with { type: 'json' };

/** @typedef {import('../flags/onlineRoom.js').Room} Room */
/** @typedef {import('../flags/onlineRoom.js').Broadcast} Broadcast */

export default class TicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    this.party = party;
    this.room = createRoom(generateRandomPuzzle(countries));
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
      const country = countries.find((c) => c.code === parsed.countryCode);
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
