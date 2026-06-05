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
  preloadFlags,
  shouldFireQuizConfetti,
  shouldShowBestTime,
  formatBestScoreLabel,
  mistakesAfterGiveUp,
} from './quiz.js';

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

/** @typedef {import('./group.js').Country} Country */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** @type {Country[]} */
const countries = JSON.parse(
  readFileSync(join(__dirname, 'countries.json'), 'utf8'),
);

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

test('MODES contains "60s" and "all" in that display order', () => {
  assert.deepEqual(Object.keys(MODES), ['60s', 'all']);
});

test('MODES["60s"] is a 60-second budget with a 3-second-per-wrong penalty', () => {
  assert.deepEqual(MODES['60s'], { kind: 'timed', budgetMs: 60_000, penaltyMs: 3_000 });
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

test('preloadFlags invokes the loader once per pool entry with the SVG URL', () => {
  const pool = [{ code: 'pl' }, { code: 'de' }, { code: 'us' }];
  /** @type {string[]} */
  const seen = [];
  preloadFlags(pool, (url) => seen.push(url));
  assert.deepEqual(seen, [
    '../flags/svg/pl.svg',
    '../flags/svg/de.svg',
    '../flags/svg/us.svg',
  ]);
});

test('preloadFlags accepts a custom base path', () => {
  /** @type {string[]} */
  const seen = [];
  preloadFlags([{ code: 'fr' }], (url) => seen.push(url), '/static/flags/');
  assert.deepEqual(seen, ['/static/flags/fr.svg']);
});

test('preloadFlags handles an empty pool without calling the loader', () => {
  let calls = 0;
  preloadFlags([], () => { calls++; });
  assert.equal(calls, 0);
});

// shouldFireQuizConfetti
// Encodes the rule: timed (60s) celebrates only new records; untimed (all)
// also celebrates a clean sweep on its own merits.

test('shouldFireQuizConfetti: timed mode fires only on a new record', () => {
  assert.equal(shouldFireQuizConfetti({ timed: true, wrongCount: 0, isNew: true }), true);
  assert.equal(shouldFireQuizConfetti({ timed: true, wrongCount: 5, isNew: true }), true);
  assert.equal(shouldFireQuizConfetti({ timed: true, wrongCount: 0, isNew: false }), false,
    'timed mode does not reward a clean sweep on its own — only beating the prior best');
  assert.equal(shouldFireQuizConfetti({ timed: true, wrongCount: 5, isNew: false }), false);
});

test('shouldFireQuizConfetti: untimed mode fires on a clean sweep (wrongCount === 0) even without a new record', () => {
  assert.equal(shouldFireQuizConfetti({ timed: false, wrongCount: 0, isNew: false }), true,
    'clean sweep gets confetti even if a prior run was equally clean and faster');
  assert.equal(shouldFireQuizConfetti({ timed: false, wrongCount: 0, isNew: true }), true);
});

test('shouldFireQuizConfetti: untimed mode fires on a new record even with mistakes', () => {
  assert.equal(shouldFireQuizConfetti({ timed: false, wrongCount: 3, isNew: true }), true,
    'fewer mistakes than before still earns confetti even if not a clean sweep');
});

test('shouldFireQuizConfetti: untimed mode does NOT fire when there are mistakes and no new record', () => {
  assert.equal(shouldFireQuizConfetti({ timed: false, wrongCount: 3, isNew: false }), false);
  assert.equal(shouldFireQuizConfetti({ timed: false, wrongCount: 1, isNew: false }), false);
});
