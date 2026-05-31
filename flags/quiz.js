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

// Flags that look essentially identical at the sizes shown in the quiz.
// When the answer is in one of these groups, the other members are
// excluded from being distractors in the same question (so the user is
// never asked to tell two near-identical flags apart).
/** @type {string[][]} */
export const LOOKALIKES = [
  ['id', 'mc'], // Indonesia, Monaco - red over white
  ['ro', 'td'], // Romania, Chad - vertical blue/yellow/red
  ['ie', 'ci'], // Ireland, Cote d'Ivoire - vertical tricolour, mirrored
  // Norwegian flag - used by Norway and its two uninhabited dependencies
  ['no', 'sj', 'bv'],
  // French tricolour - used by France, Clipperton, and the overseas
  // departments/collectivities that fly the plain tricolour
  ['fr', 're', 'cp', 'gp', 'mf', 'pm', 'wf', 'gf', 'yt', 'bl'],
];

/**
 * @param {string} code
 * @returns {string[]} the group containing this code (including itself), or just [code]
 */
export function lookalikesOf(code) {
  for (const group of LOOKALIKES) {
    if (group.includes(code)) return group;
  }
  return [code];
}

// Picks a set of `choiceCount` choices for one question. Ensures no two
// choices share a LOOKALIKES group - we exclude lookalikes of the
// answer, and as each distractor is picked we exclude lookalikes of
// that distractor too. Falls back to allowing duplicates only when the
// pool is too small to satisfy the strict rule.
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
    // Pool too small to give every choice its own lookalike group.
    // Relax: any non-answer entry is fair game.
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

// Builds a quiz that asks every answer at most once. Each call to .next()
// returns the next question (or null when exhausted). Distractors are
// drawn from the full pool excluding the current answer, so wrong choices
// can recur but the country being asked never does.
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

// Variant definitions. The key is the URL slug (?v=<key>); the order
// here is the display order in the menu — the two whole-world pools
// come first, then the per-continent pools (and "Others" alongside
// them as another narrow pool).
/** @type {Record<string, Variant>} */
export const VARIANTS = {
  countries: {
    label: 'All countries',
    filter: (c) => c.category === 'country',
  },
  all: {
    label: 'All flags',
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

// Question-count modes. The key is the URL slug (?n=<key>) and also the
// label rendered in the menu. The value is the upper bound; the actual
// target is clamped to the pool size in case the pool is smaller.
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

// Which mode keys make sense for a pool of this size. A mode is usable
// when its labelled count (e.g. 20) is <= the pool, OR when it has no
// fixed count (Infinity = "all"). Preserves MODES insertion order.
/**
 * @param {number} poolSize
 * @returns {string[]}
 */
export function availableModes(poolSize) {
  return Object.keys(MODES).filter(
    (m) => MODES[m] === Infinity || MODES[m] <= poolSize,
  );
}

// Pretty-print a duration in milliseconds as M:SS.mmm (e.g. 1:23.456).
// Floors rather than rounds so the displayed value never overshoots the
// real elapsed time.
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

// CSS color string for a score ratio (0..1). Maps to a hue going red
// (0) -> yellow (0.5) -> green (1) at a fixed saturation/lightness that
// reads well on the off-white background. Inputs outside [0, 1] are
// clamped.
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

// Decide what to keep as "best" between a previous best and a current
// result. Higher score wins; if scores are tied, faster time wins.
// Returns the chosen value and whether it represents a new best.
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

// Read a stored best from any Storage-like object. Returns null when
// the key is missing, the value is unparseable, or the parsed value
// does not look like a Result. Never throws.
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

// Write a best to any Storage-like object. Silently no-ops if the
// store throws (e.g. private-mode localStorage with quota of zero).
/**
 * @param {BestStore} store
 * @param {string} key
 * @param {Result} value
 */
export function saveBest(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be disabled or full - degrade gracefully.
  }
}

// Storage key for the best score of a given variant + mode. Keeping
// this in code (rather than inlined as a template literal at the call
// site) gives a single source of truth + a target for tests.
/**
 * @param {string} variantKey
 * @param {string} modeKey
 * @returns {string}
 */
export function bestKey(variantKey, modeKey) {
  return `flagquiz.best.${variantKey}.${modeKey}`;
}

// End-of-game flow: read the previous best for this variant/mode,
// decide whether the current run beats it, and persist if so. Returns
// what to display and whether the displayed value is freshly set.
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
