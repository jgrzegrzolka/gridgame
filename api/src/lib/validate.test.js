const test = require('node:test');
const assert = require('node:assert/strict');
const { validateResult } = require('./validate');

const validBody = () => ({
  puzzleId: 7,
  totalCount: 9,
  durationMs: 87_000,
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  foundCodes: ['ch', 'dk', 'gb'],
});

test('valid body passes', () => {
  assert.deepEqual(validateResult(validBody()), { ok: true });
});

test('null body fails with body_required', () => {
  assert.deepEqual(validateResult(null), { ok: false, error: 'body_required' });
});

test('non-object body fails with body_required', () => {
  assert.deepEqual(validateResult('hi'), { ok: false, error: 'body_required' });
});

test('puzzleId 0 or negative is invalid', () => {
  const b = validBody();
  b.puzzleId = 0;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_puzzleId' });
  b.puzzleId = -3;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_puzzleId' });
});

test('puzzleId non-integer is invalid', () => {
  const b = validBody();
  b.puzzleId = 1.5;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_puzzleId' });
  b.puzzleId = '7';
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_puzzleId' });
});

test('totalCount out of range is invalid', () => {
  const b = validBody();
  b.totalCount = 0;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_totalCount' });
  b.totalCount = 51;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_totalCount' });
});

test('durationMs too short is invalid', () => {
  const b = validBody();
  b.durationMs = 500;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_durationMs' });
});

test('durationMs too long is invalid', () => {
  const b = validBody();
  b.durationMs = 7 * 60 * 60 * 1000;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_durationMs' });
});

test('deviceId too short is invalid', () => {
  const b = validBody();
  b.deviceId = 'short';
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_deviceId' });
});

test('deviceId non-string is invalid', () => {
  const b = validBody();
  b.deviceId = 12345678;
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_deviceId' });
});

test('foundCodes must be an array', () => {
  const b = validBody();
  b.foundCodes = 'ch';
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_foundCodes' });
});

test('foundCodes empty is valid (zero finds is a real outcome)', () => {
  const b = validBody();
  b.foundCodes = [];
  assert.deepEqual(validateResult(b), { ok: true });
});

test('foundCodes longer than totalCount fails', () => {
  const b = validBody();
  b.totalCount = 2;
  b.foundCodes = ['ch', 'dk', 'gb'];
  assert.deepEqual(validateResult(b), { ok: false, error: 'too_many_codes' });
});

test('code format must be 2 lowercase letters', () => {
  const b = validBody();
  b.foundCodes = ['CH'];
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_code' });
  b.foundCodes = ['c'];
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_code' });
  b.foundCodes = ['ch1'];
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_code' });
  b.foundCodes = [42];
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_code' });
});

test('duplicate codes are rejected', () => {
  const b = validBody();
  b.foundCodes = ['ch', 'dk', 'ch'];
  assert.deepEqual(validateResult(b), { ok: false, error: 'duplicate_codes' });
});

test('wrongCodes is optional — absent passes', () => {
  const b = validBody();
  delete b.wrongCodes;
  assert.deepEqual(validateResult(b), { ok: true });
});

test('wrongCodes empty array passes', () => {
  const b = validBody();
  b.wrongCodes = [];
  assert.deepEqual(validateResult(b), { ok: true });
});

test('wrongCodes valid codes pass', () => {
  const b = validBody();
  b.wrongCodes = ['de', 'fr', 'us'];
  assert.deepEqual(validateResult(b), { ok: true });
});

test('wrongCodes non-array (e.g. string) is rejected', () => {
  const b = validBody();
  b.wrongCodes = 'de,fr';
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_wrongCodes' });
});

test('wrongCodes containing a malformed code is rejected', () => {
  const b = validBody();
  b.wrongCodes = ['de', 'XYZ'];
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_wrong_code' });
});

test('wrongCodes containing a non-string entry is rejected', () => {
  const b = validBody();
  b.wrongCodes = ['de', 42];
  assert.deepEqual(validateResult(b), { ok: false, error: 'invalid_wrong_code' });
});

test('wrongCodes with duplicates rejected', () => {
  const b = validBody();
  b.wrongCodes = ['de', 'fr', 'de'];
  assert.deepEqual(validateResult(b), { ok: false, error: 'duplicate_wrong_codes' });
});

test('foundCodes and wrongCodes can share a code (different semantics — found vs wrong-attempted)', () => {
  // This shouldn't happen in normal play (a code goes to one or the
  // other), but the validator should not impose cross-list uniqueness.
  // Each list is deduped on its own; the *server* trusts the client's
  // semantics.
  const b = validBody();
  b.foundCodes = ['ch'];
  b.wrongCodes = ['ch'];
  assert.deepEqual(validateResult(b), { ok: true });
});

const { validatePuzzleIdParam } = require('./validate');

test('validatePuzzleIdParam accepts a numeric string within range', () => {
  assert.deepEqual(validatePuzzleIdParam('7'), { ok: true, value: 7 });
  assert.deepEqual(validatePuzzleIdParam('1'), { ok: true, value: 1 });
  assert.deepEqual(validatePuzzleIdParam('9999'), { ok: true, value: 9999 });
});

test('validatePuzzleIdParam rejects 0 and negatives', () => {
  assert.deepEqual(validatePuzzleIdParam('0'), { ok: false, error: 'invalid_puzzleId' });
  assert.deepEqual(validatePuzzleIdParam('-3'), { ok: false, error: 'invalid_puzzleId' });
});

test('validatePuzzleIdParam rejects values over the cap', () => {
  assert.deepEqual(validatePuzzleIdParam('10000'), { ok: false, error: 'invalid_puzzleId' });
});

test('validatePuzzleIdParam rejects non-integer strings', () => {
  assert.deepEqual(validatePuzzleIdParam('1.5'), { ok: false, error: 'invalid_puzzleId' });
  assert.deepEqual(validatePuzzleIdParam('1e3'), { ok: true, value: 1000 }); // Number('1e3') === 1000, an integer
  assert.deepEqual(validatePuzzleIdParam('abc'), { ok: false, error: 'invalid_puzzleId' });
});

test('validatePuzzleIdParam rejects empty / missing input', () => {
  assert.deepEqual(validatePuzzleIdParam(''), { ok: false, error: 'invalid_puzzleId' });
  assert.deepEqual(validatePuzzleIdParam(/** @type {any} */ (undefined)), { ok: false, error: 'invalid_puzzleId' });
  assert.deepEqual(validatePuzzleIdParam(/** @type {any} */ (null)), { ok: false, error: 'invalid_puzzleId' });
});

test('validatePuzzleIdParam rejects non-string inputs (defensive)', () => {
  assert.deepEqual(validatePuzzleIdParam(/** @type {any} */ (7)), { ok: false, error: 'invalid_puzzleId' });
  assert.deepEqual(validatePuzzleIdParam(/** @type {any} */ ({})), { ok: false, error: 'invalid_puzzleId' });
});

// ---------------------------------------------------------------------------
// validateQuizRecord
// ---------------------------------------------------------------------------

const { validateQuizRecord } = require('./validate');

const validQuizBody = () => ({
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  configKey: 'countries:60s:sov',
  score: 50,
  durationMs: 60_000,
  lowerWins: false,
});

test('validateQuizRecord: valid body passes', () => {
  assert.deepEqual(validateQuizRecord(validQuizBody()), { ok: true });
});

test('validateQuizRecord: null body → body_required', () => {
  assert.deepEqual(validateQuizRecord(null), { ok: false, error: 'body_required' });
});

test('validateQuizRecord: short deviceId → invalid_deviceId', () => {
  const b = validQuizBody();
  b.deviceId = 'short';
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_deviceId' });
});

test('validateQuizRecord: malformed configKey → invalid_configKey', () => {
  const b = validQuizBody();
  b.configKey = 'countries:60s';
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_configKey' });
  b.configKey = 'countries:60s:wat';
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_configKey' });
  b.configKey = '';
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_configKey' });
});

test('validateQuizRecord: oversize configKey → invalid_configKey', () => {
  const b = validQuizBody();
  b.configKey = `${'x'.repeat(50)}:60s:sov`;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_configKey' });
});

test('validateQuizRecord: score 0 is allowed (zero-correct, zero-mistake edge cases)', () => {
  const b = validQuizBody();
  b.score = 0;
  assert.deepEqual(validateQuizRecord(b), { ok: true });
});

test('validateQuizRecord: negative score → invalid_score', () => {
  const b = validQuizBody();
  b.score = -1;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_score' });
});

test('validateQuizRecord: non-integer score → invalid_score', () => {
  const b = validQuizBody();
  b.score = 1.5;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_score' });
});

test('validateQuizRecord: score over 1000 → invalid_score', () => {
  const b = validQuizBody();
  b.score = 1001;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_score' });
});

test('validateQuizRecord: negative durationMs → invalid_durationMs', () => {
  const b = validQuizBody();
  b.durationMs = -1;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_durationMs' });
});

test('validateQuizRecord: durationMs over 6h → invalid_durationMs', () => {
  const b = validQuizBody();
  b.durationMs = 6 * 60 * 60 * 1000 + 1;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_durationMs' });
});

test('validateQuizRecord: lowerWins non-boolean → invalid_lowerWins', () => {
  const b = validQuizBody();
  /** @type {any} */ (b).lowerWins = 'true';
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_lowerWins' });
  /** @type {any} */ (b).lowerWins = 1;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_lowerWins' });
  delete b.lowerWins;
  assert.deepEqual(validateQuizRecord(b), { ok: false, error: 'invalid_lowerWins' });
});
