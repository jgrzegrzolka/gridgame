/**
 * Promote the next staged daily puzzle to live.
 *
 * Moves `daily/daily_backlog.json[0]` to the end of
 * `daily/daily_puzzles.json`, preserving the existing 2-space indent and
 * trailing newline. Driven from `.github/workflows/release-daily.yml` on
 * a cron (Polish midnight), and gated by `npm run validate` afterwards so
 * the catalog rules in flags/daily.test.js still hold.
 *
 * Why a node script (not inline yaml): the same `node scripts/release-next.mjs`
 * runs locally if Jan ever wants to release one by hand without waiting
 * for the cron — same code path, same diff shape.
 *
 * Exits non-zero on an empty backlog so the workflow surfaces a failure
 * email — that's the cue to refill `daily_backlog.json`.
 *
 * Under GitHub Actions, the promoted puzzle number is written to
 * $GITHUB_OUTPUT as `n=<value>` so the commit step can name it.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const LIVE = 'daily/daily_puzzles.json';
const BACKLOG = 'daily/daily_backlog.json';

const live = JSON.parse(readFileSync(LIVE, 'utf8'));
const backlog = JSON.parse(readFileSync(BACKLOG, 'utf8'));

if (backlog.length === 0) {
  console.error('Backlog is empty — refill daily/daily_backlog.json.');
  process.exit(1);
}

const next = backlog.shift();
live.push(next);

const writeJson = (path, data) =>
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
writeJson(LIVE, live);
writeJson(BACKLOG, backlog);

console.log(`Promoted #${next.n} to live. Backlog now has ${backlog.length} entries.`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `n=${next.n}\n`);
}
