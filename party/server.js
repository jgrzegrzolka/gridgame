import rawCountries from '../flags/countries.json' with { type: 'json' };
import population from '../flags/metrics/population.json' with { type: 'json' };
import area from '../flags/metrics/area.json' with { type: 'json' };
import density from '../flags/metrics/density.json' with { type: 'json' };
import gdp from '../flags/metrics/gdp.json' with { type: 'json' };
import gdpPerCapita from '../flags/metrics/gdpPerCapita.json' with { type: 'json' };
import coffee from '../flags/metrics/coffee.json' with { type: 'json' };
import wine from '../flags/metrics/wine.json' with { type: 'json' };
import cocoa from '../flags/metrics/cocoa.json' with { type: 'json' };
import banana from '../flags/metrics/banana.json' with { type: 'json' };
import apple from '../flags/metrics/apple.json' with { type: 'json' };
import oil from '../flags/metrics/oil.json' with { type: 'json' };
import rice from '../flags/metrics/rice.json' with { type: 'json' };
import coal from '../flags/metrics/coal.json' with { type: 'json' };
import elevation from '../flags/metrics/elevation.json' with { type: 'json' };
import coastline from '../flags/metrics/coastline.json' with { type: 'json' };
import forest from '../flags/metrics/forest.json' with { type: 'json' };
import sheepPerCapita from '../flags/metrics/sheepPerCapita.json' with { type: 'json' };
import cattlePerCapita from '../flags/metrics/cattlePerCapita.json' with { type: 'json' };
import beerPerCapita from '../flags/metrics/beerPerCapita.json' with { type: 'json' };
import tea from '../flags/metrics/tea.json' with { type: 'json' };
import sugarcane from '../flags/metrics/sugarcane.json' with { type: 'json' };
import gold from '../flags/metrics/gold.json' with { type: 'json' };
import alcoholPerCapita from '../flags/metrics/alcoholPerCapita.json' with { type: 'json' };
import meatPerCapita from '../flags/metrics/meatPerCapita.json' with { type: 'json' };
import borders from '../flags/metrics/borders.json' with { type: 'json' };
import oliveOil from '../flags/metrics/oliveOil.json' with { type: 'json' };
import honey from '../flags/metrics/honey.json' with { type: 'json' };
import corruption from '../flags/metrics/corruption.json' with { type: 'json' };
import { loadCountries, attachMetrics } from '../flags/group.js';
import { TicTacToeServer } from './ticTacToeServer.js';

// JSON-module imports are fine here: the party server is bundled by esbuild for
// Cloudflare Workers (Node/build-time), not served to a browser (so unlike the
// pages it can't loop `METRIC_FILES` to fetch; each metric is a static import).
// Attaching the metrics lets the threshold categories in the random pool
// resolve on the server that generates + validates every puzzle. A new metric:
// add its import above + one line to this map, then `attachMetrics` wires it in.
const countries = loadCountries(rawCountries);
attachMetrics(countries, {
  population: population.values,
  area: area.values,
  density: density.values,
  gdp: gdp.values,
  gdpPerCapita: gdpPerCapita.values,
  coffee: coffee.values,
  wine: wine.values,
  cocoa: cocoa.values,
  banana: banana.values,
  apple: apple.values,
  elevation: elevation.values,
  coastline: coastline.values,
  forest: forest.values,
  oil: oil.values,
  rice: rice.values,
  coal: coal.values,
  sheepPerCapita: sheepPerCapita.values,
  cattlePerCapita: cattlePerCapita.values,
  beerPerCapita: beerPerCapita.values,
  tea: tea.values,
  sugarcane: sugarcane.values,
  gold: gold.values,
  alcoholPerCapita: alcoholPerCapita.values,
  meatPerCapita: meatPerCapita.values,
  borders: borders.values,
  oliveOil: oliveOil.values,
  honey: honey.values,
  // corruption is a lens-only metric (no attacher yet), so attachMetrics ignores
  // this value; the line keeps the static-import guard satisfied for when a TTT
  // axis lands. See the metrics.test.js "static-import site" guard.
  corruption: corruption.values,
});

export default class GameServer extends TicTacToeServer {
  /** @param {any} party */
  constructor(party) {
    super(party, countries);
  }
}
