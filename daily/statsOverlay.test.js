import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyFindRatesToTiles } from './statsOverlay.js';

function makeDoc() {
  /** @type {any} */
  const doc = {};
  doc.createElement = (tag) => {
    /** @type {any} */
    const el = {
      tag,
      className: '',
      textContent: '',
      children: [],
      ownerDocument: doc,
      dataset: {},
      appendChild(c) { this.children.push(c); return c; },
      querySelector(sel) {
        const cls = sel.replace(/^\./, '');
        return this.children.find((c) => (c.className || '').split(' ').includes(cls)) || null;
      },
    };
    return el;
  };
  return doc;
}

/** @param {string[]} codes */
function makeContainer(doc, codes) {
  const tiles = codes.map((code) => {
    const tile = doc.createElement('li');
    tile.className = 'find-tile';
    tile.dataset.code = code;
    return tile;
  });
  /** @type {any} */
  const container = {
    ownerDocument: doc,
    tiles,
    querySelectorAll(sel) {
      if (sel === '.find-tile') return tiles;
      return [];
    },
  };
  return { container, tiles };
}

test('null stats → no-op (no overlays added)', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch', 'dk']);
  applyFindRatesToTiles(container, null);
  for (const t of tiles) assert.equal(t.children.length, 0);
});

test('undefined stats → no-op', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch']);
  applyFindRatesToTiles(container, undefined);
  assert.equal(tiles[0].children.length, 0);
});

test('totalAttempts === 0 → no-op (no meaningful population yet)', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch']);
  applyFindRatesToTiles(container, { totalAttempts: 0, perCodeFinds: {} });
  assert.equal(tiles[0].children.length, 0);
});

test('appends a .find-stats-pct span to each tile with the correct percentage', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch', 'dk', 'gb']);
  applyFindRatesToTiles(container, {
    totalAttempts: 10,
    perCodeFinds: { ch: 8, dk: 5, gb: 1 },
  });
  assert.equal(tiles[0].children[0].className, 'find-stats-pct');
  assert.equal(tiles[0].children[0].textContent, '80%');
  assert.equal(tiles[1].children[0].textContent, '50%');
  assert.equal(tiles[2].children[0].textContent, '10%');
});

test('code missing from perCodeFinds renders 0%', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch', 'unknown']);
  applyFindRatesToTiles(container, {
    totalAttempts: 4,
    perCodeFinds: { ch: 3 },
  });
  assert.equal(tiles[0].children[0].textContent, '75%');
  assert.equal(tiles[1].children[0].textContent, '0%');
});

test('tile without data-code is skipped (defensive)', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch']);
  delete tiles[0].dataset.code;
  applyFindRatesToTiles(container, { totalAttempts: 1, perCodeFinds: { ch: 1 } });
  assert.equal(tiles[0].children.length, 0);
});

test('idempotent: re-applying does not duplicate the overlay span', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch']);
  applyFindRatesToTiles(container, { totalAttempts: 10, perCodeFinds: { ch: 5 } });
  applyFindRatesToTiles(container, { totalAttempts: 10, perCodeFinds: { ch: 5 } });
  assert.equal(tiles[0].children.length, 1);
  assert.equal(tiles[0].children[0].textContent, '50%');
});

test('re-apply updates the text in-place when the rate changed', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['ch']);
  applyFindRatesToTiles(container, { totalAttempts: 10, perCodeFinds: { ch: 5 } });
  applyFindRatesToTiles(container, { totalAttempts: 10, perCodeFinds: { ch: 8 } });
  assert.equal(tiles[0].children.length, 1);
  assert.equal(tiles[0].children[0].textContent, '80%');
});

test('percentages round to nearest integer', () => {
  const doc = makeDoc();
  const { container, tiles } = makeContainer(doc, ['a', 'b', 'c']);
  applyFindRatesToTiles(container, {
    totalAttempts: 7,
    perCodeFinds: { a: 1, b: 2, c: 5 },
  });
  // 1/7 = 14.28 → 14; 2/7 = 28.57 → 29; 5/7 = 71.43 → 71
  assert.equal(tiles[0].children[0].textContent, '14%');
  assert.equal(tiles[1].children[0].textContent, '29%');
  assert.equal(tiles[2].children[0].textContent, '71%');
});
