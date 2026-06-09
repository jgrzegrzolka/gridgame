import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderStats } from './statsRender.js';

/**
 * Minimal Document stand-in: just enough surface for renderStats —
 * createElement (with className, textContent, dataset, appendChild, src,
 * alt, loading, innerHTML, ownerDocument). Children are tracked so we
 * can walk the tree after a render and assert.
 */
function makeDoc() {
  /** @type {any} */
  const doc = {};
  function makeEl(tag) {
    /** @type {any[]} */
    const children = [];
    const dataset = {};
    /** @type {any} */
    const el = {
      tag,
      className: '',
      textContent: '',
      src: '',
      alt: '',
      loading: '',
      ownerDocument: doc,
      children,
      dataset,
      get innerHTML() { return ''; },
      set innerHTML(v) { children.length = 0; },
      /** @param {any} child */
      appendChild(child) { children.push(child); return child; },
    };
    return el;
  }
  doc.createElement = makeEl;
  return doc;
}

function makeContainer(doc) {
  /** @type {any} */
  const c = {
    children: [],
    ownerDocument: doc,
    get innerHTML() { return ''; },
    set innerHTML(_v) { c.children.length = 0; },
    /** @param {any} child */
    appendChild(child) { c.children.push(child); return child; },
  };
  return c;
}

const targets = [
  { code: 'ch', name: 'Switzerland' },
  { code: 'dk', name: 'Denmark' },
  { code: 'gb', name: 'United Kingdom' },
];
const labels = { sectionTitle: 'Community', noSubmissions: 'Be the first!' };
const displayName = (c) => c.name;

test('zero attempts renders heading + empty message, no list', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: { totalAttempts: 0, perCodeFinds: {}, median: 0, topPct: 0 },
    targets, displayName, labels,
  });
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].tag, 'h2');
  assert.equal(container.children[0].textContent, 'Community');
  assert.equal(container.children[1].tag, 'p');
  assert.equal(container.children[1].textContent, 'Be the first!');
});

test('null stats also renders the empty message', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, { stats: null, targets, displayName, labels });
  assert.equal(container.children[1].textContent, 'Be the first!');
});

test('renders one tile per target, with flag image and percentage', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: {
      totalAttempts: 100,
      perCodeFinds: { ch: 87, dk: 42, gb: 31 },
      median: 2, topPct: 12,
    },
    targets, displayName, labels,
  });
  const list = container.children[1];
  assert.equal(list.tag, 'ul');
  assert.equal(list.children.length, 3);
  // Each tile is a li with image + pct span
  for (const tile of list.children) {
    assert.equal(tile.tag, 'li');
    assert.equal(tile.children.length, 2);
    assert.equal(tile.children[0].tag, 'img');
    assert.equal(tile.children[1].tag, 'span');
  }
});

test('tiles are sorted hardest first (lowest percent first)', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: {
      totalAttempts: 100,
      perCodeFinds: { ch: 87, dk: 42, gb: 31 },
      median: 2, topPct: 12,
    },
    targets, displayName, labels,
  });
  const list = container.children[1];
  // ch=87%, dk=42%, gb=31% → sort ascending → gb, dk, ch
  assert.equal(list.children[0].dataset.name, 'United Kingdom');
  assert.equal(list.children[1].dataset.name, 'Denmark');
  assert.equal(list.children[2].dataset.name, 'Switzerland');
});

test('percentage is rounded to integer and stored in dataset', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: {
      totalAttempts: 7,
      perCodeFinds: { ch: 2, dk: 1, gb: 5 },
      median: 1, topPct: 0,
    },
    targets, displayName, labels,
  });
  const list = container.children[1];
  // ch: 2/7 = 28.57 → 29; dk: 1/7 = 14.28 → 14; gb: 5/7 = 71.4 → 71
  // Sort ascending → dk(14), ch(29), gb(71)
  assert.equal(list.children[0].dataset.pct, '14');
  assert.equal(list.children[0].children[1].textContent, '14%');
  assert.equal(list.children[1].dataset.pct, '29');
  assert.equal(list.children[2].dataset.pct, '71');
});

test('missing code in perCodeFinds counts as zero finds', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: {
      totalAttempts: 10,
      perCodeFinds: { ch: 5 }, // dk and gb missing
      median: 1, topPct: 0,
    },
    targets, displayName, labels,
  });
  const list = container.children[1];
  // dk=0%, gb=0% (tied) sort by code → dk, gb. Then ch=50%
  assert.equal(list.children[0].dataset.name, 'Denmark');
  assert.equal(list.children[0].dataset.pct, '0');
  assert.equal(list.children[1].dataset.name, 'United Kingdom');
  assert.equal(list.children[1].dataset.pct, '0');
  assert.equal(list.children[2].dataset.name, 'Switzerland');
  assert.equal(list.children[2].dataset.pct, '50');
});

test('tied percentages sort by country code for stable order', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: {
      totalAttempts: 10,
      perCodeFinds: { ch: 5, dk: 5, gb: 5 }, // all 50%
      median: 1, topPct: 0,
    },
    targets, displayName, labels,
  });
  const list = container.children[1];
  // All 50% — sort by code ascending: ch, dk, gb
  assert.equal(list.children[0].dataset.name, 'Switzerland');
  assert.equal(list.children[1].dataset.name, 'Denmark');
  assert.equal(list.children[2].dataset.name, 'United Kingdom');
});

test('container is cleared before render (no append-only growth)', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  // Stuff something in first
  container.appendChild({ tag: 'div' });
  container.appendChild({ tag: 'div' });
  renderStats(container, {
    stats: { totalAttempts: 5, perCodeFinds: { ch: 3 }, median: 0, topPct: 0 },
    targets, displayName, labels,
  });
  // Should be exactly 2 children: heading + list (not the leftover divs)
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].tag, 'h2');
  assert.equal(container.children[1].tag, 'ul');
});

test('uses the injected displayName function so localized names appear', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: { totalAttempts: 10, perCodeFinds: { ch: 5 }, median: 0, topPct: 0 },
    targets: [{ code: 'ch', name: 'Switzerland' }],
    displayName: (c) => `LOCALIZED-${c.code}`,
    labels,
  });
  const tile = container.children[1].children[0];
  assert.equal(tile.dataset.name, 'LOCALIZED-ch');
  assert.equal(tile.children[0].alt, 'LOCALIZED-ch');
});

test('section heading uses the injected label exactly', () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  renderStats(container, {
    stats: { totalAttempts: 1, perCodeFinds: {}, median: 0, topPct: 0 },
    targets, displayName,
    labels: { sectionTitle: 'CUSTOM TITLE', noSubmissions: '...' },
  });
  assert.equal(container.children[0].textContent, 'CUSTOM TITLE');
});
