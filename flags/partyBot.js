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
  // Every window starts after its own skill's flag-pick window ENDS (pinned by
  // test), so "the bot is slower here" holds at every difficulty rather than only
  // on average. The ceiling is the other constraint: a question ends when every
  // seat has buzzed, so a slow bot is time the human spends waiting — which is
  // why easy tops out at 14 s rather than being scaled as far as the 20 s clock
  // would technically allow.
  spotFlag: {
    easy: { delayMinMs: 9500, delayMaxMs: 14000 },
    medium: { delayMinMs: 6500, delayMaxMs: 12000 },
    hard: { delayMinMs: 3500, delayMaxMs: 9500 },
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
 * @param {{ options: string[], answer: string, questionId?: string }} question  the
 *   full question, including the server-held `answer` (never sent to clients).
 *   `questionId` selects the delay window — see {@link QUESTION_PACE}.
 * @param {string} skill  a BOT_SKILLS id; coerced if unknown
 * @param {() => number} [rng]  returns [0, 1); defaults to Math.random
 * @returns {{ choice: string, delayMs: number }}
 */
export function decideBuzz(question, skill, rng = Math.random) {
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
  const window = delayWindowFor(question.questionId, validateBotSkill(skill));
  const span = window.delayMaxMs - window.delayMinMs;
  const delayMs = Math.round(window.delayMinMs + rng() * span);
  return { choice, delayMs };
}
