import rawCountries from '../flags/countries.json' with { type: 'json' };
import population from '../flags/metrics/population.json' with { type: 'json' };
import area from '../flags/metrics/area.json' with { type: 'json' };
import density from '../flags/metrics/density.json' with { type: 'json' };
import gdp from '../flags/metrics/gdp.json' with { type: 'json' };
import gdpPerCapita from '../flags/metrics/gdpPerCapita.json' with { type: 'json' };
import { loadCountries, attachPopulations, attachAreas, attachDensities, attachGdps, attachGdpPerCapitas } from '../flags/group.js';
import { UltimateTicTacToeServer } from './ultimateTicTacToeServer.js';

// See party/server.js for why the JSON import is safe here. The 9×9 pool keeps
// only the single broad breakpoint per metric (`over 10M` / `over 100K km²` /
// `over 100 people/km²` / `over $100B` / `over $30K`, buildUltimateCategoryPool),
// but it still needs the metrics attached to resolve.
const countries = loadCountries(rawCountries);
attachPopulations(countries, population.values);
attachAreas(countries, area.values);
attachDensities(countries, density.values);
attachGdps(countries, gdp.values);
attachGdpPerCapitas(countries, gdpPerCapita.values);

export default class UltimateGameServer extends UltimateTicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
