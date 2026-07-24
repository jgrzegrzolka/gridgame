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
 *
 * A skill preset is only the starting point. Three things move it, in this order:
 * the **mode** ({@link MODE_PROFILE} — weird flags and map outlines are harder
 * than sovereign flags, spot-the-flag is easier and slower), the **question**
 * (a statistic's accuracy comes from how far its answer stands out —
 * {@link spreadGapOf}), and the **seat** (a bot that drafted this round plays it
 * a little better — {@link PICKER_BONUS}).
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
 * Per-**mode** overrides of a skill preset, because {@link BOT_SKILLS} above is
 * calibrated for ONE task: read a country name, find a sovereign flag among four.
 * A bot has no such task — it is handed the answer — so its dials are not a
 * simulation of anything, they are a handicap chosen to sit where a human's play
 * lands. A round that asks something different of a person needs different numbers.
 *
 * **Keyed on the mode id, not the question id**, and that distinction is
 * load-bearing: `flags-all` and `flags-weird` are the same `flagPick` question
 * module over different pools (`flags/partyPlan.js`), and they are nowhere near
 * equally hard for a person — everybody knows the French flag, almost nobody knows
 * Wallis and Futuna's. A question-keyed table cannot tell them apart, which is why
 * the server stamps `modeId` on every question it deals.
 *
 * The accuracy ladder across the picture modes, easiest first (Jan, 2026-07-24):
 *   spot-the-flag → flags → weird flags → map outlines.
 *
 *  - **spot-the-flag** is the gentlest question in the show, and it pulls the two
 *    dials in OPPOSITE directions. *Slower*, because the player is given three
 *    criteria and four tiles and has to check every tile against all three before
 *    they can start choosing, where a flag-pick question is one recognition; the
 *    windows are also deliberately WIDER, since the task has more variance for a
 *    person (a lucky first tile versus checking all four) and a bot that arrives
 *    like a metronome is one you either always beat or never do. *More accurate*,
 *    because nothing is being recalled — the answer is on screen and the criteria
 *    are printed next to it. What makes it hard is the time it takes, not the
 *    knowing, and time is the one thing a bot has. An Easy bot getting half of
 *    these wrong read as broken rather than easy.
 *  - **flags-weird** (territories, dependencies, the non-sovereign pool) drops
 *    below the base: these are the flags a person is least likely to have ever
 *    seen, so a bot that hits them at sovereign-flag rates is playing a different
 *    game from everyone else at the table.
 *  - **map-outlines** is the hardest of the four. An outline carries none of the
 *    colour and emblem cues a flag does, and it is the one picture mode where good
 *    players routinely guess.
 *
 * Only `accuracy` moves for the two new entries — the delay windows stay the
 * base's, because how *hard* a round is and how *long* it takes to answer are
 * separate dials and only the first is what makes weird flags weird.
 *
 * Any field may be omitted; whatever is absent falls back to {@link BOT_SKILLS}.
 * Statistics rounds are deliberately absent — their difficulty is per-question,
 * not per-mode; see {@link STAT_ACCURACY}.
 *
 * @type {Record<string, Record<string, { accuracy?: number, delayMinMs?: number, delayMaxMs?: number }>>}
 */
export const MODE_PROFILE = {
  // Numbers are Jan's call (2026-07-23). The windows OVERLAP the base on purpose:
  // a Hard bot can occasionally arrive at 2 s, quicker than its own flag-pick
  // worst case. That is the intended read — usually slower here, occasionally as
  // quick as it would have been on an easier question — and it keeps Hard a real
  // race for a strong player rather than a bot that only turns up once you have
  // already won.
  //
  // The ceiling is the other constraint: a question ends when every seat has
  // buzzed, so a slow bot is time the human spends waiting. Easy tops out at 12 s
  // rather than being scaled as far as the 20 s clock would technically allow.
  'spot-flag': {
    easy: { accuracy: 0.8, delayMinMs: 6000, delayMaxMs: 12000 },
    medium: { accuracy: 0.9, delayMinMs: 4000, delayMaxMs: 8000 },
    // Not 1.0: a Hard bot that never missed would be a different kind of opponent
    // (see the module doc — every skill whiffs sometimes, that is what keeps it
    // from feeling scripted).
    hard: { accuracy: 0.97, delayMinMs: 2000, delayMaxMs: 6500 },
  },
  'flags-weird': {
    easy: { accuracy: 0.35 },
    medium: { accuracy: 0.6 },
    hard: { accuracy: 0.8 },
  },
  'map-outlines': {
    easy: { accuracy: 0.3 },
    medium: { accuracy: 0.52 },
    hard: { accuracy: 0.75 },
  },
};

/**
 * Mode ids for questions dealt without one — a room snapshot written before the
 * server stamped `modeId`, which outlives a deploy in the durable object.
 *
 * Only the modes whose question id identifies them unambiguously are here.
 * `flagPick` is deliberately absent: it is exactly the ambiguity this whole key
 * change exists to resolve, and guessing `flags-all` for an old weird-flags round
 * would hand that round the wrong numbers. Unmapped means the base preset, which
 * is what those rounds already played at before this change.
 * @type {Record<string, string>}
 */
const MODE_BY_QUESTION_ID = {
  spotFlag: 'spot-flag',
  mapPick: 'map-outlines',
};

/**
 * The {@link MODE_PROFILE} key for a question: the mode the server stamped, else
 * whatever its question id unambiguously implies, else null (base preset).
 * @param {{ modeId?: string, questionId?: string }} question
 * @returns {string | null}
 */
export function modeKeyFor(question) {
  if (typeof question.modeId === 'string') return question.modeId;
  const qid = question.questionId;
  return (typeof qid === 'string' && Object.prototype.hasOwnProperty.call(MODE_BY_QUESTION_ID, qid))
    ? MODE_BY_QUESTION_ID[qid]
    : null;
}

/**
 * A statistics round's accuracy range, low gap → high gap (see
 * {@link spreadGapOf}). Ranges rather than points because a world-facts question
 * is the one round whose difficulty is a property of the *question*, not the mode:
 * "which of these produces the most coffee — Brazil, Iceland, Mongolia, Norway"
 * and "…Brazil, Vietnam, Colombia, Indonesia" are the same mode and nothing like
 * the same question.
 *
 * The floors sit below the base preset and the ceilings well above it, so a
 * statistics round is genuinely easier than a flag pick when the answer is out on
 * its own and genuinely harder when the top two are neck and neck — which is the
 * same thing that decides it for a person.
 * @type {Record<string, { min: number, max: number }>}
 */
export const STAT_ACCURACY = {
  easy: { min: 0.4, max: 0.75 },
  medium: { min: 0.6, max: 0.92 },
  hard: { min: 0.78, max: 0.99 },
};

/**
 * How clearly this question's answer stands out from the field, in `[0, 1]`.
 *
 * Deliberately a **fraction of the board's own spread** — how far the answer beats
 * the runner-up, over how far it beats the far end — rather than the value ratio
 * the generator's `GAP_RATIO` gate uses. Two reasons, both fatal to a ratio:
 * several shipped metrics are index scores where a ratio means nothing (a
 * corruption index of 60 is not "1.25× more corrupt" than 48), and average
 * temperature goes **negative**, where a ratio is not merely meaningless but
 * sign-flipped. Subtraction survives both.
 *
 * It also matches what the player actually does: they are not comparing the answer
 * to an absolute scale, they are comparing four tiles to each other. 1 is a
 * runaway, 0 is a coin-flip between the top two.
 *
 * Null for any question that is not a ranked statistic (no `ranking` / `values`),
 * or one whose four options are all equal — the caller falls back to the mode
 * table.
 *
 * @param {{ ranking?: string[], values?: Record<string, number> }} question
 * @returns {number | null}
 */
export function spreadGapOf(question) {
  const ranking = question.ranking;
  const values = question.values;
  if (!Array.isArray(ranking) || ranking.length < 2 || !values) return null;
  const best = values[ranking[0]];
  const runnerUp = values[ranking[1]];
  const farthest = values[ranking[ranking.length - 1]];
  if (typeof best !== 'number' || typeof runnerUp !== 'number' || typeof farthest !== 'number') return null;
  const spread = Math.abs(best - farthest);
  if (!(spread > 0)) return null;
  return Math.min(1, Math.abs(best - runnerUp) / spread);
}

/**
 * The accuracy a statistics question of this clarity deserves at this skill —
 * a straight lerp across {@link STAT_ACCURACY}. Linear, not curved: the curve
 * would be a second dial to explain, and the gap is already a normalised
 * fraction rather than a raw magnitude.
 * @param {number} gap  a {@link spreadGapOf} fraction
 * @param {string} skill  an already-validated BOT_SKILLS id
 * @returns {number}
 */
export function statAccuracyFor(gap, skill) {
  const range = STAT_ACCURACY[skill];
  const t = Math.max(0, Math.min(1, gap));
  return range.min + (range.max - range.min) * t;
}

/**
 * What a bot gains on the round it chose itself.
 *
 * A drafted round is a bet: a person picks the category they know, and the round
 * they picked is the round they are best at. A bot that picked at random and then
 * played the round exactly as it plays every other one is the only seat at the
 * table for which the pick meant nothing — so it gets the edge a picker has,
 * rather than a smarter pick (which would also make it pick the same few modes
 * every game, and drain the variety the draft exists for).
 *
 * Small on purpose: at Medium it turns a 3-in-4 round into roughly a 5-in-6 one,
 * noticeable over five questions without making a bot's own round unwinnable.
 */
export const PICKER_BONUS = 0.08;

/**
 * The hard cap on any accuracy after bonuses. A bot that cannot miss reads as
 * scripted rather than skilled (the same reason Hard spot-the-flag stops at 0.97),
 * so the picker bonus can approach certainty but never reach it.
 */
export const ACCURACY_CEILING = 0.99;

/** The skill a bot gets when none (or an unknown one) is asked for. */
export const DEFAULT_BOT_SKILL = 'medium';

/**
 * This mode's override entry for a skill, or null when it has none.
 * @param {unknown} modeId
 * @param {string} skill  an already-validated BOT_SKILLS id
 */
function profileFor(modeId, skill) {
  const byMode = typeof modeId === 'string'
    && Object.prototype.hasOwnProperty.call(MODE_PROFILE, modeId)
    ? MODE_PROFILE[modeId]
    : null;
  return (byMode && byMode[skill]) || null;
}

/**
 * The delay window to draw from: the mode's own override if it has one, else
 * the skill's base window.
 *
 * @param {unknown} modeId  the round's mode id (absent on older payloads)
 * @param {string} skill  an already-validated BOT_SKILLS id
 * @returns {{ delayMinMs: number, delayMaxMs: number }}
 */
export function delayWindowFor(modeId, skill) {
  const p = profileFor(modeId, skill);
  const base = BOT_SKILLS[skill];
  return {
    delayMinMs: p && typeof p.delayMinMs === 'number' ? p.delayMinMs : base.delayMinMs,
    delayMaxMs: p && typeof p.delayMaxMs === 'number' ? p.delayMaxMs : base.delayMaxMs,
  };
}

/**
 * The chance this bot taps the right answer on a round of this mode: the mode's
 * own override if it has one, else the skill's. The static half of the dial —
 * {@link buzzAccuracy} is what a buzz actually rolls against.
 *
 * @param {unknown} modeId
 * @param {string} skill  an already-validated BOT_SKILLS id
 * @returns {number}
 */
export function accuracyFor(modeId, skill) {
  const p = profileFor(modeId, skill);
  return p && typeof p.accuracy === 'number' ? p.accuracy : BOT_SKILLS[skill].accuracy;
}

/**
 * The accuracy one buzz rolls against: the mode's number, or the question's own
 * where it has one (a statistic scales with how clear its answer is), plus the
 * picker's bonus when this bot chose the round, capped at
 * {@link ACCURACY_CEILING}.
 *
 * The three layers are ordered deliberately. The gap REPLACES the mode number
 * rather than nudging it — a statistics round has no meaningful fixed difficulty
 * to nudge — while the picker bonus ADDS to whatever came out, because it is a
 * property of the seat, not of the question.
 *
 * @param {{ modeId?: string, questionId?: string, ranking?: string[], values?: Record<string, number> }} question
 * @param {string} skill  an already-validated BOT_SKILLS id
 * @param {{ picked?: boolean }} [opts]  `picked` = this bot drafted this round
 * @returns {number}
 */
export function buzzAccuracy(question, skill, opts = {}) {
  const gap = spreadGapOf(question);
  const base = gap === null ? accuracyFor(modeKeyFor(question), skill) : statAccuracyFor(gap, skill);
  const withBonus = opts.picked === true ? base + PICKER_BONUS : base;
  return Math.min(ACCURACY_CEILING, withBonus);
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
 * turn if veiled rounds feel wrong. Softened once already (Jan, 2026-07-23): at
 * 0.45/0.55/0.65 a veiled Hard bot did not arrive until 8.2 s, which over-corrected
 * — the veil should cost the bot roughly what it costs a person, not hand the
 * round to whoever is fastest among the humans. At 0.38 a Hard bot buzzes from
 * 7.1 s, so a sharp player reading the flag at ~40% clarity still gets there
 * first, and a normal one does not.
 * @type {Record<string, number>}
 */
export const VEIL_SIGHT = { easy: 0.55, medium: 0.46, hard: 0.38 };

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
 * @param {{ options: string[], answer: string, modeId?: string, questionId?: string,
 *   clearFrac?: number, ranking?: string[], values?: Record<string, number> }} question
 *   the full question, including the server-held `answer` (never sent to
 *   clients). `modeId` selects both the delay window and the accuracy — see
 *   {@link MODE_PROFILE} — `ranking` / `values` scale a statistic's accuracy to
 *   how clear its answer is, `questionId` times the veil alongside `clearFrac`.
 * @param {string} skill  a BOT_SKILLS id; coerced if unknown
 * @param {() => number} [rng]  returns [0, 1); defaults to Math.random
 * @param {{ tricky?: boolean, picked?: boolean }} [opts]  room state the decision
 *   needs: `tricky` is the veil setting for this round (see {@link VEIL_SIGHT}),
 *   `picked` says this bot drafted this round (see {@link PICKER_BONUS}). Absent
 *   = unveiled, not the picker.
 * @returns {{ choice: string, delayMs: number }}
 */
export function decideBuzz(question, skill, rng = Math.random, opts = {}) {
  const validSkill = validateBotSkill(skill);
  const options = Array.isArray(question.options) ? question.options : [];
  const answer = question.answer;

  const wantsCorrect = rng() < buzzAccuracy(question, validSkill, opts);
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
  // order the doc promises still holds with the window now mode-dependent.
  const window = delayWindowFor(modeKeyFor(question), validSkill);
  const span = window.delayMaxMs - window.delayMinMs;
  const drawn = window.delayMinMs + rng() * span;
  // The veil pushes the whole window back by the time it takes this bot to see
  // the tiles — its reaction is unchanged, it just starts later, exactly as a
  // human's does. Capped so a veiled Easy bot still buzzes before the clock.
  const sight = veilSightMs(question, validSkill, opts.tricky === true);
  const delayMs = Math.round(Math.min(sight + drawn, sight > 0 ? VEIL_CEILING_MS : Infinity));
  return { choice, delayMs };
}
