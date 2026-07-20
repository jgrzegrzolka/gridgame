const { test } = require('node:test');
const assert = require('node:assert/strict');

const { planRow, TARGETS, ADD_CODE } = require('./backfill-gq-add-star.cjs');

test('a row that never guessed gq is credited with it', () => {
  const plan = planRow({ id: 'x', puzzleId: 45, foundCodes: ['so', 'km'], wrongCodes: ['pl'], totalCount: 11 }, 12);
  assert.equal(plan.action, 'patch');
  assert.ok(plan.next.foundCodes.includes('gq'));
  assert.equal(plan.next.totalCount, 12);
  assert.deepEqual(plan.next.wrongCodes, ['pl']);
});

test('a row that guessed gq has it moved from wrong to found, not duplicated', () => {
  // This is the case the puzzle1_add_li backfill never had to handle: the
  // player typed Equatorial Guinea, was told it was wrong, and that verdict
  // is the bug being corrected.
  const plan = planRow({ id: 'x', puzzleId: 45, foundCodes: ['so'], wrongCodes: ['pl', 'gq'], totalCount: 11 }, 12);
  assert.deepEqual(plan.next.foundCodes, ['so', 'gq']);
  assert.deepEqual(plan.next.wrongCodes, ['pl'], 'gq must not remain a recorded mistake');
});

test('an already-migrated row is skipped, so re-running is safe', () => {
  const plan = planRow({ id: 'x', puzzleId: 45, foundCodes: ['so', 'gq'], wrongCodes: [], totalCount: 12 }, 12);
  assert.equal(plan.action, 'skip');
});

test('a row with the new total but missing gq is still patched', () => {
  // Guards a half-applied run: totalCount bumped, credit not yet given.
  const plan = planRow({ id: 'x', puzzleId: 45, foundCodes: ['so'], wrongCodes: [], totalCount: 12 }, 12);
  assert.equal(plan.action, 'patch');
  assert.ok(plan.next.foundCodes.includes('gq'));
});

test('system fields are stripped before upsert', () => {
  const plan = planRow({
    id: 'x', puzzleId: 45, foundCodes: [], wrongCodes: [], totalCount: 11,
    _rid: 'r', _self: 's', _etag: 'e', _attachments: 'a', _ts: 1,
  }, 12);
  for (const f of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
    assert.ok(!(f in plan.next), `${f} must not be written back`);
  }
  assert.equal(plan.next.id, 'x');
});

test('the patched row is marked as backfilled', () => {
  const plan = planRow({ id: 'x', puzzleId: 45, foundCodes: [], wrongCodes: [], totalCount: 11 }, 12);
  assert.equal(plan.next.backfilled, true);
});

test('missing code arrays are tolerated rather than throwing', () => {
  const plan = planRow({ id: 'x', puzzleId: 13, totalCount: 15 }, 16);
  assert.deepEqual(plan.next.foundCodes, ['gq']);
  assert.equal(plan.next.totalCount, 16);
});

test('both affected puzzles are targeted with the right new totals', () => {
  // Pins the blast radius: exactly #13 and #45, nothing else.
  assert.deepEqual(TARGETS, [{ puzzleId: 13, newTotal: 16 }, { puzzleId: 45, newTotal: 12 }]);
  assert.equal(ADD_CODE, 'gq');
});
