/**
 * Shared verdict-state plumbing for the ideas review UI. Both the
 * tile grid (`page.js`) and the single-idea play page (`play.js`)
 * read and write the same localStorage key, so the verdict you set
 * on either surface is reflected on the other immediately.
 *
 * Storage shape: JSON object `{ "<filterString>": "approved" | "rejected" }`.
 * Backward-compat with the v1 array-of-approved-filters from the
 * first version of this UI: arrays are migrated to objects on read.
 *
 * Orphan entries (filters no longer in `ideas.json`) are harmless
 * — they just sit there. We don't prune; cost is bytes, benefit is
 * bug-free idempotency when the generator re-runs.
 */

/** @typedef {'approved' | 'rejected'} Verdict */

export const REVIEW_KEY = 'gridgame.ideas.reviewed';

/**
 * Stable verdict key for an idea, shared by the grid and play surfaces so a
 * verdict set on one shows on the other. Filter ideas key on the filter string
 * (the original contract); superlative ideas have no criterion filter, so they
 * key on a serialized spec instead.
 *
 * @param {{ kind?: string, filter?: string, metric?: string, scope?: string, direction?: string, topN?: number }} idea
 * @returns {string}
 */
export function ideaKey(idea) {
  if (idea.kind === 'superlative') {
    return `sup:${idea.metric}:${idea.scope}:${idea.direction}:${idea.topN}:${idea.filter ?? ''}`;
  }
  return idea.filter ?? '';
}

/** @returns {Map<string, Verdict>} */
export function loadReviewState() {
  try {
    const raw = window.localStorage.getItem(REVIEW_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Map(parsed.map((f) => [String(f), /** @type {Verdict} */ ('approved')]));
    }
    if (parsed && typeof parsed === 'object') {
      const m = new Map();
      for (const [k, v] of Object.entries(parsed)) {
        if (v === 'approved' || v === 'rejected') m.set(k, v);
      }
      return m;
    }
    return new Map();
  } catch {
    return new Map();
  }
}

/** @param {Map<string, Verdict>} map */
export function saveReviewState(map) {
  window.localStorage.setItem(REVIEW_KEY, JSON.stringify(Object.fromEntries(map)));
}
