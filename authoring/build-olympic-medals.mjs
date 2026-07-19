/**
 * Regenerates the four Olympic-medal metrics from one source pull:
 *   flags/metrics/summerMedals.json         Summer Games medals, all-time
 *   flags/metrics/summerMedalsPerCapita.json  ...per million people
 *   flags/metrics/winterMedals.json         Winter Games medals, all-time
 *   flags/metrics/winterMedalsPerCapita.json  ...per million people
 *
 * WHY SUMMER AND WINTER ARE SEPARATE METRICS, not one combined count. Summer has
 * roughly five times the medals of Winter, so a combined total is really just the
 * Summer ranking with noise on top, and Winter's entirely different story would be
 * drowned out. Split, they answer two genuinely different questions: Summer is led
 * by the United States, Winter by Norway. Jan's call, and the reason the metric
 * trail gets two subjects here rather than one.
 *
 * WHY EACH HAS A PER-MILLION TWIN. The absolute counts rank the big rich countries
 * in the order everyone expects. The intensive cut is where the metric earns its
 * place: the per-million leaders are tiny countries with one strong niche
 * (Liechtenstein's alpine skiers, Grenada's sprinters), never the giants. See
 * memory `feedback_prefer_intensive_metrics`. In Flag Party the total and its
 * per-million twin share ONE draft card per season (`summerMedals` /
 * `winterMedals` in `METRIC_FAMILIES`), so the hand never spends two slots asking
 * the picker to arbitrate "total or per head". Summer and Winter stay two cards:
 * the family bar is "two ways of asking one question", and they are two questions.
 *
 * DEFUNCT NOCs: MERGE ONLY WHERE THERE IS EXACTLY ONE SUCCESSOR STATE. This is the
 * decision that shapes the numbers, taken with Jan before any code. The source
 * table deliberately does NOT combine defunct NOCs with their successors ("The
 * totals of NOCs are not combined with those of their predecessors and
 * successors"), and those NOCs have no flag in countries.json, so each one must be
 * either merged into a modern place or dropped. The rule:
 *
 *   MERGE (one unambiguous successor): East Germany (GDR), West Germany (FRG) and
 *   the United Team of Germany (EUA) all fold into Germany. Reunification makes
 *   Germany the sole successor to all three, and leaving them out would put
 *   Germany absurdly low in a table it genuinely leads. Cross-check: our merged
 *   Summer total (688 + 409 + 204 + 118 = 1,419) reproduces Wikipedia's own
 *   "including precursors" figure exactly, which is a real check on the arithmetic
 *   and on the claim that these four rows are disjoint.
 *
 *   DROP (many successors, or no country at all): the Soviet Union, the Russian
 *   Empire and the Unified Team each split across 12-15 states, and there is no
 *   fair way to divide their medals. Awarding the USSR's 1,204 to Russia alone is
 *   the single most common error in amateur versions of this table, and Ukraine or
 *   Kazakhstan would have an equally good claim. Czechoslovakia, Yugoslavia,
 *   Serbia and Montenegro, Australasia, the British West Indies, the Netherlands
 *   Antilles and Bohemia are the same shape. The special delegations (the Refugee
 *   Olympic Team, Mixed teams, Independent Olympic Athletes/Participants, and the
 *   neutral-designation Russian teams OAR and AIN) are not any country's NOC and
 *   are dropped too. This costs us ~1,700 medals that simply have no modern home,
 *   which is honest: they were won by countries that no longer exist.
 *
 * DATA CONTRACT: dense, `absence: 'zero'`. "How many Olympic medals has this place
 * won" has an answer for every real place, and for most the answer is 0. That is a
 * true zero, not a gap: the source lists every medal ever awarded, so absence from
 * it means none, not unknown. Every real place is filled explicitly so the TTT
 * no-data guard blocks only the org flags (the Antarctica bug class). Note the
 * source also names 64 NOCs that have competed and never medalled: those are
 * genuine, well-attested zeros rather than assumptions.
 *
 * PER MILLION, not per capita. True per-capita gives 0.00002, unreadable on a round
 * card. Per million lands where it reads, and the Winter figures are the best
 * trivia in the set: Liechtenstein is around 250 per million off ten medals and
 * 39,000 people, an order of magnitude clear of Norway. Zero-population places take
 * an explicit 0 rather than an undefined 0/0; the party rounds are `zeroFiltered`
 * so a quartet can never come up tied at zero.
 *
 * SOURCE: Wikipedia's "All-time Olympic Games medal table" (1896-2026, Summer +
 * Winter). Chosen because it is the maintained aggregate of the IOC's own results
 * and it is explicit about the precursor question, which is the only hard part
 * here. The parse reads the main per-NOC table, whose rows carry 15 numeric cells
 * (Summer games/G/S/B/total, Winter ditto, Combined ditto); we take the two totals.
 *
 * To refresh: re-run (it fetches Wikipedia's parse API live). The script throws on
 * an NOC code it cannot resolve, so a newly medalling nation surfaces as a build
 * failure rather than a silently missing row. After a Games, re-check MERGE_INTO
 * and DROP_NOCS for any new special delegation.
 *
 * See DATA_FEATURE.md "Feature EO" and the add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const PAGE = 'All-time_Olympic_Games_medal_table';
const API = `https://en.wikipedia.org/w/api.php?action=parse&page=${PAGE}&format=json&formatversion=2&prop=`;

/**
 * NOC codes whose medals fold into a modern place: exactly one successor state.
 * Germany is the only case that qualifies (see the header).
 */
const MERGE_INTO = {
  GDR: 'de', // East Germany, 1968-1988
  FRG: 'de', // West Germany, 1968-1988
  EUA: 'de', // United Team of Germany, 1956-1964
};

/**
 * NOC codes with no single successor, or no country at all. Dropped, not merged.
 * Listed explicitly (rather than "anything unmapped") so a NEW code can never be
 * silently discarded: an unknown NOC throws.
 */
const DROP_NOCS = new Set([
  'URS', // Soviet Union -> 15 states
  'RU1', // Russian Empire -> same
  'EUN', // Unified Team 1992 -> 12 states
  'TCH', // Czechoslovakia -> Czechia + Slovakia
  'YUG', // Yugoslavia -> 6+ states
  'SCG', // Serbia and Montenegro -> 2 states
  'BOH', // Bohemia -> via Czechoslovakia, same split
  'ANZ', // Australasia -> Australia + New Zealand
  'BWI', // British West Indies Federation -> several Caribbean states
  'AHO', // Netherlands Antilles -> Curacao, Sint Maarten, and others
  'OAR', // Olympic Athletes from Russia (2018): a sanction-era neutral designation
  'ROC', // Russian Olympic Committee (2020/2022): the same, under a third name
  'AIN', // Individual Neutral Athletes: mixed nationalities
  'IOA', // Independent Olympic Athletes: mixed
  'IOP', // Independent Olympic Participants 1992
  'EOR', // Refugee Olympic Team: no country
  'ZZX', // Mixed team, early Games
]);

/** NOC -> ISO where the source's country name does not match countries.json. */
const NOC_NAME_FIXUPS = {
  CPV: 'cv', // Cape Verde -> Cabo Verde
  CIV: 'ci', // Ivory Coast -> Cote d'Ivoire
  CZE: 'cz', // Czech Republic -> Czechia
  GBR: 'gb', // Great Britain -> United Kingdom
  TPE: 'tw', // Chinese Taipei -> Taiwan
  TUR: 'tr', // Turkey -> Turkiye
  USA: 'us', // United States -> United States of America
  ISV: 'vi', // Virgin Islands -> Virgin Islands (U.S.)
};

const countries = JSON.parse(readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'));
const countryList = Array.isArray(countries) ? countries : countries.countries;
const realPlaces = countryList.filter((c) => c.category !== 'other');
const byName = new Map(realPlaces.map((c) => [c.name.toLowerCase(), c.code]));
const validCode = new Set(realPlaces.map((c) => c.code));

async function fetchPage(prop) {
  const res = await fetch(API + prop);
  if (!res.ok) throw new Error(`Wikipedia API ${res.status} for prop=${prop}`);
  return (await res.json()).parse[prop === 'text' ? 'text' : 'wikitext'];
}

/**
 * Medal totals per NOC from the main table. Each data row carries 15 numeric
 * cells: Summer (games, gold, silver, bronze, total), Winter (same), Combined
 * (same). We take index 4 and index 9.
 *
 * @param {string} wikitext
 * @returns {Record<string, { summer: number, winter: number }>}
 */
function parseMedalTable(wikitext) {
  /** @type {Record<string, { summer: number, winter: number }>} */
  const out = {};
  for (const chunk of wikitext.split(/\n\|-/)) {
    const code = chunk.match(/flag\s?IOC\|([A-Z0-9]{3})/);
    if (!code) continue;
    const nums = [...chunk.matchAll(/\|\s*(?:style="[^"]*"\s*\|)?\s*(?:''')?(\d[\d,]*)(?:''')?\s*(?=\|\||\n|$)/g)]
      .map((m) => Number(m[1].replace(/,/g, '')));
    if (nums.length < 15) continue;
    if (!out[code[1]]) out[code[1]] = { summer: nums[4], winter: nums[9] };
  }
  return out;
}

/** NOC code -> the country name the source links, from the rendered HTML. */
function parseNocNames(html) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /id="([A-Z0-9]{3})"[\s\S]{0,600}?<a href="\/wiki\/[^"]*"[^>]*title="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!out[m[1]]) out[m[1]] = m[2].replace(/ at the .*$/, '').trim();
  }
  return out;
}

const [wikitext, html] = await Promise.all([fetchPage('wikitext'), fetchPage('text')]);
const medals = parseMedalTable(wikitext);
const nocNames = parseNocNames(html);

/** @type {Record<string, number>} */
const summer = {};
/** @type {Record<string, number>} */
const winter = {};
let dropped = 0;
let droppedMedals = 0;

for (const [noc, m] of Object.entries(medals)) {
  if (DROP_NOCS.has(noc)) {
    dropped += 1;
    droppedMedals += m.summer + m.winter;
    continue;
  }
  const code = MERGE_INTO[noc] || NOC_NAME_FIXUPS[noc] || byName.get((nocNames[noc] || '').toLowerCase());
  if (!code) throw new Error(`Unresolved NOC "${noc}" (${nocNames[noc] || 'no name'}) - map or drop it`);
  if (!validCode.has(code)) throw new Error(`NOC ${noc} resolved to unknown code "${code}"`);
  summer[code] = (summer[code] || 0) + m.summer;
  winter[code] = (winter[code] || 0) + m.winter;
}

// Cross-check the one merge we do perform, against the source's own published
// "including precursors" figure. A silent double-count here would be invisible.
if (summer.de !== 1419) throw new Error(`Germany summer expected 1419 (688+409+204+118), got ${summer.de}`);

const population = JSON.parse(readFileSync(join(METRICS, 'population.json'), 'utf-8'));

/** Dense fill + the per-million twin, for one season. */
function build(counts) {
  /** @type {Record<string, number>} */
  const total = {};
  /** @type {Record<string, number>} */
  const perCapita = {};
  for (const code of realPlaces.map((c) => c.code).sort()) {
    const n = counts[code] || 0;
    total[code] = n;
    const pop = population.values[code];
    if (typeof pop !== 'number') throw new Error(`No population for ${code}`);
    // 0/0 is not a rank: an uninhabited place with no medals reads as an honest 0.
    perCapita[code] = pop > 0 ? Math.round((n / (pop / 1e6)) * 100) / 100 : 0;
  }
  return { total, perCapita };
}

const S = build(summer);
const W = build(winter);

const provenance =
  `Wikipedia "All-time Olympic Games medal table" (1896-2026), the maintained aggregate ` +
  `of the IOC's own results. East and West Germany and the United Team of Germany are ` +
  `merged into Germany (one unambiguous successor); the Soviet Union, Czechoslovakia, ` +
  `Yugoslavia and the other multi-successor NOCs, plus the neutral and refugee ` +
  `delegations, have no modern home and are excluded rather than reassigned`;

/** @param {string} key @param {string} label @param {string} unit @param {string} fmt @param {Record<string, number>} values @param {string} note */
function write(key, label, unit, fmt, values, note) {
  writeFileSync(
    join(METRICS, `${key}.json`),
    JSON.stringify(
      { key, label, unit, format: fmt, absence: 'zero', source: `${provenance}. ${note}`, year: 2026, values },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

write('summerMedals', 'Summer Olympic medals', 'medals', 'compact', S.total, 'All medals, Summer Games only');
write('winterMedals', 'Winter Olympic medals', 'medals', 'compact', W.total, 'All medals, Winter Games only');
write('summerMedalsPerCapita', 'Summer Olympic medals per million people', 'medals/million', 'decimal1', S.perCapita,
  `Summer medals divided by population (${population.year})`);
write('winterMedalsPerCapita', 'Winter Olympic medals per million people', 'medals/million', 'decimal1', W.perCapita,
  `Winter medals divided by population (${population.year})`);

const withSummer = Object.values(S.total).filter((v) => v > 0).length;
const withWinter = Object.values(W.total).filter((v) => v > 0).length;
console.log('Wrote summerMedals / summerMedalsPerCapita / winterMedals / winterMedalsPerCapita');
console.log(`  NOCs in source: ${Object.keys(medals).length}, dropped: ${dropped} (${droppedMedals} medals with no modern home)`);
console.log(`  places with Summer medals: ${withSummer}, Winter: ${withWinter}, of ${realPlaces.length} real places`);
console.log(`  Germany merged: ${summer.de} summer / ${winter.de} winter`);
