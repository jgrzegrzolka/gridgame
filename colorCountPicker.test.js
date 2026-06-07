import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorCountPickerState, createColorCountPicker } from './colorCountPicker.js';
import { emptyFilters } from './flags/flagsFilter.js';

/**
 * Minimal Document stand-in for createColorCountPicker's DOM widget
 * tests. Tracks click listeners per element so the test can fire a
 * synthetic click and walk the event path. classList toggle / hidden
 * are enough surface area for the picker's paint() to read.
 *
 * Scoped via try/finally in each test so the global `document` doesn't
 * leak between this file and any other (which would silently swap node's
 * happy "no document" state for our half-stub).
 */
/**
 * @template T
 * @param {(handles: { fireOutsideClick: () => void }) => T} fn
 * @returns {T}
 */
function withFakeDocument(fn) {
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {Set<() => void>} Document-level click listeners (used by the picker's outside-click handler). */
  const docClickListeners = new Set();
  function makeEl() {
    /** @type {Record<string, Array<(e: any) => void>>} */
    const listeners = {};
    /** @type {any[]} */
    const children = [];
    /** @type {Set<string>} */
    const classes = new Set();
    const el = /** @type {any} */ ({
      className: '',
      textContent: '',
      hidden: false,
      type: '',
      _children: children,
      _listeners: listeners,
      classList: {
        /** @param {string} c */ add(c) { classes.add(c); },
        /** @param {string} c */ remove(c) { classes.delete(c); },
        /** @param {string} c @param {boolean} [on] */
        toggle(c, on) {
          if (on === undefined) on = !classes.has(c);
          if (on) classes.add(c); else classes.delete(c);
        },
        /** @param {string} c */ contains(c) { return classes.has(c); },
      },
      /** @param {string} type @param {(e: any) => void} fn */
      addEventListener(type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
      },
      /** @param {any} c */ appendChild(c) { children.push(c); return c; },
      setAttribute() {},
    });
    return el;
  }
  /** @type {any} */ (globalThis).document = {
    createElement: () => makeEl(),
    /** @param {string} type @param {() => void} fn */
    addEventListener(type, fn) {
      if (type === 'click') docClickListeners.add(fn);
    },
  };
  try {
    return fn({ fireOutsideClick: () => { for (const l of docClickListeners) l(); } });
  } finally {
    /** @type {any} */ (globalThis).document = prev;
  }
}

/** @param {any} el @param {Object} [event] */
function fireClick(el, event = {}) {
  const ev = { stopPropagation() {}, ...event };
  for (const fn of (el._listeners.click ?? [])) fn(ev);
}

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

// --- DOM widget tests (createColorCountPicker)
// Verify the click wiring under the widget — the state machine tests
// above pin the logic; these pin that clicking the rendered chips
// actually invokes that logic and fires the page hooks.

test('createColorCountPicker: clicking the inactive pill body engages with default = 2 and fires both hooks', () => {
  withFakeDocument(() => {
    const filters = emptyFilters();
    let changes = 0, picks = 0;
    const p = createColorCountPicker(filters, (_k, fb) => fb, {
      onChange: () => changes++,
      onPicked: () => picks++,
    });
    fireClick(p.el);
    assert.deepEqual(filters.colorCount, { op: '=', n: 2 });
    assert.equal(p.el.classList.contains('active'), true);
    assert.equal(changes, 1);
    assert.equal(picks, 1, 'engaging the picker must fire onPicked so the page can disengage the lock');
  });
});

test('createColorCountPicker: clicking an N option chip while inactive engages with that N', () => {
  withFakeDocument(() => {
    const filters = emptyFilters();
    const p = createColorCountPicker(filters, (_k, fb) => fb, {
      onChange() {}, onPicked() {},
    });
    // p.el structure: [opSide, nSide, clearBtn]
    const nSide = /** @type {any} */ (p.el)._children[1];
    // nSide structure: [currentChip, optionsContainer]
    const nCurrent = nSide._children[0];
    // Inactive: clicking the current chip engages first (no dropdown yet).
    fireClick(nCurrent);
    assert.deepEqual(filters.colorCount, { op: '=', n: 2 });
    // Active: clicking it again opens the dropdown.
    fireClick(nCurrent);
    assert.equal(nSide.classList.contains('is-expanded'), true);
    // Pick the 4 option chip (index 2 inside optionsContainer: [2, 3, 4, 5]).
    const nOptions = nSide._children[1];
    const fourChip = nOptions._children[2];
    fireClick(fourChip);
    assert.deepEqual(filters.colorCount, { op: '=', n: 4 });
    assert.equal(nSide.classList.contains('is-expanded'), false,
      'picking an option must collapse the dropdown');
  });
});

test('createColorCountPicker: clicking the × clear button disengages and clears the filter', () => {
  withFakeDocument(() => {
    const filters = emptyFilters();
    let picks = 0;
    const p = createColorCountPicker(filters, (_k, fb) => fb, {
      onChange() {}, onPicked: () => picks++,
    });
    fireClick(p.el); // engage
    picks = 0;
    // p.el _children: [opSide, nSide, clearBtn]
    const clearBtn = /** @type {any} */ (p.el)._children[2];
    fireClick(clearBtn);
    assert.equal(filters.colorCount, null);
    assert.equal(p.el.classList.contains('active'), false);
    assert.equal(clearBtn.hidden, true, '× should hide itself once disengaged');
    assert.equal(picks, 0, 'clear must NOT fire onPicked — the picker is letting go, not taking over');
  });
});

test('createColorCountPicker: disengage() from the page leaves filters.colorCount alone — page-glue contention guard', () => {
  // Reproduces the live bug at the widget level: another surface (the
  // lock) writes filters.colorCount, then the page calls
  // picker.disengage() to step the picker visually back. The picker
  // MUST NOT clobber the lock's value.
  withFakeDocument(() => {
    const filters = emptyFilters();
    const p = createColorCountPicker(filters, (_k, fb) => fb, {
      onChange() {}, onPicked() {},
    });
    // Simulate the lock taking over after the picker had been touched
    fireClick(p.el);
    filters.colorCount = { op: '=', n: 0 };
    p.disengage();
    assert.deepEqual(filters.colorCount, { op: '=', n: 0 },
      'picker.disengage at the widget boundary must not touch the lock\'s value');
    assert.equal(p.el.classList.contains('active'), false);
  });
});

test('createColorCountPicker: outside click collapses an open dropdown', () => {
  withFakeDocument(/** @param {{ fireOutsideClick: () => void }} doc */ (doc) => {
    const filters = emptyFilters();
    const p = createColorCountPicker(filters, (_k, fb) => fb, {
      onChange() {}, onPicked() {},
    });
    fireClick(p.el); // engage
    const nSide = /** @type {any} */ (p.el)._children[1];
    fireClick(nSide._children[0]); // tap N current → opens dropdown
    assert.equal(nSide.classList.contains('is-expanded'), true);
    doc.fireOutsideClick();
    assert.equal(nSide.classList.contains('is-expanded'), false,
      'outside click must close any open dropdown');
  });
});
