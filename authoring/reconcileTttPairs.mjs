/**
 * One-shot reconciliation for the `tttPairs` Cosmos container.
 *
 * Before PR #551, both clients POSTed their own outcome to /api/v1/ttt/
 * result and a dropped POST on one side left that side's row out of
 * sync with the other (the (5:0) vs (0:3) split-brain Jan saw on prod).
 * The new design has only the room creator POST, server writes both
 * rows in lockstep — but Cosmos already has the historical asymmetric
 * data baked in.
 *
 * This script walks every row, finds its mirror, and reconciles the
 * counters to `max(this side, other side mirror)` per slot. The MAX
 * is correct because each Cosmos counter increments per *received*
 * POST — so if A.wins is 5 and B.losses is 3, the true game count is
 * at least 5 (A's row got 5 reports, B's row missed 2). Picking max
 * brings the lagging side up to the side that DID report accurately.
 *
 * Authentication: pulls `COSMOS_CONN` from SWA app settings via the
 * `az` CLI. No secrets ever land on disk; the value lives in memory
 * only.
 *
 * Modes:
 *   - Default (no flag): DRY RUN. Prints every asymmetric pair and
 *     what each side would become, then exits. Nothing is written.
 *   - `--apply`: Actually upsert the corrected rows. Must run dry-run
 *     first and review the report.
 *
 * Optional flag:
 *   - `--device <deviceId>`: only reconcile pairs that involve the
 *     given deviceId. Useful for Jan-scoped fixes (his own test rows)
 *     without touching other players' data.
 *
 * Usage:
 *   node authoring/reconcileTttPairs.mjs
 *   node authoring/reconcileTttPairs.mjs --device <id>
 *   node authoring/reconcileTttPairs.mjs --apply
 *   node authoring/reconcileTttPairs.mjs --device <id> --apply
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { queryDocs, insertDoc } = require('../api/src/lib/cosmos.js');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'tttPairs';

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const deviceIdx = args.indexOf('--device');
  const deviceFilter = deviceIdx >= 0 ? args[deviceIdx + 1] : null;
  return { apply, deviceFilter };
}

function fetchCosmosConn() {
  // Accept env override first so the script runs cleanly in shells
  // where `az` isn't on PATH (the agent's bash sandbox is one such
  // shell — pass the value in via `COSMOS_CONN=$(az ...) node ...`).
  if (process.env.COSMOS_CONN) return process.env.COSMOS_CONN;
  console.error('fetching COSMOS_CONN from SWA app settings…');
  const out = execFileSync(
    'az',
    [
      'staticwebapp',
      'appsettings',
      'list',
      '-n',
      'swa-yetanotherquiz-v3',
      '-g',
      'rg-yetanotherquiz',
      '--query',
      'properties.COSMOS_CONN',
      '-o',
      'tsv',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  ).toString().trim();
  if (!out) throw new Error('COSMOS_CONN is empty in SWA app settings');
  return out;
}

function normaliseMode(m) {
  const out = { wins: 0, losses: 0, draws: 0 };
  if (m && typeof m === 'object') {
    for (const k of ['wins', 'losses', 'draws']) {
      const v = m[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
    }
  }
  return out;
}

async function listAllRows(connString) {
  const res = await queryDocs({
    connString,
    dbName: DB_NAME,
    containerName: CONTAINER_NAME,
    query: 'SELECT * FROM c',
    parameters: [],
    enableCrossPartition: true,
  });
  if (!res.ok) throw new Error(`cosmos list failed: ${JSON.stringify(res)}`);
  return res.docs;
}

/**
 * For two rows (this device → that device) and (that device → this
 * device), compute the reconciled counters. Each slot becomes the max
 * of its own value and the other side's mirror:
 *   this.m3x3.wins   = max(this.m3x3.wins,   other.m3x3.losses)
 *   this.m3x3.losses = max(this.m3x3.losses, other.m3x3.wins)
 *   this.m3x3.draws  = max(this.m3x3.draws,  other.m3x3.draws)
 */
function reconcile(thisSide, otherSide) {
  const tM3 = normaliseMode(thisSide && thisSide.m3x3);
  const oM3 = normaliseMode(otherSide && otherSide.m3x3);
  return {
    m3x3: {
      wins: Math.max(tM3.wins, oM3.losses),
      losses: Math.max(tM3.losses, oM3.wins),
      draws: Math.max(tM3.draws, oM3.draws),
    },
  };
}

function modeChanged(before, after) {
  return before.wins !== after.wins || before.losses !== after.losses || before.draws !== after.draws;
}

function fmtMode(label, m) {
  return `${label}{w:${m.wins} l:${m.losses} d:${m.draws}}`;
}

async function main() {
  const { apply, deviceFilter } = parseArgs();
  const connString = fetchCosmosConn();
  const rows = await listAllRows(connString);
  console.error(`scanned ${rows.length} row(s)`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const visitedPairs = new Set();
  let asymmetricCount = 0;
  let writes = 0;

  for (const row of rows) {
    if (!row || typeof row.deviceId !== 'string' || typeof row.opponentId !== 'string') continue;
    const a = row.deviceId;
    const b = row.opponentId;
    if (deviceFilter && a !== deviceFilter && b !== deviceFilter) continue;
    // Process each unordered pair exactly once.
    const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (visitedPairs.has(pairKey)) continue;
    visitedPairs.add(pairKey);

    const aRow = byId.get(`${a}:${b}`);
    const bRow = byId.get(`${b}:${a}`);

    const aTarget = reconcile(aRow, bRow);
    const bTarget = reconcile(bRow, aRow);

    const aBefore = {
      m3x3: normaliseMode(aRow && aRow.m3x3),
    };
    const bBefore = {
      m3x3: normaliseMode(bRow && bRow.m3x3),
    };

    const aChanged = modeChanged(aBefore.m3x3, aTarget.m3x3);
    const bChanged = modeChanged(bBefore.m3x3, bTarget.m3x3);
    if (!aChanged && !bChanged) continue;

    asymmetricCount++;
    console.log(`\npair ${a.slice(0, 8)}…  ↔  ${b.slice(0, 8)}…`);
    if (aChanged || !aRow) {
      console.log(`  A→B  before: ${fmtMode('3x3', aBefore.m3x3)}`);
      console.log(`       after:  ${fmtMode('3x3', aTarget.m3x3)}`);
    }
    if (bChanged || !bRow) {
      console.log(`  B→A  before: ${fmtMode('3x3', bBefore.m3x3)}`);
      console.log(`       after:  ${fmtMode('3x3', bTarget.m3x3)}`);
    }

    if (apply) {
      if (aChanged) {
        const doc = {
          id: `${a}:${b}`,
          deviceId: a,
          opponentId: b,
          m3x3: aTarget.m3x3,
          lastOutcome: (aRow && aRow.lastOutcome) || null,
          lastPlayedAt: (aRow && aRow.lastPlayedAt) || Date.now(),
          v: 1,
        };
        const res = await insertDoc({
          connString,
          dbName: DB_NAME,
          containerName: CONTAINER_NAME,
          partitionKey: a,
          doc,
          upsert: true,
        });
        if (!res.ok) {
          console.error(`  upsert A→B failed: ${JSON.stringify(res)}`);
          process.exitCode = 1;
        } else {
          writes++;
        }
      }
      if (bChanged) {
        const doc = {
          id: `${b}:${a}`,
          deviceId: b,
          opponentId: a,
          m3x3: bTarget.m3x3,
          lastOutcome: (bRow && bRow.lastOutcome) || null,
          lastPlayedAt: (bRow && bRow.lastPlayedAt) || Date.now(),
          v: 1,
        };
        const res = await insertDoc({
          connString,
          dbName: DB_NAME,
          containerName: CONTAINER_NAME,
          partitionKey: b,
          doc,
          upsert: true,
        });
        if (!res.ok) {
          console.error(`  upsert B→A failed: ${JSON.stringify(res)}`);
          process.exitCode = 1;
        } else {
          writes++;
        }
      }
    }
  }

  console.error(`\nfound ${asymmetricCount} asymmetric pair(s)`);
  if (apply) {
    console.error(`wrote ${writes} row(s)`);
  } else if (asymmetricCount > 0) {
    console.error('dry run — no writes performed. Re-run with --apply to fix.');
  }
}

main().catch((err) => {
  console.error('fatal:', err.message || err);
  process.exit(1);
});
