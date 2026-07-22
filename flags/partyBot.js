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

/** The skill a bot gets when none (or an unknown one) is asked for. */
export const DEFAULT_BOT_SKILL = 'medium';

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
 * @param {{ options: string[], answer: string }} question  the full question,
 *   including the server-held `answer` (never sent to clients)
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

  const span = cfg.delayMaxMs - cfg.delayMinMs;
  const delayMs = Math.round(cfg.delayMinMs + rng() * span);
  return { choice, delayMs };
}
