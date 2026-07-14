import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chipLabelText, buildFilterChip, renderCriteriaInline, renderMetricLeadInline } from './filterChips.js';
import { emptyFilters } from './flagsFilter.js';

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
  f.motif.exclude.add('cross'); // flag-design + exclude: flag glyph, spelled "not cross"
  f.coffee = { op: '>=', n: 10000 }; // metric: hued icon
  const crits = /** @type {any} */ (renderCriteriaInline(f, t, fakeDoc())).children
    .filter((/** @type {any} */ c) => c.className.split(' ').includes('crit'));
  const [africa, red, cross, coffee] = crits;
  const kids = (/** @type {any} */ c) => c.children.map((/** @type {any} */ k) => k.className);

  assert.deepEqual(kids(africa), ['crit-label']); // no leading mark for a country fact
  assert.ok(kids(red).includes('pill-swatch'));
  assert.ok(kids(cross).includes('crit-flag'));
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
  assert.deepEqual(kids(eu), ['crit-label']); // no glyph — reads as a country fact
  assert.ok(kids(uj).includes('crit-flag')); // a real charge keeps the glyph
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
