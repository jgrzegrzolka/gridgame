import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barFractions, railWidthPx, chartUnitLine, RAIL_AVATAR_PX, RAIL_AVATAR_OVERLAP_PX, RAIL_MORE_PX } from './partyChart.js';
import { PICK_AVATAR_CAP } from './pickAvatars.js';

test('all-positive metrics read as a share of the biggest', () => {
  // The common case, and the one a player intuitively expects: the winner fills
  // the bar and everyone else is a visible proportion of it.
  const f = barFractions(['a', 'b', 'c', 'd'], { a: 100, b: 50, c: 25, d: 0 });
  assert.deepEqual(f, [1, 0.5, 0.25, 0]);
});

test('a negative metric never produces a negative bar', () => {
  // THE reason this is normalised across the range rather than value/max.
  // Temperature bottoms out at -49C; under value/max that country's bar is
  // negative, which renders as no bar rather than as an obviously wrong one.
  const f = barFractions(['hot', 'mild', 'cold'], { hot: 30, mild: 0, cold: -49 });
  for (const x of f) assert.ok(x >= 0 && x <= 1, `fraction ${x} out of range`);
  assert.equal(f[2], 0, 'the coldest sits at the floor');
  assert.ok(f[0] > f[1] && f[1] > f[2], 'and the order still reads correctly');
});

test('an all-negative quartet still ranks, rather than collapsing to nothing', () => {
  const f = barFractions(['a', 'b', 'c'], { a: -5, b: -20, c: -49 });
  assert.ok(f[0] > f[1] && f[1] > f[2], 'warmest longest, coldest shortest');
  assert.equal(f[2], 0);
  for (const x of f) assert.ok(x >= 0 && x <= 1);
});

test('a least-question ranks ascending and the bars follow the VALUES', () => {
  // On a "least" question ranking[0] is the smallest, so the bars grow as you
  // read down. That is deliberate: position encodes the answer, length encodes
  // the value, and both are labelled. Pinned so it is not "fixed" by accident.
  const f = barFractions(['smallest', 'mid', 'biggest'], { smallest: 10, mid: 50, biggest: 100 });
  assert.ok(f[0] < f[1] && f[1] < f[2], 'bar length tracks the value, not the rank');
});

test('identical values give every bar the same length', () => {
  // No range to normalise against. A full bar each is the honest reading of
  // "these are the same"; dividing by a zero span would give NaN.
  const f = barFractions(['a', 'b'], { a: 7, b: 7 });
  assert.deepEqual(f, [1, 1]);
  for (const x of f) assert.ok(Number.isFinite(x));
});

test('all-zero values do not divide by zero', () => {
  const f = barFractions(['a', 'b'], { a: 0, b: 0 });
  for (const x of f) assert.ok(Number.isFinite(x), 'no NaN from a zero span');
});

test('a missing or malformed value counts as zero rather than throwing', () => {
  // The reveal carries a value for every option it ranks, so a gap means a
  // stale or partial payload. A short bar beats a broken chart.
  const f = barFractions(['a', 'b', 'c', 'd'], { a: 100, c: /** @type {any} */ ('50'), d: NaN });
  assert.equal(f.length, 4);
  for (const x of f) assert.ok(Number.isFinite(x) && x >= 0 && x <= 1);
  assert.equal(f[0], 1, 'the one real value still anchors the top');
});

test('empty or absent inputs return an empty list, not a crash', () => {
  assert.deepEqual(barFractions([], { a: 1 }), []);
  assert.deepEqual(barFractions(/** @type {any} */ (null), { a: 1 }), []);
  assert.deepEqual(barFractions(['a'], null), [0]);
  assert.deepEqual(barFractions(['a'], undefined), [0]);
});

test('one option is a full bar', () => {
  assert.deepEqual(barFractions(['a'], { a: 42 }), [1]);
});

// ---- railWidthPx ----

test('railWidthPx: an empty rail still reserves one avatar', () => {
  // Every row needs the same track, including the three nobody picked -- that is
  // the whole point of measuring the chart rather than the row.
  assert.equal(railWidthPx(['jp', 'kr'], {}), RAIL_AVATAR_PX);
});

test('railWidthPx: sized by the BUSIEST row, not by each row', () => {
  const ranking = ['jp', 'kr', 'cn', 'th'];
  const picks = { a: 'kr', b: 'kr', c: 'kr', d: 'jp' };
  const step = RAIL_AVATAR_PX - RAIL_AVATAR_OVERLAP_PX;
  assert.equal(railWidthPx(ranking, picks), RAIL_AVATAR_PX + 2 * step, 'three on one row');
});

test('railWidthPx: overlapping avatars cost less than their full width', () => {
  // Regression guard on the arithmetic itself: stacking must use the overlap
  // step, not the avatar width, or the rail is far wider than what it holds.
  const wide = railWidthPx(['jp'], { a: 'jp', b: 'jp' });
  assert.ok(wide < RAIL_AVATAR_PX * 2, 'the second avatar slides over the first');
  assert.equal(wide, RAIL_AVATAR_PX * 2 - RAIL_AVATAR_OVERLAP_PX);
});

test('railWidthPx: a pick for a code that is not on the chart does not widen it', () => {
  assert.equal(railWidthPx(['jp', 'kr'], { a: 'zz' }), RAIL_AVATAR_PX);
});

test('railWidthPx: survives a missing ranking or picks', () => {
  assert.equal(railWidthPx(/** @type {any} */ (null), /** @type {any} */ (null)), RAIL_AVATAR_PX);
  assert.equal(railWidthPx([], {}), RAIL_AVATAR_PX);
});

test('the rail constants match the stylesheet they mirror', () => {
  // The arithmetic hardcodes two CSS numbers. Without this, resizing an avatar in
  // index.css silently desyncs the rail width and nothing fails.
  const css = readFileSync(new URL('../flagParty/index.css', import.meta.url), 'utf8');
  const avatar = css.match(/\.rank-rail \.avatar\s*\{[^}]*width:\s*(\d+)px/);
  const overlap = css.match(/\.rank-rail \.avatar \+ \.avatar\s*\{[^}]*margin-left:\s*-(\d+)px/);
  assert.ok(avatar, 'expected a .rank-rail .avatar width in flagParty/index.css');
  assert.ok(overlap, 'expected a .rank-rail .avatar + .avatar negative margin');
  assert.equal(Number(avatar[1]), RAIL_AVATAR_PX);
  assert.equal(Number(overlap[1]), RAIL_AVATAR_OVERLAP_PX);
  // The overflow marker's width is a third hardcoded CSS number, and the one most
  // likely to be nudged for looks — a marker wider than the rail thinks it is
  // pushes the points column off every row at once.
  const more = css.match(/\.rank-rail \.more\s*\{[^}]*width:\s*(\d+)px/);
  assert.ok(more, 'expected a .rank-rail .more width in flagParty/index.css');
  assert.equal(Number(more[1]), RAIL_MORE_PX);
});

test('railWidthPx: the cap bounds the rail, however full the room', () => {
  // The bug this closes: twelve people all picking Brazil sized the rail at 198px,
  // and every row is pinned to the busiest one, so the country name lost its
  // column on all four rows — including the three nobody picked.
  const ranking = ['br', 'vn', 'co', 'id'];
  /** @param {number} n */
  const allOn = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['p' + i, 'br']));
  const widest = railWidthPx(ranking, allOn(PICK_AVATAR_CAP + 1));
  for (const n of [8, 12, 20, 200]) {
    assert.equal(railWidthPx(ranking, allOn(n)), widest, `${n} pickers cost no more than ${PICK_AVATAR_CAP + 1}`);
  }
  // And the bound is a number a phone row can actually spare: the row's other
  // five tracks and their gaps take 176px of ~350px.
  assert.ok(widest <= 120, `the widest rail is ${widest}px`);
});

test('railWidthPx: the marker costs a slot, and only past the cap', () => {
  const ranking = ['br', 'vn'];
  /** @param {number} n */
  const allOn = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['p' + i, 'br']));
  const step = RAIL_AVATAR_PX - RAIL_AVATAR_OVERLAP_PX;
  // Right up to the cap it is avatars all the way, exactly as before.
  assert.equal(railWidthPx(ranking, allOn(PICK_AVATAR_CAP)),
    RAIL_AVATAR_PX + (PICK_AVATAR_CAP - 1) * step);
  // One more, and the sixth face becomes a marker that overlaps like an avatar.
  assert.equal(railWidthPx(ranking, allOn(PICK_AVATAR_CAP + 1)),
    RAIL_AVATAR_PX + (PICK_AVATAR_CAP - 1) * step + RAIL_MORE_PX - RAIL_AVATAR_OVERLAP_PX);
});

// ---- chartUnitLine ----

/** A translator that knows only the keys it is given.
 *  @param {Record<string, string>} dict
 *  @returns {(key: string, fallback: string) => string} */
const tWith = (dict) => (key, fallback) => (key in dict ? dict[key] : fallback);

test('chartUnitLine: joins the translated unit and the year', () => {
  const t = tWith({ 'metricUnit.summerMedals': 'medals' });
  assert.equal(chartUnitLine({ key: 'summerMedals', year: 2026 }, t), 'medals · 2026');
});

test('chartUnitLine: an untranslated metric shows the year alone, never English', () => {
  // Deliberately no fallback to the metric file's own `unit`: those are English,
  // and some are less precise than the translated string (the gdpPerCapita file
  // says "US$" where the string says "US$/person"), so a fallback would mislabel
  // a per-capita chart rather than merely fail to translate.
  const t = tWith({});
  assert.equal(chartUnitLine({ key: 'gdpPerCapita', year: 2023 }, t), '2023');
});

test('chartUnitLine: nothing to say yields an empty line, not a stray separator', () => {
  const t = tWith({});
  assert.equal(chartUnitLine({ key: '', year: null }, t), '');
  assert.equal(chartUnitLine(null, t), '');
  assert.equal(chartUnitLine(undefined, t), '');
});

test('chartUnitLine: a unit with no year drops the separator', () => {
  const t = tWith({ 'metricUnit.area': 'km²' });
  assert.equal(chartUnitLine({ key: 'area', year: null }, t), 'km²');
});
