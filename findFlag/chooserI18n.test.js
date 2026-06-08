import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshChooserI18n } from './chooserI18n.js';
import { _seedCacheForTests, _resetCacheForTests } from '../i18n.js';

function makeEl(initial = '') {
  return { textContent: initial };
}

test('refreshChooserI18n: re-translates each section header from its key + fallback', () => {
  _seedCacheForTests({ findFlag: { sections: { continents: 'Kontynenty', colors: 'Kolory' } } });
  const h1 = makeEl('Continents');
  const h2 = makeEl('Colors');
  refreshChooserI18n({
    sectionHeaders: [
      { h: h1, key: 'findFlag.sections.continents', fallback: 'Continents' },
      { h: h2, key: 'findFlag.sections.colors', fallback: 'Colors' },
    ],
    allPills: [],
    onlyColorsLabelSpan: null,
    updateBar: () => {},
  });
  assert.equal(h1.textContent, 'Kontynenty');
  assert.equal(h2.textContent, 'Kolory');
  _resetCacheForTests();
});

test('refreshChooserI18n: falls back to the English fallback when the key is missing from the cache', () => {
  // The cache may be empty (boot race) or partial (translator missed a
  // key). pillLabel / t both fall back to the supplied English source —
  // re-running the helper against that state must surface the fallback,
  // not break the chooser visually.
  _resetCacheForTests();
  const h = makeEl('something stale');
  refreshChooserI18n({
    sectionHeaders: [{ h, key: 'findFlag.sections.continents', fallback: 'Continents' }],
    allPills: [],
    onlyColorsLabelSpan: null,
    updateBar: () => {},
  });
  assert.equal(h.textContent, 'Continents');
});

test('refreshChooserI18n: re-translates each pill via pillLabel(group, value, "include", t)', () => {
  // Pill text comes from pillLabel — variant.<key> for continents,
  // color.<key> for colours, motif.<key> for motifs. Pinning the
  // group→namespace routing here protects against a regression where
  // someone forgets that continents read from `variant.*`, not
  // `continent.*`.
  _seedCacheForTests({
    variant: { europe: 'Europa' },
    color: { red: 'czerwony' },
    motif: { star: 'gwiazda' },
  });
  const europeSpan = makeEl('Europe');
  const redSpan = makeEl('red');
  const starSpan = makeEl('star');
  refreshChooserI18n({
    sectionHeaders: [],
    allPills: [
      { labelSpan: europeSpan, group: 'continent', value: 'Europe' },
      { labelSpan: redSpan, group: 'color', value: 'red' },
      { labelSpan: starSpan, group: 'motif', value: 'star' },
    ],
    onlyColorsLabelSpan: null,
    updateBar: () => {},
  });
  assert.equal(europeSpan.textContent, 'Europa');
  assert.equal(redSpan.textContent, 'czerwony');
  assert.equal(starSpan.textContent, 'gwiazda');
  _resetCacheForTests();
});

test('refreshChooserI18n: re-translates the "no other colours" modifier when the span is present', () => {
  _seedCacheForTests({ findFlag: { noOtherColors: 'tylko te kolory' } });
  const onlySpan = makeEl('no other colours');
  refreshChooserI18n({
    sectionHeaders: [],
    allPills: [],
    onlyColorsLabelSpan: onlySpan,
    updateBar: () => {},
  });
  assert.equal(onlySpan.textContent, 'tylko te kolory');
  _resetCacheForTests();
});

test('refreshChooserI18n: tolerates a null onlyColorsLabelSpan (chooser variant without the modifier)', () => {
  // No throw is the whole contract here — a future chooser shape
  // without the Colors section would pass null, and the helper must
  // skip the branch instead of crashing.
  refreshChooserI18n({
    sectionHeaders: [],
    allPills: [],
    onlyColorsLabelSpan: null,
    updateBar: () => {},
  });
});

test('refreshChooserI18n: invokes updateBar exactly once so the "Play (N)" label re-applies', () => {
  // The Play button text is set programmatically as "Play (matchCount)";
  // applyStringsToDocument would restore it to a static "Play". Calling
  // updateBar reapplies the live count + current-language playLabel.
  // Pinning the count protects against accidental double-calls (which
  // re-render the chooser bar pointlessly) and silent removals.
  let called = 0;
  refreshChooserI18n({
    sectionHeaders: [],
    allPills: [],
    onlyColorsLabelSpan: null,
    updateBar: () => { called++; },
  });
  assert.equal(called, 1);
});
