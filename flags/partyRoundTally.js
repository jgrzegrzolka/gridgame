/**
 * Per-round score breakdown for Flag Party's standings break.
 *
 * The break shows what a player gained over the round's five questions. Until now
 * that was one merged number, so the speed bonus — the only mechanic that rewards
 * racing the table — was invisible three seconds after it happened. This module
 * accumulates each question's points into a per-player `{ base, speed }` tally the
 * break renders as chips.
 *
 * **Why the split is derived rather than sent.** A question awards
 * `CORRECT_POINTS` plus a speed bonus from `SPEED_BONUS`, the whole thing scaled by
 * the round multiplier. Every reachable total (0, 10, 11, 13, 15, and their doubles)
 * decomposes into exactly one base/speed pair, so the client can recover the split
 * from the `points` the reveal already carries. That keeps this phase free of a wire
 * change — client and PartyKit deploy independently, so not needing a server deploy
 * is worth real money.
 *
 * **This stops being true the moment scoring grows.** Adding a streak or
 * sole-survivor bonus (both +5) makes `15` ambiguous: 10 + 5 speed, or 10 + 5
 * streak? At that point the server must send the breakdown on the reveal and
 * {@link splitPoints} must go. That is a known, deliberate handoff — see
 * "Phase 5" in `PARTY.md`'s Iteration 12. Do not add a bonus without doing it.
 *
 * @typedef {{ base: number, speed: number }} Split
 * @typedef {Record<string, Split>} Tally
 */

import { CORRECT_POINTS, SPEED_BONUS } from './partyScore.js';

/**
 * Split one question's award into the flat correctness points and the speed bonus.
 *
 * A total that doesn't correspond to any reachable award (a stale client reading a
 * newer server's scoring, say) is reported as all-base rather than throwing: the
 * chips are decoration, and showing a slightly wrong label beats breaking the break.
 *
 * @param {number} points  points awarded for one question, multiplier already applied
 * @param {number} [multiplier]  the round's multiplier (2 on a double round)
 * @returns {Split}
 */
export function splitPoints(points, multiplier = 1) {
  const m = multiplier > 0 ? multiplier : 1;
  if (!Number.isFinite(points) || points <= 0) return { base: 0, speed: 0 };
  const base = CORRECT_POINTS * m;
  const speed = points - base;
  // Only a real speed-bonus value counts as speed; anything else is left as base so
  // the chips still add up to the total the player actually sees.
  const known = SPEED_BONUS.some((b) => b * m === speed);
  if (speed > 0 && known) return { base, speed };
  return { base: points, speed: 0 };
}

/** An empty tally — a fresh round with nothing scored yet. @returns {Tally} */
export function emptyTally() {
  return {};
}

/**
 * Fold one question's points into the round's running tally, returning a new tally
 * (the caller holds it across renders, so mutating in place would make a re-render
 * double-count).
 *
 * @param {Tally} tally
 * @param {Record<string, number>} pointsByPlayer  the reveal's `points`
 * @param {number} [multiplier]
 * @returns {Tally}
 */
export function addQuestionToTally(tally, pointsByPlayer, multiplier = 1) {
  /** @type {Tally} */
  const next = {};
  for (const [id, split] of Object.entries(tally || {})) next[id] = { ...split };
  for (const [id, points] of Object.entries(pointsByPlayer || {})) {
    const { base, speed } = splitPoints(points, multiplier);
    const prev = next[id] || { base: 0, speed: 0 };
    next[id] = { base: prev.base + base, speed: prev.speed + speed };
  }
  return next;
}

/**
 * The chips to render for one player's round, loudest-first and never showing a
 * zero — a `+0` chip is noise on the row of someone who had a bad round.
 *
 * `kind` is a stable token the page maps to a class and an icon; the label is the
 * number alone, so this stays free of i18n (a `+5` reads the same in every locale).
 *
 * @param {Split | undefined} split
 * @returns {Array<{ kind: 'base' | 'speed', value: number }>}
 */
export function chipsFor(split) {
  if (!split) return [];
  /** @type {Array<{ kind: 'base' | 'speed', value: number }>} */
  const chips = [];
  if (split.base > 0) chips.push({ kind: 'base', value: split.base });
  if (split.speed > 0) chips.push({ kind: 'speed', value: split.speed });
  return chips;
}
