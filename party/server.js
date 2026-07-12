import rawCountries from '../flags/countries.json' with { type: 'json' };
import population from '../flags/metrics/population.json' with { type: 'json' };
import area from '../flags/metrics/area.json' with { type: 'json' };
import density from '../flags/metrics/density.json' with { type: 'json' };
import gdp from '../flags/metrics/gdp.json' with { type: 'json' };
import gdpPerCapita from '../flags/metrics/gdpPerCapita.json' with { type: 'json' };
import coffee from '../flags/metrics/coffee.json' with { type: 'json' };
import { loadCountries, attachPopulations, attachAreas, attachDensities, attachGdps, attachGdpPerCapitas, attachCoffees } from '../flags/group.js';
import { TicTacToeServer } from './ticTacToeServer.js';

// JSON-module imports are fine here: the party server is bundled by esbuild for
// Cloudflare Workers (Node/build-time), not served to a browser. Attaching the
// metrics lets the `population` / `area` / `density` / `gdp` / `gdpPerCapita`
// threshold categories in the random pool resolve on the server that generates
// + validates every puzzle.
const countries = loadCountries(rawCountries);
attachPopulations(countries, population.values);
attachAreas(countries, area.values);
attachDensities(countries, density.values);
attachGdps(countries, gdp.values);
attachGdpPerCapitas(countries, gdpPerCapita.values);
attachCoffees(countries, coffee.values);

export default class GameServer extends TicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
