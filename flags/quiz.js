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
  const choices = shuffle(countries).slice(0, choiceCount);
  const answer = choices[Math.floor(Math.random() * choiceCount)];
  return { answer, choices };
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
      const distractors = shuffle(pool.filter((c) => c.code !== answer.code))
        .slice(0, choiceCount - 1);
      return { answer, choices: shuffle([answer, ...distractors]) };
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

// How many questions a given variant should ask. Continents and "Others"
// run through every flag in the pool; the two pan-pool variants are
// capped so the game stays finite.
export const BIG_VARIANT_TARGET = 40;
const BIG_VARIANTS = new Set(['countries', 'all']);

/**
 * @param {string} variantKey
 * @param {{ length: number }} pool
 * @returns {number}
 */
export function targetFor(variantKey, pool) {
  if (!VARIANTS[variantKey]) {
    throw new Error(`Unknown variant: ${variantKey}`);
  }
  return BIG_VARIANTS.has(variantKey)
    ? Math.min(BIG_VARIANT_TARGET, pool.length)
    : pool.length;
}
