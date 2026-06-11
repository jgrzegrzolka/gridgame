const test = require('node:test');
const assert = require('node:assert/strict');
const { planRow, ADD_CODE, NEW_TOTAL } = require('./backfill-puzzle1-add-li.cjs');

const FULL_SOLVE_ROW = {
  id: '1:abc',
  puzzleId: 1,
  deviceId: 'abc',
  foundCodes: ['ch', 'dk', 'fi', 'gb', 'gr', 'is', 'mt', 'no', 'se'],
  wrongCodes: [],
  totalCount: 9,
  durationMs: 50_000,
  submittedAt: 1_780_000_000_000,
  v: 1,
  _rid: 'X', _self: 'Y', _etag: 'Z', _attachments: 'A', _ts: 1_780_000_000,
};

const PARTIAL_SOLVE_ROW = {
  ...FULL_SOLVE_ROW,
  id: '1:def',
  deviceId: 'def',
  foundCodes: ['ch', 'dk', 'fi'],
};

const ALREADY_MIGRATED_ROW = {
  ...FULL_SOLVE_ROW,
  id: '1:ghi',
  deviceId: 'ghi',
  foundCodes: ['ch', 'dk', 'fi', 'gb', 'gr', 'is', 'li', 'mt', 'no', 'se'],
  totalCount: 10,
  backfilled: true,
};

test('full-solve row gets li appended + totalCount=10 + backfilled:true', () => {
  const plan = planRow(FULL_SOLVE_ROW);
  assert.equal(plan.action, 'patch');
  assert.ok(plan.next.foundCodes.includes(ADD_CODE));
  assert.equal(plan.next.foundCodes.length, 10);
  assert.equal(plan.next.totalCount, NEW_TOTAL);
  assert.equal(plan.next.backfilled, true);
});

test('partial-solve row also gets li appended (bonus credit)', () => {
  const plan = planRow(PARTIAL_SOLVE_ROW);
  assert.equal(plan.action, 'patch');
  assert.deepEqual(plan.next.foundCodes, ['ch', 'dk', 'fi', 'li']);
  assert.equal(plan.next.totalCount, NEW_TOTAL);
});

test('already-migrated row is skipped (idempotent re-run)', () => {
  const plan = planRow(ALREADY_MIGRATED_ROW);
  assert.equal(plan.action, 'skip');
});

test('patch strips system fields', () => {
  const plan = planRow(FULL_SOLVE_ROW);
  for (const k of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
    assert.equal(k in plan.next, false, `${k} should be stripped`);
  }
});

test('row with li but old totalCount=9 still gets patched (totalCount-only fix)', () => {
  const partial = { ...FULL_SOLVE_ROW, foundCodes: ['ch', 'li'], totalCount: 9 };
  const plan = planRow(partial);
  assert.equal(plan.action, 'patch');
  assert.deepEqual(plan.next.foundCodes, ['ch', 'li']); // no duplicate li
  assert.equal(plan.next.totalCount, NEW_TOTAL);
});

test('li in wrongCodes is stripped (past guesses now correct)', () => {
  const row = {
    ...FULL_SOLVE_ROW,
    foundCodes: ['ch', 'dk'],
    wrongCodes: ['fr', 'li', 'de'],
  };
  const plan = planRow(row);
  assert.equal(plan.action, 'patch');
  assert.deepEqual(plan.next.wrongCodes, ['fr', 'de']);
  assert.ok(plan.next.foundCodes.includes('li'));
});

test('already-migrated row but with stale li in wrongCodes is re-patched', () => {
  const row = {
    ...ALREADY_MIGRATED_ROW,
    wrongCodes: ['fr', 'li'],
  };
  const plan = planRow(row);
  assert.equal(plan.action, 'patch');
  assert.deepEqual(plan.next.wrongCodes, ['fr']);
});

test('fully clean row (li in found, not in wrong, totalCount=10) is skipped', () => {
  const row = { ...ALREADY_MIGRATED_ROW, wrongCodes: ['fr', 'de'] };
  const plan = planRow(row);
  assert.equal(plan.action, 'skip');
});
