const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeEngagement } = require('./engagementCompute');

const ZERO = {
  hasNickname: false,
  hasLinkedDevice: false,
  dailySharesCount: 0,
  quizSharesCount: 0,
  findflagSharesCount: 0,
  coffeeClicked: false,
};

// ---------------------------------------------------------------------------
// Empty / nullish inputs
// ---------------------------------------------------------------------------

test('null profile and null engagement → zero result', () => {
  assert.deepEqual(computeEngagement(null, null), ZERO);
});

test('undefined profile and engagement → zero result', () => {
  assert.deepEqual(computeEngagement(undefined, undefined), ZERO);
});

test('empty engagement object → zero result (no shares, no coffee)', () => {
  assert.deepEqual(computeEngagement(null, {}), ZERO);
});

// ---------------------------------------------------------------------------
// hasNickname (from profile.nickname)
// ---------------------------------------------------------------------------

test('profile with no nickname field → hasNickname false', () => {
  assert.equal(computeEngagement({}, {}).hasNickname, false);
});

test('profile with explicit nickname:null → hasNickname false', () => {
  assert.equal(computeEngagement({ nickname: null }, {}).hasNickname, false);
});

test('profile with empty-string nickname → hasNickname false (row exists but player never picked a name)', () => {
  assert.equal(computeEngagement({ nickname: '' }, {}).hasNickname, false);
});

test('profile with non-string nickname → hasNickname false (defensive)', () => {
  assert.equal(computeEngagement({ nickname: /** @type {any} */ (123) }, {}).hasNickname, false);
});

test('profile with a real nickname → hasNickname true', () => {
  assert.equal(computeEngagement({ nickname: 'Nimble Hare' }, {}).hasNickname, true);
});

// ---------------------------------------------------------------------------
// hasLinkedDevice (from profile.linkedAt)
// ---------------------------------------------------------------------------

test('profile with numeric linkedAt → hasLinkedDevice true', () => {
  assert.equal(computeEngagement({ linkedAt: 1_750_000_000_000 }, {}).hasLinkedDevice, true);
});

test('profile with null linkedAt → hasLinkedDevice false', () => {
  assert.equal(computeEngagement({ linkedAt: null }, {}).hasLinkedDevice, false);
});

test('profile with missing linkedAt → hasLinkedDevice false', () => {
  assert.equal(computeEngagement({ nickname: 'X' }, {}).hasLinkedDevice, false);
});

test('profile with NaN linkedAt → hasLinkedDevice false (defensive)', () => {
  assert.equal(computeEngagement({ linkedAt: NaN }, {}).hasLinkedDevice, false);
});

test('profile with string linkedAt → hasLinkedDevice false (defensive)', () => {
  assert.equal(computeEngagement({ linkedAt: /** @type {any} */ ('yesterday') }, {}).hasLinkedDevice, false);
});

// ---------------------------------------------------------------------------
// Share counts (from blob.shares.<surface>)
// ---------------------------------------------------------------------------

test('blob with daily shares → dailySharesCount only', () => {
  const r = computeEngagement(null, { shares: { daily: 5 } });
  assert.equal(r.dailySharesCount, 5);
  assert.equal(r.quizSharesCount, 0);
  assert.equal(r.findflagSharesCount, 0);
});

test('blob with flagquiz shares → quizSharesCount only', () => {
  // The local-state key is `flagquiz`; the snapshot field is
  // `quizSharesCount` (renamed for the consumer side). Mapping is in
  // computeEngagement so a future split / rename only touches one
  // place.
  const r = computeEngagement(null, { shares: { flagquiz: 3 } });
  assert.equal(r.quizSharesCount, 3);
  assert.equal(r.dailySharesCount, 0);
});

test('blob with findflag shares → findflagSharesCount only', () => {
  const r = computeEngagement(null, { shares: { findflag: 7 } });
  assert.equal(r.findflagSharesCount, 7);
});

test('blob with ttt shares is silently skipped (no current achievement consumes it)', () => {
  // The local-state SHARE_SURFACES list includes `ttt` for future-proofing,
  // but no current achievement counter exposes it on the snapshot. A
  // future "TTT Sharer" tier would add the field here.
  const r = computeEngagement(null, { shares: { ttt: 4, daily: 1 } });
  assert.equal(r.dailySharesCount, 1);
  // No `tttSharesCount` field — confirmed by deep-equal against the
  // expected snapshot shape.
  assert.deepEqual(Object.keys(r).sort(), Object.keys(ZERO).sort());
});

test('blob with all share surfaces populated → all three Sharer counts surface', () => {
  const r = computeEngagement(null, {
    shares: { daily: 2, flagquiz: 3, findflag: 1, ttt: 9 },
  });
  assert.equal(r.dailySharesCount, 2);
  assert.equal(r.quizSharesCount, 3);
  assert.equal(r.findflagSharesCount, 1);
});

test('negative / NaN / non-integer share values are skipped (read as zero, not coerced)', () => {
  // Defensive: a hand-edited or future-shape blob shouldn't poison the
  // counter. Reading bad values as zero is honest — the alternative
  // (Math.max(0, n) coercion) would mask the schema break instead of
  // letting it surface.
  const r = computeEngagement(null, {
    shares: {
      daily: -3,
      flagquiz: 1.5,
      findflag: /** @type {any} */ ('NaN'),
    },
  });
  assert.equal(r.dailySharesCount, 0);
  assert.equal(r.quizSharesCount, 0);
  assert.equal(r.findflagSharesCount, 0);
});

test('blob.shares missing entirely → all share counts zero (defensive)', () => {
  const r = computeEngagement(null, { coffeeClickCount: 1 });
  assert.equal(r.dailySharesCount, 0);
  assert.equal(r.coffeeClicked, true);
});

// ---------------------------------------------------------------------------
// coffeeClicked (from blob.coffeeClickCount, threshold >= 1)
// ---------------------------------------------------------------------------

test('coffeeClickCount >= 1 → coffeeClicked true (matches pre-Phase-4 boolean semantics)', () => {
  assert.equal(computeEngagement(null, { coffeeClickCount: 1 }).coffeeClicked, true);
  assert.equal(computeEngagement(null, { coffeeClickCount: 42 }).coffeeClicked, true);
});

test('coffeeClickCount = 0 → coffeeClicked false', () => {
  assert.equal(computeEngagement(null, { coffeeClickCount: 0 }).coffeeClicked, false);
});

test('coffeeClickCount missing → coffeeClicked false', () => {
  assert.equal(computeEngagement(null, { shares: { daily: 1 } }).coffeeClicked, false);
});

test('coffeeClickCount non-integer / negative → coffeeClicked false (defensive, same rule as shares)', () => {
  assert.equal(computeEngagement(null, { coffeeClickCount: -1 }).coffeeClicked, false);
  assert.equal(computeEngagement(null, { coffeeClickCount: 1.5 }).coffeeClicked, false);
  assert.equal(computeEngagement(null, { coffeeClickCount: /** @type {any} */ ('1') }).coffeeClicked, false);
});

// ---------------------------------------------------------------------------
// Combined: profile + blob full populated
// ---------------------------------------------------------------------------

test('all signals at once → all populated', () => {
  const profile = { nickname: 'Brave Otter', linkedAt: 1_750_000_000_000 };
  const blob = {
    shares: { daily: 4, flagquiz: 2, findflag: 1, ttt: 7 },
    coffeeClickCount: 3,
  };
  assert.deepEqual(computeEngagement(profile, blob), {
    hasNickname: true,
    hasLinkedDevice: true,
    dailySharesCount: 4,
    quizSharesCount: 2,
    findflagSharesCount: 1,
    coffeeClicked: true,
  });
});

test('malformed engagement (non-object, e.g. array) → treated as missing, zeros for blob-derived fields', () => {
  // A hand-edited row shipping syncBlob.engagement as [] or "string" or
  // 42 shouldn't crash the read path. Profile-derived fields still
  // resolve from the profile arg.
  for (const bad of [/** @type {any} */ ([]), /** @type {any} */ ('foo'), /** @type {any} */ (42)]) {
    const r = computeEngagement({ nickname: 'X' }, bad);
    assert.equal(r.hasNickname, true);
    assert.equal(r.dailySharesCount, 0);
    assert.equal(r.coffeeClicked, false);
  }
});
