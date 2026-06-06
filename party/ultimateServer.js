import rawCountries from '../flags/countries.json' with { type: 'json' };
import { loadCountries } from '../flags/group.js';
import { UltimateTicTacToeServer } from './ultimateTicTacToeServer.js';

const countries = loadCountries(rawCountries);

export default class UltimateGameServer extends UltimateTicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
