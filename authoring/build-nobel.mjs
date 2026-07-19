/**
 * Regenerates flags/metrics/nobel.json (Nobel laureates, absolute count) and
 * flags/metrics/nobelPerCapita.json (laureates per million people).
 *
 * ATTRIBUTION: COUNTRY OF BIRTH, remapped to modern borders. This is the single
 * decision that shapes both metrics, and it was made deliberately. The Nobel
 * Foundation publishes two country fields per laureate: where they were born, and
 * where they were working when the prize was announced. Affiliation-at-award piles
 * ~40% of every prize onto the United States and turns the per-capita metric into a
 * ranking of research funding. Birth country is what the popular league tables use,
 * and it is what makes the per-capita cut interesting: the top of that chart is
 * Saint Lucia, the Faroe Islands and Luxembourg, not the countries with the most
 * laureates. A non-obvious #1 is the whole reason an intensive metric earns its
 * place (see memory `feedback_prefer_intensive_metrics`).
 *
 * The cost of the choice, stated plainly: a laureate who left as an infant still
 * counts for the country they were born in. Both metrics' `source` strings say
 * "by country of birth" so no surface can imply otherwise.
 *
 * ALL SIX CATEGORIES: physics, chemistry, medicine, literature, peace, economics.
 * The 28 organisation laureates (Red Cross, UNHCR, WFP, ...) have no birth country
 * and are dropped, so the totals here count people, not prizes.
 *
 * MODERN BORDERS. The API's `birth.place.countryNow` already resolves historical
 * states, so a laureate born in Breslau, German Empire lands on Poland and one born
 * in Austria-Hungary lands on whichever successor holds that town today. We take
 * that field verbatim rather than re-deriving it; it is the Foundation's own call
 * and it is more consistent than anything we would hand-roll.
 *
 * TWO PLACES WHERE WE OVERRIDE THE API.
 *
 *   1. UK constituent nations. `countryNow` is inconsistent here: it says "Scotland"
 *      for 11 laureates but "United Kingdom" for four more who were plainly born in
 *      Scotland (Aberdeen, Edinburgh, Bearsden, Bellshill), and it never says
 *      "Wales" at all. Since countries.json carries gb-eng / gb-sct / gb-wls /
 *      gb-nir as real places, leaving them to fall through to `gb` would print
 *      "Wales: 0 laureates" on the lens, which is false. So UK_CITY_NATION below
 *      maps every UK birth city to its nation.
 *   2. Spanish autonomous communities. Same shape, one hit: Iria Flavia (Camilo
 *      José Cela) is in Galicia. Catalonia and the Basque Country genuinely have no
 *      Nobel-born laureate among Spain's seven, so their 0 is a real 0.
 *
 * NESTING. Sub-national places roll UP into their parent: `gb` carries the whole
 * United Kingdom (110), and gb-eng / gb-sct / gb-wls / gb-nir each carry their own
 * share of that same 110. `es` likewise contains its communities' laureates. This
 * matches how population.json and gdp.json treat these codes, which is what keeps
 * the per-capita division honest on both levels. Separately-coded territories
 * (Faroe Islands, Guadeloupe) are NOT rolled into Denmark / France, because the API
 * already reports them disjointly and countries.json treats them as their own place.
 *
 * DATA CONTRACT: dense, `absence: 'zero'` in spirit but written out explicitly.
 * "How many Nobel laureates were born here" has an answer for every real place, and
 * for most of them the answer is 0. That is a true zero, not a gap: the Foundation's
 * laureate list is complete, so a country's absence from it means nobody, not
 * unknown. Every real place (category !== 'other') therefore gets a value, and the
 * ~180 zeros are filled explicitly rather than omitted, so the TTT no-data guard
 * blocks only the org flags. See the data-contract section of the add-world-metric
 * skill; this is the Antarctica bug class.
 *
 * PER MILLION, not per capita. Raw per-capita gives 0.000003, unreadable on a round
 * card. Per million lands where it reads: Saint Lucia ~11, Iceland ~2.6, Sweden
 * ~2.8, United States ~0.87. Two decimals are stored so the crowded tail ranks
 * apart even though 'decimal1' displays one.
 *
 * ZERO-POPULATION PLACES. Antarctica and the uninhabited territories carry 0
 * laureates over a population of 0 or a few hundred. 0/0 is not a rank, so they take
 * an explicit 0 per million, which is the honest reading: nobody was born there and
 * won a Nobel. The Flag Party round is `zeroFiltered` on both metrics anyway, so a
 * quartet can never come up tied at zero.
 *
 * To refresh: re-run (it fetches api.nobelprize.org live, ~1,018 records over 11
 * pages). After a new prize announcement, check the console warning for any birth
 * city or country name the tables below do not know, and add it. The script throws
 * on an unmapped country rather than silently dropping a laureate.
 *
 * See DATA_FEATURE.md "Feature EN" and the add-world-metric skill.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const METRICS = join(REPO, 'flags', 'metrics');
const API = 'https://api.nobelprize.org/2.1/laureates';

/**
 * `countryNow` name -> ISO code, for every name the API emits that does not match a
 * countries.json name outright. Anything unmapped and unmatched throws.
 */
const COUNTRY_NAME_TO_CODE = {
  USA: 'us',
  'the Netherlands': 'nl',
  'United Kingdom': 'gb',
  Scotland: 'gb-sct',
  'Northern Ireland': 'gb-nir',
  Wales: 'gb-wls',
  England: 'gb-eng',
  'Czech Republic': 'cz', // countries.json says Czechia
  'East Timor': 'tl', // countries.json says Timor-Leste
  Turkey: 'tr', // countries.json says Türkiye
  Brunei: 'bn', // countries.json says Brunei Darussalam
  'Faroe Islands (Denmark)': 'fo',
  'Guadeloupe, France': 'gp',
};

/**
 * The three laureates whose API record carries no birth place at all. Verified
 * individually rather than guessed; the script warns if this list stops matching.
 */
const MISSING_BIRTH_PLACE = {
  'Abdulrazak Gurnah': 'tz', // born 1948 in Zanzibar
  'James A. Robinson': 'gb-eng', // born 1960 in Chelmsford, Essex
  'John M. Martinis': 'us', // born 1958, raised in San Pedro, California
};

/**
 * Every UK birth city in the laureate list -> constituent nation, England included.
 * England is spelled out rather than left as the fallback on purpose: with a silent
 * default, a newly announced laureate born in Glasgow or Cardiff would file as
 * English and nobody would notice. A city in neither table throws.
 */
const UK_CITY_NATION = {
  Banbury: 'gb-eng',
  Batley: 'gb-eng',
  Birmingham: 'gb-eng',
  Blackpool: 'gb-eng',
  Bradford: 'gb-eng',
  Brighton: 'gb-eng',
  Bristol: 'gb-eng',
  'Burnham-on-Sea': 'gb-eng',
  Cambridge: 'gb-eng',
  'Cheetham Hill': 'gb-eng',
  Chorley: 'gb-eng',
  Colchester: 'gb-eng',
  Derby: 'gb-eng',
  Dewsbury: 'gb-eng',
  Dippenhall: 'gb-eng',
  Eastbourne: 'gb-eng',
  Fareham: 'gb-eng',
  Fowey: 'gb-eng',
  Fulmer: 'gb-eng',
  Glusburn: 'gb-eng',
  Gravesend: 'gb-eng',
  Halifax: 'gb-eng',
  Hampstead: 'gb-eng',
  Harborne: 'gb-eng',
  Holbeach: 'gb-eng',
  'Kingston Hill': 'gb-eng',
  Lancashire: 'gb-eng',
  'Langford Grove, Maldon, Essex': 'gb-eng',
  Leeds: 'gb-eng',
  Leicester: 'gb-eng',
  Liverpool: 'gb-eng',
  London: 'gb-eng',
  Manchester: 'gb-eng',
  Mitcham: 'gb-eng',
  Neston: 'gb-eng',
  Newark: 'gb-eng',
  'Newcastle upon Tyne': 'gb-eng',
  Newquay: 'gb-eng',
  'Newton-le-Willows': 'gb-eng',
  Northampton: 'gb-eng',
  Norwich: 'gb-eng',
  Oxford: 'gb-eng',
  Rendcombe: 'gb-eng',
  'Rufford, near Chesterfield': 'gb-eng',
  Sheffield: 'gb-eng',
  Stainforth: 'gb-eng',
  Stroud: 'gb-eng',
  Swanage: 'gb-eng',
  Tardebigg: 'gb-eng',
  'Thames Ditton': 'gb-eng',
  Todmorden: 'gb-eng',
  Tonbridge: 'gb-eng',
  Warwick: 'gb-eng',
  Widnes: 'gb-eng',
  Wigton: 'gb-eng',
  Willesden: 'gb-eng',
  'Wisbech, Cambridgeshire': 'gb-eng',
  Woodstock: 'gb-eng',
  Aberdeen: 'gb-sct',
  Bearsden: 'gb-sct',
  Bellshill: 'gb-sct',
  Edinburgh: 'gb-sct',
  Glasgow: 'gb-sct',
  Glencorse: 'gb-sct',
  Minnigaff: 'gb-sct',
  Cluny: 'gb-sct',
  Kilmaurs: 'gb-sct',
  Lochfield: 'gb-sct',
  Uddingston: 'gb-sct',
  Cardiff: 'gb-wls',
  Swansea: 'gb-wls',
  Trelleck: 'gb-wls',
  Belfast: 'gb-nir',
  Londonderry: 'gb-nir',
  'Casteldàwson': 'gb-nir',
};

/** UK laureates whose API record gives a country but no birth city. */
const UK_NO_CITY = {
  'M. Stanley Whittingham': 'gb-eng', // born 1941 in Nottingham
  'Michael Houghton': 'gb-eng', // born 1949 in England
};

/** Spanish birth cities that sit in a countries.json autonomous community. */
const ES_CITY_REGION = {
  'Iria Flavia': 'es-ga',
};

/** Sub-national code -> the parent whose total must also include it. */
const ROLLS_UP_INTO = {
  'gb-eng': 'gb',
  'gb-sct': 'gb',
  'gb-wls': 'gb',
  'gb-nir': 'gb',
  'es-ga': 'es',
  'es-ct': 'es',
  'es-pv': 'es',
};

const countries = JSON.parse(readFileSync(join(REPO, 'flags', 'countries.json'), 'utf-8'));
const countryList = Array.isArray(countries) ? countries : countries.countries;
const realPlaces = countryList.filter((c) => c.category !== 'other');
const byName = new Map(realPlaces.map((c) => [c.name, c.code]));
const validCode = new Set(realPlaces.map((c) => c.code));

async function fetchLaureates() {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${API}?limit=100&offset=${offset}`);
    if (!res.ok) throw new Error(`Nobel API ${res.status} at offset ${offset}`);
    const page = (await res.json()).laureates || [];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

/** Resolve one laureate to a place code, or null if they are an organisation. */
function codeFor(laureate, warnings) {
  const name = laureate.knownName?.en || laureate.fullName?.en || '(unnamed)';
  const place = laureate.birth?.place;

  if (!place) {
    const manual = MISSING_BIRTH_PLACE[name];
    if (manual) return manual;
    // Organisations have no `birth` block at all; a person without one is new.
    if (laureate.birth) warnings.push(`No birth place and no manual entry: ${name}`);
    return null;
  }

  const countryName = place.countryNow?.en || place.country?.en;
  if (!countryName) {
    warnings.push(`No country name for ${name}`);
    return null;
  }

  let code = COUNTRY_NAME_TO_CODE[countryName] || byName.get(countryName);
  if (!code) throw new Error(`Unmapped birth country "${countryName}" (${name})`);

  const city = (place.cityNow?.en || place.city?.en || '').trim();
  if (code === 'gb' || code.startsWith('gb-')) {
    // The API says "United Kingdom" for people plainly born in Scotland, so the city
    // decides, not countryNow. Two laureates carry no city at all and are named here.
    const nation = UK_CITY_NATION[city] || UK_NO_CITY[name];
    if (!nation) throw new Error(`Unknown UK birth city "${city}" (${name}), add it to UK_CITY_NATION`);
    code = nation;
  } else if (code === 'es') {
    code = ES_CITY_REGION[city] || 'es';
  }

  if (!validCode.has(code)) throw new Error(`Resolved ${name} to unknown code "${code}"`);
  return code;
}

const warnings = [];
const laureates = await fetchLaureates();
const counts = {};
let people = 0;

for (const laureate of laureates) {
  const code = codeFor(laureate, warnings);
  if (!code) continue;
  people += 1;
  counts[code] = (counts[code] || 0) + 1;
  const parent = ROLLS_UP_INTO[code];
  if (parent) counts[parent] = (counts[parent] || 0) + 1;
}

// Dense fill: every real place gets a value, most of them a true 0.
const nobelValues = {};
for (const code of realPlaces.map((c) => c.code).sort()) nobelValues[code] = counts[code] || 0;

const population = JSON.parse(readFileSync(join(METRICS, 'population.json'), 'utf-8'));
const perCapitaValues = {};
for (const [code, count] of Object.entries(nobelValues)) {
  const pop = population.values[code];
  if (typeof pop !== 'number') throw new Error(`No population for ${code}`);
  // 0/0 is not a rank: an uninhabited place with no laureates reads as an honest 0.
  perCapitaValues[code] = pop > 0 ? Math.round((count / (pop / 1e6)) * 100) / 100 : 0;
}

const YEAR = Math.max(
  ...laureates.flatMap((l) => (l.nobelPrizes || []).map((p) => Number(p.awardYear) || 0)),
);

const attribution =
  `Nobel Foundation laureate API (api.nobelprize.org), all prizes 1901-${YEAR}, ` +
  `counted by country of birth on modern borders. Organisation laureates are excluded, ` +
  `so these are people, not prizes. UK and Spanish sub-national places carry their own ` +
  `share and also roll up into the United Kingdom / Spain totals`;

writeFileSync(
  join(METRICS, 'nobel.json'),
  JSON.stringify(
    {
      key: 'nobel',
      label: 'Nobel laureates',
      unit: 'laureates',
      format: 'compact',
      absence: 'zero',
      source: attribution,
      year: YEAR,
      values: nobelValues,
    },
    null,
    2,
  ) + '\n',
  'utf-8',
);

writeFileSync(
  join(METRICS, 'nobelPerCapita.json'),
  JSON.stringify(
    {
      key: 'nobelPerCapita',
      label: 'Nobel laureates per million people',
      unit: 'laureates/million',
      format: 'decimal1',
      absence: 'zero',
      source: `${attribution}, divided by population (${population.year})`,
      year: YEAR,
      values: perCapitaValues,
    },
    null,
    2,
  ) + '\n',
  'utf-8',
);

const withAny = Object.values(nobelValues).filter((v) => v > 0).length;
console.log(`Wrote nobel.json and nobelPerCapita.json`);
console.log(`  laureates counted: ${people} of ${laureates.length} records (rest are organisations)`);
console.log(`  places with at least one: ${withAny} of ${realPlaces.length} real places`);
console.log(`  latest award year: ${YEAR}`);
for (const w of warnings) console.warn(`  WARNING: ${w}`);
