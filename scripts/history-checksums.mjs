// Immutability guard for historical flag SVGs.
//
// Files under flags/history/ are served with `Cache-Control: immutable,
// max-age=1yr` (see staticwebapp.config.json) and the flag-story timeline
// references them by a bare, unversioned URL. So overwriting one in place makes
// Cloudflare + browsers serve the STALE bytes for a year (this bit us in PR
// #664 -> #665). The rule is: never modify an existing history SVG; add a new
// filename instead.
//
// This module pins each SVG's content hash in checksums.json. The companion
// test (checksums.test.js) fails if a pinned file's content changes. The
// generator below is ADD-ONLY: it records hashes for NEW files and prunes
// entries whose file is gone, but it NEVER rewrites the hash of a file that
// still exists. So you cannot use it to silently bless an in-place edit; the
// test keeps failing until you rename (or deliberately delete the entry).
//
// After ADDING a new history SVG, run:  npm run history:checksums

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const historyDir = join(HERE, '..', 'flags', 'history');
export const manifestPath = join(historyDir, 'checksums.json');

/** Hash file content, normalising line endings so the hash is stable across
 * a CRLF (Windows) or LF (CI) checkout. SVGs are text.
 * @param {string} absPath
 * @returns {string} */
export function hashSvg(absPath) {
  const text = readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Every *.svg in flags/history/, sorted. */
export function listSvgs() {
  return readdirSync(historyDir).filter((f) => f.endsWith('.svg')).sort();
}

/** The pinned manifest (empty object if none yet). */
export function readManifest() {
  return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
}

/** Add-only rebuild: keep the existing hash for files that still exist (so a
 * modified file's mismatch is preserved and surfaces in the test), add a hash
 * for new files, drop entries for deleted files. */
export function buildManifest() {
  const existing = readManifest();
  /** @type {Record<string, string>} */
  const next = {};
  for (const f of listSvgs()) {
    next[f] = Object.prototype.hasOwnProperty.call(existing, f)
      ? existing[f]
      : hashSvg(join(historyDir, f));
  }
  return next;
}

// Run directly (npm run history:checksums) to write the manifest.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const next = buildManifest();
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n');
  const count = Object.keys(next).length;
  console.log(`Wrote ${manifestPath} (${count} history SVGs pinned).`);
}
