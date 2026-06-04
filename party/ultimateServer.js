import countries from '../flags/countries.json' with { type: 'json' };
import { UltimateTicTacToeServer } from './ultimateTicTacToeServer.js';

export default class UltimateGameServer extends UltimateTicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
