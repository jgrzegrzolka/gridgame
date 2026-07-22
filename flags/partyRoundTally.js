/**
 * Per-round score breakdown for Flag Party's standings break.
 *
 * The break shows what a player gained over the round's five questions. Until now
 * that was one merged number, so the speed bonus — the only mechanic that rewards
 * racing the table — was invisible three seconds after it happened. This module
 * accumulates each question's award into a per-player `{ base, speed, solo }` tally
 * the break renders as chips.
 *
 * **The split arrives from the server; it is no longer inferred.** This module used
 * to recover base/speed from the total by inverse arithmetic (subtract the base,
 * match the remainder against a fixed speed curve), which worked only while every
 * reachable total decomposed uniquely — and it never truly did (the solo bonus
 * collided with a speed bonus, and the speed ladder is now sized to the race so
 * its values aren't even fixed). `scoreQuestionDetailed` now itemises the award
 * server-side and the reveal carries it, so this module only ever adds up numbers
 * somebody else already attributed.
 *
 * `closeness` is the world-facts question's near-miss award: you named the
 * second- or third-biggest rather than the biggest. A separate bucket from
 * `base` on purpose -- "you were right" and "you were close" are different
 * things to tell a player, and the break's chips say which.
 *
 * @typedef {{ base: number, speed: number, solo: number, closeness: number }} Split
 * @typedef {Record<string, Split>} Tally
 */

/** An empty tally — a fresh round with nothing scored yet. @returns {Tally} */
export function emptyTally() {
  return {};
}

/** A split with nothing in it. @returns {Split} */
function zeroSplit() {
  return { base: 0, speed: 0, solo: 0, closeness: 0 };
}

/**
 * Fold one question's awards into the round's running tally, returning a new tally
 * (the caller holds it across renders, so mutating in place would make a re-render
 * double-count).
 *
 * A missing or malformed award contributes nothing rather than throwing: a stale
 * client reading a newer server's reveal should show a thin breakdown, not break
 * the whole standings screen.
 *
 * @param {Tally} tally
 * @param {Record<string, Partial<Split>> | undefined} awardsByPlayer  the reveal's `breakdown`
 * @returns {Tally}
 */
export function addQuestionToTally(tally, awardsByPlayer) {
  /** @type {Tally} */
  const next = {};
  for (const [id, split] of Object.entries(tally || {})) next[id] = { ...split };
  for (const [id, award] of Object.entries(awardsByPlayer || {})) {
    const prev = next[id] || zeroSplit();
    next[id] = {
      base: prev.base + num(award?.base),
      speed: prev.speed + num(award?.speed),
      solo: prev.solo + num(award?.solo),
      closeness: prev.closeness + num(award?.closeness),
    };
  }
  return next;
}

/** @param {unknown} v @returns {number} */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * The chips to render for one player's round, loudest-first and never showing a
 * zero — a `+0` chip is noise on the row of someone who had a bad round.
 *
 * `kind` is a stable token the page maps to a class and an icon; the label is the
 * number alone, so this stays free of i18n (a `+5` reads the same in every locale).
 *
 * @param {Split | undefined} split
 * @returns {Array<{ kind: 'base' | 'speed' | 'solo' | 'closeness', value: number }>}
 */
export function chipsFor(split) {
  if (!split) return [];
  /** @type {Array<{ kind: 'base' | 'speed' | 'solo' | 'closeness', value: number }>} */
  const chips = [];
  if (split.base > 0) chips.push({ kind: 'base', value: split.base });
  if (split.speed > 0) chips.push({ kind: 'speed', value: split.speed });
  if (split.solo > 0) chips.push({ kind: 'solo', value: split.solo });
  // Last: closeness is the quietest of the four, and it is mutually exclusive
  // with base per question -- a row showing both earned them on different
  // questions of the round.
  if (split.closeness > 0) chips.push({ kind: 'closeness', value: split.closeness });
  return chips;
}
