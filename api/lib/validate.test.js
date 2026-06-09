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
