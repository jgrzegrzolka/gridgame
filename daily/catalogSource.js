/**
 * Catalog source — single source of truth is the public-read Azure
 * blob `styetanotherquiz/catalog`. The page fetches `puzzles.json`,
 * `ideas.json`, etc. directly from there in both prod and local dev
 * (the blob is small and CORS-allowed for both origins).
 *
 * Feature R replaced the old `live.json` + `backlog.json` split with a
 * single dated `puzzles.json`; the page filters by date locally. The
 * authoring path is `npm run catalog:pull` → edit `.catalog/` → `npm
 * run catalog:push`, not commit-and-deploy.
 */

const BLOB_BASE = 'https://styetanotherquiz.blob.core.windows.net/catalog';

/** @type {Record<'puzzles' | 'ideas' | 'parked' | 'policy', string>} */
const BLOB_FILE = {
  puzzles: 'puzzles.json',
  ideas: 'ideas.json',
  parked: 'parked.json',
  policy: 'policy.json',
};

/**
 * @param {keyof typeof BLOB_FILE} name
 * @returns {string}
 */
export function catalogUrl(name) {
  return `${BLOB_BASE}/${BLOB_FILE[name]}`;
}

/**
 * @param {keyof typeof BLOB_FILE} name
 * @returns {Promise<any>}  matches the implicit `any` returned by the
 *                          native `fetch().json()` it replaces
 */
export async function fetchCatalog(name) {
  const res = await fetch(catalogUrl(name));
  if (!res.ok) throw new Error(`fetch ${name}.json: HTTP ${res.status}`);
  return res.json();
}
