/**
 * Audit puzzles for **flag-data ambiguity** — the case where a flag's
 * colour count or colour membership could reasonably be disputed by a
 * player. Two veto rules, same shape:
 *
 *   1. **Count veto.** A puzzle whose filter constrains `colorCount` is
 *      invalid if any flag has `ambiguousColorCount` values that
 *      straddle the constraint — i.e. some plausible count satisfies
 *      the constraint and another doesn't.
 *   2. **Membership veto.** A puzzle whose filter includes or excludes
 *      a colour `X` is invalid if any flag has `ambiguousColors`
 *      containing `X` AND flipping presence-of-X for that flag changes
 *      its answer-set membership.
 *
 * Both checks scan the full country list (not just `puzzle.answers`)
 * because a player's disagreement can either drop an answer ("I count
 * Bhutan as 4 colours, so it's not in `colorCount:3`") or add one ("I
 * count Bhutan as 4 colours, so it IS in `colorCount:>=4`").
 *
 * See `DATA_FEATURE.md` Feature DA for the full rationale.
 */

import { parseFilterString } from './findFlag.js';
import { matchesFilters } from './flagsFilter.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * @typedef {Object} AmbiguityViolation
 * @property {'count' | 'membership'} kind
 * @property {string} country  ISO code
 * @property {string} name
 * @property {string} detail   human-readable explanation
 */

/**
 * @param {'=' | '>=' | '<='} op
 * @param {number} value
 * @param {number} n
 */
function satisfies(op, value, n) {
  if (op === '=') return value === n;
  if (op === '>=') return value >= n;
  if (op === '<=') return value <= n;
  return false;
}

/**
 * Find every ambiguity violation triggered by `filter` across `countries`.
 * Pure: no I/O, doesn't depend on puzzle.answers (computes from the filter).
 *
 * @param {string | undefined} filter
 * @param {Country[]} countries
 * @returns {AmbiguityViolation[]}
 */
export function auditFilter(filter, countries) {
  // Manual entries have no filter, and superlative entries only sometimes
  // carry an optional pool-narrowing one. `parseFilterString` assumes a
  // string, so guard before delegating — a filter-less entry has nothing
  // to audit.
  if (typeof filter !== 'string' || filter === '') return [];
  const parsed = parseFilterString(filter);
  if (!parsed) return [];

  /** @type {AmbiguityViolation[]} */
  const violations = [];

  // --- Count veto ---
  // Restrict to flags that pass all *non-count* filters — otherwise we'd
  // false-positive on e.g. Bhutan (ambig count [3,4]) for an
  // `continent:Europe,colorCount:3` puzzle where Bhutan is excluded
  // by continent anyway and no count flip could pull it into scope.
  if (parsed.colorCount) {
    const { op, n } = parsed.colorCount;
    const nonCount = /** @type {typeof parsed} */ ({
      ...parsed,
      colorCount: null,
    });
    for (const c of countries) {
      const ambig = /** @type {number[] | undefined} */ (
        /** @type {any} */ (c).ambiguousColorCount
      );
      if (!ambig) continue;
      if (!matchesFilters(c, nonCount)) continue;
      const canonical = c.colors.length;
      const canonicalSat = satisfies(op, canonical, n);
      const straddles = ambig.some(
        (v) => v !== canonical && satisfies(op, v, n) !== canonicalSat,
      );
      if (straddles) {
        violations.push({
          kind: 'count',
          country: c.code,
          name: c.name,
          detail:
            `canonical count ${canonical} ` +
            `${canonicalSat ? 'satisfies' : 'misses'} colorCount${op}${n}; ` +
            `ambig ${JSON.stringify(ambig)} straddles the constraint`,
        });
      }
    }
  }

  // --- Membership veto ---
  if (parsed.color.include.size > 0 || parsed.color.exclude.size > 0) {
    for (const c of countries) {
      const ambigColors = /** @type {string[] | undefined} */ (
        /** @type {any} */ (c).ambiguousColors
      );
      if (!ambigColors) continue;
      for (const x of ambigColors) {
        const inInclude = parsed.color.include.has(x);
        const inExclude = parsed.color.exclude.has(x);
        if (!inInclude && !inExclude) continue;

        // Flip presence-of-X and re-check membership. `c.colors` is a
        // non-enumerable getter; spreading `c` drops it, so we set a
        // plain `colors` array on the clone — matchesFilters reads
        // `country.colors`, so the clone is enough.
        const canonicalHasX = c.colors.includes(x);
        const flippedColors = canonicalHasX
          ? c.colors.filter((col) => col !== x)
          : [...c.colors, x];
        const flipped = /** @type {Country} */ (
          /** @type {any} */ ({ ...c, colors: flippedColors })
        );
        const canonicalMatch = matchesFilters(c, parsed);
        const flippedMatch = matchesFilters(flipped, parsed);
        if (canonicalMatch !== flippedMatch) {
          const token = inInclude ? `color:${x}` : `color:!${x}`;
          violations.push({
            kind: 'membership',
            country: c.code,
            name: c.name,
            detail:
              `${token} contested by ambiguousColors: canonical is ` +
              `${canonicalMatch ? 'in' : 'out of'} the answer set, ` +
              `plausible flip is ${flippedMatch ? 'in' : 'out of'} it`,
          });
          break; // one disagreement per (country, filter) is enough
        }
      }
    }
  }

  return violations;
}

/**
 * Convenience wrapper for puzzle records. Delegates to `auditFilter`.
 *
 * @param {{ filter?: string }} puzzle
 * @param {Country[]} countries
 */
export function auditPuzzle(puzzle, countries) {
  return auditFilter(puzzle.filter, countries);
}
