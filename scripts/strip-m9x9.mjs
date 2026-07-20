/**
 * One-shot: strip the legacy `m9x9` sub-object from every `tttPairs` row.
 *
 * Feature U removed the 9×9 board. `m9x9` is the only 9×9 artifact left in
 * Cosmos — of the four containers (`dailyResults`, `profiles`, `quizRecords`,
 * `tttPairs`) only `tttPairs` encodes a mode at all. Everything else that a
 * `9x9` grep of `api/` finds is code reading this field.
 *
 * WHY THIS NEEDS A DRY RUN, even though Jan said "I don't care about data
 * loss": achievements are **computed on read**, not stored. `tttCompute.js`
 * derives the snapshot from these rows on every `/api/v1/daily/me`, so the
 * counters here decide which badges a profile shows *right now*. The two 9×9
 * badges are already deleted in code, which is the intended loss. But
 * `tttGamesPlayed` / `hasWonTtt` / `hasLostTtt` aggregate across BOTH modes,
 * so removing `m9x9` also shrinks those — a player whose 10th game or only
 * win was a 9×9 game silently loses **Ten Games** / **First Win** / **First
 * Loss**, which are not 9×9 badges at all. Jan's read is that he is the only
 * player with 9×9 rows, which would make the collateral his alone. The dry
 * run prints exactly who is affected so that read is checked, not assumed.
 *
 * Ordering: run this AFTER the code removal is deployed. Stripping while a
 * 9×9 client can still POST would let a game re-add the field. (Post-removal
 * `mergePairResult` ignores mode '9x9' rather than counting it, so a late
 * straggler POST cannot resurrect m9x9 either way — but deploy first.)
 *
 * Authentication: pulls `COSMOS_CONN` from SWA app settings via the `az` CLI.
 * No secrets land on disk; the value lives in memory only.
 *
 * Modes:
 *   - Default (no flag): DRY RUN. Prints every row that would change and the
 *     per-device badge delta. Nothing is written.
 *   - `--apply`: rewrite the rows without `m9x9`. Run the dry run first.
 *
 * Usage:
 *   node scripts/strip-m9x9.mjs
 *   node scripts/strip-m9x9.mjs --apply
 *
 * One-shot: delete this script once it has been run with --apply (tracked as
 * a cleanup entry in FEATURE.md — the same lifecycle the two `backfill-*.cjs`
 * scripts went through before being deleted on 2026-07-20).
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { queryDocs, insertDoc } = require('../api/src/lib/cosmos.js');
const { computeTttSignals } = require('../api/src/lib/tttCompute.js');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'tttPairs';

const apply = process.argv.includes('--apply');

function fetchCosmosConn() {
  // Accept env override first so the script runs cleanly in shells where `az`
  // isn't on PATH (pass it in via `COSMOS_CONN=$(az ...) node ...`).
  if (process.env.COSMOS_CONN) return process.env.COSMOS_CONN;
  console.error('fetching COSMOS_CONN from SWA app settings…');
  const out = execFileSync(
    'az',
    ['staticwebapp', 'appsettings', 'list', '-n', 'swa-yetanotherquiz-v3',
      '-g', 'rg-yetanotherquiz', '--query', 'properties.COSMOS_CONN', '-o', 'tsv'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  ).toString().trim();
  if (!out) throw new Error('COSMOS_CONN is empty in SWA app settings');
  return out;
}

const total = (m) => (m ? (m.wins || 0) + (m.losses || 0) + (m.draws || 0) : 0);

async function main() {
  const connString = fetchCosmosConn();
  const res = await queryDocs({
    connString,
    dbName: DB_NAME,
    containerName: CONTAINER_NAME,
    query: 'SELECT * FROM c',
    enableCrossPartition: true,
  });
  if (!res.ok) throw new Error(`query failed: ${JSON.stringify(res)}`);
  const rows = res.docs;

  const withM9 = rows.filter((r) => r.m9x9 !== undefined);
  console.log(`\ntttPairs rows: ${rows.length}`);
  console.log(`rows carrying m9x9: ${withM9.length}`);
  console.log(`rows with >=1 actual 9x9 game: ${rows.filter((r) => total(r.m9x9) > 0).length}`);
  console.log(`total 9x9 games recorded (per-row, so each pair counts twice): ${rows.reduce((a, r) => a + total(r.m9x9), 0)}`);

  if (withM9.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  // Per-device badge impact. This is the part worth reading.
  const byDevice = new Map();
  for (const r of rows) {
    if (!byDevice.has(r.deviceId)) byDevice.set(r.deviceId, []);
    byDevice.get(r.deviceId).push(r);
  }

  console.log('\n=== badge impact per device ===');
  let collateral = 0;
  for (const [dev, drows] of byDevice) {
    // `computeTttSignals` already ignores m9x9 post-Feature-U, so model the
    // BEFORE state with the old both-modes arithmetic explicitly.
    const before = { games: 0, won: false, lost: false };
    for (const r of drows) {
      const m3 = r.m3x3 || {}; const m9 = r.m9x9 || {};
      before.games += total(m3) + total(m9);
      if ((m3.wins || 0) > 0 || (m9.wins || 0) > 0) before.won = true;
      if ((m3.losses || 0) > 0 || (m9.losses || 0) > 0) before.lost = true;
    }
    const after = computeTttSignals(drows.map((r) => ({ m3x3: r.m3x3 })));

    const lost = [];
    if (before.games >= 10 && after.tttGamesPlayed < 10) lost.push('Ten Games');
    if (before.games >= 100 && after.tttGamesPlayed < 100) lost.push('Hundred Games');
    if (before.won && !after.hasWonTtt) lost.push('First Win');
    if (before.lost && !after.hasLostTtt) lost.push('First Loss');

    const nine = drows.reduce((a, r) => a + total(r.m9x9), 0);
    if (nine > 0 || lost.length) {
      console.log(`  ${dev.slice(0, 12)}…  9x9 games: ${nine}  |  total games ${before.games} → ${after.tttGamesPlayed}`
        + (lost.length ? `  |  *** ALSO LOSES: ${lost.join(', ')}` : ''));
      if (lost.length) collateral++;
    }
  }
  if (collateral === 0) console.log('  (no device loses a non-9x9 badge)');
  else console.log(`\n  !!! ${collateral} device(s) lose a badge that is NOT a 9x9 badge.`);

  if (!apply) {
    console.log(`\n(dry run — would rewrite ${withM9.length} rows. Pass --apply to write.)`);
    return;
  }

  let written = 0;
  for (const row of withM9) {
    const { m9x9, ...clean } = row;
    // Drop Cosmos' system fields; upsert rewrites the doc wholesale.
    for (const k of ['_rid', '_self', '_etag', '_attachments', '_ts']) delete clean[k];
    const out = await insertDoc({
      connString,
      dbName: DB_NAME,
      containerName: CONTAINER_NAME,
      partitionKey: row.deviceId,
      doc: clean,
      upsert: true,
    });
    if (!out.ok) {
      console.error(`  FAILED ${row.id}: ${JSON.stringify(out)}`);
      continue;
    }
    written++;
  }
  console.log(`\nAPPLIED — rewrote ${written}/${withM9.length} rows without m9x9.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
