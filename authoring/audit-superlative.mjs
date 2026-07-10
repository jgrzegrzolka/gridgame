/**
 * Author-time correctness check for superlative daily puzzles. Runs locally:
 *
 *   node authoring/audit-superlative.mjs
 *
 * For every `kind: "superlative"` entry in `.catalog/puzzles.json`, recompute
 * the roster with `resolveSuperlative` against the current country + metric
 * data and compare it to the stored `answers`.
 *
 * Why this lives here and not in the catalog test / push validator:
 * superlative answers are **frozen** (see `flags/dailyValidate.js`
 * `checkSuperlativeShape`). `population.json` refreshes yearly and a released
 * daily puzzle is immutable, so live-recomputing every entry would eventually
 * fail a past puzzle with no legal fix. This script is the author's assist —
 * it recomputes and flags drift on **future-dated (still editable) drafts**,
 * where a mismatch means the roster was authored wrong and should be fixed
 * before release. Drift on a past entry is expected after a data refresh and
 * only warned about.
 *
 * Exit code 1 when any future-dated entry drifts (so it can gate a push);
 * 0 otherwise. Membership is compared as a set — a superlative roster is a
 * ranking, but gameplay only cares that the right countries are present.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadCountries } from '../flags/group.js';
import { resolveSuperlative } from '../flags/superlative.js';
import { METRIC_FILES } from '../flags/metrics/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const COUNTRIES = loadCountries(
  JSON.parse(readFileSync(join(ROOT, 'flags', 'countries.json'), 'utf-8')),
);

/** @type {Record<string, Record<string, number>>} metric key → its values map */
const VALUES_BY_METRIC = {};
for (const m of METRIC_FILES) {
  const data = JSON.parse(readFileSync(join(ROOT, 'flags', 'metrics', m.file), 'utf-8'));
  VALUES_BY_METRIC[m.key] = data.values ?? {};
}

const CATALOG_DIR = join(ROOT, '.catalog');
const PUZZLES = JSON.parse(readFileSync(join(CATALOG_DIR, 'puzzles.json'), 'utf-8'));

// Warsaw "today" as YYYY-MM-DD — the page filters visibility on the same key,
// so an entry with date > today is still an editable future draft.
const TODAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

/** @param {string[]} a @param {string[]} b */
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

let checked = 0;
let futureDrift = 0;
let pastDrift = 0;

for (const entry of PUZZLES) {
  if (entry.kind !== 'superlative') continue;
  checked++;
  const values = VALUES_BY_METRIC[entry.metric];
  const spec = {
    metric: entry.metric,
    scope: entry.scope,
    direction: entry.direction,
    topN: entry.topN,
    filter: entry.filter,
  };
  const computed = values ? resolveSuperlative(spec, COUNTRIES, values) : [];
  const stored = entry.answers ?? [];
  if (sameSet(computed, stored)) continue;

  const future = entry.date > TODAY;
  if (future) futureDrift++;
  else pastDrift++;

  const specLabel = `${entry.direction} ${entry.topN} ${entry.metric} · ${entry.scope}` +
    (entry.filter ? ` · ${entry.filter}` : '');
  console.log(`#${entry.n} (${entry.date}) ${future ? 'FUTURE — fix before release' : 'past — frozen, warning only'}`);
  console.log(`  spec:     ${specLabel}`);
  console.log(`  stored:   [${stored.join(', ')}]`);
  console.log(`  computed: [${computed.join(', ')}]${values ? '' : '  (unknown metric!)'}`);
  console.log('');
}

console.log(
  `checked ${checked} superlative entr${checked === 1 ? 'y' : 'ies'}: ` +
  `${futureDrift} future-dated drift, ${pastDrift} past (frozen).`,
);
process.exit(futureDrift > 0 ? 1 : 0);
