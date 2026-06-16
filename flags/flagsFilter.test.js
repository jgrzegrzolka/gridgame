import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilters, matchesFilters, createColorCountLock } from './flagsFilter.js';
import { createCountry } from './group.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./flagsFilter.js').Filters} Filters */

/**
 * @param {Partial<Country>} [over]
 * @returns {Country}
 */
function country(over = {}) {
  return createCountry({
    code: 'xx',
    name: 'X',
    category: 'country',
    continent: 'Europe',
    ...over,
  });
}

/**
 * @param {Partial<Record<keyof Filters, { include?: string[], exclude?: string[] }>>} spec
 * @returns {Filters}
 */
function filters(spec) {
  const f = emptyFilters();
  for (const k of /** @type {Array<'status'|'continent'|'color'|'motif'|'stripesOnly'>} */ (Object.keys(spec))) {
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
  const c = country({ primaryColors: ['red', 'white'] });
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
  const c = country({ primaryColors: ['red', 'white'] });
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
  const sovereignRed = country({ primaryColors: ['red'] });
  const sovereignBlue = country({ primaryColors: ['blue'] });
  const territoryRed = country({ statehood: 'territory', primaryColors: ['red'] });
  const f = filters({
    status: { include: ['sovereign'] },
    color: { include: ['red'] },
  });
  assert.equal(matchesFilters(sovereignRed, f), true);
  assert.equal(matchesFilters(sovereignBlue, f), false);
  assert.equal(matchesFilters(territoryRed, f), false);
});

test('matchesFilters: include + exclude on different values in the same group both apply', () => {
  const redOnly = country({ primaryColors: ['red'] });
  const redAndBlue = country({ primaryColors: ['red', 'blue'] });
  const blueOnly = country({ primaryColors: ['blue'] });
  const f = filters({ color: { include: ['red'], exclude: ['blue'] } });
  assert.equal(matchesFilters(redOnly, f), true);
  assert.equal(matchesFilters(redAndBlue, f), false);
  assert.equal(matchesFilters(blueOnly, f), false);
});

test('matchesFilters: colorField "primaryColors" reads only the primaryColors bucket, ignoring additionalColors', () => {
  // Country split into primary + additional — e.g. Portugal: green/red are primary
  // (visible from across a room), yellow/blue/white are additional (COA-only).
  // A "yellow" filter must reject under primaryColors but accept under colors (the union).
  const portugal = country({
    code: 'pt',
    primaryColors: ['green', 'red'],
    additionalColors: ['yellow', 'blue', 'white'],
  });
  // Under default (colorField: 'colors'), all five colors are matchable via the union.
  assert.equal(matchesFilters(portugal, filters({ color: { include: ['yellow'] } })), true);
  // Under primaryColors, yellow drops out because it's only in the COA.
  assert.equal(
    matchesFilters(portugal, filters({ color: { include: ['yellow'] } }), { colorField: 'primaryColors' }),
    false,
  );
  // Green stays primary; both modes accept.
  assert.equal(matchesFilters(portugal, filters({ color: { include: ['green'] } })), true);
  assert.equal(
    matchesFilters(portugal, filters({ color: { include: ['green'] } }), { colorField: 'primaryColors' }),
    true,
  );
});

test('matchesFilters: a flag with no additionalColors matches the same set under colors and primaryColors', () => {
  // Plain tricolours (no COA, no emblem) have additionalColors empty, so the
  // union equals primaryColors and both colorFields resolve identically.
  const italy = country({ code: 'it', primaryColors: ['green', 'white', 'red'], additionalColors: [] });
  assert.equal(
    matchesFilters(italy, filters({ color: { include: ['green'] } }), { colorField: 'primaryColors' }),
    true,
  );
  assert.equal(matchesFilters(italy, filters({ color: { include: ['green'] } })), true);
  assert.equal(
    matchesFilters(italy, filters({ color: { include: ['blue'] } }), { colorField: 'primaryColors' }),
    false,
  );
  assert.equal(matchesFilters(italy, filters({ color: { include: ['blue'] } })), false);
});

test('matchesFilters: colorCount {op:=, n:3} matches countries whose total palette size equals 3', () => {
  // Slovakia-shape: 3 colours total, all primary (no additional).
  const sk = country({ code: 'sk', primaryColors: ['white','blue','red'], additionalColors: [] });
  // Croatia-shape: 3 primary + 1 additional = 4 total.
  const hr = country({ code: 'hr', primaryColors: ['white','blue','red'], additionalColors: ['yellow'] });
  // Filter "exactly 3 colours" picks sk, rejects hr — regardless of colorField,
  // because colorCount always checks the full union.
  const f = emptyFilters();
  f.colorCount = { op: '=', n: 3 };
  assert.equal(matchesFilters(sk, f), true);
  assert.equal(matchesFilters(hr, f), false);
  assert.equal(matchesFilters(sk, f, { colorField: 'primaryColors' }), true);
  assert.equal(matchesFilters(hr, f, { colorField: 'primaryColors' }), false);
});

test('matchesFilters: colorCount {op:>=, n:4} matches countries with 4 or more colours', () => {
  const three = country({ code: 'sk', primaryColors: ['white','blue','red'], additionalColors: [] });
  const four = country({ code: 'hr', primaryColors: ['white','blue','red'], additionalColors: ['yellow'] });
  const five = country({ code: 'xx', primaryColors: ['white','blue','red','yellow','green'], additionalColors: [] });
  const f = emptyFilters();
  f.colorCount = { op: '>=', n: 4 };
  assert.equal(matchesFilters(three, f), false);
  assert.equal(matchesFilters(four, f), true);
  assert.equal(matchesFilters(five, f), true);
});

test('matchesFilters: colorCount {op:<=, n:2} matches countries with 2 or fewer colours', () => {
  const one = country({ code: 'aa', primaryColors: ['red'] });
  const two = country({ code: 'jp', primaryColors: ['white','red'] });
  const three = country({ code: 'sk', primaryColors: ['white','blue','red'] });
  const f = emptyFilters();
  f.colorCount = { op: '<=', n: 2 };
  assert.equal(matchesFilters(one, f), true);
  assert.equal(matchesFilters(two, f), true);
  assert.equal(matchesFilters(three, f), false);
});

test('matchesFilters: colorCount {op:=, n:0} picks only empty-palette countries (none in real data, but the predicate must work)', () => {
  const c = country({ code: 'xx', primaryColors: [], additionalColors: [] });
  const f = emptyFilters();
  f.colorCount = { op: '=', n: 0 };
  assert.equal(matchesFilters(c, f), true);
  const nonEmpty = country({ code: 'yy', primaryColors: ['red'], additionalColors: [] });
  assert.equal(matchesFilters(nonEmpty, f), false);
});

test('matchesFilters: colorCount combines with color includes — "only red+white+blue" pattern', () => {
  const sk = country({ code: 'sk', primaryColors: ['white','blue','red'], additionalColors: [] });
  const hr = country({ code: 'hr', primaryColors: ['white','blue','red'], additionalColors: ['yellow'] });
  // Same flags as before, but now testing the realistic puzzle pattern:
  // include {red,white,blue} AND colorCount {op:=, n:3}. sk passes, hr fails on count.
  const f = filters({ color: { include: ['red','white','blue'] } });
  f.colorCount = { op: '=', n: 3 };
  assert.equal(matchesFilters(sk, f), true);
  assert.equal(matchesFilters(hr, f), false);
});

test('emptyFilters returns a fresh Filters with all include/exclude sets empty and colorCount null', () => {
  const f = emptyFilters();
  for (const k of /** @type {Array<'status'|'continent'|'color'|'motif'|'stripesOnly'>} */ (['status','continent','color','motif','stripesOnly'])) {
    assert.equal(f[k].include.size, 0);
    assert.equal(f[k].exclude.size, 0);
  }
  assert.equal(f.colorCount, null);
  // independence: mutating one instance doesn't affect a fresh one
  f.color.include.add('red');
  assert.equal(emptyFilters().color.include.size, 0);
});

// stripesOnly — scalar group: a flag has exactly one orientation, or null
// (not pure stripes). Two-value AND is unsatisfiable; excluding a value
// lets null-stripes flags through (`!horizontal` includes vertical AND null).

test('matchesFilters: stripesOnly include matches the flag with that exact orientation', () => {
  const fr = country({ code: 'fr', stripesOnly: 'vertical' });
  const de = country({ code: 'de', stripesOnly: 'horizontal' });
  const mx = country({ code: 'mx', stripesOnly: null });
  const f = filters({ stripesOnly: { include: ['vertical'] } });
  assert.equal(matchesFilters(fr, f), true);
  assert.equal(matchesFilters(de, f), false);
  assert.equal(matchesFilters(mx, f), false);
});

test('matchesFilters: stripesOnly include with two values is unsatisfiable (scalar AND)', () => {
  const f = filters({ stripesOnly: { include: ['horizontal', 'vertical'] } });
  assert.equal(matchesFilters(country({ stripesOnly: 'horizontal' }), f), false);
  assert.equal(matchesFilters(country({ stripesOnly: 'vertical' }), f), false);
  assert.equal(matchesFilters(country({ stripesOnly: null }), f), false);
});

test('matchesFilters: stripesOnly exclude rejects the excluded orientation and lets null through', () => {
  const f = filters({ stripesOnly: { exclude: ['horizontal'] } });
  assert.equal(matchesFilters(country({ stripesOnly: 'horizontal' }), f), false);
  assert.equal(matchesFilters(country({ stripesOnly: 'vertical' }), f), true);
  // null-stripes flags must pass — "not horizontal stripes" includes flags
  // that aren't pure stripes at all (Mexico, US, UK, Switzerland, …).
  assert.equal(matchesFilters(country({ stripesOnly: null }), f), true);
});

test('matchesFilters: stripesOnly defaults missing field to null and rejects positive include', () => {
  // Country object with no stripesOnly property — should behave like null.
  const c = country({});
  const inc = filters({ stripesOnly: { include: ['horizontal'] } });
  assert.equal(matchesFilters(c, inc), false);
  const exc = filters({ stripesOnly: { exclude: ['horizontal'] } });
  assert.equal(matchesFilters(c, exc), true);
});

test('matchesFilters: stripesOnly composes with continent (the daily-puzzle use case)', () => {
  // "European horizontal-stripe flags" — the canonical puzzle filter shape.
  const f = filters({
    continent: { include: ['Europe'] },
    stripesOnly: { include: ['horizontal'] },
  });
  const de = country({ code: 'de', continent: 'Europe', stripesOnly: 'horizontal' });
  const fr = country({ code: 'fr', continent: 'Europe', stripesOnly: 'vertical' });
  const ng = country({ code: 'ng', continent: 'Africa', stripesOnly: 'vertical' });
  const eg = country({ code: 'eg', continent: 'Africa', stripesOnly: null });
  assert.equal(matchesFilters(de, f), true);
  assert.equal(matchesFilters(fr, f), false);
  assert.equal(matchesFilters(ng, f), false);
  assert.equal(matchesFilters(eg, f), false);
});

// createColorCountLock — the state machine behind the "no other colours"
// toggle pill on both findFlag and flagsdata. Pages drove their own copies
// of this until the second consumer arrived; tests pin the contract so
// drift between the two pages is impossible.

test('createColorCountLock: starts off — isOn false, colorCount untouched', () => {
  const f = emptyFilters();
  const lock = createColorCountLock(f);
  assert.equal(lock.isOn, false);
  assert.equal(f.colorCount, null);
});

test('createColorCountLock: toggle() flips on and binds colorCount to include set size with op =', () => {
  const f = emptyFilters();
  f.color.include.add('red');
  f.color.include.add('white');
  const lock = createColorCountLock(f);
  assert.equal(lock.toggle(), true);
  assert.equal(lock.isOn, true);
  assert.deepEqual(f.colorCount, { op: '=', n: 2 });
});

test('createColorCountLock: second toggle() flips off and clears colorCount', () => {
  const f = emptyFilters();
  f.color.include.add('red');
  const lock = createColorCountLock(f);
  lock.toggle();
  assert.equal(lock.toggle(), false);
  assert.equal(lock.isOn, false);
  assert.equal(f.colorCount, null);
});

test('createColorCountLock: sync() while on tracks include-set growth and shrinkage', () => {
  const f = emptyFilters();
  f.color.include.add('red');
  const lock = createColorCountLock(f);
  lock.toggle();
  assert.deepEqual(f.colorCount, { op: '=', n: 1 });
  // page added another colour pill — sync picks up the new size
  f.color.include.add('white');
  lock.sync();
  assert.deepEqual(f.colorCount, { op: '=', n: 2 });
  // and shrinks back when a pill is removed
  f.color.include.delete('red');
  lock.sync();
  assert.deepEqual(f.colorCount, { op: '=', n: 1 });
});

test('createColorCountLock: sync() while off is a no-op — colorCount stays null', () => {
  const f = emptyFilters();
  f.color.include.add('red');
  const lock = createColorCountLock(f);
  lock.sync();
  assert.equal(f.colorCount, null,
    'sync without ever toggling on must not flip the lock — it just re-applies current state');
});

test('createColorCountLock: sync() while off does NOT clobber an externally-set filter (e.g. picker pill)', () => {
  // Pinning the live contention bug: picker engages with =3, then
  // user toggles a colour pill → cyclePill calls colorCountLock.sync()
  // → sync MUST leave filter.colorCount alone. Old behaviour set it
  // to null, silently disabling the picker's filter mid-flow.
  const f = emptyFilters();
  const lock = createColorCountLock(f);
  // Simulate the picker writing the primitive
  f.colorCount = { op: '=', n: 3 };
  lock.sync();
  assert.deepEqual(f.colorCount, { op: '=', n: 3 },
    'sync (lock off) must not clobber the picker\'s value');
});

test('createColorCountLock: disengage() flips off without touching filter.colorCount', () => {
  // Used when the colour-count picker takes over the shared primitive:
  // the lock has to disengage cosmetically, but blowing away
  // filter.colorCount would clobber what the picker just wrote.
  const f = emptyFilters();
  f.color.include.add('red');
  const lock = createColorCountLock(f);
  lock.toggle();
  assert.deepEqual(f.colorCount, { op: '=', n: 1 });
  // Simulate the picker taking over with a different value
  f.colorCount = { op: '>=', n: 4 };
  lock.disengage();
  assert.equal(lock.isOn, false);
  assert.deepEqual(f.colorCount, { op: '>=', n: 4 },
    'disengage must NOT clobber the picker\'s value');
});

test('createColorCountLock: reset() turns off and clears, regardless of prior state', () => {
  const f = emptyFilters();
  f.color.include.add('red');
  const lock = createColorCountLock(f);
  lock.toggle();
  assert.deepEqual(f.colorCount, { op: '=', n: 1 });
  lock.reset();
  assert.equal(lock.isOn, false);
  assert.equal(f.colorCount, null);
  // reset on an already-off lock is also fine — pages call it from Clear
  // unconditionally without checking isOn first.
  lock.reset();
  assert.equal(lock.isOn, false);
  assert.equal(f.colorCount, null);
});

test('createColorCountLock: matchesFilters honours the locked colorCount on a realistic Slovakia/Croatia pair', () => {
  // End-to-end pin so a future refactor of the lock can't silently break
  // the "only red+white+blue, 3 colours total" puzzle pattern that the
  // backlog leans on.
  const sk = createCountry({ code: 'sk', name: 'Slovakia', category: 'country', continent: 'Europe',
    primaryColors: ['white','blue','red'], additionalColors: [] });
  const hr = createCountry({ code: 'hr', name: 'Croatia', category: 'country', continent: 'Europe',
    primaryColors: ['white','blue','red'], additionalColors: ['yellow'] });
  const f = emptyFilters();
  f.color.include.add('red');
  f.color.include.add('white');
  f.color.include.add('blue');
  const lock = createColorCountLock(f);
  // Without the lock, both pass the colour-include check
  assert.equal(matchesFilters(sk, f), true);
  assert.equal(matchesFilters(hr, f), true);
  // Engage the lock — Croatia's 4-colour palette fails the count
  lock.toggle();
  assert.equal(matchesFilters(sk, f), true);
  assert.equal(matchesFilters(hr, f), false);
});
