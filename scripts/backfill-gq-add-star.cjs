// Equatorial Guinea (gq) was missing the `star-or-moon` motif in
// flags/countries.json — its arms carry six gold six-pointed stars above the
// silk-cotton tree (visible in flags/svg/gq.svg as one gold path of six star
// subpaths). Slovenia and Croatia, whose stars also live only inside a coat
// of arms, were tagged correctly; gq was not.
//
// Fixing the tag grew two puzzles:
//   #13 (2026-06-18)  Africa · yellow · red · green · star   15 -> 16
//   #45 (2026-07-20)  Africa · star · blue                   11 -> 12
//
// This script patches every existing Cosmos row for those puzzles:
//   - credits "gq" into foundCodes
//   - REMOVES "gq" from wrongCodes if the player guessed it
//   - bumps totalCount
//
// That middle step is what makes this different from
// backfill-puzzle1-add-li.cjs, which only ever had to append. Here the flag
// was actively rejected while the bug was live, so some rows record a correct
// answer as a mistake. Leaving it there would keep the result screen — and the
// community "most common mistake" rail — calling Equatorial Guinea wrong.
//
// Everyone is credited, including players who never typed gq. They could not
// have found it: the game refused the answer. Mirrors the decision taken for
// puzzle1_add_li.
//
// Mirrors the client-side `applyScoreMigrations` in daily/scores.js, which
// patches localStorage on the player's next visit. Server-side patch keeps the
// community aggregates honest.
//
// Idempotent: a row is skipped only when it already has "gq" in foundCodes AND
// the new totalCount. A half-applied run re-patches. Safe to run twice.
//
// Usage:
//   node scripts/backfill-gq-add-star.cjs --dry-run    (default — no writes)
//   node scripts/backfill-gq-add-star.cjs --apply      (actually write)
//
// COSMOS_CONN must be set. Production connection string lives in the SWA
// appsettings — fetch with:
//   COSMOS_CONN="$(az staticwebapp appsettings list -n swa-yetanotherquiz-v3 -g rg-yetanotherquiz --query 'properties.COSMOS_CONN' -o tsv)"

const { queryDocs, insertDoc } = require('../api/src/lib/cosmos');

const DB = 'yetanotherquiz';
const C = 'dailyResults';
const ADD_CODE = 'gq';

/** The complete blast radius. Nothing outside this list is touched. */
const TARGETS = [
  { puzzleId: 13, newTotal: 16 },
  { puzzleId: 45, newTotal: 12 },
];

const SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

function stripSystemFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

function planRow(row, newTotal) {
  const found = Array.isArray(row.foundCodes) ? row.foundCodes : [];
  const wrong = Array.isArray(row.wrongCodes) ? row.wrongCodes : [];
  const hasCode = found.includes(ADD_CODE);
  if (hasCode && row.totalCount === newTotal) {
    return { action: 'skip', reason: 'already migrated' };
  }
  const next = stripSystemFields(row);
  next.foundCodes = hasCode ? [...found] : [...found, ADD_CODE];
  // The correction that puzzle1_add_li never needed: a rejected-but-correct
  // guess stops being recorded as a mistake.
  next.wrongCodes = wrong.filter((code) => code !== ADD_CODE);
  next.totalCount = newTotal;
  next.backfilled = true;
  return { action: 'patch', next, movedFromWrong: wrong.includes(ADD_CODE) };
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
  console.log(`Target: credit "${ADD_CODE}", drop it from wrongCodes, bump totalCount`);
  console.log(`Puzzles: ${TARGETS.map((t) => `#${t.puzzleId}->${t.newTotal}`).join(', ')}\n`);

  const counts = { skipped: 0, patched: 0, moved: 0, errors: 0 };

  for (const { puzzleId, newTotal } of TARGETS) {
    const q = await queryDocs({
      connString: conn, dbName: DB, containerName: C,
      query: 'SELECT * FROM c WHERE c.puzzleId = @pid',
      parameters: [{ name: '@pid', value: puzzleId }],
      partitionKey: puzzleId,
    });
    if (!q.ok) {
      console.error(`Query failed for #${puzzleId}: ${JSON.stringify(q)}`);
      process.exit(1);
    }
    console.log(`puzzleId=${puzzleId}: ${q.docs.length} rows`);

    for (const row of q.docs) {
      const plan = planRow(row, newTotal);
      if (plan.action === 'skip') {
        counts.skipped++;
        continue;
      }
      counts.patched++;
      if (plan.movedFromWrong) counts.moved++;
      const tag = plan.movedFromWrong ? ' [had gq as WRONG -> moved to found]' : '';
      console.log(`  patch: id=${row.id} (local=${row.local === true}, was ${(row.foundCodes || []).length}/${row.totalCount})${tag}`);
      if (dryRun) continue;
      const res = await insertDoc({
        connString: conn, dbName: DB, containerName: C,
        partitionKey: puzzleId, doc: plan.next, upsert: true,
      });
      if (!res.ok) {
        counts.errors++;
        console.error(`  ! upsert failed: ${JSON.stringify(res)}`);
      }
    }
  }

  console.log('\nSummary:');
  console.log(`  patched: ${counts.patched}`);
  console.log(`  of those, gq moved from wrongCodes to foundCodes: ${counts.moved}`);
  console.log(`  skipped (already migrated): ${counts.skipped}`);
  if (counts.errors) console.log(`  errors: ${counts.errors}`);
  if (dryRun) console.log('\n(no rows were modified — re-run with --apply to write)');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { planRow, stripSystemFields, TARGETS, ADD_CODE };
