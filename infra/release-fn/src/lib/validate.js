/**
 * Hard-rule catalog validation, run after `promote()` and before the
 * blob write. If any rule throws, the Function App marks the run as
 * Failed, the catalog is unchanged in blob, and Jan gets an App
 * Insights alert in the morning.
 *
 * Scope of enforcement at this step (rules from the daily-puzzle-author
 * skill):
 *
 *   Rule 1 — drift detector: stored answers == filter resolution today
 *   Rule 3 — every answer code is a sovereign country
 *   Rule 4 — sequential `n` across live + backlog
 *   Rule 7 — en + pl description present
 *
 * The other hard rules (2, 5, 6, 14, 15) are author-time concerns —
 * they fail at the moment an entry is added to the backlog, not as a
 * consequence of promotion. Phase 3's drift-detector CI step runs the
 * full validation against every PR, so authoring-time bugs are still
 * caught before the entry can ever reach backlog. Promoting the next
 * already-authored entry doesn't re-create those failure modes.
 *
 * If a follow-up audit makes us want to harden this further, port the
 * remaining rules into this file — the test in `flags/daily.test.js`
 * already has the reference shape for each.
 */

import { parseFilterString } from '../../../../flags/findFlag.js';
import { matchesFilters } from '../../../../flags/flagsFilter.js';
import { flagsGamePool, loadCountries } from '../../../../flags/group.js';
import RAW_COUNTRIES from '../../../../flags/countries.json' with { type: 'json' };

// flagsGamePool expects loadCountries-processed objects (normalized
// fields, derived arrays). Skipping loadCountries leaves the country
// objects missing fields like `colors` and matchesFilters dies with
// `Cannot read properties of undefined (reading 'includes')`.
const COUNTRIES = loadCountries(RAW_COUNTRIES);
const SOV = flagsGamePool(COUNTRIES, false);
const SOV_CODES = new Set(SOV.map((c) => c.code));

/**
 * Throws on the first rule violation. Returns nothing on success.
 *
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
