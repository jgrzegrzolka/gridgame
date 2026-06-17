/**
 * Catalog source — single source of truth is the public-read Azure
 * blob `styetanotherquiz/catalog`. The page fetches `live.json`,
 * `backlog.json`, `ideas.json`, etc. directly from there in both prod
 * and local dev (the blob is small and CORS-allowed for both origins).
 *
 * Phase 3 of Feature P removed the Phase 1 repo fallback — there are
 * no longer any `daily/*.json` files committed to the repo, so falling
 * back to them would 404. The authoring path is `npm run catalog:pull`
 * → edit `.catalog/` → `npm run catalog:push`, not commit-and-deploy.
 */

const BLOB_BASE = 'https://styetanotherquiz.blob.core.windows.net/catalog';

/** @type {Record<'puzzles' | 'live' | 'backlog' | 'ideas' | 'parked' | 'policy', string>} */
const BLOB_FILE = {
  puzzles: 'puzzles.json',
  live: 'live.json',
  backlog: 'backlog.json',
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
