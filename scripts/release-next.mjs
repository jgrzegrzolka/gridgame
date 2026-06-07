/**
 * Promote the next staged daily puzzle to live.
 *
 * Pure logic in `promote()`; IO (read both JSON files, write them back,
 * emit `$GITHUB_OUTPUT`) lives in `main()` and runs only when this file
 * is invoked as the CLI entry point. Same shape as cache-bust.mjs —
 * keeps the move covered by `release-next.test.mjs` without having to
 * stub `node:fs`.
 *
 * Driven from `.github/workflows/release-daily.yml` on a cron at Polish
 * midnight. After the move the workflow runs `npm run validate`, so any
 * catalog-rule breakage (e.g. country-data drift invalidated a stored
 * answer set since the entry was authored) fails the workflow before the
 * push, and nothing ships.
 *
 * Throws on an empty backlog so the workflow surfaces a failure email —
 * the cue to refill `daily_backlog.json`.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Move the first entry of `backlog` to the end of `live`. Returns the new
 * arrays (inputs are not mutated) plus the promoted puzzle's number, so
 * the CLI driver can name it in $GITHUB_OUTPUT for the commit message.
 *
 * @param {{ n: number }[]} live
 * @param {{ n: number }[]} backlog
 * @returns {{ live: { n: number }[], backlog: { n: number }[], n: number }}
 */
export function promote(live, backlog) {
  if (backlog.length === 0) {
    throw new Error('Backlog is empty — refill daily/daily_backlog.json.');
  }
  const next = backlog[0];
  return {
    live: [...live, next],
    backlog: backlog.slice(1),
    n: next.n,
  };
}

const LIVE = 'daily/daily_puzzles.json';
const BACKLOG = 'daily/daily_backlog.json';

function main() {
  const live = JSON.parse(readFileSync(LIVE, 'utf8'));
  const backlog = JSON.parse(readFileSync(BACKLOG, 'utf8'));

  const result = promote(live, backlog);

  const writeJson = (path, data) =>
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  writeJson(LIVE, result.live);
  writeJson(BACKLOG, result.backlog);

  console.log(`Promoted #${result.n} to live. Backlog now has ${result.backlog.length} entries.`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `n=${result.n}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
