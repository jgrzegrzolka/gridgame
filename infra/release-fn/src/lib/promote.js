/**
 * Move the first entry of `backlog` to the end of `live`. Pure — inputs
 * are not mutated. Mirrors the logic that lived in
 * `scripts/release-next.mjs` during Phase 1 (which still exists at the
 * time of writing but is unreached: the Logic App is disabled and the
 * Function below is the only midnight runner).
 *
 * @param {{ n: number }[]} live
 * @param {{ n: number }[]} backlog
 * @returns {{ live: { n: number }[], backlog: { n: number }[], n: number }}
 */
export function promote(live, backlog) {
  if (backlog.length === 0) {
    throw new Error('Backlog is empty — refill catalog/backlog.json.');
  }
  const next = backlog[0];
  return {
    live: [...live, next],
    backlog: backlog.slice(1),
    n: next.n,
  };
}
