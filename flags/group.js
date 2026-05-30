export const CONTINENTS = [
  'Africa',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
  'Antarctica',
];

export function splitByCategory(entries) {
  const countries = [];
  const other = [];
  for (const e of entries) {
    (e.category === 'country' ? countries : other).push(e);
  }
  return { countries, other };
}

export function groupByContinent(countries) {
  const groups = Object.fromEntries(CONTINENTS.map((c) => [c, []]));
  for (const c of countries) {
    if (!(c.continent in groups)) {
      throw new Error(`Unknown continent "${c.continent}" for ${c.code} (${c.name})`);
    }
    groups[c.continent].push(c);
  }
  return groups;
}
