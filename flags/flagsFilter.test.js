import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilters, matchesFilters } from './flagsFilter.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./flagsFilter.js').Filters} Filters */

/**
 * @param {Partial<Country>} [over]
 * @returns {Country}
 */
function country(over = {}) {
  return {
    code: 'xx',
    name: 'X',
    category: 'country',
    continent: 'Europe',
    ...over,
  };
}

/**
 * @param {Partial<Record<keyof Filters, { include?: string[], exclude?: string[] }>>} spec
 * @returns {Filters}
 */
function filters(spec) {
  const f = emptyFilters();
  for (const k of /** @type {Array<keyof Filters>} */ (Object.keys(spec))) {
    const s = spec[k];
    if (!s) continue;
    if (s.include) f[k].include = new Set(s.include);
    if (s.exclude) f[k].exclude = new Set(s.exclude);
  }
  return f;
}

test('matchesFilters: empty filters accept every country', () => {
  assert.equal(matchesFilters(country(), emptyFilters()), true);
  assert.equal(matchesFilters(country({ category: 'other', continent: null }), emptyFilters()), true);
});

test('matchesFilters: status include filters by sovereignty', () => {
  const sovereign = country();
  const territory = country({ statehood: 'territory' });
  const f = filters({ status: { include: ['sovereign'] } });
  assert.equal(matchesFilters(sovereign, f), true);
  assert.equal(matchesFilters(territory, f), false);
});

test('matchesFilters: status include with multiple scalar values is AND — unsatisfiable, every country fails', () => {
  const f = filters({ status: { include: ['sovereign', 'territory'] } });
  // A country can only have one statehood; two-value AND can never match.
  assert.equal(matchesFilters(country(), f), false);
  assert.equal(matchesFilters(country({ statehood: 'territory' }), f), false);
  assert.equal(matchesFilters(country({ statehood: 'non_un' }), f), false);
});

test('matchesFilters: status exclude rejects countries with the excluded sovereignty', () => {
  const f = filters({ status: { exclude: ['territory'] } });
  assert.equal(matchesFilters(country(), f), true);
  assert.equal(matchesFilters(country({ statehood: 'territory' }), f), false);
});

test('matchesFilters: continent treats null/missing as "Other"', () => {
  const orphan = country({ category: 'other', continent: null });
  assert.equal(matchesFilters(orphan, filters({ continent: { include: ['Other'] } })), true);
  assert.equal(matchesFilters(orphan, filters({ continent: { include: ['Europe'] } })), false);
  assert.equal(matchesFilters(orphan, filters({ continent: { exclude: ['Other'] } })), false);
});

test('matchesFilters: color include requires every selected colour to be present (AND)', () => {
  const c = country({ colors: ['red', 'white'] });
  assert.equal(matchesFilters(c, filters({ color: { include: ['red', 'white'] } })), true);
  assert.equal(matchesFilters(c, filters({ color: { include: ['red', 'green'] } })), false);
  assert.equal(matchesFilters(c, filters({ color: { include: ['green'] } })), false);
});

test('matchesFilters: continent include with two values is unsatisfiable — every country fails', () => {
  // Two continents AND-ed: no single country can be in both.
  const f = filters({ continent: { include: ['Asia', 'Africa'] } });
  assert.equal(matchesFilters(country({ continent: 'Asia' }), f), false);
  assert.equal(matchesFilters(country({ continent: 'Africa' }), f), false);
});

test('matchesFilters: motif include requires every selected motif to be present (AND)', () => {
  const both = country({ motifs: ['weapon', 'animal'] });
  const onlyWeapon = country({ motifs: ['weapon'] });
  const f = filters({ motif: { include: ['weapon', 'animal'] } });
  assert.equal(matchesFilters(both, f), true);
  assert.equal(matchesFilters(onlyWeapon, f), false);
});

test('matchesFilters: color exclude rejects when any excluded colour appears', () => {
  const c = country({ colors: ['red', 'white'] });
  assert.equal(matchesFilters(c, filters({ color: { exclude: ['red'] } })), false);
  assert.equal(matchesFilters(c, filters({ color: { exclude: ['green'] } })), true);
});

test('matchesFilters: missing motifs are treated as an empty array', () => {
  const c = country(); // no motifs property
  assert.equal(matchesFilters(c, filters({ motif: { include: ['animal'] } })), false);
  assert.equal(matchesFilters(c, filters({ motif: { exclude: ['animal'] } })), true);
});

test('matchesFilters: motif exclude is exactly the "find missing tag" use case', () => {
  const withAnimal = country({ motifs: ['animal', 'star'] });
  const noAnimal = country({ motifs: ['star'] });
  const f = filters({ motif: { exclude: ['animal'] } });
  assert.equal(matchesFilters(withAnimal, f), false);
  assert.equal(matchesFilters(noAnimal, f), true);
});

test('matchesFilters: groups combine via AND', () => {
  const sovereignRed = country({ colors: ['red'] });
  const sovereignBlue = country({ colors: ['blue'] });
  const territoryRed = country({ statehood: 'territory', colors: ['red'] });
  const f = filters({
    status: { include: ['sovereign'] },
    color: { include: ['red'] },
  });
  assert.equal(matchesFilters(sovereignRed, f), true);
  assert.equal(matchesFilters(sovereignBlue, f), false);
  assert.equal(matchesFilters(territoryRed, f), false);
});

test('matchesFilters: include + exclude on different values in the same group both apply', () => {
  const redOnly = country({ colors: ['red'] });
  const redAndBlue = country({ colors: ['red', 'blue'] });
  const blueOnly = country({ colors: ['blue'] });
  const f = filters({ color: { include: ['red'], exclude: ['blue'] } });
  assert.equal(matchesFilters(redOnly, f), true);
  assert.equal(matchesFilters(redAndBlue, f), false);
  assert.equal(matchesFilters(blueOnly, f), false);
});

test('emptyFilters returns a fresh Filters with all include/exclude sets empty', () => {
  const f = emptyFilters();
  for (const k of /** @type {Array<keyof Filters>} */ (Object.keys(f))) {
    assert.equal(f[k].include.size, 0);
    assert.equal(f[k].exclude.size, 0);
  }
  // independence: mutating one instance doesn't affect a fresh one
  f.color.include.add('red');
  assert.equal(emptyFilters().color.include.size, 0);
});
