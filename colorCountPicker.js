import { COLOR_COUNT_OPS, COLOR_COUNT_NS } from './flags/flagsFilter.js';

/** @typedef {import('./flags/flagsFilter.js').Filters} Filters */
/** @typedef {'=' | '>=' | '<='} Op */

const OPS = COLOR_COUNT_OPS;
const NS = COLOR_COUNT_NS;

/**
 * Pure state machine for the colour-count compound pill. Lives
 * separately from the DOM widget so the transition logic is
 * unit-testable without a fake document.
 *
 * Holds the picker's own engaged flag, intentionally separate from
 * `filters.colorCount !== null`. Another UI surface (the "no other
 * colours" lock) can write the primitive without the picker being
 * engaged. Keeping the two concepts apart lets the picker pill and
 * the lock pill show independent visual states.
 *
 * Op and N have meaningful defaults (`=` and `2`) shown in the
 * inactive pill — there's no mystery placeholder. Engaged is its
 * own flag; the user engages by clicking the pill (any zone) and
 * disengages via the explicit × button.
 *
 * @param {Filters} filters
 */
export function colorCountPickerState(filters) {
  /** @type {Op} */
  let op = '=';
  /** @type {number} */
  let n = 2;
  let engaged = false;
  if (filters.colorCount !== null) {
    op = filters.colorCount.op;
    n = filters.colorCount.n;
    engaged = true;
  }
  return {
    get op() { return op; },
    get n() { return n; },
    get engaged() { return engaged; },
    engage() {
      engaged = true;
      filters.colorCount = { op, n };
    },
    /** @param {Op} newOp */
    setOp(newOp) {
      op = newOp;
      engaged = true;
      filters.colorCount = { op, n };
    },
    /** @param {number} newN */
    setN(newN) {
      n = newN;
      engaged = true;
      filters.colorCount = { op, n };
    },
    clear() {
      // Explicit × button. Disengages and clears the filter.
      engaged = false;
      filters.colorCount = null;
    },
    disengage() {
      // Cosmetic disengage — another surface (the lock) is taking over.
      // Drop op back to default, n to default. Doesn't touch
      // `filters.colorCount`; that's now owned by the engaging surface.
      engaged = false;
      op = '=';
      n = 2;
    },
    reset() {
      // Clear-button path: drop everything. Page is also clearing
      // `filters.colorCount` separately via the lock's reset.
      engaged = false;
      op = '=';
      n = 2;
    },
  };
}

/**
 * "Colour count" compound pill — ONE pill rendered in the Colors row.
 * Visually a chip-style `[= 2]` (or `[= —]` when inactive). Each side
 * is itself a chip the user can click to *expand* into all options:
 *
 *   - Click the op chip (`=`): the op side momentarily expands to
 *     `[= ≥ ≤]`. Pick one → collapses back to a single chip with the
 *     new value. Picking the current op just collapses (no change).
 *   - Click the N chip (`2`): expands to `[— 2 3 4 5]`. `—` is the
 *     placeholder that disengages the filter.
 *
 * Click anywhere else (outside the pill) collapses any open expansion
 * without changing the value. Mutually exclusive: only one side can
 * be expanded at a time.
 *
 * The page owns coordination with the "no other colours" lock — both
 * surfaces drive the same `filters.colorCount`. The page wires the
 * lock's click to call `picker.disengage()` and the picker's
 * engagement signals `onPicked()` so the page can disengage the lock.
 *
 * @param {Filters} filters
 * @param {(key: string, fallback: string) => string} translate
 * @param {{ onChange(): void, onPicked(): void }} hooks
 * @returns {{ el: HTMLElement, disengage(): void, reset(): void }}
 */
export function createColorCountPicker(filters, translate, hooks) {
  const state = colorCountPickerState(filters);

  /** @type {'op' | 'n' | null} Which side, if any, is currently expanded. */
  let expanded = null;

  const el = document.createElement('span');
  el.className = 'pill color-count-pill';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', translate('colorCountPicker.aria.label', 'colour count'));

  // Op side container — holds the single "current op" chip AND the
  // expanded `= ≥ ≤` row. Only one is visible at a time.
  const opSide = document.createElement('span');
  opSide.className = 'color-count-side color-count-op';

  const opCurrent = document.createElement('span');
  opCurrent.className = 'color-count-chip color-count-chip--current';
  opCurrent.setAttribute('role', 'button');
  opCurrent.setAttribute('tabindex', '0');
  opCurrent.addEventListener('click', (e) => {
    e.stopPropagation();
    // Inactive: engage first (the click is the activation). Active:
    // toggle the dropdown so the user can pick a different op.
    if (!state.engaged) {
      state.engage();
      paint();
      hooks.onPicked();
      hooks.onChange();
      return;
    }
    expanded = expanded === 'op' ? null : 'op';
    paint();
  });
  opSide.appendChild(opCurrent);

  const opOptions = document.createElement('span');
  opOptions.className = 'color-count-options';
  for (const o of OPS) {
    const chip = document.createElement('span');
    chip.className = 'color-count-chip';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.textContent = symbolFor(o);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      state.setOp(o);
      expanded = null;
      paint();
      if (state.engaged) hooks.onPicked();
      hooks.onChange();
    });
    opOptions.appendChild(chip);
  }
  opSide.appendChild(opOptions);
  el.appendChild(opSide);

  // N side container — same shape as op side.
  const nSide = document.createElement('span');
  nSide.className = 'color-count-side color-count-n';

  const nCurrent = document.createElement('span');
  nCurrent.className = 'color-count-chip color-count-chip--current';
  nCurrent.setAttribute('role', 'button');
  nCurrent.setAttribute('tabindex', '0');
  nCurrent.addEventListener('click', (e) => {
    e.stopPropagation();
    // Inactive: engage first (the click is the activation). Active:
    // toggle the dropdown so the user can pick a different N.
    if (!state.engaged) {
      state.engage();
      paint();
      hooks.onPicked();
      hooks.onChange();
      return;
    }
    expanded = expanded === 'n' ? null : 'n';
    paint();
  });
  nSide.appendChild(nCurrent);

  const nOptions = document.createElement('span');
  nOptions.className = 'color-count-options';
  for (const num of NS) {
    const chip = document.createElement('span');
    chip.className = 'color-count-chip';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.textContent = String(num);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      state.setN(num);
      expanded = null;
      paint();
      if (state.engaged) hooks.onPicked();
      hooks.onChange();
    });
    nOptions.appendChild(chip);
  }
  nSide.appendChild(nOptions);
  el.appendChild(nSide);

  // Clear button — only visible when the picker is engaged. Explicit
  // "off" affordance; the `—` entry in the N dropdown does the same
  // thing but isn't discoverable to a fresh user.
  const clearBtn = document.createElement('span');
  clearBtn.className = 'color-count-clear';
  clearBtn.setAttribute('role', 'button');
  clearBtn.setAttribute('tabindex', '0');
  clearBtn.setAttribute('aria-label', translate('colorCountPicker.aria.clear', 'clear'));
  clearBtn.textContent = '×';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.clear();
    expanded = null;
    paint();
    hooks.onChange();
  });
  el.appendChild(clearBtn);

  // Click anywhere on the pill body (between the chips) acts as
  // engage-when-inactive too. The chip handlers also engage on first
  // click; this is the body fallback for when the user aims at the
  // padding rather than a chip.
  el.addEventListener('click', () => {
    if (!state.engaged) {
      state.engage();
      paint();
      hooks.onPicked();
      hooks.onChange();
    }
  });

  // Outside click closes any expansion. Listening on the document so
  // taps anywhere — flag tile, other pill, page chrome — collapse the
  // open side. Stays installed for the lifetime of the picker (the
  // page never disposes it).
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', () => {
      if (expanded !== null) {
        expanded = null;
        paint();
      }
    });
  }

  paint();

  function paint() {
    opCurrent.textContent = symbolFor(state.op);
    nCurrent.textContent = String(state.n);
    el.classList.toggle('active', state.engaged);
    opSide.classList.toggle('is-expanded', expanded === 'op');
    nSide.classList.toggle('is-expanded', expanded === 'n');
    clearBtn.hidden = !state.engaged;
  }

  /**
   * Cosmetic disengage. Called when another surface (the "no other
   * colours" lock) engages and the picker should visually step back.
   * Doesn't touch `filters.colorCount`. Drops op/N back to defaults
   * so the next engagement starts from a predictable state.
   */
  function disengage() {
    state.disengage();
    expanded = null;
    paint();
  }

  /**
   * Drop everything to defaults AND re-paint. Used from the page's
   * Clear button. The Clear handler is also responsible for clearing
   * `filters.colorCount` itself (via the lock's reset).
   */
  function reset() {
    state.reset();
    expanded = null;
    paint();
  }

  return { el, disengage, reset };
}

/** @param {Op} op */
function symbolFor(op) {
  if (op === '>=') return '≥';
  if (op === '<=') return '≤';
  return '=';
}
