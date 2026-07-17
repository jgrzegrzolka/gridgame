import { isSovereignFlag, isNonSovereignFlag } from './flagPools.js';
import { CONTOUR_CODE_SET } from './contourPool.js';

const QUIZ_LAST_VARIANT_KEY = 'gridgame.flagquiz.lastVariant';
const QUIZ_SHOW_MAP_KEY = 'gridgame.flagquiz.showMap';

/**
 * Per-device preference for showing the flagQuiz contour map.
 * **Defaults to true** — every variant has a map now, so the default
 * surface is "map on" and the toggle is an opt-out.
 *
 * Storage convention:
 *   - `'true'` or **missing** → show map (default-on for new players
 *     and for players who explicitly opted in pre-rollout).
 *   - `'false'`               → hide map (explicit opt-out).
 *
 * We can't use `readBoolSetting` here because that returns false-on-
 * missing — which would make the toggle off-by-default for every
 * player without any saved preference.
 *
 * @param {{ getItem(key: string): string | null } | null | undefined} [store]
 */
export function isQuizShowMap(store) {
  const s = store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  if (!s) return true;
  try {
    return s.getItem(QUIZ_SHOW_MAP_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Writes the literal `'true'` / `'false'` (not `removeItem` on false)
 * so an explicit opt-out persists. Otherwise a player who toggled the
 * map off would see it come back on the next visit, because missing
 * key now reads as default-on.
 *
 * @param {{ setItem(key: string, value: string): void }} store
 * @param {boolean} value
 */
export function setQuizShowMap(store, value) {
  if (!store) return;
  try {
    store.setItem(QUIZ_SHOW_MAP_KEY, value ? 'true' : 'false');
  } catch { /* ignore */ }
}

/**
 * Last variant the player started a quiz with. Returned only when the
 * stored key still names a known variant — if VARIANTS is later renamed
 * or pruned, a stale key returns null and the caller falls back to its
 * own default. Returning null (rather than 'countries') keeps "is there
 * a saved pick?" answerable by the caller, which the first-visit
 * onboarding work in phase 2 will need.
 *
 * @param {{ getItem(key: string): string | null } | null | undefined} [store]
 * @returns {string | null}
 */
export function getQuizLastVariant(store) {
  const s = store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  if (!s) return null;
  const raw = s.getItem(QUIZ_LAST_VARIANT_KEY);
  if (raw === null) return null;
  return Object.prototype.hasOwnProperty.call(VARIANTS, raw) ? raw : null;
}

/**
 * Persist the player's current variant pick so the next visit lands on
 * it. Silently ignores unknown keys — better than poisoning localStorage
 * with a value that getQuizLastVariant would then reject every load.
 *
 * @param {{ setItem(key: string, value: string): void }} store
 * @param {string} key
 */
export function setQuizLastVariant(store, key) {
  if (!Object.prototype.hasOwnProperty.call(VARIANTS, key)) return;
  store.setItem(QUIZ_LAST_VARIANT_KEY, key);
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
 * @property {'flag' | 'contour'} [art] What the choice tiles are made of.
 *   Absent means 'flag' — true of every deck but Outlines, so the default
 *   keeps the common case quiet. Read via `artKindFor` / `artBaseFor`, never
 *   directly, so the fallback lives in one place.
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
 * @returns {{
 *   total: number,
 *   next: () => { answer: T, choices: T[] } | null,
 *   peek: () => { answer: T, choices: T[] } | null,
 *   addToCabinet: (answer: T) => void,
 * }}
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
  // Eagerly materialise every question up front so peek() can return
  // the next one without consuming. The page uses peek() to warm the
  // next round's flag SVGs while the player is still answering the
  // current question, replacing the old "fire 200 requests at game
  // start" strategy with just-in-time prefetch.
  const queue = shuffle(pool).slice(0, count).map((answer) => ({
    answer,
    choices: buildChoices(pool, answer, choiceCount),
  }));
  /**
   * "Cabinet" — queue of missed answers re-presented after the main
   * queue exhausts. 60s timed mode is one-shot per question (no retry
   * in-place); the cabinet lets a player who finishes the pool with
   * time left revisit their misses. FIFO; one revisit per miss (cabinet
   * answers that go wrong again aren't re-cabined — that would be an
   * infinite loop on a player who can't recognise a flag).
   *
   * Choices are rebuilt fresh from the pool so the distractors differ
   * from the first ask — keeps the revisit a recognition exercise, not
   * a memory test of "the four flags I saw together earlier."
   *
   * `total` doesn't grow with cabinet pushes — it stays the original
   * pool count. Callers that compute progress against `total` (count
   * mode's progress bar) need to handle the "over 100%" case if they
   * adopt the cabinet; timed mode uses a countdown bar instead and is
   * unaffected.
   *
   * @type {Array<{ answer: T, choices: T[] }>}
   */
  const cabinet = [];
  return {
    total: count,
    next() {
      return queue.shift() ?? cabinet.shift() ?? null;
    },
    peek() {
      return queue[0] ?? cabinet[0] ?? null;
    },
    /** @param {T} answer */
    addToCabinet(answer) {
      cabinet.push({
        answer,
        choices: buildChoices(pool, answer, choiceCount),
      });
    },
  };
}

/**
 * Every variant owns its **whole** pool: its filter runs over the raw loaded
 * country list and decides sovereignty itself.
 *
 * This used to be split — the filters narrowed by continent only, and scope
 * (sovereign vs include-everything) was applied upstream at fetch time via
 * `flagsGamePool`, so the include-territories toggle could widen every
 * variant at once. Feature V deleted that toggle, and the split with it: the
 * `weird` deck's pool is not a *subset* of the sovereign pool, it's the
 * complement, so no upstream scope could express it. Self-contained filters
 * make it an ordinary variant instead of a special case.
 *
 * Insertion order is display order — `menu.js` iterates `Object.entries`.
 *
 * @type {Record<string, Variant>}
 */
export const VARIANTS = {
  countries: {
    label: 'All countries',
    filter: isSovereignFlag,
  },
  europe: {
    label: 'Europe',
    filter: (c) => isSovereignFlag(c) && c.continent === 'Europe',
  },
  asia: {
    label: 'Asia',
    filter: (c) => isSovereignFlag(c) && c.continent === 'Asia',
  },
  africa: {
    label: 'Africa',
    filter: (c) => isSovereignFlag(c) && c.continent === 'Africa',
  },
  'north-america': {
    label: 'North America',
    filter: (c) => isSovereignFlag(c) && c.continent === 'North America',
  },
  'south-america': {
    label: 'South America',
    filter: (c) => isSovereignFlag(c) && c.continent === 'South America',
  },
  oceania: {
    label: 'Oceania',
    filter: (c) => isSovereignFlag(c) && c.continent === 'Oceania',
  },
  // Feature V. The non-sovereign pool as its own deck, replacing the old
  // "include territories & other flags" toggle. It reuses Flag Party's
  // curated predicate rather than raw "not sovereign": that drops
  // organisations (EU / UN / ASEAN aren't places) and the codes whose flag
  // *is* their parent's, which is what made the old toggle able to ask
  // "Which flag is Réunion?" and offer the French tricolour.
  //
  // Last in the object because insertion order is display order — the menu
  // and the picker both iterate `Object.entries(VARIANTS)`.
  weird: {
    label: 'Weird flags',
    filter: isNonSovereignFlag,
  },
  // Feature V Phase 3. The same question as every other deck — "which of
  // these is Italy?" — but the choices are contour silhouettes, so this is
  // the first variant whose ART differs from the flags everything else
  // deals. `art` is what the renderer reads to pick an asset directory.
  //
  // World-only, and that isn't a simplification: contour coverage is
  // microstate-shaped. 157 of 195 sovereigns have one; the 38 without are
  // every microstate and island nation plus Russia. Per continent that's
  // Oceania 3/14 — a dead deck — and North America 14/23 with the whole
  // Caribbean missing. A world pool of 157 has none of those problems.
  outlines: {
    label: 'Outlines',
    filter: (c) => isSovereignFlag(c) && CONTOUR_CODE_SET.has(c.code),
    art: 'contour',
  },
};

/**
 * What a variant's choice tiles are made of: 'flag' (every deck but one) or
 * 'contour'.
 *
 * Declared on the variant rather than derived at each call site, because two
 * places need it (the tile renderer and its prefetch) and a third will when
 * Facts lands. Unknown variants fall back to 'flag' so a stale `?v=` renders
 * something rather than 404ing on a directory that doesn't exist.
 *
 * @param {string} variantKey
 * @returns {string}
 */
export function artKindFor(variantKey) {
  const v = VARIANTS[variantKey];
  return (v && v.art) ? v.art : 'flag';
}

/**
 * The asset directory for a variant's choice tiles, relative to a page one
 * level under the root (which is every game page).
 *
 * @param {string} variantKey
 * @returns {string}
 */
export function artBaseFor(variantKey) {
  return artKindFor(variantKey) === 'contour' ? '../flags/contours/' : '../flags/svg/';
}

/**
 * Which variants get a global leaderboard (and the Cosmos writes that feed
 * it). The player base is too small to spread a competitive board across
 * every variant × mode — the per-continent boards sat empty, and each finish
 * still cost a Free-tier Cosmos write. So leaderboards are limited to the
 * flagship "All countries" variant: the two live boards are countries ×
 * {60s, all}. (It was four before Feature V, when the include-territories
 * toggle split each board by scope; that scope segment is gone.) Every other
 * deck, `weird` included, keeps its local personal bests via `recordResult`
 * and simply never writes or shows a global board.
 *
 * @param {string} variantKey
 * @returns {boolean}
 */
export function variantHasLeaderboard(variantKey) {
  return variantKey === 'countries';
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
 * 4 seconds. Round ends when the remaining budget hits zero OR the pool
 * exhausts — score is the number of flags answered correctly.
 *
 * `all` is the original endurance mode: play through every flag in the
 * pool. Score is the percentage correct.
 *
 * @type {Record<string, Mode>}
 */
export const MODES = {
  '60s': { kind: 'timed', budgetMs: 60_000, penaltyMs: 4_000 },
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
 * Whether the stored time for a best result is worth displaying for this mode.
 *
 *   - Timed (60s) mode: time only matters when the user finished the pool
 *     before the clock ran out (best.time < budgetMs). Otherwise the time is
 *     exactly the budget, which the mode label already conveys — showing
 *     "1:00.000" everywhere is noise.
 *   - Count modes (all): the user finished when they finished; the time
 *     always carries information.
 *
 * Used by both the end-of-round screen and the stats list so the gating
 * stays in lockstep — they used to have separate inline `poolExhausted`
 * checks.
 *
 * @param {string} modeKey
 * @param {{ time: number }} best
 * @returns {boolean}
 */
export function shouldShowBestTime(modeKey, best) {
  const def = MODES[modeKey];
  if (!def) return false;
  if (def.kind !== 'timed') return true;
  return best.time < def.budgetMs;
}

/**
 * Player-facing label for a best score. Both modes now render as
 * `correct/target` so the achievement reads against the pool ceiling
 * the same way regardless of mode:
 *
 *   - Timed mode: `best.score` is already the correct count.
 *   - Count modes: `best.score` is mistakes count, so correct = target - score.
 *     Clamped at 0 to keep old scores from the multi-attempt-per-question
 *     era (where wrongCount could exceed the pool size) from rendering
 *     as negative.
 *
 * @param {string} modeKey
 * @param {{ score: number }} best
 * @param {number} target
 * @returns {string}
 */
export function formatBestScoreLabel(modeKey, best, target) {
  if (isTimedMode(modeKey)) return `${best.score}/${target}`;
  return `${Math.max(0, target - best.score)}/${target}`;
}

/**
 * Fraction of a count-mode round that's been completed. Each click
 * advances the round (one-shot per question), so progress tracks BOTH
 * correct and wrong picks — forgetting to count wrongCount here freezes
 * the visible bar on rounds where the player gets things wrong, which
 * is exactly the regression this helper is meant to pin.
 *
 * Returned value is clamped to [0, 1] so a defensive caller multiplying
 * by 100 for a CSS width can never produce a percentage outside that
 * range. Empty pools return 1 ("100% complete") because there's nothing
 * left to do.
 *
 * @param {number} answeredCount
 * @param {number} wrongCount
 * @param {number} target
 * @returns {number}
 */
export function countModeProgressRatio(answeredCount, wrongCount, target) {
  if (target <= 0) return 1;
  return Math.min(1, (answeredCount + wrongCount) / target);
}

/**
 * Compute the final mistakes count when the player gives up mid-round.
 *
 *   - Timed mode: nothing to penalise — the round was racing the clock,
 *     not aiming for completion. Return wrongCount unchanged so the
 *     result still reflects "correct picks in the time you spent".
 *   - Count mode (one-shot per question, so answered + wrongCount =
 *     questions seen): everything you didn't answer counts as a mistake,
 *     leaving the result page reading "answeredCount / target" — exactly
 *     the score you walked away with, unattempted questions discounted.
 *
 * @param {{ modeKey: string, target: number, answeredCount: number, wrongCount: number }} args
 * @returns {number} the wrongCount to store / display
 */
export function mistakesAfterGiveUp({ modeKey, target, answeredCount, wrongCount }) {
  if (isTimedMode(modeKey)) return wrongCount;
  return target - answeredCount;
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
 * Resolve which mode to play given an optional URL hint and a pool
 * size. Returns the URL hint when it names a mode that's actually
 * available for the variant's pool — otherwise falls back to the
 * variant's default. Returns null when the pool is too small for any
 * mode at all (matching defaultModeFor's "no viable mode" signal).
 *
 * Used in two places that previously duplicated the expression:
 * `flagQuiz/page.js` (deciding the mode for the about-to-start game)
 * and `flagQuiz/menu.js`'s first-visit picker (building the href on
 * each tile). De-duplicating the rule keeps both call sites
 * trivially in sync — e.g. the picker preserving `?n=60s` from the
 * home tile when the pool supports it.
 *
 * @param {string | null} urlMode
 * @param {number} poolSize
 * @returns {string | null}
 */
export function resolveMode(urlMode, poolSize) {
  if (urlMode && availableModes(poolSize).includes(urlMode)) return urlMode;
  return defaultModeFor(poolSize);
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
 * Feature V dropped the trailing `.all` segment along with the
 * include-territories toggle. The sovereign form — which is what every real
 * PB is stored under — is **byte-identical** before and after, so no
 * migration is needed here: existing bests keep loading. The old
 * `.all`-suffixed keys simply become unreachable, a few dead bytes in
 * localStorage. `weird` gets its own fresh slot like any other variant.
 *
 * @param {string} variantKey
 * @param {string} modeKey
 * @returns {string}
 */
export function bestKey(variantKey, modeKey) {
  // The `all` mode swapped its `Result.score` semantics from "percentage
  // correct, higher wins" to "mistakes count, lower wins". Add a `.v2`
  // segment so old percentage-shaped entries don't get reloaded and
  // misinterpreted as monstrous mistake counts (e.g. `95` reading as 95
  // mistakes out of a 269-flag pool). 60s and grid keys are unaffected
  // — they always stored a count.
  return modeKey === 'all'
    ? `flagquiz.best.${variantKey}.${modeKey}.v2`
    : `flagquiz.best.${variantKey}.${modeKey}`;
}

/**
 * @param {BestStore} store
 * @param {string} variantKey
 * @param {string} modeKey
 * @param {Result} current
 * @param {ScoreComparator} [scoreBetter]
 * @returns {{ best: Result, isNew: boolean }}
 */
export function recordResult(store, variantKey, modeKey, current, scoreBetter) {
  const key = bestKey(variantKey, modeKey);
  const outcome = nextBest(loadBest(store, key), current, scoreBetter);
  if (outcome.isNew) saveBest(store, key, outcome.best);
  return outcome;
}

/**
 * Pick a celebration tier from a game-end state. Shared across daily,
 * findFlag, and both quiz modes so every "you finished" moment reads
 * the same way to the player.
 *
 * The rule:
 * - `none`      — you found nothing, OR you walked away mid-round
 *                 (prematurelyGaveUp). Celebrating either feels wrong.
 * - `confetti`  — you found something, but neither a clean sweep nor a
 *                 personal best. Recognises effort without overselling.
 * - `fireworks` — clean sweep OR new personal best. The big-moment cue;
 *                 confetti is *not* layered on top, so the rare event
 *                 has its own distinct visual.
 *
 * Modes:
 * - Daily / findFlag pass `isNew: false` (no record tracking) and
 *   `isTimed: false` — sweep → fireworks, partial → confetti. They
 *   do NOT set `prematurelyGaveUp` because give-up is the normal way
 *   to finish a round there ("I'm done looking, count what I have"),
 *   not a premature exit.
 * - Quiz untimed passes the actual `isNew` plus `isTimed: false` —
 *   sweep OR record → fireworks. Sets `prematurelyGaveUp: true` when
 *   the player clicks Give up before the pool is exhausted, because in
 *   quiz the natural end is finishing the round; walking away is.
 * - Quiz 60s passes `isTimed: true` so the sweep branch is suppressed
 *   (every timed run is inherently "complete" when the budget runs out;
 *   the brag-worthy event there is beating your prior best, not
 *   answering all the questions). Also passes `prematurelyGaveUp` for
 *   the same reason as untimed quiz.
 *
 * Returns both the tier and an `intensity` in [0, 1]. Intensity is what
 * scales the confetti burst so 1/10 found feels noticeably smaller than
 * 9/10 — the percentage-of-found maps directly onto particle density. For
 * `fireworks` (and the timed-mode `confetti` branch, where `total` isn't
 * meaningful) intensity is 1 so the spectacle stays at its full size.
 *
 * @param {{ found: number, total: number, isNew?: boolean, isTimed?: boolean, prematurelyGaveUp?: boolean }} params
 * @returns {{ tier: 'none' | 'confetti' | 'fireworks', intensity: number }}
 */
export function pickCelebration({ found, total, isNew = false, isTimed = false, prematurelyGaveUp = false }) {
  if (prematurelyGaveUp) return { tier: 'none', intensity: 0 };
  if (found === 0) return { tier: 'none', intensity: 0 };
  if (isNew) return { tier: 'fireworks', intensity: 1 };
  if (!isTimed && found === total) return { tier: 'fireworks', intensity: 1 };
  // Partial confetti: ratio of found/total, clamped. Timed mode has no
  // meaningful `total` so it gets the full burst — the brag-worthy
  // event there is the record, not the count.
  const intensity = isTimed || total <= 0 ? 1 : Math.max(0, Math.min(1, found / total));
  return { tier: 'confetti', intensity };
}

/**
 * Decide how the "You found X / Y" result line should render. On a clean
 * sweep we collapse to "You found all" and hide the count — at 124/124
 * the fraction is redundant noise. Any other outcome (including 0) keeps
 * the count so the player sees what they accomplished.
 *
 * Shared by findFlag and daily, which both render the same line over the
 * same markup; tic-tac-toe and quiz use different score semantics and
 * don't go through this helper.
 *
 * @param {number} found
 * @param {number} total
 * @returns {{ prefixKey: 'findFlag.youFoundAll' | 'findFlag.youFound', showFraction: boolean }}
 */
export function pickFinalScoreLine(found, total) {
  const allFound = total > 0 && found === total;
  return {
    prefixKey: allFound ? 'findFlag.youFoundAll' : 'findFlag.youFound',
    showFraction: !allFound,
  };
}
