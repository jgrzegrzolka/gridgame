/**
 * Regenerates flags/metrics/rice.json: rice (paddy) production per country.
 *
 * Rice is a *sparse* world metric, the sixth crop after coffee / wine / cocoa /
 * banana / apple and by far the largest by tonnage: ~119 countries grow paddy
 * rice (the whole tropics and subtropics, Asia dominant), while cool and arid
 * places grow none. Source: FAOSTAT 2024 (item 27 "Rice", paddy, via Our World
 * in Data's mirror), producers only. India leads (218M tonnes), then China
 * (208M), Bangladesh, Indonesia, Vietnam, Thailand: a heavily Asian top.
 *
 * DATA CONTRACT. Rice is *sparse* with `absence: 'zero'`, exactly like the other
 * crops. The emitted file lists growers only and carries the hint; the loader
 * (`attachRices` -> `attachZeroFilledMetric` in group.js) defaults every real
 * place (`category !== 'other'`) missing from the map to 0, leaving only the
 * non-place org flags without the field. A country that grows no rice is a *fair
 * wrong guess* on a "rice >= 1M tonnes" cell, NOT a data gap. The lens and the
 * superlative round read the raw sparse map instead (`createMetric`), ranking
 * growers only.
 *
 * Values are whole tonnes; a grower that rounds below 1 tonne falls to the
 * absence=0 default. Sorted by code for minimal refresh diffs.
 *
 * Snapshot, not a live fetch: OWID's CSV column names aren't a stable API, so
 * the FAOSTAT figures are embedded below (the same hand-maintained-table pattern
 * as build-apple.mjs). To refresh: re-pull
 *   https://ourworldindata.org/grapher/rice-production.csv?csvType=full
 * take each country's latest year, and update RAW_TONNES + YEAR. Two growers
 * (Nicaragua, Syria) have no 2024 row and carry their latest available year
 * (2023 / 1996); both are tiny and change no ranking or tier.
 *
 * See DATA_FEATURE.md "Feature DT" and the add-world-metric skill for the map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const YEAR = 2024;

/**
 * FAOSTAT rice (paddy) production, tonnes, keyed by our ISO 3166-1 alpha-2 flag
 * code (via Our World in Data's FAOSTAT mirror, item 27). Growers only: a real
 * place absent here grows none and defaults to 0 at load. Predominantly 2024;
 * the two sub-2024 figures (ni/sy) are each grower's latest available year. Raw
 * figures, rounded to whole tonnes on emit.
 * @type {Record<string, number>}
 */
const RAW_TONNES = {
  af: 654000, ao: 48340, ar: 1264770, au: 619180, az: 15290.57, bd: 60570452,
  bf: 513234.03, bg: 65840, bi: 136000, bj: 500605.34, bn: 3612.05, bo: 434028.22,
  br: 10671490, bt: 41536.79, bz: 16777, cd: 1940592, cf: 52867.55, cg: 1000,
  ci: 2381129, cl: 118673.23, cm: 345582.88, cn: 207530000, co: 2823000, cr: 64213.75,
  cu: 84331.03, do: 958000, dz: 313.12, ec: 1560200, eg: 6430000, es: 605820,
  et: 282719.5, fj: 8597.5, fm: 181.81, fr: 71960, ga: 1761.51, gf: 15073,
  gh: 1721200, gm: 52548, gn: 3680000, gr: 250090, gt: 31700.25, gw: 243900,
  gy: 1115800, hn: 23432.61, ht: 135000, hu: 8560, id: 53142730, in: 217867870,
  iq: 227508, ir: 3478820, it: 1448760, jp: 10142000, ke: 282152, kg: 48092,
  kh: 14200000, km: 5, kp: 2250000, kr: 4783114, kz: 512982.22, la: 3750740,
  lk: 4698453, lr: 322400, ma: 6006, mg: 4970000, mk: 18608, ml: 2756344,
  mm: 27650000, mr: 431700, mw: 127000, mx: 219587.88, my: 2102960, mz: 169311,
  ne: 164768, ng: 9129900, ni: 498969.1, np: 5955500, pa: 371000, pe: 3640432,
  pg: 882.53, ph: 19087136, pk: 14585231, pr: 3497.97, pt: 172120, py: 1051752,
  re: 185, ro: 14400, ru: 1258900, rw: 141932.4, sa: 1006.16, sb: 2756.01,
  sd: 27817.84, sl: 1390800, sn: 1580000, so: 2000, sr: 225923.12, ss: 38000,
  sv: 11000, sy: 100, sz: 1000, td: 347187, tg: 180200, th: 33551336,
  tj: 163548.83, tl: 62000, tm: 85535.7, tr: 1019000, tt: 784.4, tw: 1643000,
  tz: 4052140.8, ua: 15000, ug: 300000, us: 10075780, uy: 1305900, uz: 383563.94,
  ve: 611475.25, vn: 43450450, za: 3082.36, zm: 24565.61, zw: 73.5,
};

function main() {
  const countries = JSON.parse(
    readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'),
  );
  const realCodes = new Set(
    countries.filter((c) => c.category !== 'other').map((c) => c.code),
  );

  /** @type {Record<string, number>} */
  const values = {};
  const dropped = []; // growers that round below 1 tonne
  const unknownCode = []; // grower codes not present as a real place
  for (const [code, raw] of Object.entries(RAW_TONNES)) {
    if (!realCodes.has(code)) {
      unknownCode.push(code);
      continue;
    }
    const tonnes = Math.round(raw);
    if (tonnes < 1) {
      dropped.push(code);
      continue;
    }
    values[code] = tonnes;
  }

  // Stable, code-sorted output for minimal refresh diffs.
  const sorted = {};
  for (const code of Object.keys(values).sort()) sorted[code] = values[code];

  const metric = {
    key: 'rice',
    label: 'Rice production',
    unit: 'tonnes',
    // 'compact' -> 218M / 10.1M / 605K rice tonnes.
    format: 'compact',
    // Sparse: growers only, with the rest defaulted to 0 at load.
    absence: 'zero',
    source:
      `FAOSTAT ${YEAR} (rice, paddy, item 27) via Our World in Data; ` +
      'two minor growers (Nicaragua, Syria) carry their latest available ' +
      'year (2023 / 1996). Rounded to whole tonnes',
    year: YEAR,
    values: sorted,
  };

  const outPath = join(REPO, 'flags', 'metrics', 'rice.json');
  writeFileSync(outPath, JSON.stringify(metric, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(
    `  growers: ${Object.keys(sorted).length} ` +
      `(dropped <1t ${dropped.length ? dropped.join(',') : 'none'}) | ` +
      `real places ${realCodes.size} -> the rest default to 0 at load`,
  );
  if (unknownCode.length) {
    console.error(
      `  grower codes not in countries.json (dropped): ${unknownCode.join(', ')}`,
    );
  }
}

main();
