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

/**
 * @param {{ puzzles: any[] }} state
 */
export function validateCatalog({ puzzles }) {
  checkSequentialN(puzzles);
  checkDates(puzzles);
  checkAnswerShape(puzzles);
  checkSovereignCodes(puzzles);
  checkDescriptions(puzzles);
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
    } else if (typeof entry.filter !== 'string' || entry.filter.length === 0) {
      throw new Error(`puzzles #${entry.n}: filter must be a non-empty string`);
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
  }
}

/**
 * @param {any[]} entries
 */
function checkDriftFree(entries) {
  for (const entry of entries) {
    if (entry.kind === 'manual') continue;
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
