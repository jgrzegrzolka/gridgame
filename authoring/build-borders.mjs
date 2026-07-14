/**
 * Regenerates flags/metrics/borders.json: the number of distinct countries a
 * place shares a LAND border with. A pure-geography "wow" metric: Russia and
 * China top out at 14, most islands sit at 0.
 *
 * DATA CONTRACT: dense. Every real place (`category !== 'other'`) gets a definite
 * integer count, so this is a plain dense metric (like area / coastline), NOT
 * absence:'unknown' or absence:'zero'. An island or an isolated territory genuinely
 * borders 0 countries, a real fact, not a data gap, so it carries 0 (not omission).
 * That upholds the "no data = not a place" invariant the TTT guard leans on: only
 * the org "flags" (EU, UN, ...) have no value. The build 0-fills every real place,
 * then overrides the land-bordered ones from BORDERS below.
 *
 * DEFINITION. The count is "distinct sovereign / territorial neighbours sharing a
 * land border", the standard trivia figure: France's metropolitan 8, not 11 (its
 * overseas parts, e.g. French Guiana, are separate entries here and carry their
 * own counts). Western Sahara, Kosovo, Palestine and the like are counted as the
 * neighbours they physically are. Sub-national entries count the foreign countries
 * they touch (Catalonia borders France + Andorra = 2; England touches no foreign
 * country = 0).
 *
 * SOURCE. Standard land-border counts (CIA World Factbook / the Wikipedia "list of
 * countries and territories by land borders"). Hand-maintained here because the
 * figure is stable and small; no network call, so this is deterministic. To
 * refresh or fix one country, edit BORDERS and re-run. See DATA_FEATURE.md and the
 * add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const YEAR = 2024;

/**
 * Land-border count keyed by our ISO 3166-1 alpha-2 flag code. Only the places
 * that border at least one country are listed; every other real place (all the
 * islands and isolated territories) is 0-filled by the build. A code here that is
 * not a real place in countries.json is logged and dropped.
 * @type {Record<string, number>}
 */
const BORDERS = {
  // ---- Africa ----
  dz: 7, ao: 4, bj: 4, bw: 4, bf: 6, bi: 3, cm: 6, cf: 6, td: 6, cg: 5, cd: 9,
  dj: 3, eg: 4, gq: 2, er: 3, sz: 2, et: 6, ga: 3, gm: 1, gh: 3, gn: 6, gw: 2,
  ci: 5, ke: 5, ls: 1, lr: 3, ly: 6, mw: 3, ml: 7, mr: 4, ma: 3, mz: 6, na: 4,
  ne: 7, ng: 4, rw: 4, sn: 5, sl: 2, so: 3, za: 6, ss: 6, sd: 7, tz: 8, tg: 3,
  tn: 2, ug: 5, zm: 8, zw: 4, eh: 3,
  // ---- Europe ----
  al: 4, ad: 2, at: 8, by: 5, be: 4, ba: 3, bg: 5, hr: 5, cz: 4, dk: 1, ee: 2,
  fi: 3, fr: 8, de: 9, gr: 4, hu: 7, ie: 1, it: 6, xk: 4, lv: 4, li: 2, lt: 4,
  lu: 3, md: 2, mc: 1, me: 5, nl: 2, mk: 5, no: 3, pl: 7, pt: 1, ro: 5, ru: 14,
  sm: 1, rs: 8, sk: 5, si: 4, es: 5, se: 2, ch: 5, ua: 7, va: 1, gb: 1,
  // ---- Asia / Middle East ----
  af: 6, // Afghanistan: China, Iran, Pakistan, Tajikistan, Turkmenistan, Uzbekistan
  am: 4, az: 5, bd: 2, bt: 2, bn: 1, kh: 3, cn: 14, ge: 4, in: 6, id: 3, ir: 7,
  iq: 6, il: 5, jo: 5, kz: 5, kw: 2, kg: 4, la: 5, lb: 2, my: 3, mn: 2, mm: 5,
  np: 2, kp: 3, om: 3, pk: 4, ps: 3, qa: 1, sa: 7, kr: 1, sy: 5, tj: 4, th: 4,
  tl: 1, tr: 8, tm: 4, ae: 2, uz: 5, vn: 3, ye: 2,
  // ---- Americas ----
  bz: 2, ca: 1, cr: 2, do: 1, sv: 2, gt: 4, ht: 1, hn: 3, mx: 3, ni: 2, pa: 2,
  us: 2, ar: 5, bo: 5, br: 10, cl: 3, co: 5, ec: 2, gy: 3, py: 3, pe: 5, sr: 3,
  uy: 2, ve: 3,
  // ---- Oceania ----
  pg: 1,
  // ---- Non-sovereign territories / sub-national parts with a land border ----
  gf: 2, // French Guiana: Brazil, Suriname
  gi: 1, // Gibraltar: Spain
  hk: 1, // Hong Kong: China
  mo: 1, // Macau: China
  'gb-nir': 1, // Northern Ireland: Ireland
  'es-ct': 2, // Catalonia: France, Andorra
  'es-pv': 1, // Basque Country: France
  'es-ga': 1, // Galicia: Portugal
};

function main() {
  const countries = JSON.parse(
    readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'),
  );
  const realCodes = new Set(
    countries.filter((c) => c.category !== 'other').map((c) => c.code),
  );

  // Dense: every real place starts at 0, then the land-bordered ones override.
  /** @type {Record<string, number>} */
  const values = {};
  for (const code of realCodes) values[code] = 0;

  const unknownCode = [];
  for (const [code, n] of Object.entries(BORDERS)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    values[code] = n;
  }

  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'borders',
    label: 'Bordering countries',
    unit: 'countries',
    // 'plain' -> whole count (14, 9, 0). The range is 0..14.
    format: 'plain',
    // Dense: no absence hint. Every real place has a true count (islands = 0);
    // only the org flags have none.
    source:
      `Number of distinct countries sharing a land border, standard land-border ` +
      `counts (CIA World Factbook / Wikipedia list of countries by land borders). ` +
      `Metropolitan counts (France 8, not counting overseas parts, which are ` +
      `separate entries). Islands and isolated territories carry a true 0`,
    year: YEAR,
    values: sorted,
  };

  const outPath = join(METRICS, 'borders.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  const nonZero = Object.values(sorted).filter((v) => v > 0).length;
  console.log(`Wrote ${outPath}`);
  console.log(`  values: ${Object.keys(sorted).length} real places (${nonZero} with a land border)`);
  console.log(`  top: cn=${sorted.cn} ru=${sorted.ru} br=${sorted.br} de=${sorted.de} cd=${sorted.cd}`);
  if (unknownCode.length) {
    console.error(`  border codes not in countries.json (dropped): ${unknownCode.join(', ')}`);
  }
}

main();
