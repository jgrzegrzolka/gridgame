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

/** @type {Record<string, Variant>} */
export const VARIANTS = {
  countries: {
    label: 'All countries',
    filter: (c) => c.category === 'country',
  },
  all: {
    label: 'Flags data',
    filter: () => true,
  },
  europe: {
    label: 'Europe',
    filter: (c) => c.category === 'country' && c.continent === 'Europe',
  },
  asia: {
    label: 'Asia',
    filter: (c) => c.category === 'country' && c.continent === 'Asia',
  },
  africa: {
    label: 'Africa',
    filter: (c) => c.category === 'country' && c.continent === 'Africa',
  },
  'north-america': {
    label: 'North America',
    filter: (c) => c.category === 'country' && c.continent === 'North America',
  },
  'south-america': {
    label: 'South America',
    filter: (c) => c.category === 'country' && c.continent === 'South America',
  },
  oceania: {
    label: 'Oceania',
    filter: (c) => c.category === 'country' && c.continent === 'Oceania',
  },
  others: {
    label: 'Others',
    filter: (c) => c.category === 'other',
  },
};

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

/** @type {Record<string, number>} */
export const MODES = {
  '20': 20,
  all: Infinity,
};

/**
 * @param {string} modeKey
 * @param {{ length: number }} pool
 * @returns {number}
 */
export function targetFor(modeKey, pool) {
  if (!(modeKey in MODES)) {
    throw new Error(`Unknown mode: ${modeKey}`);
  }
  return Math.min(MODES[modeKey], pool.length);
}

/**
 * @param {number} poolSize
 * @returns {string[]}
 */
export function availableModes(poolSize) {
  return Object.keys(MODES).filter(
    (m) => MODES[m] === Infinity || MODES[m] <= poolSize,
  );
}

/**
 * @param {number} poolSize
 * @returns {string | null}
 */
export function defaultModeFor(poolSize) {
  return availableModes(poolSize)[0] ?? null;
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
 * @param {Result | null} prev
 * @param {Result} current
 * @returns {{ best: Result, isNew: boolean }}
 */
export function nextBest(prev, current) {
  if (!prev) return { best: current, isNew: true };
  if (current.score > prev.score) return { best: current, isNew: true };
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
 * @returns {string}
 */
export function bestKey(variantKey, modeKey) {
  return `flagquiz.best.${variantKey}.${modeKey}`;
}

/**
 * @param {BestStore} store
 * @param {string} variantKey
 * @param {string} modeKey
 * @param {Result} current
 * @returns {{ best: Result, isNew: boolean }}
 */
export function recordResult(store, variantKey, modeKey, current) {
  const key = bestKey(variantKey, modeKey);
  const outcome = nextBest(loadBest(store, key), current);
  if (outcome.isNew) saveBest(store, key, outcome.best);
  return outcome;
}
