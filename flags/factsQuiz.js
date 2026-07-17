/**
 * The Facts deck's question source: "Most forest cover?" over four flags.
 *
 * Wears the same shape as `createQuiz` (`total` / `next` / `peek` /
 * `addToCabinet`) so `flagQuiz/page.js` drives it through the identical loop —
 * the page renders `q.choices` as flag tiles and scores `chosen.code ===
 * q.answer.code` exactly as it does for every other deck. Only the prompt
 * differs, and the page reads that off `q.prompt`.
 *
 * **Why it can't just BE `createQuiz`.** `createQuiz` materialises one question
 * per pool entry up front: the pool is the question list, and you play through
 * it. Facts has no such list. Each question picks a metric AND a quartet, so the
 * same country can headline several questions (Brazil for coffee, then for
 * area) and the space is metrics × quartets, not countries. That is also exactly
 * why the deck is 60s-only (`VARIANTS.facts.modes`): there is nothing to
 * exhaust, so an endurance run would never end.
 *
 * Questions are therefore generated **lazily**, one at a time, with a one-deep
 * lookahead so `peek()` can warm the next round's flags the way the flag decks'
 * prefetch does.
 *
 * The rules for each metric (which direction to ask, whether a real 0 means "not
 * a candidate") are NOT decided here — they come from `superlativeCatalog.js`
 * via `buildSuperlativeRound`, the same path Flag Party's server takes. This
 * module only picks which metric to ask about next.
 */

import { buildSuperlativeRound } from './partyRounds/superlativeCore.js';
import { hintFor } from './partyRounds/superlativeCatalog.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./partyRounds/superlativeCatalog.js').SuperlativeMetric} SuperlativeMetric */
/** @typedef {import('./partyRounds/superlativeCatalog.js').Hint} Hint */

/**
 * A loaded metric: its catalog entry plus the values file the page fetched.
 * @typedef {{ entry: SuperlativeMetric, data: import('./metrics.js').MetricData }} LoadedMetric
 */

/**
 * @typedef {Object} FactsQuestion
 * @property {Country} answer the country at the extreme
 * @property {Country[]} choices four countries, the answer among them
 * @property {{ metricKey: string, roundId: string, direction: 'most' | 'least', hint: Hint }} prompt
 *   what to ask. `hint` is the criterion label; `metricKey` drives the icon and
 *   hue, the same per-metric identity Flag Party's prompt wears.
 */

/**
 * How many recent answers to keep out of the next quartet. Mirrors Flag Party's
 * per-game `usedCodes`, but bounded: that set covers a 16-round game, whereas a
 * good 60s run can answer ~25 and the pool is 195, so an unbounded exclude would
 * slowly starve the draw and end up rejecting most of the pool. Ten is enough
 * that no country repeats within a stretch you'd notice.
 */
const RECENT_ANSWERS = 10;

/**
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the Facts deck's question source.
 *
 * @param {{
 *   metrics: LoadedMetric[],
 *   pool: Country[],
 *   rng?: () => number,
 * }} args  `pool` must be the sovereign pool — see `VARIANTS.facts`, the
 *   uninhabited-territory zeros make a wider pool answer "Least populous?" with
 *   Bouvet Island.
 * @returns {{
 *   total: number,
 *   next: () => FactsQuestion | null,
 *   peek: () => FactsQuestion | null,
 *   addToCabinet: (answer: Country) => void,
 * }}
 */
export function createFactsQuiz({ metrics, pool, rng = Math.random }) {
  if (metrics.length === 0) throw new Error('createFactsQuiz: no metrics loaded');
  if (pool.length < 4) throw new Error(`createFactsQuiz: need at least 4 countries, got ${pool.length}`);

  const byCode = new Map(pool.map((c) => [c.code, c]));
  const entries = pool.map((c) => ({ code: c.code }));
  // One round per metric, built once. `buildSuperlativeRound` applies the
  // catalog's zero-filter and direction lock — the same call the server makes.
  const rounds = metrics.map((m) => ({
    metric: m.entry,
    round: buildSuperlativeRound(m.entry, m.data),
  }));

  /** Answer codes from the last few questions, so a country doesn't recur. */
  /** @type {string[]} */
  const recent = [];
  /** Metrics not yet asked this round-robin: draw without replacement so a
   *  60-second run sees a spread of the catalog rather than three coffee
   *  questions by luck. Refills (reshuffled) when exhausted. */
  /** @type {typeof rounds} */
  let bag = [];

  function nextMetric() {
    if (bag.length === 0) bag = shuffle(rounds, rng);
    return /** @type {typeof rounds[0]} */ (bag.pop());
  }

  /** @returns {FactsQuestion | null} */
  function generate() {
    const { metric, round } = nextMetric();
    const q = round.generate(entries, new Set(recent), rng);
    const answer = byCode.get(q.answer);
    const choices = q.options.map((code) => byCode.get(code));
    // Every option came out of `entries`, which is built from `pool`, so these
    // lookups always hit. Guard anyway rather than hand the page an undefined
    // tile: a dropped question is recoverable, a broken render isn't.
    if (!answer || choices.some((c) => !c)) return null;
    return {
      answer,
      choices: /** @type {Country[]} */ (choices),
      prompt: {
        metricKey: metric.key,
        roundId: metric.roundId,
        direction: q.prompt,
        hint: hintFor(metric, q.prompt),
      },
    };
  }

  /** @type {FactsQuestion | null} */
  let lookahead = generate();

  return {
    // Not a question count — Facts has no end. The page uses `total` for the
    // count-mode progress bar and the "cleared the pool" leaderboard check,
    // neither of which 60s-only Facts reaches. It's the pool size so anything
    // that does read it sees the honest number of countries in play.
    total: pool.length,
    next() {
      const q = lookahead;
      if (q) {
        recent.push(q.answer.code);
        while (recent.length > RECENT_ANSWERS) recent.shift();
      }
      lookahead = generate();
      return q;
    },
    peek() {
      return lookahead;
    },
    // Facts never exhausts its pool, so the cabinet (the flag decks' "revisit
    // your misses once the queue runs dry") can never be reached. Accepting the
    // call and doing nothing keeps the page's one loop working for every deck.
    addToCabinet() {},
  };
}
