const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyResultDoc } = require('./dailyResultDoc');

const input = {
  puzzleId: 7,
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  foundCodes: ['ch', 'dk', 'gb'],
  totalCount: 9,
  durationMs: 87_000,
  now: 1_717_920_000_000,
};

test('builds the document with the canonical id shape', () => {
  const doc = buildDailyResultDoc(input);
  assert.equal(doc.id, '7:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

test('all input fields round-trip onto the doc', () => {
  const doc = buildDailyResultDoc(input);
  assert.equal(doc.puzzleId, 7);
  assert.equal(doc.deviceId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.deepEqual(doc.foundCodes, ['ch', 'dk', 'gb']);
  assert.equal(doc.totalCount, 9);
  assert.equal(doc.durationMs, 87_000);
});

test('submittedAt is the injected now (not Date.now())', () => {
  const doc = buildDailyResultDoc(input);
  assert.equal(doc.submittedAt, 1_717_920_000_000);
});

test('empty foundCodes is preserved (zero-find / give-up case)', () => {
  const doc = buildDailyResultDoc({ ...input, foundCodes: [] });
  assert.deepEqual(doc.foundCodes, []);
});

test('does NOT add fields the schema does not expect', () => {
  const doc = buildDailyResultDoc(input);
  const expected = ['id', 'puzzleId', 'deviceId', 'foundCodes', 'totalCount', 'durationMs', 'submittedAt'];
  assert.deepEqual(Object.keys(doc).sort(), expected.sort());
});

test('id is deterministic for the same (puzzleId, deviceId) regardless of other fields', () => {
  const a = buildDailyResultDoc(input);
  const b = buildDailyResultDoc({ ...input, foundCodes: ['xx'], durationMs: 99, now: 0 });
  assert.equal(a.id, b.id);
});
