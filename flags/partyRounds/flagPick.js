import { pickQuestion } from '../quiz.js';

/**
 * The "flag pick" round: "Which flag is X?" — the prompt names the target
 * country, the options are four flags (country codes), and the answer is the
 * target's own code. Distractors are lookalike-aware because generation
 * reuses the quiz question builder (`flags/quiz.js` `pickQuestion`).
 *
 * This module is a *round plug-in*: it satisfies the round contract described
 * in `PARTY.md` — `generate(pool)` produces the question, `isCorrect(question,
 * choice)` judges a buzz. The room (`flags/partyRoom.js`) stays round-agnostic
 * and never imports this file; the server resolves correctness through it and
 * hands the boolean to the room.
 *
 * Note: for flag-pick the prompt necessarily names the target country, so the
 * "answer withheld from clients" principle only hides the *option order* — a
 * client rendering flags by code could match them itself. That's acceptable
 * for a friends-in-a-room party game (nobody is reading WebSocket frames), and
 * the withholding matters more for later rounds like Superlative where the
 * answer isn't derivable from what's shown.
 */

/** @typedef {{ code: string }} PoolEntry */
/** @typedef {{ prompt: string, options: string[], answer: string }} Question */

export const id = 'flagPick';

/**
 * @param {PoolEntry[]} pool
 * @param {Set<string>} [exclude] answer codes already used this game, so a
 *   round doesn't repeat a country. Falls back to the full pool if excluding
 *   would leave too few to build a question.
 * @returns {Question}
 */
export function generate(pool, exclude) {
  const usable = exclude && exclude.size ? pool.filter((c) => !exclude.has(c.code)) : pool;
  const src = usable.length >= 4 ? usable : pool;
  const { answer, choices } = pickQuestion(src, 4);
  return {
    prompt: answer.code,
    options: choices.map((c) => c.code),
    answer: answer.code,
  };
}

/**
 * @param {{ answer: string }} question
 * @param {string} choice the chosen option's country code
 * @returns {boolean}
 */
export function isCorrect(question, choice) {
  return choice === question.answer;
}
