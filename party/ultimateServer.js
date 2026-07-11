import rawCountries from '../flags/countries.json' with { type: 'json' };
import population from '../flags/metrics/population.json' with { type: 'json' };
import area from '../flags/metrics/area.json' with { type: 'json' };
import { loadCountries, attachPopulations, attachAreas } from '../flags/group.js';
import { UltimateTicTacToeServer } from './ultimateTicTacToeServer.js';

// See party/server.js for why the JSON import is safe here. The 9×9 pool keeps
// only the single broad breakpoint per metric (`over 10M` / `over 100K km²`,
// buildUltimateCategoryPool), but it still needs the metrics attached to resolve.
const countries = attachAreas(
  attachPopulations(loadCountries(rawCountries), population.values),
  area.values,
);

export default class UltimateGameServer extends UltimateTicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
