// Feature F phase 5 backfill — second exercise of the schema-version
// migration policy documented in infra/operations.md.
//
// Brings every existing `quizRecords` row to schema v: 1 by filling
// the new analytical fields F5 introduces (attempts + lastPlayedAt
// per sub-entry).
//
// Per-row plan:
//   - For each sub-entry in `records`:
//       missing `attempts`     → set to 1   (this sub-entry exists only
//                                            because a PB was set, so at
//                                            least one attempt happened)
//       missing `lastPlayedAt` → set to that sub-entry's `submittedAt`
//                                (the closest signal we have to "last play")
//   - If any sub-entry analytical field was defaulted, set `backfilled: true`
//     on the DOC.
//   - Set `v: 1` on the doc.
//
// Idempotent: re-running skips docs already at v:1 with all sub-entries
// carrying attempts + lastPlayedAt.
//
// Usage:
//   node scripts/backfill-quiz-v1.cjs --dry-run   (default)
//   node scripts/backfill-quiz-v1.cjs --apply

const { queryDocs, insertDoc } = require('../api/src/lib/cosmos');

const DB = 'yetanotherquiz';
const C = 'quizRecords';
const TARGET_VERSION = 1;

const SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

function stripSystemFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

function planRow(row) {
  let analyticalDefaulted = false;
  const newRecords = {};
  for (const [configKey, sub] of Object.entries(row.records || {})) {
    const next = { ...sub };
    if (typeof next.attempts !== 'number') {
      next.attempts = 1;
      analyticalDefaulted = true;
    }
    if (typeof next.lastPlayedAt !== 'number') {
      next.lastPlayedAt = typeof sub.submittedAt === 'number' ? sub.submittedAt : 0;
      analyticalDefaulted = true;
    }
    newRecords[configKey] = next;
  }
  const needsV = row.v !== TARGET_VERSION;
  if (!analyticalDefaulted && !needsV) {
    return { action: 'skip', reason: 'already at v:1 with all fields' };
  }
  const next = stripSystemFields(row);
  next.records = newRecords;
  next.v = TARGET_VERSION;
  if (analyticalDefaulted) next.backfilled = true;
  return { action: 'migrate', next, analyticalDefaulted };
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

  // Enumerate deviceIds via single-field cross-partition projection,
  // which the REST gateway can serve.
  const idsRes = await queryDocs({
    connString: conn, dbName: DB, containerName: C,
    query: 'SELECT VALUE c.deviceId FROM c',
    enableCrossPartition: true,
  });
  if (!idsRes.ok) { console.error('Failed listing deviceIds:', idsRes); process.exit(1); }
  console.log(`Found ${idsRes.docs.length} deviceIds in ${C}\n`);

  const counts = { skipped: 0, migrated: 0, analytical: 0, vOnly: 0, errors: 0 };

  for (const did of idsRes.docs) {
    const r = await queryDocs({
      connString: conn, dbName: DB, containerName: C,
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: did }],
      partitionKey: did,
    });
    if (!r.ok || !r.docs[0]) {
      console.error(`  ! could not read deviceId=${did}`);
      continue;
    }
    const row = r.docs[0];
    const plan = planRow(row);
    if (plan.action === 'skip') {
      counts.skipped++;
      continue;
    }
    counts.migrated++;
    if (plan.analyticalDefaulted) counts.analytical++; else counts.vOnly++;
    const subKeys = Object.keys(row.records || {});
    console.log(`deviceId=${did}: ${subKeys.length} sub-entries (analytical defaulted: ${plan.analyticalDefaulted})`);
    if (dryRun) continue;
    const res = await insertDoc({
      connString: conn, dbName: DB, containerName: C,
      partitionKey: did, doc: plan.next, upsert: true,
    });
    if (!res.ok) {
      counts.errors++;
      console.error(`  ! upsert failed: ${JSON.stringify(res)}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  migrated (analytical defaulted → backfilled:true): ${counts.analytical}`);
  console.log(`  migrated (v-only patch, no backfilled marker):     ${counts.vOnly}`);
  console.log(`  skipped (already at v:1 with all fields):          ${counts.skipped}`);
  if (counts.errors) console.log(`  errors: ${counts.errors}`);
  if (dryRun) console.log('\n(no rows were modified — re-run with --apply to write)');
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { planRow, stripSystemFields, TARGET_VERSION };
