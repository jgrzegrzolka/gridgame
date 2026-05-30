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
  ['nl', 'lu'], // Netherlands, Luxembourg - red/white/blue horizontal
  ['ie', 'ci'], // Ireland, Cote d'Ivoire - vertical tricolour, mirrored
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

// Picks a set of `choiceCount` choices for one question. Avoids putting
// flags from the same LOOKALIKES group together. Falls back to allowing
// the lookalikes only when the pool is too small to fill the slots
// otherwise.
/**
 * @template {{ code: string }} T
 * @param {T[]} pool
 * @param {T} answer
 * @param {number} choiceCount
 * @returns {T[]}
 */
function buildChoices(pool, answer, choiceCount) {
  const exclude = new Set(lookalikesOf(answer.code));
  let usable = pool.filter((c) => !exclude.has(c.code));
  if (usable.length < choiceCount - 1) {
    // Tiny pool: allow lookalikes rather than fail. Still exclude the
    // answer itself so we don't pick it twice.
    usable = pool.filter((c) => c.code !== answer.code);
  }
  const distractors = shuffle(usable).slice(0, choiceCount - 1);
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
// here is the display order in the menu.
/** @type {Record<string, Variant>} */
export const VARIANTS = {
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
  countries: {
    label: 'All countries',
    filter: (c) => c.category === 'country',
  },
  all: {
    label: 'All flags',
    filter: () => true,
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
