import rawCountries from '../flags/countries.json' with { type: 'json' };
import { loadCountries } from '../flags/group.js';
import { TicTacToeServer } from './ticTacToeServer.js';

const countries = loadCountries(rawCountries);

export default class GameServer extends TicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
