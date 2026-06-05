import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRatings, setRating, ratedCount } from './rating.js';

describe('ratings helpers', () => {
  it('starts empty', () => {
    assert.deepEqual(emptyRatings(), {});
    assert.equal(ratedCount(emptyRatings()), 0);
  });

  it('records a rating', () => {
    const r = setRating(emptyRatings(), 'us', 1);
    assert.equal(r.us, 1);
    assert.equal(ratedCount(r), 1);
  });

  it('overwrites an existing rating without inflating the count', () => {
    let r = setRating(emptyRatings(), 'us', 1);
    r = setRating(r, 'us', 4);
    assert.equal(r.us, 4);
    assert.equal(ratedCount(r), 1);
  });

  it('accepts the full 1..6 range', () => {
    const r = setRating(setRating(emptyRatings(), 'a', 1), 'b', 6);
    assert.equal(r.a, 1);
    assert.equal(r.b, 6);
  });

  it('ignores out-of-range, non-integer, and NaN scores', () => {
    const before = setRating(emptyRatings(), 'us', 3);
    assert.deepEqual(setRating(before, 'pl', 0), before);
    assert.deepEqual(setRating(before, 'pl', 7), before);
    assert.deepEqual(setRating(before, 'pl', 2.5), before);
    assert.deepEqual(setRating(before, 'pl', NaN), before);
  });

  it('ignores empty code', () => {
    const before = emptyRatings();
    assert.deepEqual(setRating(before, '', 3), before);
  });

  it('returns a new object — does not mutate input', () => {
    const a = emptyRatings();
    const b = setRating(a, 'us', 3);
    assert.notStrictEqual(a, b);
    assert.deepEqual(a, {});
  });
});
