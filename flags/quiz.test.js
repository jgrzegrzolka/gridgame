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
  formatTime,
  LOOKALIKES,
  lookalikesOf,
  nextBest,
  loadBest,
  saveBest,
  bestKey,
  recordResult,
  scoreColor,
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

test('VARIANTS contains the expected 9 keys in display order', () => {
  assert.deepEqual(Object.keys(VARIANTS), [
    'countries',
    'all',
    'europe',
    'asia',
    'africa',
    'north-america',
    'south-america',
    'oceania',
    'others',
  ]);
});

test('poolFor throws on an unknown variant', () => {
  assert.throws(() => poolFor('mars', countries), /Unknown variant/);
});

test('poolFor("all") returns every entry from the input', () => {
  assert.equal(poolFor('all', countries).length, countries.length);
});

test('poolFor("countries") = all entries minus "others"', () => {
  const all = countries.length;
  const others = poolFor('others', countries).length;
  assert.equal(poolFor('countries', countries).length, all - others);
});

test('poolFor("europe") returns only category=country with continent=Europe', () => {
  const europe = poolFor('europe', countries);
  assert.ok(europe.length > 0);
  for (const c of europe) {
    assert.equal(c.category, 'country');
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

test('MODES contains "20" and "all" in that display order', () => {
  assert.deepEqual(Object.keys(MODES), ['20', 'all']);
});

test('targetFor("20", pool) returns 20 when pool is large enough', () => {
  assert.equal(targetFor('20', countries), 20);
});

test('targetFor("20", tinyPool) clamps to pool length', () => {
  const tinyPool = sample.slice(0, 5);
  assert.equal(targetFor('20', tinyPool), 5);
});

test('targetFor("all", pool) returns the full pool length', () => {
  assert.equal(targetFor('all', countries), countries.length);
});

test('targetFor throws on an unknown mode', () => {
  assert.throws(() => targetFor('99', countries), /Unknown mode/);
});

test('availableModes offers both 20 and all when pool >= 20', () => {
  assert.deepEqual(availableModes(50), ['20', 'all']);
});

test('availableModes still offers 20 exactly at the boundary', () => {
  assert.deepEqual(availableModes(20), ['20', 'all']);
});

test('availableModes hides 20 when pool is below 20', () => {
  assert.deepEqual(availableModes(19), ['all']);
  assert.deepEqual(availableModes(13), ['all']);
  assert.deepEqual(availableModes(4), ['all']);
});

test('availableModes returns "all" alone for an empty pool', () => {
  assert.deepEqual(availableModes(0), ['all']);
});

test('defaultModeFor returns "20" when the pool can support a 20-question round', () => {
  assert.equal(defaultModeFor(20), '20');
  assert.equal(defaultModeFor(50), '20');
});

test('defaultModeFor falls back to "all" for narrower pools', () => {
  assert.equal(defaultModeFor(19), 'all');
  assert.equal(defaultModeFor(4), 'all');
});

test('defaultModeFor returns "all" even for an empty pool (consistent with availableModes)', () => {
  assert.equal(defaultModeFor(0), 'all');
});

test('availableModes preserves MODES insertion order', () => {
  assert.deepEqual(availableModes(100), ['20', 'all']);
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

test('bestKey produces the expected namespaced format', () => {
  assert.equal(bestKey('europe', '20'), 'flagquiz.best.europe.20');
  assert.equal(bestKey('all', 'all'), 'flagquiz.best.all.all');
  assert.equal(bestKey('north-america', '20'), 'flagquiz.best.north-america.20');
});

test('recordResult on an empty store saves the result and reports isNew', () => {
  const store = fakeStore();
  const current = { score: 87, time: 65432 };
  const r = recordResult(store, 'europe', '20', current);
  assert.deepEqual(r, { best: current, isNew: true });
  assert.deepEqual(
    loadBest(store, bestKey('europe', '20')),
    current,
  );
});

test('recordResult does not save when the current run does not beat the best', () => {
  const store = fakeStore();
  const previous = { score: 90, time: 30000 };
  saveBest(store, bestKey('europe', '20'), previous);
  const worse = { score: 80, time: 10000 };
  const r = recordResult(store, 'europe', '20', worse);
  assert.deepEqual(r, { best: previous, isNew: false });
  assert.deepEqual(
    loadBest(store, bestKey('europe', '20')),
    previous,
  );
});

test('recordResult updates the store when the current run beats the best', () => {
  const store = fakeStore();
  saveBest(store, bestKey('europe', '20'), { score: 80, time: 60000 });
  const better = { score: 95, time: 40000 };
  const r = recordResult(store, 'europe', '20', better);
  assert.deepEqual(r, { best: better, isNew: true });
  assert.deepEqual(
    loadBest(store, bestKey('europe', '20')),
    better,
  );
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
