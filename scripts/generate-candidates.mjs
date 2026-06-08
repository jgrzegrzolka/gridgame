/**
 * Batch-generate brainstorm candidates into daily/daily_ideas.json.
 *
 * Runs locally:
 *
 *   node scripts/generate-candidates.mjs
 *
 * Enumerates filter templates (continent + color, continent + motif,
 * colorCount-driven combos, etc.), validates each candidate against the
 * hard rules (1, 3, 5, 14) and the size band of rule 9, scores with
 * daily/difficulty.js, and writes the survivors as `{ filter, notes,
 * answers, difficulty, suggestedN }` entries appended to
 * daily/daily_ideas.json. Existing entries (including the parked
 * `parkUntilN: 101` ones) are preserved at the top of the file.
 *
 * What the script DOES check (programmatic):
 *   - Rule 1: filter parses + answer set non-empty
 *   - Rule 2: no redundant filter tokens
 *   - Rule 3: every answer is a sovereign code (using flagsGamePool)
 *   - Rule 5: primary-clean (same answer set under primaryColors)
 *   - Rule 6: candidate's answer set is neither a strict subset nor
 *            a strict superset of any LIVE or BACKLOG entry's answer
 *            set. Past-#100 candidates would be exempt from rule 6, but
 *            since every catalog entry today is in #1-100 and a fresh
 *            backlog promotion lands somewhere in that window too, the
 *            generator stays strict. Also rejects exact answer-set
 *            equality (same puzzle, different filter syntax).
 *   - Rule 9: 2 <= answers.length <= 30
 *   - Rule 14: no single-use token recurrence (against catalog + ideas)
 *   - Dedup: filter string not already in catalog or ideas
 *
 * Note rule 6 is checked against LIVE + BACKLOG only, not against the
 * parked entries in `daily_ideas.json` — those parked filters are
 * `parkUntilN: 101` precisely because they're rule-6 violators kept for
 * past-#100 use, so they're not a constraint on new generation.
 *
 * What the script does NOT check (left to author at merge time):
 *   - Rule 4: numbering is decided at merge, not generation
 *   - Rule 7: en/pl descriptions are hand-written when promoting to backlog
 *   - Rule 8 / 13: nameScore caps and continent variety are slot decisions
 *   - Rule 10: small-property compounds — script avoids them by construction
 *               (won't generate compound filters whose tokens include a
 *               sub-15 sovereign property other than solo)
 *   - Rule 11: country-reuse cap is a global-catalog concern
 *   - Rule 12: #1 is pinned (no candidate competes for slot 1)
 *
 * suggestedN is derived from difficulty: easier candidates → earlier
 * slot range. Strictly advisory.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFilterString, serializeFilter } from '../flags/findFlag.js';
import { matchesFilters } from '../flags/flagsFilter.js';
import { flagsGamePool, loadCountries } from '../flags/group.js';
import { scoreEntry } from '../daily/difficulty.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const COUNTRIES = loadCountries(JSON.parse(readFileSync(join(ROOT, 'flags', 'countries.json'), 'utf-8')));
const SOV = flagsGamePool(COUNTRIES, false);
const BY_CODE = Object.fromEntries(SOV.map((c) => [c.code, c]));

const LIVE = JSON.parse(readFileSync(join(ROOT, 'daily', 'daily_puzzles.json'), 'utf-8'));
const BACKLOG = JSON.parse(readFileSync(join(ROOT, 'daily', 'daily_backlog.json'), 'utf-8'));
const IDEAS = JSON.parse(readFileSync(join(ROOT, 'daily', 'daily_ideas.json'), 'utf-8'));
const POLICY = JSON.parse(readFileSync(join(ROOT, 'daily', 'daily_policy.json'), 'utf-8'));

const CATALOG = [...LIVE, ...BACKLOG];
const USED_FILTERS = new Set([...CATALOG, ...IDEAS].map((e) => e.filter));
const SINGLE_USE = new Set(POLICY.singleUseTokens.map((t) => t.token));

const CONTINENTS = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];
const COLORS = ['red', 'white', 'blue', 'green', 'yellow', 'black'];
// Motifs that aren't single-use (weapon, union-jack are). eu-member is
// continent-locked to Europe in practice and already exhausted by live #3.
const MOTIFS = ['cross', 'animal', 'coat-of-arms', 'star-or-moon'];

/**
 * Resolve a filter to its sovereign answer set (default colors field),
 * returning null if the filter is unparseable or the set is empty.
 *
 * @param {string} filter
 */
function resolve(filter) {
  const f = parseFilterString(filter);
  if (!f) return null;
  const codes = SOV.filter((c) => matchesFilters(c, f)).map((c) => c.code);
  if (codes.length === 0) return null;
  return { parsed: f, answers: codes };
}

/**
 * Re-resolve under primaryColors. Used to check rule 5 (primary-clean).
 *
 * @param {import('../flags/flagsFilter.js').Filters} parsed
 */
function resolvePrimary(parsed) {
  return SOV.filter((c) => matchesFilters(c, parsed, { colorField: 'primaryColors' }))
    .map((c) => c.code)
    .sort();
}

/**
 * Check rule 2 — dropping any single token must change the answer set.
 *
 * @param {string} filter
 * @param {string[]} answers
 */
function rule2NoRedundant(filter, answers) {
  const tokens = filter.split(',');
  if (tokens.length <= 1) return true;
  const sorted = [...answers].sort();
  for (let i = 0; i < tokens.length; i++) {
    const reduced = [...tokens.slice(0, i), ...tokens.slice(i + 1)].join(',');
    const r = resolve(reduced);
    if (!r) continue;
    const reducedSorted = [...r.answers].sort();
    if (
      reducedSorted.length === sorted.length &&
      reducedSorted.every((c, idx) => c === sorted[idx])
    ) {
      return false; // dropping this token didn't change the set
    }
  }
  return true;
}

/**
 * Per-candidate rule-6 check runs against this list. Seeded with:
 *   - live + backlog (catalog entries)
 *   - existing non-parked ideas (so re-running the generator doesn't
 *     produce candidates that would shadow ideas already in the file)
 * Each accepted candidate is appended too, so a fresh candidate is
 * checked against (catalog ∪ existing ideas ∪ everything already
 * accepted in this run). Prevents within-batch subset chains AND
 * makes re-runs idempotent — running the script twice in a row never
 * adds a candidate that's a subset of one written by the first run.
 */
const RULE6_GUARD = [
  ...LIVE.map((e) => ({
    ref: `live#${e.n}`,
    filter: e.filter,
    set: new Set(e.answers),
  })),
  ...BACKLOG.map((e) => ({
    ref: `backlog#${e.n}`,
    filter: e.filter,
    set: new Set(e.answers),
  })),
  ...IDEAS
    .filter((e) => e.parkUntilN == null && Array.isArray(e.answers) && e.answers.length > 0)
    .map((e) => ({
      ref: `existing-idea`,
      filter: e.filter,
      set: new Set(e.answers),
    })),
];

/**
 * Check rule 6: candidate's answer set must not be a strict subset or
 * strict superset of anything already in `RULE6_GUARD` (live + backlog
 * + earlier accepted candidates in this run), and must not be exactly
 * equal either (same puzzle, different filter).
 *
 * @param {string[]} answers
 */
function rule6NoSubset(answers) {
  const candSet = new Set(answers);
  for (const existing of RULE6_GUARD) {
    // Equal sets → "same puzzle, different filter" — reject as dedup.
    if (candSet.size === existing.set.size) {
      let allMatch = true;
      for (const c of candSet) {
        if (!existing.set.has(c)) { allMatch = false; break; }
      }
      if (allMatch) return { ok: false, conflict: existing };
      continue;
    }
    // Candidate smaller → could be strict subset
    if (candSet.size < existing.set.size) {
      let isSubset = true;
      for (const c of candSet) {
        if (!existing.set.has(c)) { isSubset = false; break; }
      }
      if (isSubset) return { ok: false, conflict: existing };
    } else {
      // Candidate larger → could be strict superset
      let isSuperset = true;
      for (const c of existing.set) {
        if (!candSet.has(c)) { isSuperset = false; break; }
      }
      if (isSuperset) return { ok: false, conflict: existing };
    }
  }
  return { ok: true };
}

/**
 * Check hard rules: 2, 5, 6, 14.
 *
 * @param {string} filter
 * @param {string[]} answers
 * @param {import('../flags/flagsFilter.js').Filters} parsed
 */
function passesHardRules(filter, answers, parsed) {
  // Rule 14: no single-use token reuse
  for (const tok of filter.split(',')) {
    if (SINGLE_USE.has(tok)) return { ok: false, reason: 'single-use-token' };
  }
  // Rule 5: primary-clean
  const primary = resolvePrimary(parsed);
  const sortedAns = [...answers].sort();
  if (
    primary.length !== sortedAns.length ||
    !primary.every((c, i) => c === sortedAns[i])
  ) {
    return { ok: false, reason: 'not-primary-clean' };
  }
  // Rule 2: no redundant tokens
  if (!rule2NoRedundant(filter, answers)) {
    return { ok: false, reason: 'redundant-token' };
  }
  // Rule 6: no strict subset/superset/equal-set vs live + backlog +
  // earlier accepted candidates in this run
  const r6 = rule6NoSubset(answers);
  if (!r6.ok) {
    return { ok: false, reason: `subset-of-${r6.conflict.ref} (${r6.conflict.filter})` };
  }
  return { ok: true };
}

/**
 * Map a difficulty score to a suggested slot range. Reflects rule 8's
 * nameScore caps and an arbitrary "spread by difficulty" heuristic.
 *
 * @param {number} d
 */
function suggestedSlotRange(d) {
  if (d < 1.6) return [4, 20];
  if (d < 2.2) return [10, 40];
  if (d < 3.0) return [25, 60];
  if (d < 4.0) return [50, 100];
  if (d < 5.0) return [80, 150];
  return [120, 200];
}

/**
 * Render a human-readable note describing the candidate.
 *
 * @param {string} filter
 * @param {{ score: number, mean: number, max: number, setSize: number }} score
 * @param {[number, number]} slot
 */
function makeNote(filter, score, slot) {
  return `auto-generated • d=${score.score.toFixed(2)} (mean=${score.mean.toFixed(2)}, max=${score.max}, n=${score.setSize}) • suggest #${slot[0]}-${slot[1]}`;
}

// --- Templates -----------------------------------------------------------

const candidates = [];

/** @param {string} filter */
function tryCandidate(filter) {
  if (USED_FILTERS.has(filter)) return;
  const r = resolve(filter);
  if (!r) return;
  // Rule 9 size band
  if (r.answers.length < 2 || r.answers.length > 30) return;
  const hard = passesHardRules(filter, r.answers, r.parsed);
  if (!hard.ok) return;
  const score = scoreEntry({ filter, answers: r.answers }, BY_CODE);
  const slot = /** @type {[number, number]} */ (suggestedSlotRange(score.score));
  candidates.push({
    filter,
    notes: makeNote(filter, score, slot),
    answers: r.answers,
    difficulty: +score.score.toFixed(2),
    suggestedN: slot,
  });
  USED_FILTERS.add(filter); // dedup within this run too
  // Seed the next candidate's rule-6 check with this one — that's how
  // within-batch subset chains get caught.
  RULE6_GUARD.push({ ref: `cand:${filter}`, filter, set: new Set(r.answers) });
}

// T1: continent + 1 color
for (const cont of CONTINENTS) {
  for (const col of COLORS) {
    tryCandidate(`continent:${cont},color:${col}`);
  }
}

// T2: continent + 1 motif
for (const cont of CONTINENTS) {
  for (const m of MOTIFS) {
    tryCandidate(`continent:${cont},motif:${m}`);
  }
}

// T3: continent + 2 colors + colorCount:2 ("only these two")
for (const cont of CONTINENTS) {
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      tryCandidate(`continent:${cont},color:${COLORS[i]},color:${COLORS[j]},colorCount:2`);
    }
  }
}

// T4: continent + 3 colors + colorCount:3 ("only these three")
for (const cont of CONTINENTS) {
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      for (let k = j + 1; k < COLORS.length; k++) {
        tryCandidate(`continent:${cont},color:${COLORS[i]},color:${COLORS[j]},color:${COLORS[k]},colorCount:3`);
      }
    }
  }
}

// T5: continent + colorCount:>=N (the underused mechanic — "busy flags")
for (const cont of CONTINENTS) {
  for (let n = 3; n <= 5; n++) {
    tryCandidate(`continent:${cont},colorCount:>=${n}`);
  }
}

// T6: continent + 1 color + colorCount:>=N (color-anchored busy flag)
for (const cont of CONTINENTS) {
  for (const col of COLORS) {
    for (let n = 3; n <= 4; n++) {
      tryCandidate(`continent:${cont},color:${col},colorCount:>=${n}`);
    }
  }
}

// T7: pure colorCount:N (worldwide bicolor / tricolor / etc.)
for (let n = 2; n <= 5; n++) {
  tryCandidate(`colorCount:${n}`);
  tryCandidate(`colorCount:>=${n}`);
}

// T8: 2 colors + colorCount:2 (worldwide "only X and Y")
for (let i = 0; i < COLORS.length; i++) {
  for (let j = i + 1; j < COLORS.length; j++) {
    tryCandidate(`color:${COLORS[i]},color:${COLORS[j]},colorCount:2`);
  }
}

// T9: 3 colors + colorCount:3 (worldwide "only X, Y, Z")
for (let i = 0; i < COLORS.length; i++) {
  for (let j = i + 1; j < COLORS.length; j++) {
    for (let k = j + 1; k < COLORS.length; k++) {
      tryCandidate(`color:${COLORS[i]},color:${COLORS[j]},color:${COLORS[k]},colorCount:3`);
    }
  }
}

// T10: continent + motif + 1 color (motif anchored)
for (const cont of CONTINENTS) {
  for (const m of MOTIFS) {
    for (const col of COLORS) {
      tryCandidate(`continent:${cont},motif:${m},color:${col}`);
    }
  }
}

// T11: motif + 1 color worldwide
for (const m of MOTIFS) {
  for (const col of COLORS) {
    tryCandidate(`motif:${m},color:${col}`);
  }
}

// T12: !continent + 1 color (exclude one continent, pick a color)
for (const cont of CONTINENTS) {
  for (const col of COLORS) {
    tryCandidate(`continent:!${cont},color:${col}`);
  }
}

// T13: !continent + 1 motif (exclude one continent, pick a motif)
for (const cont of CONTINENTS) {
  for (const m of MOTIFS) {
    tryCandidate(`continent:!${cont},motif:${m}`);
  }
}

// T14: motif + colorCount:>=N (worldwide motif-anchored busy flags)
for (const m of MOTIFS) {
  for (let n = 3; n <= 4; n++) {
    tryCandidate(`motif:${m},colorCount:>=${n}`);
  }
}

// T15: continent + motif + colorCount:>=N (motif-anchored busy in region)
for (const cont of CONTINENTS) {
  for (const m of MOTIFS) {
    for (let n = 3; n <= 4; n++) {
      tryCandidate(`continent:${cont},motif:${m},colorCount:>=${n}`);
    }
  }
}

// T16: continent + 2 motifs (motif intersection within region)
for (const cont of CONTINENTS) {
  for (let i = 0; i < MOTIFS.length; i++) {
    for (let j = i + 1; j < MOTIFS.length; j++) {
      tryCandidate(`continent:${cont},motif:${MOTIFS[i]},motif:${MOTIFS[j]}`);
    }
  }
}

// T17: motif + colorCount:N (worldwide motif with exact color count)
for (const m of MOTIFS) {
  for (let n = 2; n <= 4; n++) {
    tryCandidate(`motif:${m},colorCount:${n}`);
  }
}

// T18: continent + colorCount:N (exact — "only N colours" regional)
for (const cont of CONTINENTS) {
  for (let n = 2; n <= 5; n++) {
    tryCandidate(`continent:${cont},colorCount:${n}`);
  }
}

// T19: continent + 1 color + colorCount:N (color-anchored exact count)
for (const cont of CONTINENTS) {
  for (const col of COLORS) {
    for (let n = 2; n <= 4; n++) {
      tryCandidate(`continent:${cont},color:${col},colorCount:${n}`);
    }
  }
}

// T20: 1 color + colorCount:N (worldwide single-color anchored)
for (const col of COLORS) {
  for (let n = 2; n <= 4; n++) {
    tryCandidate(`color:${col},colorCount:${n}`);
  }
}

// T21: 1 color + colorCount:>=N (worldwide single-color busy)
for (const col of COLORS) {
  for (let n = 3; n <= 5; n++) {
    tryCandidate(`color:${col},colorCount:>=${n}`);
  }
}

// T22: motif + motif worldwide (two-motif intersection)
for (let i = 0; i < MOTIFS.length; i++) {
  for (let j = i + 1; j < MOTIFS.length; j++) {
    tryCandidate(`motif:${MOTIFS[i]},motif:${MOTIFS[j]}`);
  }
}

// T23: motif + 2 colors + colorCount:2 (worldwide "X-motif flags with only Y and Z")
for (const m of MOTIFS) {
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      tryCandidate(`motif:${m},color:${COLORS[i]},color:${COLORS[j]},colorCount:2`);
    }
  }
}

// T24: continent + 1 color + !1 color (color include + exclude)
for (const cont of CONTINENTS) {
  for (const inc of COLORS) {
    for (const exc of COLORS) {
      if (inc === exc) continue;
      tryCandidate(`continent:${cont},color:${inc},color:!${exc}`);
    }
  }
}

// T25: 2 colors worldwide (AND, no count constraint)
for (let i = 0; i < COLORS.length; i++) {
  for (let j = i + 1; j < COLORS.length; j++) {
    tryCandidate(`color:${COLORS[i]},color:${COLORS[j]}`);
  }
}

// T26: motif + 1 color + colorCount:N (motif + color anchored exact count)
for (const m of MOTIFS) {
  for (const col of COLORS) {
    for (let n = 2; n <= 4; n++) {
      tryCandidate(`motif:${m},color:${col},colorCount:${n}`);
    }
  }
}

// T27: motif + !motif (exclusion-based — e.g. "cross flags that aren't
// based on the Union Jack"). Includes the single-use motifs as the
// EXCLUSION side too — we can't include weapon/union-jack as compounds
// (rule 14), but excluding them as a refinement of another motif is
// fine and produces the clever "X but not Y" shape that Jan flagged
// as worth hand-curating.
const ALL_MOTIFS = [...MOTIFS, 'weapon', 'union-jack', 'eu-member'];
for (const inc of MOTIFS) {
  for (const exc of ALL_MOTIFS) {
    if (inc === exc) continue;
    tryCandidate(`motif:${inc},motif:!${exc}`);
  }
}

// --- Sort + write --------------------------------------------------------

candidates.sort((a, b) => a.difficulty - b.difficulty);

console.log(`generated ${candidates.length} candidates passing all hard rules`);
console.log('difficulty distribution:');
const buckets = { '<2': 0, '2-3': 0, '3-4': 0, '4-5': 0, '5+': 0 };
for (const c of candidates) {
  if (c.difficulty < 2) buckets['<2']++;
  else if (c.difficulty < 3) buckets['2-3']++;
  else if (c.difficulty < 4) buckets['3-4']++;
  else if (c.difficulty < 5) buckets['4-5']++;
  else buckets['5+']++;
}
console.log(buckets);

// Append candidates after the existing parked ideas (preserve them at top).
const merged = [...IDEAS, ...candidates];
writeFileSync(
  join(ROOT, 'daily', 'daily_ideas.json'),
  JSON.stringify(merged, null, 2) + '\n',
  'utf-8',
);
console.log(`wrote ${merged.length} entries to daily/daily_ideas.json (${IDEAS.length} pre-existing + ${candidates.length} new)`);
