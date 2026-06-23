// Feature S Phase 5.5 backfill — one-time pre-Phase-6 data rescue.
//
// Phase 3 moved engagement signal *writes* off `engagementEvents` and into
// `localStorage` + `profile.syncBlob`. The client's first-boot migration
// (flags/engagementMigration.js) was supposed to copy each device's
// pre-Phase-3 counts from `engagementEvents` (via `dailyMe`) into its
// `syncBlob` before Phase 4 stripped the engagementEvents read path.
//
// In practice the Phase 3 → Phase 4 deploy window was about an hour, so
// any user who didn't visit during that window now has:
//   - their pre-Phase-3 engagement rows still in `engagementEvents`
//   - an empty syncBlob.engagement section (Phase 4 dailyMe returns
//     zeros for them, so even a late migration captures nothing)
//
// This script closes the gap server-side, profile by profile, BEFORE we
// delete the container in Phase 6:
//
//   1. Cross-partition scan every row in `profiles`.
//   2. If `syncBlob.engagement` is already populated, skip — the device's
//      own migration ran successfully; we never overwrite their canonical
//      state.
//   3. Otherwise: query `engagementEvents` for that deviceId, compute the
//      engagement section the same way pre-Phase-4 engagementCompute did
//      (per-surface share counts, coffee → boolean→1/0, quiz_play 60s →
//      sorted-deduped day log), and upsert the profile with a populated
//      `syncBlob.engagement`.
//
// Idempotent: re-running skips every profile whose blob got populated by
// a previous run. Safe to dry-run repeatedly. After --apply, every
// profile has either a populated or empty-but-present engagement section,
// and `engagementEvents` can be deleted.
//
// Pre-Phase-1a orphans (engagementEvents rows whose deviceId never had a
// profile created — possible because auto-profiles only landed in Phase
// 1a) are silently ignored. Those devices had events but never customised
// or otherwise put a row in `profiles`; nothing meaningful to recover for
// achievement display.
//
// Usage:
//   node scripts/backfill-engagement-syncblob.cjs --dry-run    (default — no writes)
//   node scripts/backfill-engagement-syncblob.cjs --apply      (actually write)
//
// COSMOS_CONN must be set. Pull from SWA appsettings:
//   COSMOS_CONN="$(az staticwebapp appsettings list -n swa-yetanotherquiz-v3 -g rg-yetanotherquiz --query 'properties.COSMOS_CONN' -o tsv)"

const { queryDocs, insertDoc } = require('../api/src/lib/cosmos');

const DB = 'yetanotherquiz';
const PROFILES = 'profiles';
const EVENTS = 'engagementEvents';

// Mirrors the closed list in flags/engagementCounters.js. Adding a new
// surface here also requires teaching the client counter about it.
const SHARE_SURFACES = ['daily', 'flagquiz', 'findflag', 'ttt'];

// Cosmos system fields we never echo back on upsert (insertDoc would
// reject them anyway, but stripping keeps the doc shape stable).
const SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

function stripSystemFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Build the `engagement` section of `syncBlob` from raw engagementEvents
 * rows. Mirrors what the pre-Phase-4 engagementCompute + flags/
 * engagementMigration combination produced when a client migrated via
 * dailyMe.
 *
 * Shape matches flags/engagementCounters.js#emptyState() — same v:1
 * envelope and field names — so the client can inflate localStorage
 * from it without translation.
 *
 * Returns a fully-formed section even when `events` is empty; the
 * caller decides whether to upsert that vs. skipping (we always upsert
 * here so the field is *present*, blocking re-migration from the
 * post-Phase-4 dailyMe-returns-zeros path).
 *
 * @param {Array<Record<string, any>>} events
 * @returns {{ v: 1, shares: { daily: number, flagquiz: number, findflag: number, ttt: number }, coffeeClickCount: number, quiz60sDayLog: number[] }}
 */
function computeEngagementSection(events) {
  const shares = { daily: 0, flagquiz: 0, findflag: 0, ttt: 0 };
  let coffeeClicked = false;
  const days = new Set();

  for (const ev of events || []) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.kind === 'coffee_click') {
      coffeeClicked = true;
      continue;
    }
    if (ev.kind === 'share') {
      const surface = ev.payload && typeof ev.payload === 'object' ? ev.payload.surface : null;
      if (SHARE_SURFACES.includes(surface)) shares[surface]++;
      continue;
    }
    if (ev.kind === 'quiz_play') {
      const mode = ev.payload && typeof ev.payload === 'object' ? ev.payload.mode : null;
      if (mode !== '60s') continue;
      if (typeof ev.dayId !== 'number' || !Number.isFinite(ev.dayId) || !Number.isInteger(ev.dayId) || ev.dayId < 0) continue;
      days.add(ev.dayId);
    }
    // daily_start, findflag_play, anything else — pure analytics with no
    // achievement consumer, silently dropped (matches Phase 3's decision
    // to delete those emit sites).
  }

  return {
    v: 1,
    shares,
    coffeeClickCount: coffeeClicked ? 1 : 0,
    quiz60sDayLog: [...days].sort((a, b) => a - b),
  };
}

/**
 * Decide what to do with one profile row + its matching events.
 *
 * @param {Record<string, any>} profile  the profile doc (with system fields)
 * @param {Array<Record<string, any>>} events  events for this profile's deviceId
 * @returns {{ action: 'skip', reason: string } | { action: 'populate', next: Record<string, any>, hadEvents: boolean }}
 */
function planRow(profile, events) {
  const blob = profile.syncBlob;
  if (blob && typeof blob === 'object' && blob.engagement && typeof blob.engagement === 'object') {
    return { action: 'skip', reason: 'syncBlob.engagement already populated' };
  }

  const engagement = computeEngagementSection(events);
  const hadEvents = (events && events.length > 0);

  // Preserve every other field on the profile (createdAt, linkedAt,
  // deletionRequestedAt, nickname, nicknameAuto, ...). Only the syncBlob
  // changes. If the profile already had a syncBlob with other sections
  // (e.g. a future Phase-5 `attempts` section), preserve those too —
  // we only fill in the missing `engagement` slot.
  const existingBlob = (blob && typeof blob === 'object') ? blob : null;
  const nextBlob = {
    v: 1,
    ...(existingBlob || {}),
    engagement,
  };

  const next = stripSystemFields(profile);
  next.syncBlob = nextBlob;

  return { action: 'populate', next, hadEvents };
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

  // Cross-partition scan of every profile. Free tier covers the RU cost,
  // and this runs once.
  const profilesRes = await queryDocs({
    connString: conn, dbName: DB, containerName: PROFILES,
    query: 'SELECT * FROM c',
    parameters: [],
    enableCrossPartition: true,
  });
  if (!profilesRes.ok) {
    console.error('profiles scan failed:', profilesRes);
    process.exit(1);
  }

  console.log(`Found ${profilesRes.docs.length} profile row(s) to inspect\n`);

  const counts = {
    skipped_already_populated: 0,
    populated_with_events: 0,
    populated_empty: 0,
    errors: 0,
  };

  for (const profile of profilesRes.docs) {
    const deviceId = profile.deviceId || profile.id;
    if (typeof deviceId !== 'string' || deviceId.length === 0) {
      console.warn(`  ! profile row has no deviceId/id; skipping: ${JSON.stringify({ id: profile.id })}`);
      continue;
    }

    // Single-partition fetch of the device's events.
    const eventsRes = await queryDocs({
      connString: conn, dbName: DB, containerName: EVENTS,
      query: 'SELECT c.kind, c.payload, c.dayId FROM c',
      parameters: [],
      partitionKey: deviceId,
    });
    if (!eventsRes.ok) {
      console.error(`  ! events query failed for ${deviceId}:`, eventsRes);
      counts.errors++;
      continue;
    }

    const plan = planRow(profile, eventsRes.docs);
    if (plan.action === 'skip') {
      counts.skipped_already_populated++;
      console.log(`  skip: ${deviceId} (${plan.reason})`);
      continue;
    }

    const bucket = plan.hadEvents ? 'populated_with_events' : 'populated_empty';
    counts[bucket]++;
    const eng = plan.next.syncBlob.engagement;
    console.log(`  ${bucket}: ${deviceId} — shares=${JSON.stringify(eng.shares)} coffee=${eng.coffeeClickCount} 60sDays=${eng.quiz60sDayLog.length}`);

    if (dryRun) continue;

    const upsertRes = await insertDoc({
      connString: conn, dbName: DB, containerName: PROFILES,
      partitionKey: deviceId, doc: plan.next, upsert: true,
    });
    if (!upsertRes.ok) {
      counts.errors++;
      console.error(`  ! upsert failed: ${JSON.stringify(upsertRes)}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  populated with events from engagementEvents: ${counts.populated_with_events}`);
  console.log(`  populated empty (profile existed but no events): ${counts.populated_empty}`);
  console.log(`  skipped (syncBlob.engagement already populated): ${counts.skipped_already_populated}`);
  if (counts.errors) console.log(`  errors: ${counts.errors}`);
  if (dryRun) console.log('\n(no rows were modified — re-run with --apply to write)');
  if (!dryRun && counts.errors === 0) {
    console.log('\nDone. engagementEvents container is now safe to delete (Phase 6).');
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { planRow, computeEngagementSection, stripSystemFields, SHARE_SURFACES };
