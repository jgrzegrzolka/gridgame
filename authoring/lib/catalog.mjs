/**
 * Shared constants + helpers for the catalog CLI scripts.
 *
 * The blob is the single source of truth (Feature P Phase 3). The
 * working copy lives at `.catalog/` (gitignored). A snapshot of the
 * last pull lives at `.catalog/.snapshot/` so push can detect when
 * the blob has moved since pull (e.g. the midnight Function ran),
 * and refuse to overwrite remote progress.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const ACCOUNT = 'styetanotherquiz';
export const RESOURCE_GROUP = 'rg-yetanotherquiz';
export const CONTAINER = 'catalog';
export const BLOB_BASE = `https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}`;

export const CATALOG_DIR = '.catalog';
export const SNAPSHOT_DIR = join(CATALOG_DIR, '.snapshot');

/**
 * Files held in the catalog container. `mutatesPlayer` flips on the
 * push-time confirm prompt: `puzzles` is the single player-facing
 * blob (Feature R — dated entries, no more live/backlog split). Author
 * always pauses before publishing it. `ideas`, `parked`, `policy` are
 * author-state and push silently.
 */
export const FILES = [
  { name: 'puzzles', mutatesPlayer: true },
  { name: 'ideas', mutatesPlayer: false },
  { name: 'parked', mutatesPlayer: false },
  { name: 'policy', mutatesPlayer: false },
];

export function blobUrl(name) {
  return `${BLOB_BASE}/${name}.json`;
}

export function localPath(name) {
  return join(CATALOG_DIR, `${name}.json`);
}

export function snapshotPath(name) {
  return join(SNAPSHOT_DIR, `${name}.json`);
}

export async function ensureDirs() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
}

export async function fetchBlob(name) {
  const res = await fetch(blobUrl(name), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`fetch ${name}.json: HTTP ${res.status}`);
  }
  return res.text();
}

export async function readJsonOrNull(path) {
  try {
    const body = await readFile(path, 'utf8');
    return JSON.parse(body);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJson(path, data) {
  const body = JSON.stringify(data, null, 2) + '\n';
  await writeFile(path, body);
  return body;
}

/**
 * Stable JSON for byte-equal comparison. Two objects that round-trip
 * to the same stringified form compare equal under this — order of
 * keys is preserved via JSON.stringify's natural order, and we don't
 * try to canonicalize beyond that since our shape is array-of-objects
 * with stable insertion order.
 *
 * @param {unknown} value
 */
export function stable(value) {
  return JSON.stringify(value, null, 2) + '\n';
}
