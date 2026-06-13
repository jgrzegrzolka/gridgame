/**
 * Audit live + backlog + ideas puzzles for flag-data ambiguity
 * violations. Runs locally:
 *
 *   node scripts/audit-flag-ambiguity.mjs
 *
 * For each puzzle that triggers a violation, prints the list-bucket
 * label, puzzle number, filter, answers, and one or more offending
 * countries. Exits with code 1 if any violation is found so this can
 * be wired into CI without needing a separate test file.
 *
 * The matching hard rule in `flags/daily.test.js` enforces the same
 * thing under `npm test`; this script is the human-friendly surface
 * for ad-hoc author checks (the doc note about field shape + violation
 * report sits in `DATA_FEATURE.md`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { flagsGamePool, loadCountries } from '../flags/group.js';
import { auditPuzzle } from '../flags/ambiguityAudit.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const COUNTRIES = loadCountries(
  JSON.parse(readFileSync(join(ROOT, 'flags', 'countries.json'), 'utf-8')),
);
// Audit against the sovereign pool only — daily puzzles only accept
// sovereign answers (rule 3), so a territory like sh-ac that visually
// straddles a colorCount filter can't actually be offered as a "wrong"
// answer. Tagging territories with ambig fields is still useful as
// flag-data documentation, but the daily-side audit shouldn't false-
// positive on them.
const SOV = flagsGamePool(COUNTRIES, false);

const LIVE = JSON.parse(
  readFileSync(join(ROOT, 'daily', 'daily_puzzles.json'), 'utf-8'),
);
const BACKLOG = JSON.parse(
  readFileSync(join(ROOT, 'daily', 'daily_backlog.json'), 'utf-8'),
);
const IDEAS = JSON.parse(
  readFileSync(join(ROOT, 'daily', 'daily_ideas.json'), 'utf-8'),
);

const BUCKETS = /** @type {const} */ ([
  ['LIVE', LIVE],
  ['BACKLOG', BACKLOG],
  ['IDEAS', IDEAS],
]);

let total = 0;
for (const [label, list] of BUCKETS) {
  let bucketHits = 0;
  for (const puzzle of list) {
    const v = auditPuzzle(puzzle, SOV);
    if (v.length === 0) continue;
    if (bucketHits === 0) {
      console.log(`\n--- ${label} (${list.length} entries) ---`);
    }
    bucketHits++;
    total += v.length;
    const id = puzzle.n != null ? `#${puzzle.n}` : '(no n)';
    console.log(`\n${label} ${id}: ${puzzle.filter}`);
    if (Array.isArray(puzzle.answers)) {
      console.log(`  answers (${puzzle.answers.length}): ${puzzle.answers.join(', ')}`);
    }
    for (const x of v) {
      console.log(`  [${x.kind}] ${x.country} ${x.name}: ${x.detail}`);
    }
  }
}

if (total === 0) {
  console.log('No ambiguity violations across LIVE + BACKLOG + IDEAS.');
  process.exit(0);
} else {
  console.log(`\n\n${total} ambiguity violation(s) found.`);
  process.exit(1);
}
