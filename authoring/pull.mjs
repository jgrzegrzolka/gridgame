/**
 * Pull all catalog blobs into `.catalog/` and snapshot them so the
 * subsequent `catalog:push` can detect remote drift. Read-only,
 * anonymous — the container is public-read.
 *
 * Idempotent: re-running overwrites the working copy with whatever
 * is currently in blob. Any unpushed local edits in `.catalog/` are
 * lost. (No git, no undo — this matches the simpler-than-git mental
 * model the team agreed to for Phase 3.)
 */

import { writeFile } from 'node:fs/promises';
import { FILES, localPath, snapshotPath, ensureDirs, fetchBlob } from './lib/catalog.mjs';

async function main() {
  await ensureDirs();
  for (const { name } of FILES) {
    const body = await fetchBlob(name);
    await writeFile(localPath(name), body);
    await writeFile(snapshotPath(name), body);
    console.log(`pulled ${name}.json (${body.length} bytes)`);
  }
  console.log('done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
