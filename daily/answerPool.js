import { flagsGamePool } from '../flags/group.js';
import { withLocalizedAliases } from '../i18n.js';

/**
 * Build the country pool the daily game searches + renders against.
 *
 * The base is the sovereign pool — filter puzzles resolve their answers
 * against it, and that's what the "Sovereign countries only" note refers
 * to. Manual puzzles, though, can name flags the filter DSL can't express
 * — home nations (England `gb-eng`), territories, regions — as answers.
 * So we add exactly the non-sovereign codes that some catalog entry
 * references, and no others: those flags become searchable in the answer
 * input and renderable as targets, without dumping the whole territory /
 * bloc pool (`eu`, `un`, `asean`, …) into every puzzle's autocomplete.
 *
 * Shared by every daily play surface (live + backlog preview) so they all
 * accept the same answers — a manual puzzle previews on backlog exactly as
 * it plays live. The full catalog (including future-dated entries) is used
 * for `referenced`; that only makes a puzzle's territory flags searchable a
 * little early, which is harmless — they only ever *match* the puzzle that
 * lists them.
 *
 * @param {any} raw  loadCountries-processed country data
 * @param {{ answers?: string[] }[]} catalog  all catalog entries
 * @returns {import('../flags/group.js').Country[]}
 */
export function buildAnswerPool(raw, catalog) {
  const sov = flagsGamePool(raw, false);
  const sovCodes = new Set(sov.map((c) => c.code));
  const referenced = new Set(catalog.flatMap((e) => e.answers ?? []));
  const extras = flagsGamePool(raw, true).filter(
    (c) => !sovCodes.has(c.code) && referenced.has(c.code),
  );
  return withLocalizedAliases([...sov, ...extras]);
}
