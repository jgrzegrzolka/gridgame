/**
 * Server-side puzzle-id → release-date mapping. Mirrors the migration
 * script's `assignDate` exactly (anchor N=12 → 2026-06-17, walk ±days)
 * so the server's notion of "today's puzzle" matches the catalog the
 * page is reading.
 *
 * Used by `dailyResult.js` to reject submissions for not-yet-released
 * puzzleIds — necessary because the dated catalog is now public-read
 * and a malicious client could otherwise POST a result for tomorrow's
 * puzzleId today and pollute aggregate stats.
 *
 * Pure date arithmetic; no Cosmos / blob fetch on the hot path. The
 * trade-off is that this couples to the "exactly one puzzle per
 * calendar day" invariant — the same one Feature R's validator
 * enforces ("dates contiguous, no gaps"). If we ever deliberately skip
 * a day, this helper has to switch to a blob lookup.
 */

const ANCHOR_N = 12;
const ANCHOR_DATE = '2026-06-17';

function addDaysIso(anchorDate, deltaDays) {
  const [y, m, d] = anchorDate.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const out = new Date(t);
  const yy = out.getUTCFullYear();
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Release date for puzzle #n as a YYYY-MM-DD string in Warsaw time.
 *
 * @param {number} n
 * @returns {string}
 */
function puzzleDateIso(n) {
  return addDaysIso(ANCHOR_DATE, n - ANCHOR_N);
}

/**
 * Is puzzle #n past its release date in Warsaw? `today` is a
 * Warsaw-local YYYY-MM-DD string.
 *
 * @param {number} n
 * @param {string} today
 * @returns {boolean}
 */
function isReleased(n, today) {
  return puzzleDateIso(n) <= today;
}

module.exports = { puzzleDateIso, isReleased };
