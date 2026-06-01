import countries from '../flags/countries.json' with { type: 'json' };
import { TicTacToeServer } from './ticTacToeServer.js';

export default class GameServer extends TicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
