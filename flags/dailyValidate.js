/**
 * Hard-rule catalog validation, shared by the agent-side push tool
 * (`authoring/push.mjs`) and the test suite (`flags/daily.test.js`).
 * Throws on the first rule violation; returns nothing on success.
 *
 * Scope of enforcement (rules from `.claude/skills/daily-puzzle-author/SKILL.md`):
 *
 *   Rule 1 — drift detector: stored answers == filter resolution today
 *   Rule 3 — every answer code is a sovereign country
 *   Rule 4 — sequential `n` AND contiguous Warsaw dates (Feature R)
 *   Rule 7 — en + pl description present
 *
 * The other hard rules (2, 5, 6, 14, 15) are author-time concerns
 * already gated by the test suite (`flags/daily.test.js`) on every PR.
 */

import { parseFilterString } from './findFlag.js';
import { matchesFilters } from './flagsFilter.js';
import { flagsGamePool, loadCountries } from './group.js';
import { isValidScope } from './superlative.js';
import { METRIC_FILES } from './metrics/index.js';
import RAW_COUNTRIES from './countries.json' with { type: 'json' };

// flagsGamePool expects loadCountries-processed objects (normalized
// fields, derived arrays). Skipping loadCountries leaves the country
// objects missing fields like `colors` and matchesFilters dies with
// `Cannot read properties of undefined (reading 'includes')`.
const COUNTRIES = loadCountries(RAW_COUNTRIES);
const SOV = flagsGamePool(COUNTRIES, false);
const SOV_CODES = new Set(SOV.map((c) => c.code));
// Manual entries may reference non-sovereign flags (home nations,
// territories) that the filter DSL can't express — validated against the
// full pool instead of the sovereign one. See checkSovereignCodes.
const FULL_CODES = new Set(flagsGamePool(COUNTRIES, true).map((c) => c.code));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const METRIC_KEYS = new Set(METRIC_FILES.map((m) => m.key));

/**
 * @param {{ puzzles: any[] }} state
 */
export function validateCatalog({ puzzles }) {
  checkSequentialN(puzzles);
  checkDates(puzzles);
  checkAnswerShape(puzzles);
  checkSovereignCodes(puzzles);
  checkDescriptions(puzzles);
  checkSuperlativeShape(puzzles);
  checkDriftFree(puzzles);
}

/**
 * Rule 4a — `n` must start at 1 and increment by 1 in array order.
 *
 * @param {any[]} entries
 */
function checkSequentialN(entries) {
  for (let i = 0; i < entries.length; i++) {
    const expected = i + 1;
    if (entries[i].n !== expected) {
      throw new Error(
        `puzzles: entry at index ${i} has n=${entries[i].n}, expected ${expected}`,
      );
    }
  }
}

/**
 * Rule 4b — every entry has a YYYY-MM-DD `date`, dates are unique, dates
 * are contiguous (no gaps) from the first entry through the last.
 *
 * @param {any[]} entries
 */
function checkDates(entries) {
  for (const entry of entries) {
    if (typeof entry.date !== 'string' || !DATE_RE.test(entry.date)) {
      throw new Error(
        `puzzles #${entry.n}: date missing or not YYYY-MM-DD (got ${JSON.stringify(entry.date)})`,
      );
    }
  }
  for (let i = 1; i < entries.length; i++) {
    const prev = parseIsoDate(entries[i - 1].date);
    const curr = parseIsoDate(entries[i].date);
    const gapDays = Math.round((curr - prev) / DAY_MS);
    if (gapDays === 0) {
      throw new Error(
        `puzzles #${entries[i].n}: duplicate date ${entries[i].date} (also on #${entries[i - 1].n})`,
      );
    }
    if (gapDays !== 1) {
      throw new Error(
        `puzzles #${entries[i].n}: date ${entries[i].date} is not contiguous with #${entries[i - 1].n}'s ${entries[i - 1].date} (gap of ${gapDays} days)`,
      );
    }
  }
}

/**
 * @param {string} iso  YYYY-MM-DD
 * @returns {number}    UTC millis at midnight on that calendar day
 */
function parseIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * @param {any[]} entries
 */
function checkAnswerShape(entries) {
  for (const entry of entries) {
    if (!Array.isArray(entry.answers) || entry.answers.length === 0) {
      throw new Error(`puzzles #${entry.n}: answers must be a non-empty array`);
    }
    if (entry.kind === 'manual') {
      if (entry.filter !== undefined) {
        throw new Error(`puzzles #${entry.n}: manual entry must not carry a filter`);
      }
    } else if (entry.kind === 'superlative') {
      // A superlative's filter is optional — it only narrows the ranking
      // pool. When present it must be a real (non-empty) filter string.
      if (entry.filter !== undefined && (typeof entry.filter !== 'string' || entry.filter.length === 0)) {
        throw new Error(`puzzles #${entry.n}: superlative filter, when present, must be a non-empty string`);
      }
    } else if (typeof entry.filter !== 'string' || entry.filter.length === 0) {
      throw new Error(`puzzles #${entry.n}: filter must be a non-empty string`);
    }
  }
}

/**
 * Superlative entries carry a machine-computed roster the catalog treats as
 * frozen (like manual). This validates the *shape* of the spec — metric /
 * scope / direction / topN / title — but deliberately does NOT re-derive the
 * answers against the live metric: `population.json` refreshes yearly and a
 * released puzzle is immutable, so a live recompute would permanently break a
 * past puzzle after a refresh. Answer *correctness* (that they really are the
 * top-N) is an author-time concern enforced by `authoring/audit-superlative.mjs`
 * on still-editable, future-dated drafts. `topN === answers.length` keeps the
 * number the title promises honest with the roster actually stored.
 *
 * @param {any[]} entries
 */
function checkSuperlativeShape(entries) {
  for (const entry of entries) {
    if (entry.kind !== 'superlative') continue;
    const at = `puzzles #${entry.n}`;
    if (!METRIC_KEYS.has(entry.metric)) {
      throw new Error(`${at}: superlative metric "${entry.metric}" is not a known metric key`);
    }
    if (!isValidScope(entry.scope)) {
      throw new Error(`${at}: superlative scope "${entry.scope}" is not 'world' or a continent`);
    }
    if (entry.direction !== 'most' && entry.direction !== 'least') {
      throw new Error(`${at}: superlative direction must be 'most' or 'least' (got ${JSON.stringify(entry.direction)})`);
    }
    if (!Number.isInteger(entry.topN) || entry.topN < 1) {
      throw new Error(`${at}: superlative topN must be a positive integer (got ${JSON.stringify(entry.topN)})`);
    }
    if (entry.topN !== entry.answers.length) {
      throw new Error(`${at}: superlative topN (${entry.topN}) must equal answers.length (${entry.answers.length})`);
    }
    if (entry.filter !== undefined && !parseFilterString(entry.filter)) {
      throw new Error(`${at}: superlative filter does not parse: ${entry.filter}`);
    }
    const ti = entry.title;
    if (!ti || typeof ti.en !== 'string' || ti.en.length === 0) {
      throw new Error(`${at}: superlative title.en missing or empty`);
    }
    if (typeof ti.pl !== 'string' || ti.pl.length === 0) {
      throw new Error(`${at}: superlative title.pl missing or empty`);
    }
  }
}

/**
 * @param {any[]} entries
 */
function checkSovereignCodes(entries) {
  for (const entry of entries) {
    const allowed = entry.kind === 'manual' ? FULL_CODES : SOV_CODES;
    for (const code of entry.answers) {
      if (!allowed.has(code)) {
        const kind = entry.kind === 'manual' ? 'known country' : 'sovereign country';
        throw new Error(
          `puzzles #${entry.n}: answer "${code}" is not a ${kind} code`,
        );
      }
    }
  }
}

/**
 * @param {any[]} entries
 */
function checkDescriptions(entries) {
  for (const entry of entries) {
    const d = entry.description;
    if (!d || typeof d.en !== 'string' || d.en.length === 0) {
      throw new Error(`puzzles #${entry.n}: description.en missing or empty`);
    }
    if (typeof d.pl !== 'string' || d.pl.length === 0) {
      throw new Error(`puzzles #${entry.n}: description.pl missing or empty`);
    }
    // Optional second line; when present it needs both languages too.
    const ad = entry.additionalDescription;
    if (ad !== undefined) {
      if (!ad || typeof ad.en !== 'string' || ad.en.length === 0) {
        throw new Error(`puzzles #${entry.n}: additionalDescription.en missing or empty`);
      }
      if (typeof ad.pl !== 'string' || ad.pl.length === 0) {
        throw new Error(`puzzles #${entry.n}: additionalDescription.pl missing or empty`);
      }
    }
  }
}

/**
 * @param {any[]} entries
 */
function checkDriftFree(entries) {
  for (const entry of entries) {
    // Manual + superlative rosters are frozen — nothing to re-resolve against
    // a filter. A superlative's answers come from a metric ranking, not a
    // per-flag filter, so the drift detector doesn't apply (see
    // checkSuperlativeShape for why it's not live-recomputed here).
    if (entry.kind === 'manual' || entry.kind === 'superlative') continue;
    const parsed = parseFilterString(entry.filter);
    if (!parsed) {
      throw new Error(`puzzles #${entry.n}: filter does not parse: ${entry.filter}`);
    }
    const resolved = SOV.filter((c) => matchesFilters(c, parsed))
      .map((c) => c.code)
      .sort();
    const stored = [...entry.answers].sort();
    if (resolved.length !== stored.length || resolved.some((v, i) => v !== stored[i])) {
      throw new Error(
        `puzzles #${entry.n}: drift — filter "${entry.filter}" resolves to [${resolved.join(', ')}] but stored answers are [${stored.join(', ')}]. ` +
          `Likely cause: flags/countries.json changed since the entry was authored. Refresh the entry's answers or revert the country-data change.`,
      );
    }
  }
}
