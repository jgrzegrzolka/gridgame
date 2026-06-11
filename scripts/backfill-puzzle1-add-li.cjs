// Puzzle #1 grew from 9 to 10 answers on 2026-06-11 when Liechtenstein
// joined the European-cross set (after we tagged the 8 European COA-cross
// flags with `cross` and refined the filter with `motif:!coat-of-arms`).
//
// Past players' rows have `foundCodes` without `"li"` and `totalCount: 9`.
// Their archive score would otherwise appear to regress ("9/10 — missed
// Liechtenstein") even though they finished a puzzle that didn't include
// li at the time. This script credits every existing row with li and
// bumps totalCount to 10.
//
// Mirrors the client-side `applyScoreMigrations` in daily/scores.js
// (which patches localStorage on next visit). Server-side patch keeps
// community aggregates honest.
//
// Idempotent: re-running skips rows that already include "li" in
// foundCodes AND have totalCount === 10. Safe to run twice.
//
// Usage:
//   node scripts/backfill-puzzle1-add-li.cjs --dry-run    (default — no writes)
//   node scripts/backfill-puzzle1-add-li.cjs --apply      (actually write)
//
// COSMOS_CONN must be set. Production connection string lives in the
// SWA appsettings — fetch with:
//   COSMOS_CONN="$(az staticwebapp appsettings list -n swa-yetanotherquiz-v3 -g rg-yetanotherquiz --query 'properties.COSMOS_CONN' -o tsv)"

const { queryDocs, insertDoc } = require('../api/src/lib/cosmos');

const DB = 'yetanotherquiz';
const C = 'dailyResults';
const PUZZLE_ID = 1;
const NEW_TOTAL = 10;
const ADD_CODE = 'li';

const SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

function stripSystemFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

function planRow(row) {
  const codes = Array.isArray(row.foundCodes) ? row.foundCodes : [];
  const hasLi = codes.includes(ADD_CODE);
  if (hasLi && row.totalCount === NEW_TOTAL) {
    return { action: 'skip', reason: 'already migrated' };
  }
  const next = stripSystemFields(row);
  next.foundCodes = hasLi ? [...codes] : [...codes, ADD_CODE];
  next.totalCount = NEW_TOTAL;
  next.backfilled = true;
  return { action: 'patch', next };
}

async function main() {
  const conn = process.env.COSMOS_CONN;
  if (!conn) { console.error('COSMOS_CONN not set'); process.exit(1); }

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply || args.includes('--dry-run');
  if (apply && args.includes('--dry-run')) {
    console.error('Cannot pass both --apply and --dry-run');
    process.exit(1);
  }

  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY (will upsert)'}`);
  console.log(`Target: puzzleId=${PUZZLE_ID}, append "${ADD_CODE}" to foundCodes, set totalCount=${NEW_TOTAL}\n`);

  const counts = { skipped: 0, patched: 0, errors: 0 };

  const q = await queryDocs({
    connString: conn, dbName: DB, containerName: C,
    query: 'SELECT * FROM c WHERE c.puzzleId = @pid',
    parameters: [{ name: '@pid', value: PUZZLE_ID }],
    partitionKey: PUZZLE_ID,
  });
  if (!q.ok) {
    console.error(`Query failed: ${JSON.stringify(q)}`);
    process.exit(1);
  }
  console.log(`puzzleId=${PUZZLE_ID}: ${q.docs.length} rows`);

  for (const row of q.docs) {
    const plan = planRow(row);
    if (plan.action === 'skip') {
      counts.skipped++;
      continue;
    }
    counts.patched++;
    console.log(`  patch: id=${row.id} (local=${row.local === true}, was ${row.foundCodes.length}/${row.totalCount})`);
    if (dryRun) continue;
    const res = await insertDoc({
      connString: conn, dbName: DB, containerName: C,
      partitionKey: PUZZLE_ID, doc: plan.next, upsert: true,
    });
    if (!res.ok) {
      counts.errors++;
      console.error(`  ! upsert failed: ${JSON.stringify(res)}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  patched (added "${ADD_CODE}" + totalCount=${NEW_TOTAL} + backfilled:true): ${counts.patched}`);
  console.log(`  skipped (already migrated): ${counts.skipped}`);
  if (counts.errors) console.log(`  errors: ${counts.errors}`);
  if (dryRun) console.log('\n(no rows were modified — re-run with --apply to write)');
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { planRow, stripSystemFields, PUZZLE_ID, NEW_TOTAL, ADD_CODE };
