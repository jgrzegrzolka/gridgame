import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  rate,
  skip,
  undo,
  currentCountry,
  isDone,
  progress,
  jumpToFirstUnrated,
} from './rating.js';

const COUNTRIES = [
  { code: 'af', name: 'Afghanistan' },
  { code: 'al', name: 'Albania' },
  { code: 'dz', name: 'Algeria' },
];

describe('rating state machine', () => {
  it('starts at index 0 with no ratings', () => {
    const s = emptyState();
    assert.equal(s.index, 0);
    assert.deepEqual(s.ratings, {});
    assert.equal(currentCountry(s, COUNTRIES)?.code, 'af');
  });

  it('records a rating and advances', () => {
    const s = rate(emptyState(), COUNTRIES, 3);
    assert.equal(s.index, 1);
    assert.equal(s.ratings.af, 3);
    assert.equal(currentCountry(s, COUNTRIES)?.code, 'al');
  });

  it('ignores invalid scores (out of range, non-integer, NaN)', () => {
    const s = emptyState();
    assert.deepEqual(rate(s, COUNTRIES, 0), s);
    assert.deepEqual(rate(s, COUNTRIES, 6), s);
    assert.deepEqual(rate(s, COUNTRIES, 2.5), s);
    assert.deepEqual(rate(s, COUNTRIES, NaN), s);
  });

  it('skip advances without recording a rating', () => {
    const s = skip(emptyState(), COUNTRIES);
    assert.equal(s.index, 1);
    assert.deepEqual(s.ratings, {});
  });

  it('undo steps back one but keeps the existing rating', () => {
    let s = rate(emptyState(), COUNTRIES, 4);
    s = undo(s);
    assert.equal(s.index, 0);
    assert.equal(s.ratings.af, 4);
  });

  it('rate at end of list is a no-op', () => {
    const s = { index: 3, ratings: {} };
    assert.deepEqual(rate(s, COUNTRIES, 3), s);
    assert.equal(isDone(s, COUNTRIES), true);
  });

  it('skip at end of list is a no-op', () => {
    const s = { index: 3, ratings: {} };
    assert.deepEqual(skip(s, COUNTRIES), s);
  });

  it('undo at start is a no-op', () => {
    const s = emptyState();
    assert.deepEqual(undo(s), s);
  });

  it('progress reports position and rated count independently', () => {
    let s = emptyState();
    s = rate(s, COUNTRIES, 1);
    s = skip(s, COUNTRIES);
    assert.deepEqual(progress(s, COUNTRIES), { position: 2, total: 3, rated: 1 });
  });

  it('jumpToFirstUnrated finds the first hole', () => {
    let s = emptyState();
    s = rate(s, COUNTRIES, 1);
    s = rate(s, COUNTRIES, 2);
    s = undo(s);
    s = undo(s);
    s = jumpToFirstUnrated(s, COUNTRIES);
    assert.equal(s.index, 2);
  });

  it('jumpToFirstUnrated returns end when everything is rated', () => {
    let s = emptyState();
    s = rate(s, COUNTRIES, 1);
    s = rate(s, COUNTRIES, 1);
    s = rate(s, COUNTRIES, 1);
    s = jumpToFirstUnrated(s, COUNTRIES);
    assert.equal(s.index, 3);
    assert.equal(isDone(s, COUNTRIES), true);
  });

  it('changing a rating overwrites the previous score', () => {
    let s = rate(emptyState(), COUNTRIES, 2);
    s = undo(s);
    s = rate(s, COUNTRIES, 5);
    assert.equal(s.ratings.af, 5);
    assert.equal(s.index, 1);
  });
});
