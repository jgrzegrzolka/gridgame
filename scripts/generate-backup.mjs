/**
 * Generate a 200-entry emergency backup catalog into daily/daily_backup.json.
 *
 * Purpose: if author can't curate for an extended period, the bot has
 * something to fall back on. Quality bar is intentionally low — this
 * list does NOT adhere to the daily-puzzle rules (rule 2 redundancy,
 * rule 5 primary-clean, rule 6 subset, rule 8 nameScore caps, rule 10
 * small-property compounds, rule 14 single-use are all skipped).
 *
 * The ONLY rule enforced: a backup entry's filter string cannot be
 * an exact match for any filter already in daily_puzzles.json or
 * daily_backlog.json. (Within-backup dedup is also enforced.)
 *
 * Run locally:
 *
 *   node scripts/generate-backup.mjs
 *
 * Overwrites daily/daily_backup.json on every run. Output entries are
 * minimal: `{ filter, answers }`. No `n`, no descriptions — if the
 * backup is ever promoted to backlog, those get added at that time.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFilterString } from '../flags/findFlag.js';
import { matchesFilters } from '../flags/flagsFilter.js';
import { flagsGamePool, loadCountries } from '../flags/group.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const COUNTRIES = loadCountries(JSON.parse(readFileSync(join(ROOT, 'flags', 'countries.json'), 'utf-8')));
const SOV = flagsGamePool(COUNTRIES, false);

const CATALOG_DIR = join(ROOT, '.catalog');
const LIVE = JSON.parse(readFileSync(join(CATALOG_DIR, 'live.json'), 'utf-8'));
const BACKLOG = JSON.parse(readFileSync(join(CATALOG_DIR, 'backlog.json'), 'utf-8'));
const USED_FILTERS = new Set([...LIVE, ...BACKLOG].map((e) => e.filter));

const CONTINENTS = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];
const COLORS = ['red', 'white', 'blue', 'green', 'yellow', 'black', 'orange'];
const MOTIFS = ['cross', 'animal', 'bird', 'coat-of-arms', 'star-or-moon', 'weapon', 'union-jack'];

const TARGET = 200;

/** @param {string} filter */
function resolve(filter) {
  const f = parseFilterString(filter);
  if (!f) return null;
  const codes = SOV.filter((c) => matchesFilters(c, f)).map((c) => c.code);
  if (codes.length === 0) return null;
  return codes;
}

const accepted = [];

/** @param {string} filter */
function tryCandidate(filter) {
  if (USED_FILTERS.has(filter)) return;
  const answers = resolve(filter);
  if (!answers) return;
  accepted.push({ filter, answers });
  USED_FILTERS.add(filter);
}

// --- Templates. Same family as scripts/generate-candidates.mjs but
// with rules disabled so the lower-quality candidates survive too.

// T1: continent + 1 color
for (const cont of CONTINENTS) for (const col of COLORS) tryCandidate(`continent:${cont},color:${col}`);

// T2: continent + 1 motif
for (const cont of CONTINENTS) for (const m of MOTIFS) tryCandidate(`continent:${cont},motif:${m}`);

// T3: continent + 2 colors + colorCount:2
for (const cont of CONTINENTS) {
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      tryCandidate(`continent:${cont},color:${COLORS[i]},color:${COLORS[j]},colorCount:2`);
    }
  }
}

// T4: continent + 3 colors + colorCount:3
for (const cont of CONTINENTS) {
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      for (let k = j + 1; k < COLORS.length; k++) {
        tryCandidate(`continent:${cont},color:${COLORS[i]},color:${COLORS[j]},color:${COLORS[k]},colorCount:3`);
      }
    }
  }
}

// T5: continent + colorCount:>=N
for (const cont of CONTINENTS) for (let n = 2; n <= 5; n++) tryCandidate(`continent:${cont},colorCount:>=${n}`);

// T6: continent + colorCount:N
for (const cont of CONTINENTS) for (let n = 2; n <= 5; n++) tryCandidate(`continent:${cont},colorCount:${n}`);

// T7: continent + 1 color + colorCount:N
for (const cont of CONTINENTS) {
  for (const col of COLORS) {
    for (let n = 2; n <= 4; n++) tryCandidate(`continent:${cont},color:${col},colorCount:${n}`);
  }
}

// T8: continent + 1 color + colorCount:>=N
for (const cont of CONTINENTS) {
  for (const col of COLORS) {
    for (let n = 3; n <= 4; n++) tryCandidate(`continent:${cont},color:${col},colorCount:>=${n}`);
  }
}

// T9: pure colorCount worldwide
for (let n = 2; n <= 5; n++) { tryCandidate(`colorCount:${n}`); tryCandidate(`colorCount:>=${n}`); }

// T10: 2 colors worldwide colorCount:2
for (let i = 0; i < COLORS.length; i++) {
  for (let j = i + 1; j < COLORS.length; j++) {
    tryCandidate(`color:${COLORS[i]},color:${COLORS[j]},colorCount:2`);
  }
}

// T11: 3 colors worldwide colorCount:3
for (let i = 0; i < COLORS.length; i++) {
  for (let j = i + 1; j < COLORS.length; j++) {
    for (let k = j + 1; k < COLORS.length; k++) {
      tryCandidate(`color:${COLORS[i]},color:${COLORS[j]},color:${COLORS[k]},colorCount:3`);
    }
  }
}

// T12: 2 colors worldwide (AND, no count)
for (let i = 0; i < COLORS.length; i++) {
  for (let j = i + 1; j < COLORS.length; j++) tryCandidate(`color:${COLORS[i]},color:${COLORS[j]}`);
}

// T13: continent + motif + 1 color
for (const cont of CONTINENTS) {
  for (const m of MOTIFS) {
    for (const col of COLORS) tryCandidate(`continent:${cont},motif:${m},color:${col}`);
  }
}

// T14: motif + 1 color worldwide
for (const m of MOTIFS) for (const col of COLORS) tryCandidate(`motif:${m},color:${col}`);

// T15: !continent + 1 color
for (const cont of CONTINENTS) for (const col of COLORS) tryCandidate(`continent:!${cont},color:${col}`);

// T16: !continent + 1 motif
for (const cont of CONTINENTS) for (const m of MOTIFS) tryCandidate(`continent:!${cont},motif:${m}`);

// T17: motif + colorCount worldwide
for (const m of MOTIFS) {
  for (let n = 2; n <= 4; n++) tryCandidate(`motif:${m},colorCount:${n}`);
  for (let n = 3; n <= 4; n++) tryCandidate(`motif:${m},colorCount:>=${n}`);
}

// T18: continent + motif + colorCount:>=N
for (const cont of CONTINENTS) {
  for (const m of MOTIFS) {
    for (let n = 3; n <= 4; n++) tryCandidate(`continent:${cont},motif:${m},colorCount:>=${n}`);
  }
}

// T19: continent + 2 motifs
for (const cont of CONTINENTS) {
  for (let i = 0; i < MOTIFS.length; i++) {
    for (let j = i + 1; j < MOTIFS.length; j++) {
      tryCandidate(`continent:${cont},motif:${MOTIFS[i]},motif:${MOTIFS[j]}`);
    }
  }
}

// T20: motif + motif worldwide
for (let i = 0; i < MOTIFS.length; i++) {
  for (let j = i + 1; j < MOTIFS.length; j++) tryCandidate(`motif:${MOTIFS[i]},motif:${MOTIFS[j]}`);
}

// T21: motif + 2 colors + colorCount:2
for (const m of MOTIFS) {
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      tryCandidate(`motif:${m},color:${COLORS[i]},color:${COLORS[j]},colorCount:2`);
    }
  }
}

// T22: continent + 1 color + !1 color
for (const cont of CONTINENTS) {
  for (const inc of COLORS) {
    for (const exc of COLORS) {
      if (inc === exc) continue;
      tryCandidate(`continent:${cont},color:${inc},color:!${exc}`);
    }
  }
}

// T23: motif + !motif
for (const inc of MOTIFS) {
  for (const exc of MOTIFS) {
    if (inc === exc) continue;
    tryCandidate(`motif:${inc},motif:!${exc}`);
  }
}

// T24: continent + motif + !motif
for (const cont of CONTINENTS) {
  for (const inc of MOTIFS) {
    for (const exc of MOTIFS) {
      if (inc === exc) continue;
      tryCandidate(`continent:${cont},motif:${inc},motif:!${exc}`);
    }
  }
}

// T25: 1 color + colorCount worldwide
for (const col of COLORS) {
  for (let n = 2; n <= 4; n++) tryCandidate(`color:${col},colorCount:${n}`);
  for (let n = 3; n <= 5; n++) tryCandidate(`color:${col},colorCount:>=${n}`);
}

// T26: motif + 1 color + colorCount
for (const m of MOTIFS) {
  for (const col of COLORS) {
    for (let n = 2; n <= 4; n++) tryCandidate(`motif:${m},color:${col},colorCount:${n}`);
  }
}

// T27: status filters
for (const status of ['sovereign', 'non_un', 'territory']) {
  for (const col of COLORS) tryCandidate(`status:${status},color:${col}`);
  for (const m of MOTIFS) tryCandidate(`status:${status},motif:${m}`);
}

// --- Pick TARGET via deterministic shuffle (seed = 42) for cross-template spread.

/** @param {number} seed */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
for (let i = accepted.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [accepted[i], accepted[j]] = [accepted[j], accepted[i]];
}

const picked = accepted.slice(0, TARGET);

console.log(`accepted ${accepted.length} candidates total — taking ${picked.length}`);
const sizeBuckets = { '1': 0, '2-5': 0, '6-15': 0, '16-30': 0, '31+': 0 };
for (const c of picked) {
  const n = c.answers.length;
  if (n === 1) sizeBuckets['1']++;
  else if (n <= 5) sizeBuckets['2-5']++;
  else if (n <= 15) sizeBuckets['6-15']++;
  else if (n <= 30) sizeBuckets['16-30']++;
  else sizeBuckets['31+']++;
}
console.log('answer-set sizes:', sizeBuckets);

writeFileSync(
  join(ROOT, 'daily', 'daily_backup.json'),
  JSON.stringify(picked, null, 2) + '\n',
  'utf-8',
);
console.log(`wrote ${picked.length} entries to daily/daily_backup.json`);
