// Feature V Phase 1c backfill — third exercise of the schema-version
// migration policy documented in infra/operations.md.
//
// Brings `quizRecords` to schema v: 2 by retiring the configKey's scope
// segment. Feature V replaced the "include territories" toggle with the
// `weird` deck, so `"<variant>:<mode>:<sov|all>"` became `"<variant>:<mode>"`.
//
// Per-slot plan (a "slot" is one (variant, mode) pair):
//   - `X:mode:sov`  → renamed to `X:mode`. Same 195-flag sovereign pool before
//                     and after, so the PB carries over untouched.
//   - `X:mode`      → already current (written since 1b deployed). Kept.
//   - `X:mode:all`  → its PB is DISCARDED. It measured the 269-flag pool
//                     (sovereign + territories + organisations) that no longer
//                     exists; it is NOT a `weird` score either, since weird is
//                     54 curated non-sovereign flags. A score against a pool
//                     that's gone is not comparable to one against the new
//                     pool, and on a small deck it could even satisfy a
//                     "Cleared" threshold it never earned.
//                     BUT its `attempts` + `lastPlayedAt` are folded into the
//                     surviving sibling: the player really did play those
//                     rounds, and those counters feed the volume achievements.
//                     Dropping them outright could revoke an earned badge.
//   - A slot whose ONLY key is `:all` has no sibling to fold into. It is
//     dropped whole. We deliberately do NOT keep a score-less entry: the
//     doc's own `isPersonalBest` compares `candidate.score > incumbent.score`,
//     and against `undefined` that is false forever — the player could never
//     set a PB on that deck again. A handful of lost attempts beats a
//     permanently broken slot. The count is reported, never silent.
//
// Collisions are real, not theoretical: 1b ships 2-part keys while pre-1c docs
// still hold the 3-part ones, so a slot can carry both. Merging uses the
// container's own PB semantics (`isPersonalBest`) and the server's own
// comparator direction (`lowerWinsFromConfigKey`) rather than a second copy
// of those rules.
//
// Not marked `backfilled: true`. Per the policy that marker means "an
// analytical field was defaulted in, treat its value as 'we never asked'".
// Nothing is defaulted here — this is a key rename plus a delete.
//
// Idempotent: a doc already at v:2 with no 3-part keys is skipped.
//
// Usage:
//   node scripts/backfill-quiz-v2.cjs --dry-run   (default)
//   node scripts/backfill-quiz-v2.cjs --apply

const { queryDocs, insertDoc } = require('../api/src/lib/cosmos');
const { isPersonalBest } = require('../api/src/lib/quizRecordDoc');
const { lowerWinsFromConfigKey } = require('../api/src/lib/quizRecordKey');

const DB = 'yetanotherquiz';
const C = 'quizRecords';
const TARGET_VERSION = 2;

const SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

function stripSystemFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Classify a configKey into the (variant, mode) slot it belongs to.
 * Returns null for a shape we don't recognise — those are left verbatim
 * rather than guessed at.
 */
function classify(configKey) {
  const parts = String(configKey).split(':');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { slot: configKey, kind: 'current' };
  }
  if (parts.length === 3 && parts[0] && parts[1] && (parts[2] === 'sov' || parts[2] === 'all')) {
    return { slot: `${parts[0]}:${parts[1]}`, kind: parts[2] };
  }
  return null;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Fold `sub` into `acc` (may be undefined) under a 2-part `slot`.
 * PB fields follow the container's own comparator; engagement counters
 * accumulate.
 */
function foldSurvivor(acc, slot, sub) {
  if (!acc) return { ...sub };
  const lowerWins = lowerWinsFromConfigKey(slot);
  // Unknown mode → keep the incumbent rather than guess a direction.
  const isPb = lowerWins === null ? false : isPersonalBest(acc, sub, lowerWins);
  return {
    score: isPb ? sub.score : acc.score,
    durationMs: isPb ? sub.durationMs : acc.durationMs,
    submittedAt: isPb ? sub.submittedAt : acc.submittedAt,
    attempts: num(acc.attempts) + num(sub.attempts),
    lastPlayedAt: Math.max(num(acc.lastPlayedAt), num(sub.lastPlayedAt)),
  };
}

function planRow(row) {
  const records = row.records || {};
  /** @type {Map<string, { survivors: any[], alls: any[] }>} */
  const bySlot = new Map();
  const unknown = {};
  let sawLegacy = false;

  for (const key of Object.keys(records).sort()) {
    const c = classify(key);
    if (!c) { unknown[key] = records[key]; continue; }
    if (c.kind !== 'current') sawLegacy = true;
    if (!bySlot.has(c.slot)) bySlot.set(c.slot, { survivors: [], alls: [] });
    const bucket = bySlot.get(c.slot);
    if (c.kind === 'all') bucket.alls.push(records[key]);
    else bucket.survivors.push(records[key]);
  }

  const next = {};
  let droppedSlots = 0;
  let droppedAttempts = 0;
  let foldedAttempts = 0;

  for (const [slot, { survivors, alls }] of [...bySlot.entries()].sort()) {
    if (survivors.length === 0) {
      // Only `:all` here — nothing to fold into. Drop whole; a score-less
      // entry would break this slot's PB comparison permanently.
      droppedSlots++;
      droppedAttempts += alls.reduce((n, s) => n + num(s.attempts), 0);
      continue;
    }
    let acc;
    for (const sub of survivors) acc = foldSurvivor(acc, slot, sub);
    // `:all` contributes engagement only — its PB measured a pool that's gone.
    for (const sub of alls) {
      foldedAttempts += num(sub.attempts);
      acc = {
        ...acc,
        attempts: num(acc.attempts) + num(sub.attempts),
        lastPlayedAt: Math.max(num(acc.lastPlayedAt), num(sub.lastPlayedAt)),
      };
    }
    next[slot] = acc;
  }

  const alreadyCurrent = !sawLegacy && row.v === TARGET_VERSION;
  if (alreadyCurrent) return { action: 'skip', reason: 'already v:2 with no legacy keys' };

  const doc = stripSystemFields(row);
  doc.records = { ...next, ...unknown };
  doc.v = TARGET_VERSION;
  return {
    action: 'migrate',
    next: doc,
    stats: {
      slots: Object.keys(next).length,
      droppedSlots,
      droppedAttempts,
      foldedAttempts,
      unknownKeys: Object.keys(unknown).length,
    },
  };
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

  const idsRes = await queryDocs({
    connString: conn, dbName: DB, containerName: C,
    query: 'SELECT VALUE c.deviceId FROM c',
    enableCrossPartition: true,
  });
  if (!idsRes.ok) { console.error('Failed listing deviceIds:', idsRes); process.exit(1); }
  console.log(`Found ${idsRes.docs.length} deviceIds in ${C}\n`);

  const totals = {
    skipped: 0, migrated: 0, errors: 0,
    keysBefore: 0, keysAfter: 0,
    droppedSlots: 0, droppedAttempts: 0, foldedAttempts: 0, unknownKeys: 0,
  };

  for (const did of idsRes.docs) {
    const r = await queryDocs({
      connString: conn, dbName: DB, containerName: C,
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: did }],
      partitionKey: did,
    });
    if (!r.ok || !r.docs[0]) { console.error(`  ! could not read deviceId=${did}`); continue; }
    const row = r.docs[0];
    const before = Object.keys(row.records || {}).length;
    const plan = planRow(row);
    if (plan.action === 'skip') { totals.skipped++; continue; }

    totals.migrated++;
    totals.keysBefore += before;
    totals.keysAfter += plan.stats.slots;
    totals.droppedSlots += plan.stats.droppedSlots;
    totals.droppedAttempts += plan.stats.droppedAttempts;
    totals.foldedAttempts += plan.stats.foldedAttempts;
    totals.unknownKeys += plan.stats.unknownKeys;

    const note = [];
    if (plan.stats.foldedAttempts) note.push(`folded ${plan.stats.foldedAttempts} :all attempts`);
    if (plan.stats.droppedSlots) note.push(`DROPPED ${plan.stats.droppedSlots} :all-only slot(s), ${plan.stats.droppedAttempts} attempts`);
    if (plan.stats.unknownKeys) note.push(`${plan.stats.unknownKeys} unknown key(s) kept verbatim`);
    console.log(`${did.slice(0, 8)}: ${before} keys → ${plan.stats.slots}${note.length ? '  [' + note.join('; ') + ']' : ''}`);

    if (dryRun) continue;
    const res = await insertDoc({
      connString: conn, dbName: DB, containerName: C,
      partitionKey: did, doc: plan.next, upsert: true,
    });
    if (!res.ok) { totals.errors++; console.error(`  ! upsert failed: ${JSON.stringify(res)}`); }
  }

  console.log('\nSummary:');
  console.log(`  docs migrated                      : ${totals.migrated}`);
  console.log(`  docs skipped (already v:2)         : ${totals.skipped}`);
  console.log(`  record keys  ${totals.keysBefore} → ${totals.keysAfter}`);
  console.log(`  :all attempts folded into siblings : ${totals.foldedAttempts} (engagement preserved)`);
  console.log(`  :all-only slots dropped            : ${totals.droppedSlots} (${totals.droppedAttempts} attempts lost — no sibling to fold into)`);
  if (totals.unknownKeys) console.log(`  unknown-shape keys kept verbatim   : ${totals.unknownKeys}`);
  if (totals.errors) console.log(`  errors: ${totals.errors}`);
  if (dryRun) console.log('\n(no rows were modified — re-run with --apply to write)');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { planRow, classify, foldSurvivor, stripSystemFields, TARGET_VERSION };
