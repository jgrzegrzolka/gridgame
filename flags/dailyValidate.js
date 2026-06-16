/**
 * Hard-rule catalog validation, shared by the midnight Function App
 * (`infra/release-fn/src/releaseDaily.js`) and the agent-side push
 * tool (`authoring/push.mjs`). Throws on the first rule violation;
 * returns nothing on success.
 *
 * Scope of enforcement (rules from `.claude/skills/daily-puzzle-author/SKILL.md`):
 *
 *   Rule 1 — drift detector: stored answers == filter resolution today
 *   Rule 3 — every answer code is a sovereign country
 *   Rule 4 — sequential `n` across live + backlog
 *   Rule 7 — en + pl description present
 *
 * The other hard rules (2, 5, 6, 14, 15) are author-time concerns
 * already gated by the test suite (`flags/daily.test.js`) on every PR.
 * A backlog entry that violates any of them couldn't have got there
 * in the first place, so re-checking at promote time is redundant.
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

/**
 * @param {{ live: any[], backlog: any[] }} state
 */
export function validateCatalog({ live, backlog }) {
  checkSequential(live, 'live', 1);
  checkSequential(backlog, 'backlog', live.length + 1);
  checkAnswerShape(live, 'live');
  checkAnswerShape(backlog, 'backlog');
  checkSovereignCodes(live, 'live');
  checkSovereignCodes(backlog, 'backlog');
  checkDescriptions(live, 'live');
  checkDescriptions(backlog, 'backlog');
  checkDriftFree(live, 'live');
  checkDriftFree(backlog, 'backlog');
}

/**
 * @param {any[]} entries
 * @param {string} label
 * @param {number} startN
 */
function checkSequential(entries, label, startN) {
  for (let i = 0; i < entries.length; i++) {
    const expected = startN + i;
    if (entries[i].n !== expected) {
      throw new Error(
        `${label}: entry at index ${i} has n=${entries[i].n}, expected ${expected}`,
      );
    }
  }
}

/**
 * @param {any[]} entries
 * @param {string} label
 */
function checkAnswerShape(entries, label) {
  for (const entry of entries) {
    if (!Array.isArray(entry.answers) || entry.answers.length === 0) {
      throw new Error(`${label} #${entry.n}: answers must be a non-empty array`);
    }
    if (entry.kind === 'manual') {
      if (entry.filter !== undefined) {
        throw new Error(`${label} #${entry.n}: manual entry must not carry a filter`);
      }
    } else if (typeof entry.filter !== 'string' || entry.filter.length === 0) {
      throw new Error(`${label} #${entry.n}: filter must be a non-empty string`);
    }
  }
}

/**
 * @param {any[]} entries
 * @param {string} label
 */
function checkSovereignCodes(entries, label) {
  for (const entry of entries) {
    for (const code of entry.answers) {
      if (!SOV_CODES.has(code)) {
        throw new Error(
          `${label} #${entry.n}: answer "${code}" is not a sovereign country code`,
        );
      }
    }
  }
}

/**
 * @param {any[]} entries
 * @param {string} label
 */
function checkDescriptions(entries, label) {
  for (const entry of entries) {
    const d = entry.description;
    if (!d || typeof d.en !== 'string' || d.en.length === 0) {
      throw new Error(`${label} #${entry.n}: description.en missing or empty`);
    }
    if (typeof d.pl !== 'string' || d.pl.length === 0) {
      throw new Error(`${label} #${entry.n}: description.pl missing or empty`);
    }
  }
}

/**
 * @param {any[]} entries
 * @param {string} label
 */
function checkDriftFree(entries, label) {
  for (const entry of entries) {
    if (entry.kind === 'manual') continue;
    const parsed = parseFilterString(entry.filter);
    if (!parsed) {
      throw new Error(`${label} #${entry.n}: filter does not parse: ${entry.filter}`);
    }
    const resolved = SOV.filter((c) => matchesFilters(c, parsed))
      .map((c) => c.code)
      .sort();
    const stored = [...entry.answers].sort();
    if (resolved.length !== stored.length || resolved.some((v, i) => v !== stored[i])) {
      throw new Error(
        `${label} #${entry.n}: drift — filter "${entry.filter}" resolves to [${resolved.join(', ')}] but stored answers are [${stored.join(', ')}]. ` +
          `Likely cause: flags/countries.json changed since the entry was authored. Refresh the entry's answers or revert the country-data change.`,
      );
    }
  }
}
