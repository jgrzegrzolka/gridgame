#!/usr/bin/env node
/**
 * One-shot migration (Feature R Phase 1). Reads `.catalog/live.json` +
 * `.catalog/backlog.json`, assigns a YYYY-MM-DD `date` to every entry
 * (N=12 → 2026-06-17, N=1 → 2026-06-06, N=72 → 2026-08-16, …), writes
 * `.catalog/puzzles.json` as a single combined array sorted by `n`.
 *
 * Pure date arithmetic in `assignDate` so the math has its own test.
 *
 * After this runs once successfully the script is dead — kept in the repo
 * for reference only.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ANCHOR_N = 12;
const ANCHOR_DATE = '2026-06-17';

/**
 * @param {string} anchorDate  YYYY-MM-DD
 * @param {number} deltaDays   signed
 * @returns {string}           YYYY-MM-DD
 */
function addDaysIso(anchorDate, deltaDays) {
  const [y, m, d] = anchorDate.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const out = new Date(t);
  const yy = out.getUTCFullYear();
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Map a puzzle's `n` to its release date by walking ±days from the anchor.
 *
 * @param {number} n
 * @param {number} [anchorN]      defaults to live ANCHOR_N
 * @param {string} [anchorDate]   defaults to ANCHOR_DATE
 * @returns {string}              YYYY-MM-DD
 */
export function assignDate(n, anchorN = ANCHOR_N, anchorDate = ANCHOR_DATE) {
  return addDaysIso(anchorDate, n - anchorN);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const live = await readJson('.catalog/live.json');
  const backlog = await readJson('.catalog/backlog.json');
  const merged = [...live, ...backlog]
    .sort((a, b) => a.n - b.n)
    .map((entry) => ({
      n: entry.n,
      date: assignDate(entry.n),
      filter: entry.filter,
      answers: entry.answers,
      description: entry.description,
    }));

  // Sanity: contiguous ns, contiguous dates.
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].n !== merged[i - 1].n + 1) {
      throw new Error(`Non-contiguous n at index ${i}: ${merged[i - 1].n} → ${merged[i].n}`);
    }
  }

  await writeFile('.catalog/puzzles.json', JSON.stringify(merged, null, 2) + '\n');
  const first = merged[0];
  const last = merged[merged.length - 1];
  console.log(
    `wrote .catalog/puzzles.json (${merged.length} entries, ` +
      `n=${first.n} ${first.date} → n=${last.n} ${last.date})`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
