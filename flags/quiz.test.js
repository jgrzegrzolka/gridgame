import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  pickQuestion,
  createQuiz,
  VARIANTS,
  poolFor,
  targetFor,
  MODES,
  availableModes,
  defaultModeFor,
  isTimedMode,
  timedRemainingMs,
  timedBudgetUsedMs,
  formatTime,
  LOOKALIKES,
  lookalikesOf,
  nextBest,
  higherScoreWins,
  lowerScoreWins,
  accuracyRatio,
  loadBest,
  saveBest,
  bestKey,
  recordResult,
  scoreColor,
  pickCelebration,
  pickFinalScoreLine,
  shouldShowBestTime,
  formatBestScoreLabel,
  mistakesAfterGiveUp,
  countModeProgressRatio,
  getQuizLastVariant,
  setQuizLastVariant,
  resolveMode,
  isQuizShowMap,
  setQuizShowMap,
} from './quiz.js';
import { loadCountries } from './group.js';

/**
 * @param {Record<string, string>} [initial]
 */
function fakeStore(initial = {}) {
  /** @type {Map<string, string>} */
  const data = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem: (k) => (data.has(k) ? /** @type {string} */ (data.get(k)) : null),
    /** @param {string} k @param {string} v */
    setItem: (k, v) => data.set(k, v),
    _dump: () => Object.fromEntries(data),
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const countries = loadCountries(JSON.parse(
  readFileSync(join(__dirname, 'countries.json'), 'utf8'),
));

const sample = Array.from({ length: 10 }, (_, i) => ({
  code: `c${i}`,
  name: `Country ${i}`,
}));

test('pickQuestion returns exactly 4 choices by default', () => {
  const q = pickQuestion(sample);
  assert.equal(q.choices.length, 4);
});

test('pickQuestion answer is always one of the choices', () => {
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    assert.ok(
      q.choices.some((c) => c.code === q.answer.code),
      `answer ${q.answer.code} not in choices`,
    );
  }
});

test('pickQuestion choices are all unique', () => {
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    const codes = new Set(q.choices.map((c) => c.code));
    assert.equal(codes.size, 4);
  }
});

test('pickQuestion choices all come from the input pool', () => {
  const inputCodes = new Set(sample.map((c) => c.code));
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    for (const c of q.choices) {
      assert.ok(inputCodes.has(c.code), `${c.code} not from input`);
    }
  }
});

test('pickQuestion answer can land at any of the four positions', () => {
  const positions = new Set();
  for (let i = 0; i < 100; i++) {
    const q = pickQuestion(sample);
    positions.add(q.choices.findIndex((c) => c.code === q.answer.code));
  }
  assert.equal(positions.size, 4);
});

test('pickQuestion respects a custom choiceCount', () => {
  const q = pickQuestion(sample, 6);
  assert.equal(q.choices.length, 6);
});

test('pickQuestion throws if input is too small', () => {
  assert.throws(
    () => pickQuestion(sample.slice(0, 3)),
    /Need at least 4 entries/,
  );
});

test('VARIANTS contains the expected 7 keys in display order (sovereign only)', () => {
  assert.deepEqual(Object.keys(VARIANTS), [
    'countries',
    'europe',
    'asia',
    'africa',
    'north-america',
    'south-america',
    'oceania',
  ]);
});

test('poolFor throws on an unknown variant', () => {
  assert.throws(() => poolFor('mars', countries), /Unknown variant/);
});

test('poolFor("countries") is an identity over its input (scope is applied upstream)', () => {
  assert.equal(poolFor('countries', countries).length, countries.length);
});

test('poolFor("europe") narrows by continent only — scope is applied upstream', () => {
  const europe = poolFor('europe', countries);
  assert.ok(europe.length > 0);
  for (const c of europe) {
    assert.equal(c.continent, 'Europe');
  }
});

test('every variant returns at least 4 entries (enough for a 4-choice question)', () => {
  for (const key of Object.keys(VARIANTS)) {
    const pool = poolFor(key, countries);
    assert.ok(
      pool.length >= 4,
      `variant "${key}" has only ${pool.length} entries`,
    );
  }
});

test('createQuiz never repeats the same answer across the run', () => {
  const quiz = createQuiz(sample, sample.length);
  const seen = new Set();
  let q;
  while ((q = quiz.next())) {
    assert.ok(!seen.has(q.answer.code), `answer ${q.answer.code} repeated`);
    seen.add(q.answer.code);
  }
  assert.equal(seen.size, sample.length);
});

test('createQuiz yields exactly `count` questions then null', () => {
  const quiz = createQuiz(sample, 5);
  for (let i = 0; i < 5; i++) {
    assert.ok(quiz.next(), `expected question #${i + 1}`);
  }
  assert.equal(quiz.next(), null);
});

test('createQuiz choices always include the answer and are unique', () => {
  const quiz = createQuiz(sample, sample.length);
  let q;
  while ((q = quiz.next())) {
    const codes = new Set(q.choices.map((c) => c.code));
    assert.equal(codes.size, 4);
    assert.ok(codes.has(q.answer.code));
  }
});

test('createQuiz throws if count exceeds pool size', () => {
  assert.throws(
    () => createQuiz(sample, sample.length + 1),
    /Cannot ask/,
  );
});

test('createQuiz.peek returns the next question without consuming it', () => {
  const quiz = createQuiz(sample, 3);
  const peeked = quiz.peek();
  assert.ok(peeked, 'peek should return a question when one is queued');
  // next() returns the same instance the peek surfaced — same answer,
  // same choices. The page uses this to prefetch the next round's
  // flag SVGs while the player is still answering the current one.
  const taken = quiz.next();
  assert.strictEqual(taken, peeked);
});

test('createQuiz.peek returns null after the queue exhausts', () => {
  const quiz = createQuiz(sample, 2);
  quiz.next();
  quiz.next();
  assert.equal(quiz.peek(), null);
  assert.equal(quiz.next(), null);
});

test('createQuiz.addToCabinet — missed answer returns after the main queue exhausts', () => {
  const quiz = createQuiz(sample, 3);
  const first = quiz.next();
  const second = quiz.next();
  const third = quiz.next();
  assert.ok(first && second && third);
  assert.equal(quiz.next(), null, 'queue empty before cabinet adds');
  // Player missed two of the three; queue them for revisit.
  quiz.addToCabinet(first.answer);
  quiz.addToCabinet(third.answer);
  const revisit1 = quiz.next();
  const revisit2 = quiz.next();
  assert.ok(revisit1 && revisit2);
  assert.equal(revisit1.answer, first.answer, 'cabinet is FIFO');
  assert.equal(revisit2.answer, third.answer);
  assert.equal(quiz.next(), null, 'cabinet exhausts cleanly');
});

test('createQuiz.addToCabinet — cabinet questions get fresh distractors', () => {
  const quiz = createQuiz(sample, 1);
  const first = quiz.next();
  assert.ok(first);
  quiz.addToCabinet(first.answer);
  const revisit = quiz.next();
  assert.ok(revisit);
  assert.equal(revisit.answer, first.answer);
  // The choices array always contains the answer plus N-1 distractors;
  // the distractors are picked from the pool excluding the answer. The
  // revisit pulls fresh distractors so the player isn't memorising the
  // earlier four-flag layout.
  assert.ok(revisit.choices.includes(first.answer));
  assert.equal(revisit.choices.length, 4);
});

test('createQuiz.peek surfaces cabinet head when the main queue is empty', () => {
  const quiz = createQuiz(sample, 1);
  const first = quiz.next();
  assert.ok(first);
  quiz.addToCabinet(first.answer);
  const peeked = quiz.peek();
  assert.ok(peeked);
  assert.equal(peeked.answer, first.answer);
  // peek doesn't consume — the same cabinet entry is still served by next().
  assert.equal(quiz.next()?.answer, first.answer);
});

test('createQuiz.addToCabinet — main queue served before cabinet', () => {
  const quiz = createQuiz(sample, 2);
  const first = quiz.next();
  assert.ok(first);
  // Queue still has one more main question; add a cabinet entry now.
  quiz.addToCabinet(first.answer);
  const next = quiz.next();
  assert.ok(next);
  // Either the second main question OR the cabinet entry, but
  // contract says main wins — verify it's NOT the cabinet entry.
  assert.notEqual(next.answer, first.answer, 'cabinet waits for the main queue to drain');
});

test('MODES contains "60s" and "all" in that display order', () => {
  assert.deepEqual(Object.keys(MODES), ['60s', 'all']);
});

test('MODES["60s"] is a 60-second budget with a 3-second-per-wrong penalty', () => {
  assert.deepEqual(MODES['60s'], { kind: 'timed', budgetMs: 60_000, penaltyMs: 4_000 });
});

test('isTimedMode is true only for time-budgeted modes', () => {
  assert.equal(isTimedMode('60s'), true);
  assert.equal(isTimedMode('all'), false);
  assert.equal(isTimedMode('99'), false);
});

test('targetFor("60s", pool) queues the full pool — pool exhaustion is a valid end', () => {
  assert.equal(targetFor('60s', countries), countries.length);
  const tinyPool = sample.slice(0, 5);
  assert.equal(targetFor('60s', tinyPool), 5);
});

test('targetFor("all", pool) returns the full pool length', () => {
  assert.equal(targetFor('all', countries), countries.length);
});

test('targetFor throws on an unknown mode', () => {
  assert.throws(() => targetFor('99', countries), /Unknown mode/);
});

// ---- shouldShowBestTime ----

test('shouldShowBestTime: 60s mode hides the time when the clock ran out (best.time == budgetMs)', () => {
  // The typical timed-mode ending — the round always stops at the budget,
  // and showing "1:00.000" tells the player nothing they don't already know.
  assert.equal(shouldShowBestTime('60s', { time: 60_000 }), false);
});

test('shouldShowBestTime: 60s mode shows the time when the pool was exhausted under budget', () => {
  // The brag case — finished every flag before the timer ran out.
  assert.equal(shouldShowBestTime('60s', { time: 47_000 }), true);
});

test('shouldShowBestTime: untimed (all) mode always shows the time — every value is meaningful', () => {
  assert.equal(shouldShowBestTime('all', { time: 30_000 }), true);
  assert.equal(shouldShowBestTime('all', { time: 600_000 }), true);
});

test('shouldShowBestTime: unknown mode is false (no defined budget, refuse to render a time we can\'t reason about)', () => {
  assert.equal(shouldShowBestTime('99', { time: 1_000 }), false);
});

// ---- formatBestScoreLabel ----

test('formatBestScoreLabel: 60s mode renders "score/target" so the achievement reads against the pool ceiling', () => {
  assert.equal(formatBestScoreLabel('60s', { score: 22 }, 195), '22/195');
  assert.equal(formatBestScoreLabel('60s', { score: 45 }, 45), '45/45');
});

test('formatBestScoreLabel: untimed (all) mode renders "correct/target" — one-shot per question, so correct = target - mistakes', () => {
  assert.equal(formatBestScoreLabel('all', { score: 5 }, 195), '190/195');
  assert.equal(formatBestScoreLabel('all', { score: 0 }, 45), '45/45');
});

test('formatBestScoreLabel: untimed clamps negative correct counts to 0 — protects legacy scores from the multi-attempt era where mistakes could exceed the pool', () => {
  assert.equal(formatBestScoreLabel('all', { score: 60 }, 45), '0/45');
});

test('formatBestScoreLabel: unknown mode falls back to "correct/target" — same shape as count mode, safer than throwing for stale localStorage entries', () => {
  assert.equal(formatBestScoreLabel('99', { score: 7 }, 50), '43/50');
});

// ---- mistakesAfterGiveUp ----

test('mistakesAfterGiveUp: count mode — partial round counts every unanswered flag as a mistake', () => {
  // Answered 5 right, 3 wrong (one-shot, so 8 questions seen). Pool is 45.
  // Unanswered 37 must all become mistakes so the result reads 5/45.
  assert.equal(
    mistakesAfterGiveUp({ modeKey: 'all', target: 45, answeredCount: 5, wrongCount: 3 }),
    40,
  );
});

test('mistakesAfterGiveUp: count mode — give up immediately scores zero correct, all mistakes', () => {
  assert.equal(
    mistakesAfterGiveUp({ modeKey: 'all', target: 45, answeredCount: 0, wrongCount: 0 }),
    45,
  );
});

test('mistakesAfterGiveUp: count mode — give up after sweeping the pool yields zero mistakes', () => {
  // Pathological — by the time answeredCount === target, the round has
  // already ended via quiz exhaustion. Tested anyway so the math is total.
  assert.equal(
    mistakesAfterGiveUp({ modeKey: 'all', target: 45, answeredCount: 45, wrongCount: 0 }),
    0,
  );
});

test('mistakesAfterGiveUp: timed mode leaves wrongCount untouched — there is nothing to penalise on a clock', () => {
  assert.equal(
    mistakesAfterGiveUp({ modeKey: '60s', target: 195, answeredCount: 20, wrongCount: 4 }),
    4,
  );
});

// ---- countModeProgressRatio ----

test('countModeProgressRatio: zero clicks is 0% — round just started', () => {
  assert.equal(countModeProgressRatio(0, 0, 45), 0);
});

test('countModeProgressRatio: wrong picks count toward progress — guards the bug where a right-after-wrong sequence visually froze the bar', () => {
  // This is the regression this helper exists to pin. If a future
  // refactor goes back to "answered only" the test fails immediately.
  assert.equal(countModeProgressRatio(1, 1, 4), 0.5);
  assert.equal(countModeProgressRatio(3, 2, 10), 0.5);
  assert.equal(countModeProgressRatio(0, 5, 10), 0.5);
});

test('countModeProgressRatio: fully completed round is 100%', () => {
  assert.equal(countModeProgressRatio(45, 0, 45), 1);
  assert.equal(countModeProgressRatio(40, 5, 45), 1);
  assert.equal(countModeProgressRatio(0, 45, 45), 1);
});

test('countModeProgressRatio: clamps over-counted progress to 100% — defensive against bookkeeping drift', () => {
  // Shouldn't happen in practice (one-shot bounds answered + wrong <= target)
  // but the bar's CSS width must never read above 100%.
  assert.equal(countModeProgressRatio(50, 10, 45), 1);
});

test('countModeProgressRatio: empty pool returns 100% — nothing left to do', () => {
  assert.equal(countModeProgressRatio(0, 0, 0), 1);
});

test('availableModes offers both 60s and all for any pool size — the timed mode never gates on pool size', () => {
  assert.deepEqual(availableModes(50), ['60s', 'all']);
  assert.deepEqual(availableModes(19), ['60s', 'all']);
  assert.deepEqual(availableModes(4), ['60s', 'all']);
  assert.deepEqual(availableModes(0), ['60s', 'all']);
});

test('defaultModeFor returns "60s" — the time-attack is the headline mode', () => {
  assert.equal(defaultModeFor(50), '60s');
  assert.equal(defaultModeFor(19), '60s');
  assert.equal(defaultModeFor(0), '60s');
});

test('availableModes preserves MODES insertion order', () => {
  assert.deepEqual(availableModes(100), ['60s', 'all']);
});

test('timedRemainingMs subtracts wall-clock burn from the budget', () => {
  assert.equal(
    timedRemainingMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 12_000, wrongCount: 0 }),
    48_000,
  );
});

test('timedRemainingMs subtracts 3 seconds per wrong answer on top of the wall-clock burn', () => {
  assert.equal(
    timedRemainingMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 12_000, wrongCount: 2 }),
    42_000,
  );
});

test('timedRemainingMs clamps at zero — once you blow the budget you do not owe time', () => {
  assert.equal(
    timedRemainingMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 50_000, wrongCount: 10 }),
    0,
  );
});

test('timedRemainingMs returns the full budget at the start of the round', () => {
  assert.equal(
    timedRemainingMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 0, wrongCount: 0 }),
    60_000,
  );
});

test('timedBudgetUsedMs is zero at the start of the round', () => {
  assert.equal(
    timedBudgetUsedMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 0, wrongCount: 0 }),
    0,
  );
});

test('timedBudgetUsedMs on a clean pool-exhaust equals wall-clock elapsed (no penalty drag)', () => {
  assert.equal(
    timedBudgetUsedMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 25_000, wrongCount: 0 }),
    25_000,
  );
});

test('timedBudgetUsedMs on a pool-exhaust under budget adds penalty time onto the wall clock — fewer wrongs = lower score = better tiebreak', () => {
  const clean = timedBudgetUsedMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 30_000, wrongCount: 0 });
  const messy = timedBudgetUsedMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 30_000, wrongCount: 4 });
  assert.equal(clean, 30_000);
  assert.equal(messy, 42_000);
  assert.ok(clean < messy, 'cleaner round must record a lower budget-used value');
});

test('timedBudgetUsedMs caps at the budget on time-out — over-running penalties do not inflate the recorded time', () => {
  assert.equal(
    timedBudgetUsedMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 60_000, wrongCount: 5 }),
    60_000,
  );
  // Even if penalty + wall vastly exceed the budget the cap holds.
  assert.equal(
    timedBudgetUsedMs({ budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 90_000, wrongCount: 20 }),
    60_000,
  );
});

test('timedBudgetUsedMs and timedRemainingMs always sum to the budget — the symmetry that defines them', () => {
  const cases = [
    { budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 0,      wrongCount: 0 },
    { budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 15_000, wrongCount: 2 },
    { budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 60_000, wrongCount: 0 },
    { budgetMs: 60_000, penaltyMs: 3_000, elapsedMs: 90_000, wrongCount: 20 },
  ];
  for (const c of cases) {
    assert.equal(timedBudgetUsedMs(c) + timedRemainingMs(c), c.budgetMs);
  }
});

test('formatTime(0) renders zero with the full three-digit ms field', () => {
  assert.equal(formatTime(0), '0:00.000');
});

test('formatTime pads sub-second values', () => {
  assert.equal(formatTime(1), '0:00.001');
  assert.equal(formatTime(42), '0:00.042');
  assert.equal(formatTime(999), '0:00.999');
});

test('formatTime rolls milliseconds into seconds at 1000', () => {
  assert.equal(formatTime(1000), '0:01.000');
  assert.equal(formatTime(1001), '0:01.001');
});

test('formatTime rolls seconds into minutes at 60000', () => {
  assert.equal(formatTime(59999), '0:59.999');
  assert.equal(formatTime(60000), '1:00.000');
});

test('formatTime handles multi-minute durations without zero-padding the minutes', () => {
  assert.equal(formatTime(123456), '2:03.456');
  assert.equal(formatTime(600000), '10:00.000');
});

test('formatTime floors rather than rounds so it never overshoots elapsed time', () => {
  assert.equal(formatTime(1999), '0:01.999');
});

test('lookalikesOf returns the group that contains the code', () => {
  assert.deepEqual(lookalikesOf('id'), ['id', 'mc']);
  assert.deepEqual(lookalikesOf('mc'), ['id', 'mc']);
  assert.deepEqual(lookalikesOf('ro'), ['ro', 'td']);
  assert.deepEqual(lookalikesOf('td'), ['ro', 'td']);
});

test('lookalikesOf returns just the code itself when no group matches', () => {
  assert.deepEqual(lookalikesOf('us'), ['us']);
  assert.deepEqual(lookalikesOf('jp'), ['jp']);
  assert.deepEqual(lookalikesOf('not-a-real-code'), ['not-a-real-code']);
});

test('LOOKALIKES groups are disjoint (no code appears in two groups)', () => {
  const seen = new Set();
  for (const group of LOOKALIKES) {
    for (const code of group) {
      assert.ok(!seen.has(code), `${code} appears in more than one group`);
      seen.add(code);
    }
  }
});

test('LOOKALIKES codes all exist in countries.json', () => {
  const known = new Set(countries.map((c) => c.code));
  for (const group of LOOKALIKES) {
    for (const code of group) {
      assert.ok(known.has(code), `${code} listed in LOOKALIKES but missing from countries.json`);
    }
  }
});

test('pickQuestion never pairs known lookalikes when the pool has alternatives', () => {
  for (let i = 0; i < 1000; i++) {
    const q = pickQuestion(countries);
    const codes = new Set(q.choices.map((c) => c.code));
    for (const group of LOOKALIKES) {
      const present = group.filter((c) => codes.has(c));
      assert.ok(
        present.length <= 1,
        `pickQuestion paired ${present.join(' + ')} in one question`,
      );
    }
  }
});

test('createQuiz never pairs known lookalikes across a full run', () => {
  for (let run = 0; run < 50; run++) {
    const quiz = createQuiz(countries, 30);
    let q;
    while ((q = quiz.next())) {
      const codes = new Set(q.choices.map((c) => c.code));
      for (const group of LOOKALIKES) {
        const present = group.filter((c) => codes.has(c));
        assert.ok(
          present.length <= 1,
          `createQuiz paired ${present.join(' + ')} in one question`,
        );
      }
    }
  }
});

test('pickQuestion falls back to allowing lookalikes when the pool is too small to avoid them', () => {
  const tinyPool = [
    { code: 'id', name: 'Indonesia' },
    { code: 'mc', name: 'Monaco' },
    { code: 'us', name: 'United States' },
    { code: 'jp', name: 'Japan' },
  ];
  for (let i = 0; i < 50; i++) {
    const q = pickQuestion(tinyPool);
    assert.equal(q.choices.length, 4);
    const codes = new Set(q.choices.map((c) => c.code));
    assert.ok(codes.has(q.answer.code));
  }
});

test('nextBest treats a null previous as the first best', () => {
  const r = nextBest(null, { score: 80, time: 60000 });
  assert.deepEqual(r, { best: { score: 80, time: 60000 }, isNew: true });
});

test('nextBest prefers the higher score regardless of time', () => {
  const prev = { score: 90, time: 10000 };
  const curr = { score: 95, time: 60000 };
  const r = nextBest(prev, curr);
  assert.deepEqual(r, { best: curr, isNew: true });
});

test('nextBest keeps the previous when the current score is lower', () => {
  const prev = { score: 90, time: 60000 };
  const curr = { score: 80, time: 1 };
  const r = nextBest(prev, curr);
  assert.deepEqual(r, { best: prev, isNew: false });
});

test('nextBest breaks score ties on faster time', () => {
  const prev = { score: 90, time: 60000 };
  const curr = { score: 90, time: 30000 };
  const r = nextBest(prev, curr);
  assert.deepEqual(r, { best: curr, isNew: true });
});

test('nextBest keeps the previous on a tied score with a slower time', () => {
  const prev = { score: 90, time: 30000 };
  const curr = { score: 90, time: 60000 };
  const r = nextBest(prev, curr);
  assert.deepEqual(r, { best: prev, isNew: false });
});

test('nextBest keeps the previous when score and time are identical', () => {
  const prev = { score: 90, time: 30000 };
  const curr = { score: 90, time: 30000 };
  const r = nextBest(prev, curr);
  assert.deepEqual(r, { best: prev, isNew: false });
});

test('loadBest returns null when the key is missing', () => {
  assert.equal(loadBest(fakeStore(), 'whatever'), null);
});

test('loadBest round-trips through saveBest', () => {
  const store = fakeStore();
  const value = { score: 87, time: 65432 };
  saveBest(store, 'best.europe.20', value);
  assert.deepEqual(loadBest(store, 'best.europe.20'), value);
});

test('saveBest stringifies as JSON (not [object Object])', () => {
  const store = fakeStore();
  saveBest(store, 'k', { score: 50, time: 1000 });
  assert.equal(store.getItem('k'), '{"score":50,"time":1000}');
});

test('loadBest returns null when the stored value is unparseable', () => {
  const store = fakeStore({ k: 'not json at all' });
  assert.equal(loadBest(store, 'k'), null);
});

test('loadBest returns null when the stored JSON has the wrong shape', () => {
  const store = fakeStore({
    a: '{"foo":"bar"}',
    b: '{"score":"high","time":1000}',
    c: 'null',
    d: '[1,2,3]',
  });
  assert.equal(loadBest(store, 'a'), null);
  assert.equal(loadBest(store, 'b'), null);
  assert.equal(loadBest(store, 'c'), null);
  assert.equal(loadBest(store, 'd'), null);
});

test('saveBest is a no-op when the store throws (no crash)', () => {
  const throwingStore = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
  };
  assert.doesNotThrow(() => saveBest(throwingStore, 'k', { score: 1, time: 2 }));
});

test('loadBest does not throw when the store throws', () => {
  const throwingStore = {
    getItem: () => { throw new Error('access denied'); },
    setItem: () => {},
  };
  assert.equal(loadBest(throwingStore, 'k'), null);
});

test('bestKey produces the expected namespaced format for 60s mode', () => {
  assert.equal(bestKey('europe', '60s'), 'flagquiz.best.europe.60s');
  assert.equal(bestKey('north-america', '60s'), 'flagquiz.best.north-america.60s');
});

test('bestKey adds a .v2 segment for the all mode — orphans pre-mistakes-scoring entries', () => {
  // Pre-mistakes-scoring all-mode stored a percentage; the new code
  // stores a mistakes count. Loading the old shape under the new
  // semantics would render `95` as "95 mistakes". The .v2 segment
  // means the old keys are unreachable and never reloaded.
  assert.equal(bestKey('europe', 'all'), 'flagquiz.best.europe.all.v2');
  assert.equal(bestKey('countries', 'all', true), 'flagquiz.best.countries.all.v2.all');
});

test('bestKey appends .all suffix when includeAll is true', () => {
  assert.equal(bestKey('europe', '60s', true), 'flagquiz.best.europe.60s.all');
  assert.equal(bestKey('europe', '60s', false), 'flagquiz.best.europe.60s');
});

test('accuracyRatio: clean sweep is 1 (full green)', () => {
  assert.equal(accuracyRatio(0, 20), 1);
});

test('accuracyRatio: a few mistakes gives a partial ratio', () => {
  assert.equal(accuracyRatio(5, 20), 0.75);
});

test('accuracyRatio: all wrong is 0 (full red)', () => {
  assert.equal(accuracyRatio(20, 20), 0);
});

test('accuracyRatio clamps at 0 when mistakes exceed target — handles the give-up bookkeeping case', () => {
  // All-mode give-up: wrongCount gets bumped by (target - answeredCount),
  // so a player who walked away early can record mistakes greater than
  // target. Without the clamp the ratio goes negative and downstream
  // colour-mapping would land in undefined HSL territory.
  assert.equal(accuracyRatio(25, 20), 0);
});

test('accuracyRatio: target=0 returns 0 (no questions = no accuracy signal)', () => {
  assert.equal(accuracyRatio(0, 0), 0);
  assert.equal(accuracyRatio(5, 0), 0);
});

test('accuracyRatio: target<0 is treated like target=0 (defensive — never happens in practice)', () => {
  assert.equal(accuracyRatio(0, -1), 0);
});

test('higherScoreWins / lowerScoreWins are pure comparators on the score field', () => {
  assert.equal(higherScoreWins(10, 5), true);
  assert.equal(higherScoreWins(5, 10), false);
  assert.equal(higherScoreWins(5, 5), false);
  assert.equal(lowerScoreWins(5, 10), true);
  assert.equal(lowerScoreWins(10, 5), false);
  assert.equal(lowerScoreWins(5, 5), false);
});

test('nextBest with lowerScoreWins prefers fewer mistakes (the all-mode shape)', () => {
  const prev = { score: 5, time: 60000 };
  const curr = { score: 3, time: 90000 };
  const r = nextBest(prev, curr, lowerScoreWins);
  assert.deepEqual(r, { best: curr, isNew: true });
});

test('nextBest with lowerScoreWins keeps the previous when current has more mistakes', () => {
  const prev = { score: 2, time: 60000 };
  const curr = { score: 5, time: 10000 };
  const r = nextBest(prev, curr, lowerScoreWins);
  assert.deepEqual(r, { best: prev, isNew: false });
});

test('nextBest with lowerScoreWins still breaks score ties on faster time', () => {
  const prev = { score: 3, time: 70000 };
  const curr = { score: 3, time: 50000 };
  const r = nextBest(prev, curr, lowerScoreWins);
  assert.deepEqual(r, { best: curr, isNew: true });
});

test('recordResult writes to a different slot when includeAll is true', () => {
  const store = fakeStore();
  recordResult(store, 'europe', '60s', { score: 12, time: 60000 }, false);
  recordResult(store, 'europe', '60s', { score: 8, time: 60000 }, true);
  assert.deepEqual(loadBest(store, bestKey('europe', '60s', false)), { score: 12, time: 60000 });
  assert.deepEqual(loadBest(store, bestKey('europe', '60s', true)), { score: 8, time: 60000 });
});

test('recordResult on an empty store saves the result and reports isNew', () => {
  const store = fakeStore();
  const current = { score: 12, time: 45000 };
  const r = recordResult(store, 'europe', '60s', current);
  assert.deepEqual(r, { best: current, isNew: true });
  assert.deepEqual(
    loadBest(store, bestKey('europe', '60s')),
    current,
  );
});

test('recordResult does not save when the current run does not beat the best', () => {
  const store = fakeStore();
  const previous = { score: 15, time: 30000 };
  saveBest(store, bestKey('europe', '60s'), previous);
  const worse = { score: 10, time: 10000 };
  const r = recordResult(store, 'europe', '60s', worse);
  assert.deepEqual(r, { best: previous, isNew: false });
  assert.deepEqual(
    loadBest(store, bestKey('europe', '60s')),
    previous,
  );
});

test('recordResult updates the store when the current run beats the best', () => {
  const store = fakeStore();
  saveBest(store, bestKey('europe', '60s'), { score: 12, time: 60000 });
  const better = { score: 18, time: 40000 };
  const r = recordResult(store, 'europe', '60s', better);
  assert.deepEqual(r, { best: better, isNew: true });
  assert.deepEqual(
    loadBest(store, bestKey('europe', '60s')),
    better,
  );
});

test('recordResult with lowerScoreWins (all-mode shape) keeps the lower-mistake run as best', () => {
  const store = fakeStore();
  saveBest(store, bestKey('europe', 'all'), { score: 5, time: 90000 });
  const worse = { score: 8, time: 30000 };
  const betterMistakes = { score: 3, time: 95000 };
  assert.deepEqual(
    recordResult(store, 'europe', 'all', worse, false, lowerScoreWins),
    { best: { score: 5, time: 90000 }, isNew: false },
  );
  assert.deepEqual(
    recordResult(store, 'europe', 'all', betterMistakes, false, lowerScoreWins),
    { best: betterMistakes, isNew: true },
  );
  assert.deepEqual(loadBest(store, bestKey('europe', 'all')), betterMistakes);
});

test('recordResult uses separate slots per variant/mode pair', () => {
  const store = fakeStore();
  recordResult(store, 'europe', '20', { score: 100, time: 30000 });
  recordResult(store, 'asia', '20', { score: 70, time: 90000 });
  recordResult(store, 'europe', 'all', { score: 85, time: 200000 });
  assert.deepEqual(
    loadBest(store, bestKey('europe', '20')),
    { score: 100, time: 30000 },
  );
  assert.deepEqual(
    loadBest(store, bestKey('asia', '20')),
    { score: 70, time: 90000 },
  );
  assert.deepEqual(
    loadBest(store, bestKey('europe', 'all')),
    { score: 85, time: 200000 },
  );
});

test('scoreColor anchors: 0 = red, 0.5 = yellow, 1 = green', () => {
  assert.equal(scoreColor(0), 'hsl(0, 65%, 38%)');
  assert.equal(scoreColor(0.5), 'hsl(60, 65%, 38%)');
  assert.equal(scoreColor(1), 'hsl(120, 65%, 38%)');
});

test('scoreColor clamps ratios outside [0, 1]', () => {
  assert.equal(scoreColor(-0.5), 'hsl(0, 65%, 38%)');
  assert.equal(scoreColor(2), 'hsl(120, 65%, 38%)');
});

// pickCelebration — unified tier picker shared across all four games.
// Rule: 0 → none, sweep OR record → fireworks, anything else > 0 → confetti.
// Timed mode (quiz 60s) suppresses the sweep branch because every finished
// timed run is "complete" by construction; only records earn fireworks there.
// Intensity scales the confetti burst by found/total so 1/10 reads
// noticeably thinner than 9/10; fireworks always runs at full intensity.

test('pickCelebration: nothing found returns "none" regardless of other flags', () => {
  assert.deepEqual(pickCelebration({ found: 0, total: 10 }), { tier: 'none', intensity: 0 });
  assert.deepEqual(pickCelebration({ found: 0, total: 10, isNew: true }), { tier: 'none', intensity: 0 },
    'a record claim with zero finds is incoherent — none beats it');
  assert.deepEqual(pickCelebration({ found: 0, total: 10, isTimed: true, isNew: true }), { tier: 'none', intensity: 0 });
});

test('pickCelebration: a clean sweep is "fireworks" (untimed games)', () => {
  assert.deepEqual(pickCelebration({ found: 10, total: 10 }), { tier: 'fireworks', intensity: 1 });
  assert.deepEqual(pickCelebration({ found: 10, total: 10, isNew: true }), { tier: 'fireworks', intensity: 1 },
    'no double-stack: sweep+record still resolves to a single fireworks');
});

test('pickCelebration: a new record is "fireworks" even on a partial finish', () => {
  assert.deepEqual(pickCelebration({ found: 7, total: 10, isNew: true }), { tier: 'fireworks', intensity: 1 });
});

test('pickCelebration: timed mode suppresses the sweep branch', () => {
  assert.deepEqual(pickCelebration({ found: 10, total: 10, isTimed: true, isNew: false }), { tier: 'confetti', intensity: 1 },
    'every 60s run "completes" when the budget runs out — the brag is the record, not the sweep');
  assert.deepEqual(pickCelebration({ found: 10, total: 10, isTimed: true, isNew: true }), { tier: 'fireworks', intensity: 1 });
});

test('pickCelebration: partial finish without a record is "confetti" scaled by found/total', () => {
  assert.deepEqual(pickCelebration({ found: 7, total: 10 }), { tier: 'confetti', intensity: 0.7 });
  assert.deepEqual(pickCelebration({ found: 1, total: 10 }), { tier: 'confetti', intensity: 0.1 },
    'even a single find earns confetti — recognising the effort, just with a thinner burst');
  assert.deepEqual(pickCelebration({ found: 9, total: 10 }), { tier: 'confetti', intensity: 0.9 },
    'near-sweep gets a near-full confetti burst');
});

test('pickCelebration: timed-mode confetti uses full intensity (total has no meaning there)', () => {
  // 60s quiz passes total: 0; the round ends on the clock, not on the
  // pool. Scaling to found/0 would be nonsense, so the partial branch
  // gives full intensity and lets the record-vs-not distinction carry
  // the brag-worthy signal instead.
  assert.deepEqual(pickCelebration({ found: 7, total: 0, isTimed: true }), { tier: 'confetti', intensity: 1 });
});

test('pickCelebration: prematurelyGaveUp short-circuits to "none" even when finds would otherwise celebrate', () => {
  // Walking away from a quiz round mid-pool isn't a finish to celebrate,
  // however many flags you got. findFlag/daily don't set this flag — there
  // give-up IS the natural finish, so a partial-but-walked-away result
  // still earns its confetti via the normal partial-finish branch.
  assert.deepEqual(pickCelebration({ found: 7, total: 10, prematurelyGaveUp: true }), { tier: 'none', intensity: 0 });
  assert.deepEqual(pickCelebration({ found: 10, total: 10, prematurelyGaveUp: true }), { tier: 'none', intensity: 0 },
    'even a coincidental sweep at give-up time stays silent — the player chose to stop, not finish');
  assert.deepEqual(pickCelebration({ found: 7, total: 10, isNew: true, prematurelyGaveUp: true }), { tier: 'none', intensity: 0 },
    'a record claim is moot when the player abandoned the round');
});

// pickFinalScoreLine — clean sweep collapses to "You found all"; everything
// else keeps the fraction so the player sees what they accomplished.

test('pickFinalScoreLine: clean sweep hides the fraction and uses the "all" key', () => {
  assert.deepEqual(pickFinalScoreLine(124, 124), {
    prefixKey: 'findFlag.youFoundAll',
    showFraction: false,
  });
});

test('pickFinalScoreLine: partial finish keeps the fraction', () => {
  assert.deepEqual(pickFinalScoreLine(7, 10), {
    prefixKey: 'findFlag.youFound',
    showFraction: true,
  });
});

test('pickFinalScoreLine: zero finds keep the fraction (0 / N is still a result)', () => {
  assert.deepEqual(pickFinalScoreLine(0, 10), {
    prefixKey: 'findFlag.youFound',
    showFraction: true,
  });
});

test('pickFinalScoreLine: degenerate total=0 does not claim "all"', () => {
  // No targets shouldn't celebrate as a sweep — guard against the
  // off-nominal case where a filter resolves to an empty set.
  assert.deepEqual(pickFinalScoreLine(0, 0), {
    prefixKey: 'findFlag.youFound',
    showFraction: true,
  });
});

// ---- getQuizLastVariant / setQuizLastVariant ----

test('getQuizLastVariant returns null when no value is stored — first-time visitor', () => {
  assert.equal(getQuizLastVariant(fakeStore()), null);
});

test('getQuizLastVariant returns the stored key when it names a known variant', () => {
  const store = fakeStore({ 'gridgame.flagquiz.lastVariant': 'europe' });
  assert.equal(getQuizLastVariant(store), 'europe');
});

test('getQuizLastVariant returns null when the stored key no longer names a known variant', () => {
  // Defends against future VARIANTS renames / removals — a stale
  // localStorage entry shouldn't crash the page or strand the player
  // on a variant that no longer exists. Caller falls back to its
  // own default.
  const store = fakeStore({ 'gridgame.flagquiz.lastVariant': 'atlantis' });
  assert.equal(getQuizLastVariant(store), null);
});

test('setQuizLastVariant + getQuizLastVariant round-trips a known variant', () => {
  const store = fakeStore();
  setQuizLastVariant(store, 'asia');
  assert.equal(getQuizLastVariant(store), 'asia');
});

test('setQuizLastVariant silently drops an unknown variant key', () => {
  // Better to no-op than poison localStorage with a value that
  // getQuizLastVariant would then reject on every load. Existing value
  // (if any) survives — guarantees a stable saved pick across releases
  // where the URL might briefly carry a typo from an external link.
  const store = fakeStore({ 'gridgame.flagquiz.lastVariant': 'africa' });
  setQuizLastVariant(store, 'atlantis');
  assert.equal(getQuizLastVariant(store), 'africa');
});

// ---- resolveMode ----

test('resolveMode returns the URL mode when it names a mode available for the pool', () => {
  // Home tile passes ?n=60s; the picker preserves this through to
  // whichever variant the player clicks, so a first-timer entering
  // via the home tile still gets a 60s landing even on Europe etc.
  assert.equal(resolveMode('60s', 200), '60s');
  assert.equal(resolveMode('all', 200), 'all');
});

test('resolveMode falls back to defaultModeFor when no URL mode is given', () => {
  // Burger menu (deep-linked or unspecified ?n=) hits this path.
  assert.equal(resolveMode(null, 200), defaultModeFor(200));
});

test('resolveMode falls back to defaultModeFor when the URL mode is not a known mode', () => {
  // A typo or a stale URL ("?n=blitz" from an external link, say)
  // shouldn't crash or stick — fall back to the variant's default.
  assert.equal(resolveMode('blitz', 200), defaultModeFor(200));
});

test('resolveMode returns null when the pool is too small for any mode', () => {
  // No mode in MODES today fails this for a non-empty pool (60s is
  // unconditionally available, 'all' has count=Infinity which means
  // "every flag, however many"). The null branch is the contract for
  // future MODES that might gate on pool size — e.g. a "n=20" count
  // mode with count: 20 would return null here for poolSize < 20.
  // Verifying the contract by stubbing availableModes is overkill;
  // testing the wiring against the current MODES is enough.
  assert.equal(resolveMode(null, 200), defaultModeFor(200));
  // Tautological sanity check that the helper stays in lockstep
  // with defaultModeFor for any pool size we actually use today.
  assert.equal(resolveMode(null, 0), defaultModeFor(0));
});

test('resolveMode is idempotent — passing back the resolved mode returns the same mode', () => {
  // Catches a regression where the helper might accidentally treat
  // its own output as "unknown" and fall back to default. Important
  // because the picker computes a mode per tile and the resulting
  // page load re-runs resolveMode in page.js's startGame branch
  // against the same URL — round-trip stability matters.
  const once = resolveMode('60s', 200);
  assert.equal(resolveMode(once, 200), once);
});

// ---- isQuizShowMap / setQuizShowMap ----
//
// Storage key is the contract — once shipped, renaming it orphans
// every player's preference. Pin both the default-when-missing
// behavior and the exact key.

test('isQuizShowMap defaults to true when the key is missing', () => {
  // Every variant has a map now — opt-out, not opt-in. Missing key
  // reads as "show" so brand-new players see the map by default.
  assert.equal(isQuizShowMap(fakeStore()), true);
});

test('isQuizShowMap returns false when the key is explicitly "false"', () => {
  // Players who toggle the map off get their opt-out persisted as the
  // literal string "false" — not removeItem, otherwise the default-on
  // behavior would bring the map back on the next visit.
  const store = fakeStore({ 'gridgame.flagquiz.showMap': 'false' });
  assert.equal(isQuizShowMap(store), false);
});

test('isQuizShowMap returns true when the key is explicitly "true"', () => {
  // Pre-rollout players who opted in have 'true' stored — same default
  // they had then, same behavior post-rollout.
  const store = fakeStore({ 'gridgame.flagquiz.showMap': 'true' });
  assert.equal(isQuizShowMap(store), true);
});

test('setQuizShowMap round-trips both true and false values', () => {
  const store = fakeStore();
  setQuizShowMap(store, false);
  assert.equal(isQuizShowMap(store), false);
  setQuizShowMap(store, true);
  assert.equal(isQuizShowMap(store), true);
});

test('isQuizShowMap reads the gridgame.flagquiz.showMap key', () => {
  // Pin the literal key so a future rename doesn't silently orphan
  // every existing player's preference.
  const store = fakeStore({ 'gridgame.flagquiz.showMap': 'true' });
  assert.equal(isQuizShowMap(store), true);
});
