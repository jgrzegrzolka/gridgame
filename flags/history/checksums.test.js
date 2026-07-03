// Immutability guard: historical flag SVGs must never change in place.
//
// They are served `immutable, max-age=1yr` and referenced by bare URLs, so an
// in-place overwrite serves stale bytes for a year (PR #664 -> #665). To change
// a design, add a NEW filename and repoint flagFacts.js; don't edit the old one.
//
// This test pins each SVG's content hash. If you see it fail:
//  - You ADDED a new SVG: run `npm run history:checksums` to pin it.
//  - You CHANGED an existing SVG: don't. Revert it and add a new filename
//    instead (the winged-harp lesson). The stale-cache trap is why.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSvgs, readManifest, hashSvg, historyDir, manifestPath } from '../../scripts/history-checksums.mjs';
import { join } from 'node:path';

test('every history SVG is pinned in checksums.json', () => {
  const manifest = readManifest();
  const missing = listSvgs().filter((f) => !Object.prototype.hasOwnProperty.call(manifest, f));
  assert.deepEqual(
    missing,
    [],
    `New history SVG(s) not pinned: ${missing.join(', ')}. Run \`npm run history:checksums\`.`,
  );
});

test('no pinned SVG has changed content (immutable, cached for a year)', () => {
  const manifest = readManifest();
  const changed = [];
  for (const f of listSvgs()) {
    if (!Object.prototype.hasOwnProperty.call(manifest, f)) continue;
    if (hashSvg(join(historyDir, f)) !== manifest[f]) changed.push(f);
  }
  assert.deepEqual(
    changed,
    [],
    `History SVG content changed in place: ${changed.join(', ')}. These files are ` +
      `served immutable (1-year cache) by bare URL, so overwriting one ships stale ` +
      `bytes to prod. Revert and add a NEW filename instead, then repoint flagFacts.js.`,
  );
});

test('checksums.json has no orphan entries (file deleted without repinning)', () => {
  const manifest = readManifest();
  const onDisk = new Set(listSvgs());
  const orphans = Object.keys(manifest).filter((f) => !onDisk.has(f));
  assert.deepEqual(
    orphans,
    [],
    `checksums.json references missing file(s): ${orphans.join(', ')} (${manifestPath}). ` +
      `Run \`npm run history:checksums\` to prune.`,
  );
});
