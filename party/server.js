import rawCountries from '../flags/countries.json' with { type: 'json' };
import population from '../flags/metrics/population.json' with { type: 'json' };
import { loadCountries, attachPopulations } from '../flags/group.js';
import { TicTacToeServer } from './ticTacToeServer.js';

// JSON-module imports are fine here: the party server is bundled by esbuild for
// Cloudflare Workers (Node/build-time), not served to a browser. Attaching
// population lets the `population` threshold categories in the random pool
// resolve on the server that generates + validates every puzzle.
const countries = attachPopulations(loadCountries(rawCountries), population.values);

export default class GameServer extends TicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
