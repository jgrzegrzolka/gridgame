const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyResultDoc } = require('./dailyResultDoc');

const input = {
  puzzleId: 7,
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  foundCodes: ['ch', 'dk', 'gb'],
  wrongCodes: ['de', 'fr'],
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
  assert.deepEqual(doc.wrongCodes, ['de', 'fr']);
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

test('empty wrongCodes is preserved (player who never typed a wrong country)', () => {
  const doc = buildDailyResultDoc({ ...input, wrongCodes: [] });
  assert.deepEqual(doc.wrongCodes, []);
});

test('missing wrongCodes defaults to [] (forward-compat with older clients)', () => {
  const { wrongCodes, ...withoutWrong } = input;
  void wrongCodes;
  const doc = buildDailyResultDoc(withoutWrong);
  assert.deepEqual(doc.wrongCodes, []);
});

test('does NOT add fields the schema does not expect', () => {
  const doc = buildDailyResultDoc(input);
  const expected = ['id', 'puzzleId', 'deviceId', 'foundCodes', 'wrongCodes', 'totalCount', 'durationMs', 'submittedAt', 'v'];
  assert.deepEqual(Object.keys(doc).sort(), expected.sort());
});

test('schema version v: 1 is set unconditionally on every native write', () => {
  const doc = buildDailyResultDoc(input);
  assert.equal(doc.v, 1);
});

test('schema version is on dev rows too (the v field is independent of the `local` provenance marker)', () => {
  const doc = buildDailyResultDoc({ ...input, local: true });
  assert.equal(doc.v, 1);
});

test('local: true is stored on the doc', () => {
  const doc = buildDailyResultDoc({ ...input, local: true });
  assert.equal(doc.local, true);
});

test('local: false is NOT stored on the doc (prod rows stay field-free)', () => {
  // Asymmetric on purpose: presence of the field means "this is dev",
  // absence means "prod or legacy". Storing `local: false` would
  // bloat every prod row with a useless field forever.
  const doc = buildDailyResultDoc({ ...input, local: false });
  assert.equal('local' in doc, false);
});

test('local omitted from input → field absent on doc', () => {
  const doc = buildDailyResultDoc(input);
  assert.equal('local' in doc, false);
});


test('id is deterministic for the same (puzzleId, deviceId) regardless of other fields', () => {
  const a = buildDailyResultDoc(input);
  const b = buildDailyResultDoc({ ...input, foundCodes: ['xx'], durationMs: 99, now: 0 });
  assert.equal(a.id, b.id);
});
