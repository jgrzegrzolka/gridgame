/**
 * Flag Party bot — decides how an automated seat plays one question. Pure and
 * self-contained: no DOM, no timers, no room. The server
 * (`party/partyGameServer.js`) owns the seat, the actual `setTimeout` that fires
 * the buzz, and resolving correctness via the question's `isCorrect`; this module
 * only answers "what would a bot at this skill pick, and how long would it wait".
 * Keeping it a pure function is what lets the accuracy distribution and reaction
 * timing be unit-tested with a seeded rng.
 *
 * A bot is fully described by two dials, and a skill level is a named preset over
 * them:
 *  - **accuracy** — probability it picks the correct answer (else a random other
 *    option on the board).
 *  - **delay** — how long before it buzzes, drawn uniformly in `[delayMinMs,
 *    delayMaxMs]`. This is what decides whether it beats a human to the
 *    first-correct speed bonus.
 * Both are rolled **per question**, so a bot is never perfectly predictable: a
 * Hard bot still occasionally whiffs, and an Easy bot occasionally nails a fast
 * one. The delay ranges all sit comfortably inside the question window
 * (`QUESTION_SECONDS`, 20 s) so a bot always answers before the clock forces the
 * reveal.
 */

import { QUESTION_SECONDS, DEFAULT_REVEAL, revealCategoryFor, veilActive } from './partyTiming.js';

/**
 * @typedef {{ accuracy: number, delayMinMs: number, delayMaxMs: number }} BotSkill
 */

/**
 * The difficulty presets. Numbers are the starting balance (Jan, 2026-07-22),
 * tuned to feel like:
 *  - easy   — you'll usually win (half-right, slow)
 *  - medium — a real race (mostly right, mid-pace)
 *  - hard   — punishes hesitation (near-always right, fast)
 * @type {Record<string, BotSkill>}
 */
export const BOT_SKILLS = {
  easy: { accuracy: 0.5, delayMinMs: 6000, delayMaxMs: 9000 },
  medium: { accuracy: 0.75, delayMinMs: 3000, delayMaxMs: 6000 },
  hard: { accuracy: 0.9, delayMinMs: 1000, delayMaxMs: 3000 },
};

/**
 * Per-question overrides of the delay window, because {@link BOT_SKILLS} above is
 * calibrated for ONE task: read a country name, find its flag among four. A bot
 * has no such task — it is handed the answer — so its delay is not a simulation
 * of anything, it is a handicap chosen to sit where a human's time lands. When
 * the question asks something slower of a person, the same delay stops being a
 * race and becomes a formality.
 *
 * **spot-the-flag** is that case. The player is given three criteria and four
 * tiles, and has to check every tile against all three before they can even start
 * choosing — where a flag-pick question is one recognition. On the base windows a
 * Hard bot buzzes at 1-3 s while a person is still reading clause two, and there
 * is no speed the human could have played at to win. These windows are both
 * later and deliberately WIDER: the task has more variance for a person (a lucky
 * first tile versus checking all four), so the bot's arrival should have more
 * variance too, or it becomes a metronome you either always beat or never do.
 *
 * Everything absent from this table keeps its {@link BOT_SKILLS} window. Accuracy
 * is never overridden here — only when the bot arrives, never whether it is right.
 *
 * @type {Record<string, Record<string, { delayMinMs: number, delayMaxMs: number }>>}
 */
export const QUESTION_PACE = {
  // Numbers are Jan's call (2026-07-23). Each window is later at BOTH ends than
  // its own skill's flag-pick window and wider than it (pinned by test), but the
  // two OVERLAP on purpose: a Hard bot can occasionally arrive at 2.5 s, quicker
  // than its own flag-pick worst case. That is the intended read — usually slower
  // here, occasionally as quick as it would have been on an easier question — and
  // it keeps Hard a real race for a strong player (a 4 s answer wins two in three)
  // rather than a bot that only turns up once you have already won.
  //
  // The ceiling is the other constraint: a question ends when every seat has
  // buzzed, so a slow bot is time the human spends waiting. Easy tops out at 13 s
  // rather than being scaled as far as the 20 s clock would technically allow.
  spotFlag: {
    easy: { delayMinMs: 6500, delayMaxMs: 13000 },
    medium: { delayMinMs: 4000, delayMaxMs: 9000 },
    hard: { delayMinMs: 2500, delayMaxMs: 7000 },
  },
};

/** The skill a bot gets when none (or an unknown one) is asked for. */
export const DEFAULT_BOT_SKILL = 'medium';

/**
 * The delay window to draw from: the question's own override if it has one, else
 * the skill's base window.
 *
 * @param {unknown} questionId  the question's id (absent on older payloads)
 * @param {string} skill  an already-validated BOT_SKILLS id
 * @returns {{ delayMinMs: number, delayMaxMs: number }}
 */
export function delayWindowFor(questionId, skill) {
  const byQuestion = typeof questionId === 'string'
    ? Object.prototype.hasOwnProperty.call(QUESTION_PACE, questionId) && QUESTION_PACE[questionId]
    : null;
  return (byQuestion && byQuestion[skill]) || BOT_SKILLS[skill];
}

/**
 * How clear a veiled tile has to be before a bot will answer, as a fraction of
 * the way to full clarity.
 *
 * On a veiled round ("Covered start") the tiles begin hidden and clear over the
 * clock, reaching full clarity at `clearFrac` of the question window — 16 s of
 * 20 for a flag round, 8 s for outlines. A bot is handed the answer, so nothing
 * about the veil slows it down: before this, a Hard bot buzzed at 1-3 s while
 * every human was still looking at a grey square, and **no player could win the
 * speed bonus on a veiled round at any difficulty**. The veil was a handicap
 * applied to exactly one side.
 *
 * So a bot now waits until a person of its calibre could plausibly have seen the
 * flag, then takes its ordinary reaction time on top. The better the bot, the
 * more obscured a tile it can read — which is the same thing that makes it good.
 *
 * These fractions are a judgement call, not a measurement; they are the dial to
 * turn if veiled rounds feel wrong.
 * @type {Record<string, number>}
 */
export const VEIL_SIGHT = { easy: 0.65, medium: 0.55, hard: 0.45 };

/**
 * The latest a veiled buzz may land. The veil pushes every window later, and on
 * a flag round at Easy the sum runs past the 20 s clock — a bot that never buzzed
 * would leave the question to time out. Capping here means an Easy bot on a
 * veiled flag round often answers at the wire, which is the honest outcome: it
 * genuinely cannot read the tile much before then.
 */
export const VEIL_CEILING_MS = 18000;

/**
 * How long into a veiled question this bot can first see the tiles, in ms.
 * Zero for any question that is not veiled — including every statistics question,
 * where {@link veilActive} refuses the veil outright.
 *
 * @param {{ questionId?: string, clearFrac?: number }} question
 * @param {string} skill  an already-validated BOT_SKILLS id
 * @param {boolean} tricky  the room's veil setting for this round
 * @param {number} [questionMs]  the question window; defaults to the real clock
 * @returns {number}
 */
export function veilSightMs(question, skill, tricky, questionMs = QUESTION_SECONDS * 1000) {
  if (!veilActive(tricky, question.questionId)) return 0;
  // `clearFrac` is stamped on the question server-side; fall back to the category
  // default so an older payload can't make the bot behave as if unveiled.
  const clearFrac = typeof question.clearFrac === 'number'
    ? question.clearFrac
    : DEFAULT_REVEAL[revealCategoryFor(String(question.questionId))];
  return Math.round(questionMs * clearFrac * (VEIL_SIGHT[skill] ?? 0));
}

/** Skill ids in difficulty order — the order the lobby lists them. */
export const BOT_SKILL_ORDER = /** @type {const} */ (['easy', 'medium', 'hard']);

/**
 * Coerce an untrusted skill (off the wire, from an older client, or absent) to a
 * known preset, so a malformed value can never reach the scheduler as `undefined`.
 * @param {unknown} skill
 * @returns {string}
 */
export function validateBotSkill(skill) {
  return typeof skill === 'string' && Object.prototype.hasOwnProperty.call(BOT_SKILLS, skill)
    ? skill
    : DEFAULT_BOT_SKILL;
}

/**
 * Decide a bot's buzz for one question: which option it taps and after how long.
 *
 * Correctness is NOT decided here — the server resolves it with the question's
 * `isCorrect`, exactly as it does for a human buzz. This only chooses an option:
 * with probability `accuracy` it taps the real answer, otherwise a uniformly
 * random *other* option on the board (which the server will then score as wrong,
 * or as a near miss on a ranked world-facts question — realistic either way).
 *
 * `rng` is consumed in a fixed order — accuracy roll, then wrong-pick index (only
 * when wrong), then delay — so a seeded rng makes the whole decision reproducible
 * in tests.
 *
 * @param {{ options: string[], answer: string, questionId?: string, clearFrac?: number }} question
 *   the full question, including the server-held `answer` (never sent to
 *   clients). `questionId` selects the delay window — see {@link QUESTION_PACE} —
 *   and `clearFrac` times the veil.
 * @param {string} skill  a BOT_SKILLS id; coerced if unknown
 * @param {() => number} [rng]  returns [0, 1); defaults to Math.random
 * @param {{ tricky?: boolean }} [opts]  room state the decision needs: `tricky` is
 *   the veil setting for this round (see {@link VEIL_SIGHT}). Absent = unveiled.
 * @returns {{ choice: string, delayMs: number }}
 */
export function decideBuzz(question, skill, rng = Math.random, opts = {}) {
  const cfg = BOT_SKILLS[validateBotSkill(skill)];
  const options = Array.isArray(question.options) ? question.options : [];
  const answer = question.answer;

  const wantsCorrect = rng() < cfg.accuracy;
  let choice = answer;
  if (!wantsCorrect) {
    const others = options.filter((o) => o !== answer);
    if (others.length > 0) {
      // Clamp guards the rng() === 1 edge (Math.random never returns it, but a
      // test rng might): an index of others.length would be undefined.
      const i = Math.min(others.length - 1, Math.floor(rng() * others.length));
      choice = others[i];
    }
    // No other option to pick (a degenerate one-option board) — fall back to the
    // answer rather than buzzing nothing.
  }

  // Drawn LAST, after the accuracy roll and any wrong-pick index, so the rng
  // order the doc promises still holds with the window now question-dependent.
  const validSkill = validateBotSkill(skill);
  const window = delayWindowFor(question.questionId, validSkill);
  const span = window.delayMaxMs - window.delayMinMs;
  const drawn = window.delayMinMs + rng() * span;
  // The veil pushes the whole window back by the time it takes this bot to see
  // the tiles — its reaction is unchanged, it just starts later, exactly as a
  // human's does. Capped so a veiled Easy bot still buzzes before the clock.
  const sight = veilSightMs(question, validSkill, opts.tricky === true);
  const delayMs = Math.round(Math.min(sight + drawn, sight > 0 ? VEIL_CEILING_MS : Infinity));
  return { choice, delayMs };
}
