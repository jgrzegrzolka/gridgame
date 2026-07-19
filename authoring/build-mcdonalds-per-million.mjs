/**
 * Regenerates flags/metrics/mcdonaldsPerMillion.json: McDonald's restaurants per
 * million people.
 *
 * WHY PER MILLION, not per capita. True per-capita gives values like 0.00004, which
 * is unreadable on a Flag Party round card. Per million lands the scale where it
 * reads: Australia ~41, United States ~41, Japan ~24. The metric is intensive
 * (size-independent) on purpose, so the #1 is NOT the country with the most outlets.
 * That non-obvious-#1 property is the whole reason this metric is fun.
 *
 * DERIVED, like density. RAW_RESTAURANTS below is the absolute count per market;
 * the per-million value is computed here against population.json. Re-run after
 * either the counts or population refresh.
 *
 * DATA CONTRACT (`absence: 'unknown'`), and this one is subtle, read before editing.
 * Three states, not two:
 *
 *   1. A market with a count       → its real per-million value.
 *   2. A place with NO McDonald's  → an explicit 0. This is a true zero, not a gap:
 *      presence is a directly observable fact, so "no entry in the source" really
 *      does mean "no restaurants". These zeros are the best trivia in the metric
 *      (Iceland closed all outlets in 2009, Bolivia pulled out in 2002, Russia
 *      exited in 2022) and they must stay rankable, so they are filled, not omitted.
 *   3. A place FOLDED into another market's row (FOLDED_INTO_PARENT below) → omitted
 *      entirely, reads "no data".
 *
 * State 3 is why this metric is `absence: 'unknown'` rather than `absence: 'zero'`.
 * McDonald's reports six combined rows, folding 17 countries into a parent market
 * with no standalone count: Cuba / Guam / Saipan into the US, five Pacific markets
 * into Australia, Monaco into France, Andorra + Gibraltar into Spain, Liechtenstein
 * into Switzerland, Isle of Man + Jersey into the UK. Those places DO have
 * McDonald's, we just cannot say how many. Encoding them as 0 would be factually
 * wrong and would corrupt the "which countries have none" answer, so they are the
 * one genuine unknown here. Splitting them would need a national source per
 * territory, which does not exist in the corporate disclosure.
 *
 * SOURCE. McDonald's Corporation, "Restaurants by Market 2025" (year-end 2025,
 * global total 45,356), the same table filed as Exhibit 99.2 of the earnings-release
 * 8-K. NOT the Wikipedia table, which carries stale rows (it has Australia at 1,076
 * against the PDF's 1,092), and emphatically not the store-count content farms
 * (retailgators runs Germany ~8% high and Japan ~4% low) which are the same failure
 * mode that killed the cheese and coffee-consumption metrics.
 *
 * The counts are unusually well cross-checkable, because several large international
 * markets are run by separately listed franchisees filing their own audited numbers:
 * McDonald's Holdings Japan (TSE:2702) files 2,988 against corporate's 2,989; Westlife
 * Foodworld (NSE) files 458 for West+South India, which plus the ~299 North/East
 * outlets is corporate's 757 exactly; Golden Arches Development Corp (PSE) files 792
 * for the Philippines at end-2024, plus 59 is 851 exactly.
 *
 * KNOWN DRIFT. Counts move 2-7% a year (Poland +6.6%, Philippines +7.4%, Italy
 * +6.6%). Australia and the United States are currently within ~0.3% of each other
 * at the top, so which of the two leads can flip between annual releases. Nothing to
 * fix, but do not build anything that depends on that specific ordering holding.
 *
 * To refresh: re-pull the year-end PDF (the corporate domain 403s plain fetchers;
 * an extractor proxy works), update RAW_RESTAURANTS + YEAR, and re-check the footnotes
 * for changes to the combined rows. No network call here, so this is deterministic.
 * See DATA_FEATURE.md "Feature EM" and the add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2025;

/**
 * McDonald's restaurant count per market at year-end 2025, keyed by our ISO 3166-1
 * alpha-2 flag code. 97 markets, straight from the corporate "Restaurants by Market"
 * table. A real place absent from here is either a genuine zero (filled below) or a
 * folded market (omitted); see the data contract in the header.
 * @type {Record<string, number>}
 */
const RAW_RESTAURANTS = {
  ae: 222, ar: 231, at: 212, au: 1092, aw: 3, az: 34, bg: 47, bh: 32, bn: 7, br: 1230,
  bs: 3, be: 128, ca: 1520, ch: 189, cl: 125, cn: 7740, co: 73, cr: 79, cw: 5, cy: 23,
  cz: 140, de: 1382, dk: 121, do: 25, ec: 36, ee: 11, eg: 194, es: 665, fi: 90, fr: 1630,
  gb: 1507, ge: 27, gf: 3, gp: 9, gr: 34, gt: 124, hk: 266, hn: 16, hr: 49, hu: 123,
  id: 314, ie: 95, il: 235, in: 757, it: 805, jo: 45, jp: 3025, kr: 401, kw: 89, lb: 23,
  lt: 19, lu: 11, lv: 14, ma: 80, md: 11, mo: 41, mq: 10, mt: 10, mu: 18, mx: 380,
  my: 372, ni: 10, nl: 266, no: 95, nz: 176, om: 35, pa: 84, pe: 30, ph: 851, pk: 70,
  pl: 618, pr: 94, pt: 220, py: 30, qa: 78, re: 18, ro: 114, rs: 39, sa: 458, se: 205,
  sg: 153, si: 29, sk: 54, sr: 2, sv: 28, sx: 3, th: 242, tr: 306, tt: 4, tw: 430,
  ua: 135, uy: 35, us: 13706, ve: 79, vi: 5, vn: 45, za: 407,
};

/**
 * Places McDonald's reports inside ANOTHER market's row, so they have no standalone
 * count. They DO have restaurants; we just cannot say how many. Omitted from `values`
 * so they read "no data" rather than a factually wrong 0. Grouped by the parent row
 * that absorbs them.
 * @type {Record<string, string>}
 */
const FOLDED_INTO_PARENT = {
  cu: 'us', gu: 'us', mp: 'us',
  as: 'au', fj: 'au', nc: 'au', pf: 'au', ws: 'au',
  mc: 'fr',
  ad: 'es', gi: 'es',
  li: 'ch',
  im: 'gb', je: 'gb',
};

/**
 * Places that once had McDonald's and no longer do. Kept as an explicit, annotated
 * list rather than folded into the generic zero-fill, because "it left" is a
 * different and much more interesting fact than "it never arrived", and because
 * these are the ones most likely to need review at refresh time (a market can
 * return). Every one resolves to 0 like any other absence.
 * @type {Record<string, string>}
 */
const WITHDREW = {
  ru: 'exited 2022 over the invasion of Ukraine; 850 stores sold',
  by: 'suspended Nov 2022, following the Russia exit',
  ba: 'operating licence revoked, 2022',
  kz: 'closed 2023, supply-chain restrictions from Russia sanctions',
  lk: 'franchise terminated 2024 over hygiene concerns (the 2024 source shows 12 → 0)',
  is: 'closed 2009, currency collapse made imported inputs unaffordable',
  bo: 'withdrew 2002, poor sales against local food culture and price point',
  jm: 'withdrew 2005, franchise conflicts and declining sales',
  bb: 'withdrew 1990, extremely poor sales (open barely a year)',
  bm: 'closed 1995, government ban on franchised restaurants',
  me: 'withdrew 2007, no viable permanent location',
  mk: 'withdrew 2013, contract dispute with franchisee',
  sm: 'withdrew 2019, competition from nearby Italian locations',
};

const countries = JSON.parse(readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'));
const population = JSON.parse(readFileSync(join(METRICS, 'population.json'), 'utf-8'));

/** Real places only: orgs (category 'other') are not rankable and get no value. */
const realPlaces = countries.filter((c) => c.category !== 'other').map((c) => c.code);

for (const code of Object.keys(RAW_RESTAURANTS)) {
  if (!realPlaces.includes(code)) throw new Error(`Unknown market code: ${code}`);
}

/** @type {Record<string, number>} */
const values = {};
for (const code of realPlaces) {
  if (code in FOLDED_INTO_PARENT) continue; // state 3: present, count unknown

  const count = RAW_RESTAURANTS[code] ?? 0; // state 2: absent from source means zero
  if (count === 0) {
    values[code] = 0;
    continue;
  }

  const pop = population.values[code];
  if (typeof pop !== 'number' || pop <= 0) {
    throw new Error(`Market ${code} has ${count} restaurants but no usable population`);
  }
  // Two decimals of precision so the tail ranks apart, though 'decimal1' displays one.
  values[code] = Math.round((count / (pop / 1e6)) * 100) / 100;
}

// Stable, code-sorted output for minimal diffs.
const sorted = {};
for (const code of Object.keys(values).sort()) sorted[code] = values[code];

const metric = {
  key: 'mcdonaldsPerMillion',
  label: "McDonald's per million people",
  unit: 'restaurants/million',
  format: 'decimal1',
  absence: 'unknown',
  source:
    `McDonald's Corporation "Restaurants by Market ${YEAR}" (year-end ${YEAR}, 97 markets, ` +
    `global total 45,356), divided by population (${population.year}). Places with no ` +
    `McDonald's carry an explicit 0; the 17 countries folded into another market's row ` +
    `(Monaco, Andorra, Liechtenstein, Cuba, Gibraltar, the Pacific markets and others) ` +
    `have restaurants but no published count and are left as "no data"`,
  year: YEAR,
  values: sorted,
};

const outPath = join(METRICS, 'mcdonaldsPerMillion.json');
writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

const zeros = Object.values(sorted).filter((v) => v === 0).length;
console.log(`Wrote ${outPath}`);
console.log(`  markets with restaurants: ${Object.keys(RAW_RESTAURANTS).length}`);
console.log(`  explicit zeros: ${zeros} (${Object.keys(WITHDREW).length} of them withdrawals)`);
console.log(`  folded, left as no data: ${Object.keys(FOLDED_INTO_PARENT).length}`);
console.log(`  total values: ${Object.keys(sorted).length} of ${realPlaces.length} real places`);
