import rawCountries from '../flags/countries.json' with { type: 'json' };
import population from '../flags/metrics/population.json' with { type: 'json' };
import { loadCountries, attachPopulations } from '../flags/group.js';
import { UltimateTicTacToeServer } from './ultimateTicTacToeServer.js';

// See party/server.js for why the JSON import is safe here. The 9×9 pool keeps
// only the single `over 10M` breakpoint (buildUltimateCategoryPool), but it
// still needs population attached to resolve it.
const countries = attachPopulations(loadCountries(rawCountries), population.values);

export default class UltimateGameServer extends UltimateTicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
