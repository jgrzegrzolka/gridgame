/**
 * Validate the working copy in `.catalog/` and upload changed files
 * to blob. Push refuses to overwrite a remote that has moved since
 * the last pull — most likely the midnight Function promoted while
 * you were editing. Refused pushes print the file that drifted and
 * the fix (`npm run catalog:pull`).
 *
 * For files that affect what players see — `live.json` + `backlog.json`
 * — push shows a diff and prompts before uploading. Pass `--yes` or
 * `-y` to skip the prompt (useful for batch operations like the
 * generator pipeline, where the author has already reviewed via
 * `/daily/ideas/` and just wants the upload).
 *
 * Auth uses the Storage account key fetched via `az storage account
 * keys list` (the same path the Phase 1 workflow used) — runs anywhere
 * Jan is logged into `az`. No additional role assignment needed.
 */

import { writeFile } from 'node:fs/promises';
import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import {
  ACCOUNT, RESOURCE_GROUP, CONTAINER, FILES,
  localPath, snapshotPath, fetchBlob, readJsonOrNull, stable,
} from './lib/catalog.mjs';
import { validateCatalog } from '../flags/dailyValidate.js';

const argv = process.argv.slice(2);
const yes = argv.includes('--yes') || argv.includes('-y');

async function main() {
  // 1. Read working copy, snapshot, and current remote.
  const local = {};
  const snapshot = {};
  const remote = {};
  for (const { name } of FILES) {
    local[name] = await readJsonOrNull(localPath(name));
    snapshot[name] = await readJsonOrNull(snapshotPath(name));
    if (local[name] === null) {
      throw new Error(`missing ${localPath(name)} — run 'npm run catalog:pull' first.`);
    }
    if (snapshot[name] === null) {
      throw new Error(`missing snapshot for ${name}.json — run 'npm run catalog:pull' first.`);
    }
    remote[name] = JSON.parse(await fetchBlob(name));
  }

  // 2. Conflict check: did the remote move since the last pull?
  const drifted = FILES
    .map(({ name }) => ({ name, drifted: stable(remote[name]) !== stable(snapshot[name]) }))
    .filter((x) => x.drifted)
    .map((x) => x.name);
  if (drifted.length > 0) {
    console.error(`remote drift on ${drifted.join(', ')} since last pull — run 'npm run catalog:pull' to reconcile, then re-apply edits.`);
    process.exit(2);
  }

  // 3. What changed locally vs the snapshot?
  const changed = FILES
    .filter(({ name }) => stable(local[name]) !== stable(snapshot[name]))
    .map(({ name }) => name);
  if (changed.length === 0) {
    console.log('nothing changed locally — nothing to push.');
    return;
  }
  console.log(`changed: ${changed.join(', ')}`);

  // 4. Validate the resulting catalog state.
  try {
    validateCatalog({ live: local.live, backlog: local.backlog });
    console.log('validate: OK');
  } catch (err) {
    console.error(`validate FAILED: ${err.message}`);
    process.exit(1);
  }

  // 5. Diff + prompt only if any player-affecting file changed.
  const playerFacing = FILES
    .filter(({ name, mutatesPlayer }) => mutatesPlayer && changed.includes(name))
    .map(({ name }) => name);
  if (playerFacing.length > 0 && !yes) {
    for (const name of playerFacing) {
      console.log(`--- diff ${name}.json ---`);
      // git is in PATH on dev machines; it returns exit code 1 when
      // there's a diff, which is the success path here.
      const r = spawnSync(
        'git',
        ['diff', '--no-index', '--no-color', snapshotPath(name), localPath(name)],
        { encoding: 'utf8' },
      );
      process.stdout.write(r.stdout || '(diff utility unavailable)\n');
    }
    const ok = await prompt('Proceed with upload? [y/N] ');
    if (!ok) {
      console.log('cancelled.');
      process.exit(0);
    }
  }

  // 6. Upload each changed file + refresh its snapshot.
  const key = execSync(
    `az storage account keys list --account-name ${ACCOUNT} --resource-group ${RESOURCE_GROUP} --query "[0].value" -o tsv`,
    { encoding: 'utf8' },
  ).trim();
  const cred = new StorageSharedKeyCredential(ACCOUNT, key);
  const client = new BlobServiceClient(`https://${ACCOUNT}.blob.core.windows.net`, cred);
  const container = client.getContainerClient(CONTAINER);

  for (const name of changed) {
    const body = stable(local[name]);
    const blob = container.getBlockBlobClient(`${name}.json`);
    await blob.upload(body, Buffer.byteLength(body, 'utf8'), {
      blobHTTPHeaders: {
        blobContentType: 'application/json',
        blobCacheControl: 'max-age=60',
      },
    });
    await writeFile(snapshotPath(name), body);
    console.log(`pushed ${name}.json`);
  }
  console.log('done.');
}

function prompt(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
