import { readBoolSetting, writeBoolSetting } from './group.js';

const QUIZ_INCLUDE_ALL_KEY = 'gridgame.flagquiz.includeAll';

/**
 * @param {{ getItem(key: string): string | null } | null | undefined} [store]
 */
export function isQuizIncludeAll(store) {
  return readBoolSetting(store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null), QUIZ_INCLUDE_ALL_KEY);
}

/**
 * @param {{ setItem(key: string, value: string): void, removeItem(key: string): void }} store
 * @param {boolean} value
 */
export function setQuizIncludeAll(store, value) {
  writeBoolSetting(store, QUIZ_INCLUDE_ALL_KEY, value);
}

/**
 * @typedef {import('./group.js').Country} Country
 *
 * @typedef {Object} Question
 * @property {Country} answer
 * @property {Country[]} choices
 *
 * @typedef {Object} Quiz
 * @property {number} total
 * @property {() => Question | null} next
 *
 * @typedef {Object} Variant
 * @property {string} label
 * @property {(c: Country) => boolean} filter
 */

/**
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @type {string[][]} */
export const LOOKALIKES = [
  ['id', 'mc'],
  ['ro', 'td'],
  ['ie', 'ci'],
  ['no', 'sj', 'bv'],
  ['fr', 're', 'cp', 'gp', 'mf', 'pm', 'wf', 'gf', 'yt', 'bl'],
];

/**
 * @param {string} code
 * @returns {string[]}
 */
export function lookalikesOf(code) {
  for (const group of LOOKALIKES) {
    if (group.includes(code)) return group;
  }
  return [code];
}

/**
 * @template {{ code: string }} T
 * @param {T[]} pool
 * @param {T} answer
 * @param {number} choiceCount
 * @returns {T[]}
 */
function buildChoices(pool, answer, choiceCount) {
  const taken = new Set(lookalikesOf(answer.code));
  const distractors = [];
  for (const c of shuffle(pool)) {
    if (distractors.length === choiceCount - 1) break;
    if (taken.has(c.code)) continue;
    distractors.push(c);
    for (const k of lookalikesOf(c.code)) taken.add(k);
  }
  if (distractors.length < choiceCount - 1) {
    const fallback = shuffle(pool.filter((c) => c.code !== answer.code))
      .slice(0, choiceCount - 1);
    return shuffle([answer, ...fallback]);
  }
  return shuffle([answer, ...distractors]);
}

/**
 * @template {{ code: string }} T
 * @param {T[]} countries
 * @param {number} [choiceCount]
 * @returns {{ answer: T, choices: T[] }}
 */
export function pickQuestion(countries, choiceCount = 4) {
  if (countries.length < choiceCount) {
    throw new Error(
      `Need at least ${choiceCount} entries, got ${countries.length}`,
    );
  }
  const answer = countries[Math.floor(Math.random() * countries.length)];
  return { answer, choices: buildChoices(countries, answer, choiceCount) };
}

/**
 * @template {{ code: string }} T
 * @param {T[]} pool
 * @param {number} count
 * @param {number} [choiceCount]
 * @returns {{ total: number, next: () => { answer: T, choices: T[] } | null }}
 */
export function createQuiz(pool, count, choiceCount = 4) {
  if (pool.length < choiceCount) {
    throw new Error(
      `Need at least ${choiceCount} entries, got ${pool.length}`,
    );
  }
  if (count > pool.length) {
    throw new Error(
      `Cannot ask ${count} unique questions from a pool of ${pool.length}`,
    );
  }
  const queue = shuffle(pool).slice(0, count);
  return {
    total: count,
    next() {
      if (queue.length === 0) return null;
      const answer = queue.shift();
      if (!answer) return null;
      return { answer, choices: buildChoices(pool, answer, choiceCount) };
    },
  };
}

/**
 * VARIANTS predicates only narrow by continent / "all". The sovereign-vs-
 * include-everything scope is applied separately at fetch time via
 * flagsGamePool, so flipping the "include territories etc." toggle
 * widens every variant uniformly without needing per-variant changes.
 *
 * @type {Record<string, Variant>}
 */
export const VARIANTS = {
  countries: {
    label: 'All countries',
    filter: () => true,
  },
  europe: {
    label: 'Europe',
    filter: (c) => c.continent === 'Europe',
  },
  asia: {
    label: 'Asia',
    filter: (c) => c.continent === 'Asia',
  },
  africa: {
    label: 'Africa',
    filter: (c) => c.continent === 'Africa',
  },
  'north-america': {
    label: 'North America',
    filter: (c) => c.continent === 'North America',
  },
  'south-america': {
    label: 'South America',
    filter: (c) => c.continent === 'South America',
  },
  oceania: {
    label: 'Oceania',
    filter: (c) => c.continent === 'Oceania',
  },
};

/**
 * Warms the browser HTTP cache for every flag in the pool by handing each
 * SVG URL to the supplied loader (typically `new Image().src = url`). Lets
 * the first question render off the wire while later questions hit cache.
 *
 * @param {{ code: string }[]} pool
 * @param {(url: string) => void} load
 * @param {string} [base]
 */
export function preloadFlags(pool, load, base = '../flags/svg/') {
  for (const c of pool) {
    load(`${base}${c.code}.svg`);
  }
}

/**
 * @param {string} variantKey
 * @param {Country[]} countries
 * @returns {Country[]}
 */
export function poolFor(variantKey, countries) {
  const variant = VARIANTS[variantKey];
  if (!variant) {
    throw new Error(`Unknown variant: ${variantKey}`);
  }
  return countries.filter(variant.filter);
}

/**
 * @typedef {{ kind: 'timed', budgetMs: number, penaltyMs: number }
 *   | { kind: 'count', count: number }} Mode
 *
 * `60s` is a time-attack: 60-second budget, each wrong tile click subtracts
 * 3 seconds. Round ends when the remaining budget hits zero OR the pool
 * exhausts — score is the number of flags answered correctly.
 *
 * `all` is the original endurance mode: play through every flag in the
 * pool. Score is the percentage correct.
 *
 * @type {Record<string, Mode>}
 */
export const MODES = {
  '60s': { kind: 'timed', budgetMs: 60_000, penaltyMs: 3_000 },
  all: { kind: 'count', count: Infinity },
};

/**
 * @param {string} modeKey
 * @returns {boolean}
 */
export function isTimedMode(modeKey) {
  const def = MODES[modeKey];
  return def !== undefined && def.kind === 'timed';
}

/**
 * Number of questions to queue up for the round. For timed modes we line
 * up the whole pool — `quiz.next()` may run out before the timer does and
 * that's a valid "pool exhausted" ending. For count modes we cap at the
 * mode's count or the pool size, whichever is smaller (existing behaviour).
 *
 * @param {string} modeKey
 * @param {{ length: number }} pool
 * @returns {number}
 */
export function targetFor(modeKey, pool) {
  const def = MODES[modeKey];
  if (!def) {
    throw new Error(`Unknown mode: ${modeKey}`);
  }
  if (def.kind === 'timed') return pool.length;
  return Math.min(def.count, pool.length);
}

/**
 * @param {number} poolSize
 * @returns {string[]}
 */
export function availableModes(poolSize) {
  return Object.keys(MODES).filter((m) => {
    const def = MODES[m];
    if (def.kind === 'timed') return true;
    return def.count === Infinity || def.count <= poolSize;
  });
}

/**
 * @param {number} poolSize
 * @returns {string | null}
 */
export function defaultModeFor(poolSize) {
  return availableModes(poolSize)[0] ?? null;
}

/**
 * Remaining budget in milliseconds. Wall-clock burn plus the per-wrong
 * penalty is subtracted from the budget; result is clamped at zero so
 * callers can render and compare without branching.
 *
 * @param {{ budgetMs: number, penaltyMs: number, elapsedMs: number, wrongCount: number }} state
 * @returns {number}
 */
export function timedRemainingMs({ budgetMs, penaltyMs, elapsedMs, wrongCount }) {
  return Math.max(0, budgetMs - elapsedMs - wrongCount * penaltyMs);
}

/**
 * Budget consumed in milliseconds — the value stored as `Result.time` for
 * a timed round so that `nextBest` ranks rounds by efficiency. Equals
 * `wall + wrongCount * penalty` on pool-exhaust (under budget) and caps at
 * the budget on time-out, so a same-score round with fewer penalties
 * always wins the tiebreaker. Symmetric with `timedRemainingMs`:
 * `budgetUsed + remaining === budgetMs`.
 *
 * @param {{ budgetMs: number, penaltyMs: number, elapsedMs: number, wrongCount: number }} state
 * @returns {number}
 */
export function timedBudgetUsedMs(state) {
  return state.budgetMs - timedRemainingMs(state);
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const milli = ms % 1000;
  return `${min}:${sec.toString().padStart(2, '0')}.${milli.toString().padStart(3, '0')}`;
}

/**
 * Accuracy as a 0..1 ratio for tinting purposes, derived from a mistakes
 * count against the round's target. Clamped at both ends — give-up
 * bookkeeping in all-mode can inflate `mistakes` above `target` (the
 * unanswered remainder is added to wrongCount when the player walks
 * away), and we want such a round to read as a flat 0 (red) rather than
 * a nonsense negative ratio downstream.
 *
 * @param {number} mistakes
 * @param {number} target
 * @returns {number}
 */
export function accuracyRatio(mistakes, target) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, (target - mistakes) / target));
}

/**
 * @param {number} ratio
 * @returns {string}
 */
export function scoreColor(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return `hsl(${clamped * 120}, 65%, 38%)`;
}

/**
 * @typedef {{ score: number, time: number }} Result
 *
 * @typedef {Object} BestStore
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/**
 * @callback ScoreComparator
 * @param {number} candidate
 * @param {number} incumbent
 * @returns {boolean} true when `candidate` should displace `incumbent`
 */

/** @type {ScoreComparator} — default: higher score wins (60s mode, grid game). */
export const higherScoreWins = (candidate, incumbent) => candidate > incumbent;

/** @type {ScoreComparator} — `all` mode: fewer mistakes wins. */
export const lowerScoreWins = (candidate, incumbent) => candidate < incumbent;

/**
 * @param {Result | null} prev
 * @param {Result} current
 * @param {ScoreComparator} [scoreBetter]
 * @returns {{ best: Result, isNew: boolean }}
 */
export function nextBest(prev, current, scoreBetter = higherScoreWins) {
  if (!prev) return { best: current, isNew: true };
  if (scoreBetter(current.score, prev.score)) return { best: current, isNew: true };
  if (current.score === prev.score && current.time < prev.time) {
    return { best: current, isNew: true };
  }
  return { best: prev, isNew: false };
}

/**
 * @param {BestStore} store
 * @param {string} key
 * @returns {Result | null}
 */
export function loadBest(store, key) {
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.score === 'number' &&
      typeof parsed.time === 'number'
    ) {
      return { score: parsed.score, time: parsed.time };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {BestStore} store
 * @param {string} key
 * @param {Result} value
 */
export function saveBest(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may throw in private mode / zero quota; degrade silently.
  }
}

/**
 * @param {string} variantKey
 * @param {string} modeKey
 * @param {boolean} [includeAll]
 * @returns {string}
 */
export function bestKey(variantKey, modeKey, includeAll = false) {
  // The `all` mode swapped its `Result.score` semantics from "percentage
  // correct, higher wins" to "mistakes count, lower wins". Add a `.v2`
  // segment so old percentage-shaped entries don't get reloaded and
  // misinterpreted as monstrous mistake counts (e.g. `95` reading as 95
  // mistakes out of a 269-flag pool). 60s and grid keys are unaffected
  // — they always stored a count.
  const base =
    modeKey === 'all'
      ? `flagquiz.best.${variantKey}.${modeKey}.v2`
      : `flagquiz.best.${variantKey}.${modeKey}`;
  return includeAll ? `${base}.all` : base;
}

/**
 * @param {BestStore} store
 * @param {string} variantKey
 * @param {string} modeKey
 * @param {Result} current
 * @param {boolean} [includeAll]
 * @param {ScoreComparator} [scoreBetter]
 * @returns {{ best: Result, isNew: boolean }}
 */
export function recordResult(store, variantKey, modeKey, current, includeAll = false, scoreBetter) {
  const key = bestKey(variantKey, modeKey, includeAll);
  const outcome = nextBest(loadBest(store, key), current, scoreBetter);
  if (outcome.isNew) saveBest(store, key, outcome.best);
  return outcome;
}

/**
 * Confetti rule for the quiz page.
 * - timed (60s) mode: only on a new record, since every finished run is
 *   inherently "complete" (the budget runs out) and the brag-worthy event
 *   is beating your previous best.
 * - untimed (all) mode: a clean sweep (wrongCount === 0) deserves the
 *   reward on its own merits even if a previous run was equally clean
 *   and faster; otherwise a new record (fewer mistakes than before, or
 *   same mistakes but faster) also fires.
 *
 * @param {{ timed: boolean, wrongCount: number, isNew: boolean }} params
 * @returns {boolean}
 */
export function shouldFireQuizConfetti({ timed, wrongCount, isNew }) {
  if (timed) return isNew;
  return wrongCount === 0 || isNew;
}
