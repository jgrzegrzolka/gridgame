import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chipLabelText, buildFilterChip, renderCriteriaInline, renderSpotCriteria, renderMetricLeadInline, renderFlagLeadInline, categoryIconEl, renderCategoryLabel, renderCategoryPair } from './filterChips.js';
import { emptyFilters } from './flagsFilter.js';
import { continent, statehood, hasColor, hasMotif, colorCount, hasStripesOnly, population, CHARGE_MOTIFS } from './engine.js';

/** Echo the fallback — renders every label in its English default. */
const t = (/** @type {string} */ _k, /** @type {string} */ fb) => fb;

/**
 * Minimal fake DOM covering the surface buildFilterChip / makeColorSwatch touch:
 * className (assigned + appended via classList), style.setProperty, dataset,
 * text/innerHTML, appendChild (tracked in `children`), and click dispatch.
 */
function fakeDoc() {
  function makeEl() {
    /** @type {Record<string, string>} */
    const attrs = {};
    /** @type {Record<string, string>} */
    const styleProps = {};
    const el = {
      className: '',
      dataset: /** @type {Record<string, string>} */ ({}),
      textContent: '',
      innerHTML: '',
      type: '',
      /** @type {any[]} */
      children: [],
      style: { setProperty: (/** @type {string} */ k, /** @type {string} */ v) => { styleProps[k] = v; }, props: styleProps },
      classList: { add: (/** @type {string} */ c) => { el.className += ` ${c}`; } },
      setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => { attrs[k] = v; },
      getAttribute: (/** @type {string} */ k) => attrs[k] ?? null,
      appendChild: (/** @type {any} */ child) => { el.children.push(child); return child; },
      /** @type {(() => void) | null} */
      _click: null,
      addEventListener: (/** @type {string} */ _ev, /** @type {() => void} */ fn) => { el._click = fn; },
    };
    return el;
  }
  return /** @type {any} */ ({
    createElement: () => makeEl(),
    createDocumentFragment: () => makeEl(),
  });
}

// ---- chipLabelText (pure) ----

test('chipLabelText: pill chip renders the bare include noun', () => {
  assert.equal(chipLabelText({ kind: 'pill', group: 'color', value: 'red', exclude: false }, emptyFilters(), t), 'red');
});

test('chipLabelText: exclude pill defaults to the bare noun (flagsdata: strike carries the negation)', () => {
  // Default (spellExclude off) — the boxed flagsdata chip's strike-through says "not this".
  assert.equal(chipLabelText({ kind: 'pill', group: 'motif', value: 'cross', exclude: true }, emptyFilters(), t), 'cross');
});

test('chipLabelText: spellExclude writes an excluded pill out as "not X"', () => {
  // The inline header opts in (no strike there) so the negation reads as a word.
  const ref = /** @type {const} */ ({ kind: 'pill', group: 'motif', value: 'cross', exclude: true });
  assert.equal(chipLabelText(ref, emptyFilters(), t, ' ', true), 'not cross');
  // An included pill is unaffected by the flag.
  const inc = /** @type {const} */ ({ kind: 'pill', group: 'motif', value: 'cross', exclude: false });
  assert.equal(chipLabelText(inc, emptyFilters(), t, ' ', true), 'cross');
});

test('chipLabelText: colorCount scalar reads exactly like the TTT category label', () => {
  // Same filter.onlyN/atLeastN/atMostN phrasing as the engine/TTT — NOT a
  // bespoke "Colors = N" that would drift from the tic-tac-toe cell label.
  const f = emptyFilters();
  f.colorCount = { op: '=', n: 3 };
  assert.equal(chipLabelText({ kind: 'scalar', group: 'colorCount' }, f, t), 'only 3 colours');
  f.colorCount = { op: '>=', n: 2 };
  assert.equal(chipLabelText({ kind: 'scalar', group: 'colorCount' }, f, t), '2 or more colours');
  f.colorCount = { op: '<=', n: 4 };
  assert.equal(chipLabelText({ kind: 'scalar', group: 'colorCount' }, f, t), '4 or fewer colours');
});

test('chipLabelText: metric scalar leads with the short name so the fact is never anonymous', () => {
  // The bug this whole change fixes: a bare "over 10K tonnes" never says of what.
  const f = emptyFilters();
  f.coffee = { op: '>=', n: 10000 };
  const label = chipLabelText({ kind: 'scalar', group: 'coffee' }, f, t);
  assert.match(label, /^Coffee production · /); // default separator (boxed flagsdata chip)
  assert.match(label, /over .*tonnes/);
});

test('chipLabelText: metric separator is configurable (inline header drops the middot)', () => {
  const f = emptyFilters();
  f.coffee = { op: '>=', n: 10000 };
  const inline = chipLabelText({ kind: 'scalar', group: 'coffee' }, f, t, ' ');
  assert.doesNotMatch(inline, /·/); // no middot to blur into the criteria separator
  assert.match(inline, /^Coffee production over .*tonnes/);
});

// ---- buildFilterChip (DOM) ----

test('buildFilterChip: colour pill gets a swatch + label, base classes', () => {
  const chip = /** @type {any} */ (buildFilterChip(
    { kind: 'pill', group: 'color', value: 'red', exclude: false },
    'red',
    { doc: fakeDoc() },
  ));
  assert.match(chip.className, /(^|\s)filter-chip(\s|$)/);
  assert.equal(chip.children[0].className, 'pill-swatch');
  const label = chip.children.find((/** @type {any} */ c) => c.className === 'filter-chip-label');
  assert.equal(label.textContent, 'red');
});

test('buildFilterChip: exclude pill carries is-exclude', () => {
  const chip = /** @type {any} */ (buildFilterChip(
    { kind: 'pill', group: 'motif', value: 'cross', exclude: true },
    'cross',
    { doc: fakeDoc() },
  ));
  assert.match(chip.className, /is-exclude/);
});

test('buildFilterChip: metric chip carries the hue + icon so it reads as its fact', () => {
  const chip = /** @type {any} */ (buildFilterChip(
    { kind: 'scalar', group: 'coffee' },
    'Coffee · over 10K tonnes',
    { doc: fakeDoc() },
  ));
  assert.match(chip.className, /is-metric/);
  assert.ok(chip.style.props['--mc'], 'metric hue is set inline');
  const icon = chip.children.find((/** @type {any} */ c) => c.className === 'mhub-ic');
  assert.ok(icon && icon.innerHTML.length > 0, 'metric icon SVG is present');
});

test('buildFilterChip: read-only by default (no × button), interactive with onRemove', () => {
  const plain = /** @type {any} */ (buildFilterChip({ kind: 'pill', group: 'color', value: 'red', exclude: false }, 'red', { doc: fakeDoc() }));
  assert.equal(plain.children.some((/** @type {any} */ c) => c.className === 'filter-chip-x'), false);

  let removed = 0;
  const chip = /** @type {any} */ (buildFilterChip(
    { kind: 'pill', group: 'color', value: 'red', exclude: false },
    'red',
    { doc: fakeDoc(), onRemove: () => { removed += 1; } },
  ));
  const x = chip.children.find((/** @type {any} */ c) => c.className === 'filter-chip-x');
  assert.ok(x, '× button present when onRemove is supplied');
  x._click();
  assert.equal(removed, 1);
});

// ---- renderCriteriaInline ----

test('renderCriteriaInline: one criterion per constraint, dot separators between', () => {
  const f = emptyFilters();
  f.continent.include.add('Africa');
  f.color.include.add('red');
  f.motif.exclude.add('cross');
  f.coffee = { op: '>=', n: 10000 };
  const frag = /** @type {any} */ (renderCriteriaInline(f, t, fakeDoc()));
  // 4 criteria + 3 separators = 7 children.
  const crits = frag.children.filter((/** @type {any} */ c) => c.className.split(' ').includes('crit'));
  const seps = frag.children.filter((/** @type {any} */ c) => c.className === 'crit-sep');
  assert.equal(crits.length, 4);
  assert.equal(seps.length, 3);
  assert.equal(frag.children.length, 7);
});

test('renderCriteriaInline: each token gets exactly the right leading mark', () => {
  const f = emptyFilters();
  f.continent.include.add('Africa'); // country fact: no mark
  f.color.include.add('red'); // colour: swatch
  f.motif.exclude.add('cross'); // flag-design + exclude: motif icon, spelled "not cross"
  f.coffee = { op: '>=', n: 10000 }; // metric: hued icon
  const crits = /** @type {any} */ (renderCriteriaInline(f, t, fakeDoc())).children
    .filter((/** @type {any} */ c) => c.className.split(' ').includes('crit'));
  const [africa, red, cross, coffee] = crits;
  const kids = (/** @type {any} */ c) => c.children.map((/** @type {any} */ k) => k.className);

  assert.deepEqual(kids(africa), ['crit-label']); // no leading mark for a country fact
  assert.ok(kids(red).includes('pill-swatch'));
  assert.ok(kids(cross).includes('crit-motif')); // a charge motif wears its own icon
  assert.match(cross.className, /crit-exclude/);
  // Inline exclude is spelled out in ink, not struck.
  const crossLabel = cross.children.find((/** @type {any} */ k) => k.className === 'crit-label');
  assert.equal(crossLabel.textContent, 'not cross');
  assert.ok(kids(coffee).includes('crit-ic'));
  // Metric label uses the space separator, not the middot.
  const coffeeLabel = coffee.children.find((/** @type {any} */ k) => k.className === 'crit-label');
  assert.match(coffeeLabel.textContent, /^Coffee production over /);
});

test('renderCriteriaInline: eu-member is a country fact (no flag glyph); real charges keep it', () => {
  // eu-member lives in the motif group but is political, not a visual charge —
  // it must read like continent/status, not "on the flag". union-jack IS a
  // charge (literally on the canton) and keeps the glyph.
  const f = emptyFilters();
  f.motif.include.add('eu-member');
  f.motif.include.add('union-jack');
  const crits = /** @type {any} */ (renderCriteriaInline(f, t, fakeDoc())).children
    .filter((/** @type {any} */ c) => c.className.split(' ').includes('crit'));
  const kids = (/** @type {any} */ c) => c.children.map((/** @type {any} */ k) => k.className);
  // echo-t returns the motif's value as the fallback, so labels read 'eu-member' / 'union-jack'.
  const eu = crits.find((/** @type {any} */ c) => c.children.some((/** @type {any} */ k) => k.textContent === 'eu-member'));
  const uj = crits.find((/** @type {any} */ c) => c.children.some((/** @type {any} */ k) => k.textContent === 'union-jack'));
  assert.deepEqual(kids(eu), ['crit-label']); // no mark — reads as a country fact
  assert.ok(kids(uj).includes('crit-motif')); // a real charge gets its own motif icon
});

test('renderSpotCriteria: appends a text-only "not <country>" criterion, NO flag mark', () => {
  // The flag thumbnail is deliberately absent: showing it would point straight at
  // the tile to avoid, defeating the recognise-the-flag point of the clause.
  const f = emptyFilters();
  f.color.exclude.add('green');
  f.motif.exclude.add('cross');
  const frag = /** @type {any} */ (renderSpotCriteria(f, ['fr'], t, fakeDoc()));
  const crits = frag.children.filter((/** @type {any} */ c) => c.className.split(' ').includes('crit'));
  assert.equal(crits.length, 3, 'the two colour/motif criteria plus the country one');
  const country = crits[crits.length - 1];
  assert.match(country.className, /crit-exclude/);
  const marks = country.children.map((/** @type {any} */ k) => k.className);
  assert.deepEqual(marks, ['crit-label'], 'name only — no flag mark, swatch or glyph');
  assert.equal(country.children[0].textContent, 'not fr', 'spelled out with the country name');
});

test('renderSpotCriteria: no country codes is just the colour/motif line', () => {
  const f = emptyFilters();
  f.color.include.add('red');
  f.motif.include.add('star-or-moon');
  const frag = /** @type {any} */ (renderSpotCriteria(f, [], t, fakeDoc()));
  assert.equal(frag.children.filter((/** @type {any} */ c) => c.className.includes('crit-exclude')).length, 0);
});

test('renderCriteriaInline: empty filter yields nothing', () => {
  assert.equal(/** @type {any} */ (renderCriteriaInline(emptyFilters(), t, fakeDoc())).children.length, 0);
});

// ---- renderMetricLeadInline (superlative header) ----

test('renderMetricLeadInline: leads the title with the hue-tinted metric icon', () => {
  const frag = /** @type {any} */ (
    renderMetricLeadInline('population', 'The 5 most populous countries of Europe', fakeDoc())
  );
  assert.equal(frag.children.length, 2);
  const [icon, label] = frag.children;
  assert.equal(icon.className, 'crit-ic');
  assert.ok(icon.innerHTML.length > 0, 'icon span carries the metric SVG');
  assert.ok(icon.style.color, 'metric hue applied to the icon');
  assert.equal(label.className, 'crit-label');
  assert.equal(label.textContent, 'The 5 most populous countries of Europe');
});

test('renderMetricLeadInline: unknown metric still renders the title (empty icon, no throw)', () => {
  const frag = /** @type {any} */ (renderMetricLeadInline('nope', 'A title', fakeDoc()));
  assert.equal(frag.children[0].innerHTML, '');
  assert.equal(frag.children[1].textContent, 'A title');
});

// ---- renderFlagLeadInline (flag-design manual header) ----

test('renderFlagLeadInline: leads the title with the flag glyph', () => {
  const frag = /** @type {any} */ (renderFlagLeadInline('Triangles from the hoist', fakeDoc()));
  assert.equal(frag.children.length, 2);
  const [glyph, label] = frag.children;
  assert.equal(glyph.className, 'crit-flag');
  assert.ok(glyph.innerHTML.length > 0, 'glyph span carries the flag SVG');
  assert.equal(label.className, 'crit-label');
  assert.equal(label.textContent, 'Triangles from the hoist');
});

// ---- categoryIconEl (tic-tac-toe grid marks, keyed off engine Category id) ----

test('categoryIconEl: colour category gets the pill swatch', () => {
  const el = /** @type {any} */ (categoryIconEl(hasColor('red'), fakeDoc()));
  assert.match(el.className, /pill-swatch/);
  assert.equal(el.dataset.value, 'red');
});

test('categoryIconEl: charge motif gets its own motif icon', () => {
  const el = /** @type {any} */ (categoryIconEl(hasMotif('animal'), fakeDoc()));
  assert.equal(el.className, 'crit-motif');
  assert.ok(el.innerHTML.length > 0, 'the icon span carries the motif SVG');
});

test('every charge motif has a dedicated icon — none falls back to the generic glyph', () => {
  // A motif without its own icon would render `.crit-flag` next to siblings wearing
  // `.crit-motif`, so a criteria line would look half-iconed. Adding a motif to the
  // engine vocabulary must come with its MOTIF_ICONS entry; this pins that pairing.
  for (const m of CHARGE_MOTIFS) {
    const el = /** @type {any} */ (categoryIconEl(hasMotif(m), fakeDoc()));
    assert.equal(el && el.className, 'crit-motif', `motif "${m}" has no dedicated icon`);
  }
});

test('categoryIconEl: colour-count and stripes-only get the flag glyph (a design property)', () => {
  assert.equal(/** @type {any} */ (categoryIconEl(colorCount('=', 3), fakeDoc())).className, 'crit-flag');
  assert.equal(/** @type {any} */ (categoryIconEl(hasStripesOnly('vertical'), fakeDoc())).className, 'crit-flag');
});

test('categoryIconEl: metric category gets the hue-tinted metric icon', () => {
  const el = /** @type {any} */ (categoryIconEl(population('>=', 10_000_000), fakeDoc()));
  assert.equal(el.className, 'crit-ic');
  assert.ok(el.innerHTML.length > 0, 'icon carries the metric SVG');
  assert.ok(el.style.color, 'metric hue applied inline');
});

test('categoryIconEl: eu-member motif is political, not a charge — no mark', () => {
  assert.equal(categoryIconEl(hasMotif('eu-member'), fakeDoc()), null);
});

test('categoryIconEl: country facts (continent / statehood) get no mark', () => {
  assert.equal(categoryIconEl(continent('Asia'), fakeDoc()), null);
  assert.equal(categoryIconEl(statehood('sovereign'), fakeDoc()), null);
});

// ---- renderCategoryLabel / renderCategoryPair (TTT header + picker) ----

test('renderCategoryLabel: marked category → icon then label span', () => {
  const el = /** @type {any} */ (fakeDoc().createElement());
  renderCategoryLabel(el, hasColor('blue'), 'blue', fakeDoc());
  assert.equal(el.children.length, 2);
  assert.match(el.children[0].className, /pill-swatch/);
  assert.equal(el.children[1].className, 'cat-label');
  assert.equal(el.children[1].textContent, 'blue');
});

test('renderCategoryLabel: unmarked category → just the label span, no icon', () => {
  const el = /** @type {any} */ (fakeDoc().createElement());
  renderCategoryLabel(el, continent('Europe'), 'Europe', fakeDoc());
  assert.equal(el.children.length, 1);
  assert.equal(el.children[0].className, 'cat-label');
  assert.equal(el.children[0].textContent, 'Europe');
});

test('renderCategoryPair: row × col each carries its mark, middot between', () => {
  const el = /** @type {any} */ (fakeDoc().createElement());
  const doc = fakeDoc();
  renderCategoryPair(el, continent('Asia'), hasColor('red'), 'Asia', 'red', doc);
  assert.equal(el.children.length, 3);
  const [row, times, col] = el.children;
  assert.equal(times.className, 'cat-times');
  assert.equal(times.textContent, ' × ');
  // row is an unmarked continent → single label span
  assert.equal(row.children.length, 1);
  assert.equal(row.children[0].textContent, 'Asia');
  // col is a colour → swatch + label span
  assert.equal(col.children.length, 2);
  assert.match(col.children[0].className, /pill-swatch/);
  assert.equal(col.children[1].textContent, 'red');
});
