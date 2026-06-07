import { test } from 'node:test';
import assert from 'node:assert/strict';

import { promote } from './release-next.mjs';

const entry = (n) => ({
  n,
  filter: `motif:test-${n}`,
  answers: ['xx'],
  description: { en: `Entry ${n}.`, pl: `Wpis ${n}.` },
});

test('promote moves backlog[0] to the end of live', () => {
  const live = [entry(1), entry(2)];
  const backlog = [entry(3), entry(4), entry(5)];
  const result = promote(live, backlog);
  assert.deepEqual(
    result.live.map((e) => e.n),
    [1, 2, 3],
  );
  assert.deepEqual(
    result.backlog.map((e) => e.n),
    [4, 5],
  );
  assert.equal(result.n, 3);
});

test('promote preserves the moved entry byte-for-byte', () => {
  const live = [entry(1)];
  const moved = entry(2);
  const result = promote(live, [moved]);
  assert.deepEqual(result.live[1], moved);
});

test('promote does not mutate its inputs', () => {
  const live = [entry(1)];
  const backlog = [entry(2), entry(3)];
  promote(live, backlog);
  assert.deepEqual(
    live.map((e) => e.n),
    [1],
  );
  assert.deepEqual(
    backlog.map((e) => e.n),
    [2, 3],
  );
});

test('promote preserves sequential numbering across the move', () => {
  // Mirrors the rule-4 invariant — after the move, backlog[0].n must
  // still equal live.length + 1 if the input already satisfied it.
  const live = [entry(1), entry(2)];
  const backlog = [entry(3), entry(4), entry(5)];
  const result = promote(live, backlog);
  assert.equal(result.backlog[0].n, result.live.length + 1);
});

test('promote throws when the backlog is empty', () => {
  assert.throws(() => promote([entry(1)], []), /Backlog is empty/);
});
