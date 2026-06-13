import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditFilter } from './ambiguityAudit.js';
import { createCountry } from './group.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * Synthetic test fixtures. We don't load real countries.json here — the
 * audit logic is filter-shape-driven, so a tiny made-up corpus makes
 * the assertions easier to read and keeps the test independent of
 * future tagging changes to real flags.
 */
const FIXTURES = [
  // Canonical 3 colours, plausible 3 OR 4 (Bhutan-shaped). The
  // contested colour is the dragon's black outline — canonically not in
  // primary, but a player counting the outline could read it as present.
  createCountry({
    code: 'bt',
    name: 'Bhutan',
    continent: 'Asia',
    category: 'country',
    primaryColors: ['yellow', 'orange', 'white'],
    additionalColors: [],
    ambiguousColorCount: [3, 4],
    ambiguousColors: ['black'],
    motifs: ['animal'],
  }),
  // Canonical 4 colours, plausible 4..7 (American-Samoa-shaped).
  createCountry({
    code: 'as',
    name: 'American Samoa',
    continent: 'Oceania',
    category: 'country',
    primaryColors: ['blue', 'white', 'red'],
    additionalColors: ['yellow'],
    ambiguousColorCount: [4, 5, 6, 7],
    motifs: ['coat-of-arms'],
  }),
  // Clean 3-colour Asian flag with no ambiguity tags — used as a
  // "should never fire" control to make sure we don't false-positive.
  createCountry({
    code: 'mn',
    name: 'Mongolia',
    continent: 'Asia',
    category: 'country',
    primaryColors: ['red', 'yellow', 'blue'],
    additionalColors: [],
    motifs: [],
  }),
];

test('auditFilter flags Bhutan for colorCount:3 (canonical matches, ambig 4 misses)', () => {
  const v = auditFilter('continent:Asia,color:yellow,colorCount:3', FIXTURES);
  const bt = v.find((x) => x.country === 'bt');
  assert.ok(bt, 'expected a violation for bt');
  assert.equal(bt.kind, 'count');
  assert.match(bt.detail, /canonical count 3 satisfies colorCount=3/);
});

test('auditFilter flags Bhutan for colorCount:>=4 (canonical misses, ambig 4 matches)', () => {
  const v = auditFilter('continent:Asia,colorCount:>=4', FIXTURES);
  const bt = v.find((x) => x.country === 'bt');
  assert.ok(bt, 'expected a violation for bt — canonical 3, ambig 4');
  assert.equal(bt.kind, 'count');
});

test('auditFilter does not flag Bhutan for colorCount:>=5 (no plausible value crosses)', () => {
  const v = auditFilter('continent:Asia,colorCount:>=5', FIXTURES);
  const bt = v.find((x) => x.country === 'bt');
  assert.equal(bt, undefined, 'all plausible counts (3,4) fail >=5 — no disagreement');
});

test('auditFilter flags American Samoa for colorCount:>=5 (canonical 4 misses, ambig 5+ match)', () => {
  const v = auditFilter('continent:Oceania,colorCount:>=5', FIXTURES);
  const as = v.find((x) => x.country === 'as');
  assert.ok(as, 'expected a violation for as');
  assert.equal(as.kind, 'count');
});

test('auditFilter flags Bhutan for color:black membership (canonical out, flip in)', () => {
  const v = auditFilter('continent:Asia,color:black', FIXTURES);
  const bt = v.find((x) => x.country === 'bt');
  assert.ok(bt, 'expected a membership violation on bt');
  assert.equal(bt.kind, 'membership');
  assert.match(bt.detail, /color:black contested/);
});

test('auditFilter flags Bhutan for color:!black (canonical in, flip out)', () => {
  const v = auditFilter('continent:Asia,color:!black', FIXTURES);
  const bt = v.find((x) => x.country === 'bt');
  assert.ok(bt, 'expected a membership violation on bt under color:!black');
  assert.equal(bt.kind, 'membership');
});

test('auditFilter does not flag Bhutan for color:black when the continent excludes it', () => {
  const v = auditFilter('continent:Africa,color:black', FIXTURES);
  const bt = v.find((x) => x.country === 'bt');
  assert.equal(bt, undefined, 'continent:Africa filters Bhutan out regardless of black-flip');
});

test('auditFilter does not flag Bhutan for colorCount:3 when continent excludes it', () => {
  // Bhutan ambig count [3,4] would in isolation straddle colorCount:3,
  // but continent:Europe filters Bhutan out before count even matters.
  // The audit should not false-positive on flags that the non-count
  // filters already exclude from any possible scope.
  const v = auditFilter('continent:Europe,colorCount:3', FIXTURES);
  const bt = v.find((x) => x.country === 'bt');
  assert.equal(bt, undefined);
});

test('auditFilter ignores flags with no ambiguity tags (Mongolia control)', () => {
  const v = auditFilter('continent:Asia,colorCount:3', FIXTURES);
  const mn = v.find((x) => x.country === 'mn');
  assert.equal(mn, undefined);
});

test('auditFilter returns [] for filters with no colorCount or color tokens', () => {
  const v = auditFilter('continent:Asia,motif:animal', FIXTURES);
  assert.deepEqual(v, []);
});

test('auditFilter returns [] for an unparseable filter', () => {
  const v = auditFilter('!!!not-a-filter', FIXTURES);
  assert.deepEqual(v, []);
});
