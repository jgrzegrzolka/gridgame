const test = require('node:test');
const assert = require('node:assert/strict');
const { validateResult, validateProfileBody, validateTttResultBody, LIMITS } = require('./validate');

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

// ---------------------------------------------------------------------------
// validateProfileBody
// ---------------------------------------------------------------------------

const validProfileBody = () => ({
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  nickname: 'Alice',
});

test('validateProfileBody: valid body returns the trimmed nickname in `value`', () => {
  assert.deepEqual(validateProfileBody(validProfileBody()), {
    ok: true,
    value: { deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', nickname: 'Alice' },
  });
});

test('validateProfileBody: null body fails body_required', () => {
  assert.deepEqual(validateProfileBody(null), { ok: false, error: 'body_required' });
});

test('validateProfileBody: deviceId too short / too long → invalid_deviceId', () => {
  const short = validProfileBody();
  short.deviceId = 'short';
  assert.deepEqual(validateProfileBody(short), { ok: false, error: 'invalid_deviceId' });
  const long = validProfileBody();
  long.deviceId = 'x'.repeat(LIMITS.DEVICE_ID_MAX + 1);
  assert.deepEqual(validateProfileBody(long), { ok: false, error: 'invalid_deviceId' });
});

test('validateProfileBody: nickname null is the explicit clear signal', () => {
  const b = validProfileBody();
  /** @type {any} */ (b).nickname = null;
  assert.deepEqual(validateProfileBody(b), {
    ok: true,
    value: { deviceId: b.deviceId, nickname: null },
  });
});

test('validateProfileBody: nickname is trimmed before length check', () => {
  const b = validProfileBody();
  b.nickname = '  Alice  ';
  const r = validateProfileBody(b);
  assert.equal(r.ok, true);
  assert.equal(r.value?.nickname, 'Alice');
});

test('validateProfileBody: empty string (and whitespace-only) → invalid_nickname (use null to clear)', () => {
  const b = validProfileBody();
  b.nickname = '';
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
  b.nickname = '   ';
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
});

test('validateProfileBody: nickname over NICKNAME_MAX → invalid_nickname', () => {
  const b = validProfileBody();
  b.nickname = 'x'.repeat(LIMITS.NICKNAME_MAX + 1);
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
});

test('validateProfileBody: nickname at exactly NICKNAME_MAX is accepted (boundary)', () => {
  const b = validProfileBody();
  b.nickname = 'x'.repeat(LIMITS.NICKNAME_MAX);
  const r = validateProfileBody(b);
  assert.equal(r.ok, true);
  assert.equal(r.value?.nickname.length, LIMITS.NICKNAME_MAX);
});

test('validateProfileBody: non-string nickname (other than null) → invalid_nickname', () => {
  const b = validProfileBody();
  /** @type {any} */ (b).nickname = 42;
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
  /** @type {any} */ (b).nickname = ['Alice'];
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
  /** @type {any} */ (b).nickname = undefined;
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
});

test('validateProfileBody: nickname accepts safe unicode — emoji, RTL letters, CJK', () => {
  const b = validProfileBody();
  b.nickname = '🌍🎉';
  assert.equal(validateProfileBody(b).ok, true, 'emoji accepted');
  b.nickname = 'مرحبا';
  assert.equal(validateProfileBody(b).ok, true, 'RTL script accepted');
  b.nickname = '日本';
  assert.equal(validateProfileBody(b).ok, true, 'CJK accepted');
  b.nickname = 'Łukasz';
  assert.equal(validateProfileBody(b).ok, true, 'Polish accepted');
});

test('validateProfileBody: rejects bidi override chars (sanitiser gate)', () => {
  // U+202E RLO would render "OlleH" as "Hello" — spoofing vector. The
  // sanitiser rejects the whole submission rather than stripping silently
  // so the user sees that something needs editing.
  const b = validProfileBody();
  b.nickname = `${String.fromCodePoint(0x202E)}OlleH`;
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
});

test('validateProfileBody: rejects zero-width chars (sanitiser gate)', () => {
  const b = validProfileBody();
  b.nickname = `Alice${String.fromCodePoint(0x200B)}Bob`;
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
});

test('validateProfileBody: rejects control chars (sanitiser gate)', () => {
  const b = validProfileBody();
  b.nickname = `Alice${String.fromCodePoint(0x07)}Bob`;
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'invalid_nickname' });
});

test('validateProfileBody: internal whitespace collapses (sanitiser allows)', () => {
  const b = validProfileBody();
  b.nickname = 'Alice\nBob';
  const r = validateProfileBody(b);
  assert.equal(r.ok, true);
  assert.equal(r.value?.nickname, 'Alice Bob');
});

test('validateProfileBody: rejects offensive nicknames with distinct error', () => {
  const b = validProfileBody();
  b.nickname = 'fuck';
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'offensive_nickname' });
  b.nickname = 'Kurwa';
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'offensive_nickname' });
  b.nickname = 'Admin';
  assert.deepEqual(validateProfileBody(b), { ok: false, error: 'offensive_nickname' });
});


// ---------------------------------------------------------------------------
// validateTttResultBody — Feature G
// ---------------------------------------------------------------------------

const validTttBody = () => ({
  deviceId:   'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  opponentId: '11111111-2222-3333-4444-555555555555',
  mode:       '3x3',
  outcome:    'win',
});

test('validateTttResultBody: valid body returns trimmed value', () => {
  const r = validateTttResultBody(validTttBody());
  assert.equal(r.ok, true);
  assert.equal(r.value?.deviceId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(r.value?.outcome, 'win');
});

test('validateTttResultBody: null body fails body_required', () => {
  assert.deepEqual(validateTttResultBody(null), { ok: false, error: 'body_required' });
});

test('validateTttResultBody: invalid deviceId / opponentId surface the right error code', () => {
  const tooShort = validTttBody();
  tooShort.deviceId = 'short';
  assert.deepEqual(validateTttResultBody(tooShort), { ok: false, error: 'invalid_deviceId' });
  const oppShort = validTttBody();
  oppShort.opponentId = 'x';
  assert.deepEqual(validateTttResultBody(oppShort), { ok: false, error: 'invalid_opponentId' });
});

test('validateTttResultBody: deviceId === opponentId is self_match', () => {
  const b = validTttBody();
  b.opponentId = b.deviceId;
  assert.deepEqual(validateTttResultBody(b), { ok: false, error: 'self_match' });
});

test('validateTttResultBody: mode must be exactly 3x3 or 9x9', () => {
  for (const bad of ['3X3', '4x4', '', 'three-by-three', null, undefined]) {
    const b = validTttBody();
    /** @type {any} */ (b).mode = bad;
    assert.deepEqual(validateTttResultBody(b), { ok: false, error: 'invalid_mode' });
  }
  for (const good of ['3x3', '9x9']) {
    const b = validTttBody();
    b.mode = good;
    assert.equal(validateTttResultBody(b).ok, true, `expected ${good} accepted`);
  }
});

test('validateTttResultBody: outcome must be win / loss / draw — anything else is rejected', () => {
  // Note: "gave_up" and "opponent_gave_up" from the original Feature G design
  // are NOT accepted — the client squashes them into win/loss before sending.
  // This is a deliberate v1 simplification.
  for (const bad of ['gave_up', 'opponent_gave_up', 'WIN', '', null, 1]) {
    const b = validTttBody();
    /** @type {any} */ (b).outcome = bad;
    assert.deepEqual(validateTttResultBody(b), { ok: false, error: 'invalid_outcome' });
  }
  for (const good of ['win', 'loss', 'draw']) {
    const b = validTttBody();
    b.outcome = good;
    assert.equal(validateTttResultBody(b).ok, true, `expected ${good} accepted`);
  }
});

// ---------------------------------------------------------------------------
// validateDeviceIdParam — used by GET /api/v1/profile + GET /api/v1/ttt/result
// ---------------------------------------------------------------------------

const { validateDeviceIdParam } = require('./validate');

test('validateDeviceIdParam: accepts a length-in-range string and echoes it as value', () => {
  const r = validateDeviceIdParam('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'invalid_id');
  assert.deepEqual(r, { ok: true, value: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
});

test('validateDeviceIdParam: returns the caller-supplied error code on failure', () => {
  // The caller picks the field name (`invalid_id`, `invalid_deviceId`,
  // `invalid_opponentId`) so the same validator can serve every endpoint.
  assert.deepEqual(validateDeviceIdParam('short', 'invalid_id'),
    { ok: false, error: 'invalid_id' });
  assert.deepEqual(validateDeviceIdParam('short', 'invalid_opponentId'),
    { ok: false, error: 'invalid_opponentId' });
});

test('validateDeviceIdParam: rejects null / undefined / non-string inputs', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.deepEqual(validateDeviceIdParam(/** @type {any} */ (bad), 'invalid_id'),
      { ok: false, error: 'invalid_id' });
  }
});

test('validateDeviceIdParam: enforces both length bounds', () => {
  assert.equal(validateDeviceIdParam('a'.repeat(7), 'invalid_id').ok, false);
  assert.equal(validateDeviceIdParam('a'.repeat(8), 'invalid_id').ok, true);
  assert.equal(validateDeviceIdParam('a'.repeat(64), 'invalid_id').ok, true);
  assert.equal(validateDeviceIdParam('a'.repeat(65), 'invalid_id').ok, false);
});

const { validateConfigKeyParam } = require('./validate');

test('validateConfigKeyParam: accepts real configKeys', () => {
  assert.deepEqual(validateConfigKeyParam('countries:60s:sov'), { ok: true, value: 'countries:60s:sov' });
  assert.deepEqual(validateConfigKeyParam('africa:all:all'), { ok: true, value: 'africa:all:all' });
});

test('validateConfigKeyParam: rejects non-string / empty / oversized', () => {
  assert.deepEqual(validateConfigKeyParam(null), { ok: false, error: 'invalid_configKey' });
  assert.deepEqual(validateConfigKeyParam(''), { ok: false, error: 'invalid_configKey' });
  assert.deepEqual(validateConfigKeyParam('a'.repeat(41)), { ok: false, error: 'invalid_configKey' });
});

test('validateConfigKeyParam: rejects shape-violating strings', () => {
  assert.deepEqual(validateConfigKeyParam('countries:60s'), { ok: false, error: 'invalid_configKey' });
  assert.deepEqual(validateConfigKeyParam('Countries:60s:sov'), { ok: false, error: 'invalid_configKey' });
  assert.deepEqual(validateConfigKeyParam('countries:60s:wat'), { ok: false, error: 'invalid_configKey' });
});
