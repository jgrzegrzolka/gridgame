/**
 * Registry of world metrics — a plain list, no data imported here.
 *
 * IMPORTANT: this is loaded in the browser (flagsdata). Static JSON-module
 * imports (`import x from './x.json' with { type: 'json' }`) only work reliably
 * in Node — many browsers reject them and fall back to MIME-checking the file
 * as a script, which 404-equivalently breaks the whole module graph. So metric
 * DATA is fetched at runtime the same way `countries.json` is
 * (`fetch(url).then(r => r.json())`), and this file only names the files.
 *
 * Add a metric: drop `<key>.json` in this folder and add one line here. The
 * `label` is an English fallback for the lens button before i18n resolves
 * `metric.<key>`.
 *
 * @typedef {{ key: string, file: string, label: string }} MetricFile
 * @type {MetricFile[]}
 */
export const METRIC_FILES = [
  { key: 'population', file: 'population.json', label: 'Population' },
  { key: 'area', file: 'area.json', label: 'Land area' },
  { key: 'density', file: 'density.json', label: 'Population density' },
  { key: 'gdp', file: 'gdp.json', label: 'GDP' },
  { key: 'gdpPerCapita', file: 'gdpPerCapita.json', label: 'GDP per capita' },
  { key: 'coffee', file: 'coffee.json', label: 'Coffee production' },
];
