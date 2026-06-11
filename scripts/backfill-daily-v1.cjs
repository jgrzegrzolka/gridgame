// Feature F phase 4 backfill — first exercise of the schema-version
// migration policy documented in infra/operations.md.
//
// Brings every existing dailyResults row to schema v: 1. Two row groups:
//
//   A) Pre-PR-#317 rows (no `wrongCodes`, no `v`): add `wrongCodes: []`,
//      `backfilled: true`, `v: 1`. The `backfilled` marker exists because
//      we're filling an ANALYTICAL field (wrongCodes) with a default,
//      and future analytics should know "this `[]` is not a confirmed-
//      no-wrong-picks signal — the original submitter never reported".
//
//   B) Post-#317, pre-#351 rows (have `wrongCodes`, no `v`): only add
//      `v: 1`. NO `backfilled` marker — `v` is metadata about the row
//      shape, not an analytical value. Marking these as `backfilled`
//      would falsely imply analytical-value provenance is suspect, and
//      poison every future "exclude backfilled rows" analytic with
//      noise from rows whose analytical values are perfectly native.
//
// Idempotent: re-running skips rows where `v === 1`. Safe to run twice.
//
// Usage:
//   node scripts/backfill-daily-v1.cjs --dry-run    (default — no writes)
//   node scripts/backfill-daily-v1.cjs --apply      (actually write)
//
// COSMOS_CONN must be set. Production connection string lives in the
// SWA appsettings — fetch with:
//   COSMOS_CONN="$(az staticwebapp appsettings list -n swa-yetanotherquiz-v3 -g rg-yetanotherquiz --query 'properties.COSMOS_CONN' -o tsv)"

const { queryDocs, insertDoc } = require('../api/src/lib/cosmos');

const DB = 'yetanotherquiz';
const C = 'dailyResults';
const TARGET_VERSION = 1;
const MAX_PUZZLE_ID = 20; // scan a generous range; misses are cheap (404)

// System fields Cosmos manages — never echo into the upsert body.
const SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

function stripSystemFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

function planRow(row) {
  if (row.v === TARGET_VERSION) return { action: 'skip', reason: 'already at v:1' };
  const next = stripSystemFields(row);
  next.v = TARGET_VERSION;
  if (!('wrongCodes' in row)) {
    // Group A — analytical field defaulted; mark provenance.
    next.wrongCodes = [];
    next.backfilled = true;
    return { action: 'group_a', next };
  }
  // Group B — only metadata added; no `backfilled` marker.
  return { action: 'group_b', next };
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

  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY (will upsert)'}\n`);

  const counts = { skipped: 0, group_a: 0, group_b: 0, errors: 0 };

  for (let pid = 1; pid <= MAX_PUZZLE_ID; pid++) {
    const q = await queryDocs({
      connString: conn, dbName: DB, containerName: C,
      query: 'SELECT * FROM c WHERE c.puzzleId = @pid',
      parameters: [{ name: '@pid', value: pid }],
      partitionKey: pid,
    });
    if (!q.ok || q.docs.length === 0) continue;
    console.log(`puzzleId=${pid}: ${q.docs.length} rows`);
    for (const row of q.docs) {
      const plan = planRow(row);
      if (plan.action === 'skip') {
        counts.skipped++;
        continue;
      }
      counts[plan.action]++;
      console.log(`  ${plan.action}: id=${row.id} (local=${row.local === true})`);
      if (dryRun) continue;
      const res = await insertDoc({
        connString: conn, dbName: DB, containerName: C,
        partitionKey: pid, doc: plan.next, upsert: true,
      });
      if (!res.ok) {
        counts.errors++;
        console.error(`  ! upsert failed: ${JSON.stringify(res)}`);
      }
    }
  }

  console.log('\nSummary:');
  console.log(`  group A (added wrongCodes:[] + backfilled:true + v:1): ${counts.group_a}`);
  console.log(`  group B (added v:1 only): ${counts.group_b}`);
  console.log(`  skipped (already v:1): ${counts.skipped}`);
  if (counts.errors) console.log(`  errors: ${counts.errors}`);
  if (dryRun) console.log('\n(no rows were modified — re-run with --apply to write)');
}

// Run when invoked directly. When required by a test, the exports below
// are what matter; main() should not fire on `require()`.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { planRow, stripSystemFields, TARGET_VERSION };
