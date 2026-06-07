import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorCountPickerState } from './colorCountPicker.js';
import { emptyFilters } from './flags/flagsFilter.js';

test('colorCountPickerState: defaults to = and 2, inactive', () => {
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  assert.equal(s.op, '=');
  assert.equal(s.n, 2);
  assert.equal(s.engaged, false);
  assert.equal(f.colorCount, null);
});

test('colorCountPickerState: pre-engaged if a filter pre-exists (e.g. ?f=colorCount:>=4)', () => {
  const f = emptyFilters();
  f.colorCount = { op: '>=', n: 4 };
  const s = colorCountPickerState(f);
  assert.equal(s.op, '>=');
  assert.equal(s.n, 4);
  assert.equal(s.engaged, true);
});

test('colorCountPickerState: engage applies the current op+n', () => {
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  s.engage();
  assert.equal(s.engaged, true);
  assert.deepEqual(f.colorCount, { op: '=', n: 2 });
});

test('colorCountPickerState: setN engages and writes the new N', () => {
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  s.setN(4);
  assert.equal(s.engaged, true);
  assert.equal(s.n, 4);
  assert.deepEqual(f.colorCount, { op: '=', n: 4 });
});

test('colorCountPickerState: setOp engages and writes the new op', () => {
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  s.setOp('>=');
  assert.equal(s.engaged, true);
  assert.equal(s.op, '>=');
  assert.deepEqual(f.colorCount, { op: '>=', n: 2 });
});

test('colorCountPickerState: clear disengages and clears the filter', () => {
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  s.setN(3);
  s.clear();
  assert.equal(s.engaged, false);
  assert.equal(f.colorCount, null);
});

test('colorCountPickerState: disengage flips engaged off WITHOUT touching the filter — contention guard', () => {
  // The page calls disengage() when another surface (the lock) is
  // taking over. The lock has just written `filters.colorCount`; if
  // disengage clobbered it, the lock would never actually filter
  // anything. Pins the bug class that broke "no other colours" when
  // picker and lock both reset()'d the primitive.
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  s.engage();
  // Simulate the lock writing its own value
  f.colorCount = { op: '=', n: 0 };
  s.disengage();
  assert.equal(s.engaged, false);
  assert.deepEqual(f.colorCount, { op: '=', n: 0 },
    'disengage must NOT clobber the lock\'s value');
});

test('colorCountPickerState: disengage drops op/n back to defaults so re-engagement starts predictably', () => {
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  s.setOp('<=');
  s.setN(5);
  s.disengage();
  assert.equal(s.op, '=');
  assert.equal(s.n, 2);
  assert.equal(s.engaged, false);
});

test('colorCountPickerState: reset is the Clear-button path — drops picker state, leaves filter for the page', () => {
  const f = emptyFilters();
  const s = colorCountPickerState(f);
  s.setOp('>=');
  s.setN(5);
  s.reset();
  assert.equal(s.engaged, false);
  assert.equal(s.op, '=');
  assert.equal(s.n, 2);
  // The page's Clear handler is also calling the lock's reset, which
  // clears `filters.colorCount`. picker.reset() itself doesn't touch
  // the primitive — pinning so the contention bug can't sneak back.
  assert.deepEqual(f.colorCount, { op: '>=', n: 5 });
});
