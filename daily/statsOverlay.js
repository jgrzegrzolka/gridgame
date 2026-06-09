/**
 * Apply the community find-rate overlay to existing flag tiles inside
 * a container (typically `#find-result-found` and `#find-missed`).
 *
 * Each `.find-tile` is expected to carry `data-code` pointing at its
 * 2-letter country code (see flagTile in playFlow.js). For each one
 * we compute `perCodeFinds[code] / totalAttempts` and append (or
 * update) a `.find-stats-pct` span inside the tile.
 *
 * Idempotent — safe to call multiple times on the same container.
 *
 * No-ops when `stats` is null/undefined or has zero attempts (no
 * meaningful comparison to display yet).
 */

/**
 * @param {{ querySelectorAll: (s: string) => any, ownerDocument: any } | HTMLElement} container
 * @param {{ totalAttempts: number, perCodeFinds: Record<string, number> } | null | undefined} stats
 */
export function applyFindRatesToTiles(container, stats) {
  if (!stats || !stats.totalAttempts) return;

  const tiles = container.querySelectorAll('.find-tile');
  for (const tile of tiles) {
    const code = tile.dataset && tile.dataset.code;
    if (!code) continue;
    const finds = (stats.perCodeFinds && stats.perCodeFinds[code]) || 0;
    const pct = Math.round((finds / stats.totalAttempts) * 100);
    upsertPctOverlay(tile, pct);
  }
}

/**
 * Add a new percentage span to the tile, or update the text on an
 * already-present one. Update path lets the function double as a
 * re-apply-after-language-switch or re-apply-after-replay handler.
 */
function upsertPctOverlay(tile, pct) {
  const existing = tile.querySelector('.find-stats-pct');
  if (existing) {
    existing.textContent = `${pct}%`;
    return;
  }
  const doc = tile.ownerDocument;
  const span = doc.createElement('span');
  span.className = 'find-stats-pct';
  span.textContent = `${pct}%`;
  tile.appendChild(span);
}
