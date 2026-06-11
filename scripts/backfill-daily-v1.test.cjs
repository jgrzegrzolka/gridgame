const test = require('node:test');
const assert = require('node:assert/strict');
const { planRow, stripSystemFields, TARGET_VERSION } = require('./backfill-daily-v1.cjs');

const PRE_317_ROW = {
  id: '1:abc',
  puzzleId: 1,
  deviceId: 'abc',
  foundCodes: ['ch', 'fi', 'dk'],
  // no wrongCodes
  totalCount: 9,
  durationMs: 50_000,
  submittedAt: 1_780_000_000_000,
  _rid: 'X', _self: 'Y', _etag: 'Z', _attachments: 'A', _ts: 1_780_000_000,
};

const POST_317_ROW = {
  ...PRE_317_ROW,
  id: '1:def',
  deviceId: 'def',
  wrongCodes: ['fr', 'de'],
};

const ALREADY_V1_ROW = {
  ...POST_317_ROW,
  id: '1:ghi',
  deviceId: 'ghi',
  v: 1,
};

test('group A: pre-#317 row gets wrongCodes:[], backfilled:true, v:1', () => {
  const plan = planRow(PRE_317_ROW);
  assert.equal(plan.action, 'group_a');
  assert.deepEqual(plan.next.wrongCodes, []);
  assert.equal(plan.next.backfilled, true);
  assert.equal(plan.next.v, 1);
});

test('group B: post-#317 row gets v:1 only, no backfilled marker', () => {
  const plan = planRow(POST_317_ROW);
  assert.equal(plan.action, 'group_b');
  assert.equal(plan.next.v, 1);
  assert.deepEqual(plan.next.wrongCodes, ['fr', 'de']);
  assert.equal('backfilled' in plan.next, false);
});

test('skip: row already at TARGET_VERSION is left alone', () => {
  const plan = planRow(ALREADY_V1_ROW);
  assert.equal(plan.action, 'skip');
});

test('TARGET_VERSION matches what the writer ships today', () => {
  assert.equal(TARGET_VERSION, 1);
});

test('stripSystemFields removes Cosmos system fields, keeps everything else', () => {
  const cleaned = stripSystemFields(PRE_317_ROW);
  assert.equal('_rid' in cleaned, false);
  assert.equal('_self' in cleaned, false);
  assert.equal('_etag' in cleaned, false);
  assert.equal('_attachments' in cleaned, false);
  assert.equal('_ts' in cleaned, false);
  assert.equal(cleaned.id, '1:abc');
  assert.equal(cleaned.puzzleId, 1);
});

test('planRow preserves local: true on dev rows it migrates', () => {
  const devRow = { ...POST_317_ROW, local: true };
  const plan = planRow(devRow);
  assert.equal(plan.action, 'group_b');
  assert.equal(plan.next.local, true);
});

test('planRow preserves absence of local on prod rows it migrates', () => {
  const plan = planRow(POST_317_ROW);
  assert.equal(plan.action, 'group_b');
  assert.equal('local' in plan.next, false);
});
