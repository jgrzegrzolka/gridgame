/**
 * Catalog source selector.
 *
 * The released daily catalog lives in an Azure blob (container `catalog`
 * on `styetanotherquiz`, anonymous read, `Cache-Control: max-age=60`).
 * In prod the page fetches from the blob so puzzle promotion is
 * decoupled from the SWA deploy — see FEATURE.md Feature P. In local
 * dev the page reads the JSON files from the repo unchanged.
 *
 * Phase 1 transitional behaviour: if the blob fetch fails in prod, fall
 * back to the repo-served path so a misconfigured blob never blanks the
 * site. The fallback (and the repo files themselves) go away in Phase 3.
 */

const BLOB_BASE = 'https://styetanotherquiz.blob.core.windows.net/catalog';

/** @type {Record<'live' | 'backlog' | 'ideas' | 'parked' | 'policy', string>} */
const BLOB_FILE = {
  live: 'live.json',
  backlog: 'backlog.json',
  ideas: 'ideas.json',
  parked: 'parked.json',
  policy: 'policy.json',
};

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * @param {'live' | 'backlog' | 'ideas' | 'parked' | 'policy'} name
 * @param {{ hostname: string, devPath: string }} env
 * @returns {string}
 */
export function catalogUrl(name, { hostname, devPath }) {
  if (isLocalHost(hostname)) return devPath;
  return `${BLOB_BASE}/${BLOB_FILE[name]}`;
}

/**
 * @param {'live' | 'backlog' | 'ideas' | 'parked' | 'policy'} name
 * @param {string} devPath  repo-relative path used in local dev and as
 *                          the Phase 1 prod fallback
 * @returns {Promise<any>}  matches the implicit `any` returned by the
 *                          native `fetch().json()` it replaces
 */
export async function fetchCatalog(name, devPath) {
  const host = window.location.hostname;
  const url = catalogUrl(name, { hostname: host, devPath });
  try {
    const res = await fetch(url);
    if (res.ok) return res.json();
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (isLocalHost(host)) throw err;
    const fallback = await fetch(devPath);
    if (!fallback.ok) throw err;
    return fallback.json();
  }
}
