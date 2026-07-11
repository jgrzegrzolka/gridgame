/**
 * Continent-classification zoom captions for the daily result screen.
 *
 * Pure logic: no DOM, no fetch. Same shape and purpose as `populationRank.js`
 * (a global per-flag fact installed via `setZoomNotes`), but for the handful of
 * flags whose continent a player commonly disagrees with. In a continent puzzle
 * ("European flags with a cross") a player clicks Georgia (its flag has five
 * crosses), it isn't in the answer set because we classify Georgia as Asia, and
 * it lands in the result screen's "Most missed" rail. Tapping it should explain
 * why, turning a "the game is wrong" moment into a geography fact.
 *
 * These are neutral geographic notes, not "your click was wrong" justifications.
 * The set is only the genuine straddlers: countries whose land, or common
 * perception, crosses a Europe / Asia / Africa boundary. Classification here
 * follows the single-continent-per-country rule the data uses (capital plus
 * majority population), which matches Olympic / atlas / quiz convention.
 *
 * Only surfaced on continent-scoped puzzles (see `continentScopeOf`): in a
 * worldwide puzzle Georgia is a valid answer, so the note would be noise.
 */

import { parseFilterString } from './findFlag.js';

/**
 * The straddler flags and their classification notes (`{ en, pl }` per code).
 * @type {Record<string, { en: string, pl: string }>}
 */
export const CONTINENT_NOTES = {
  ge: {
    en: 'Classified here as Asia. Georgia is in the South Caucasus, south of the Caucasus watershed, but often joins Europe for sport and politics.',
    pl: 'Zaklasyfikowana tutaj jako Azja. Gruzja leży na Zakaukaziu, na południe od działu wodnego Kaukazu, ale w sporcie i polityce często zalicza się ją do Europy.',
  },
  am: {
    en: 'Classified here as Asia. Armenia is in the South Caucasus, south of the Caucasus watershed, but often joins European bodies in sport and politics.',
    pl: 'Zaklasyfikowana tutaj jako Azja. Armenia leży na Zakaukaziu, na południe od działu wodnego Kaukazu, ale w sporcie i polityce często należy do struktur europejskich.',
  },
  az: {
    en: 'Classified here as Asia. Azerbaijan is mostly in the South Caucasus, south of the Caucasus watershed, but often competes in European events.',
    pl: 'Zaklasyfikowany tutaj jako Azja. Azerbejdżan leży głównie na Zakaukaziu, na południe od działu wodnego Kaukazu, ale często rywalizuje w zawodach europejskich.',
  },
  kz: {
    en: 'Classified here as Asia. A strip west of the Ural River is in Europe, but the capital and most of Kazakhstan are in Asia.',
    pl: 'Zaklasyfikowany tutaj jako Azja. Pas na zachód od rzeki Ural leży w Europie, ale stolica i większość Kazachstanu znajdują się w Azji.',
  },
  tr: {
    en: 'Classified here as Asia. European Istanbul sits in Europe, but the capital Ankara and most of Türkiye are in Asia.',
    pl: 'Zaklasyfikowana tutaj jako Azja. Europejski Stambuł leży w Europie, ale stolica Ankara i większość Turcji znajdują się w Azji.',
  },
  ru: {
    en: 'Classified here as Europe. Russia reaches deep into Asia, but Moscow and about three quarters of the population are in Europe.',
    pl: 'Zaklasyfikowana tutaj jako Europa. Rosja sięga głęboko w Azję, ale Moskwa i około trzech czwartych ludności znajdują się w Europie.',
  },
  cy: {
    en: 'Classified here as Europe. Cyprus is geographically in the Middle East, but is politically and culturally European and an EU member.',
    pl: 'Zaklasyfikowany tutaj jako Europa. Cypr leży geograficznie na Bliskim Wschodzie, ale politycznie i kulturowo należy do Europy oraz jest członkiem UE.',
  },
  eg: {
    en: 'Classified here as Africa. The Sinai Peninsula reaches into Asia, but the capital and most of Egypt are in Africa.',
    pl: 'Zaklasyfikowany tutaj jako Afryka. Półwysep Synaj sięga Azji, ale stolica i większość Egiptu znajdują się w Afryce.',
  },
};

/**
 * The continent a daily entry is scoped to, or null when it isn't continent-
 * scoped (so the classification notes shouldn't show).
 *   - superlative: its `scope`, unless that's 'world'.
 *   - filter entry: the `continent:<name>` include token, if any.
 *   - manual entry: never (no filter, and rosters may include territories).
 *
 * @param {{ kind?: string, scope?: string, filter?: string } | null | undefined} entry
 * @returns {string | null}
 */
export function continentScopeOf(entry) {
  if (!entry) return null;
  if (entry.kind === 'superlative') {
    return entry.scope && entry.scope !== 'world' ? entry.scope : null;
  }
  if (typeof entry.filter === 'string') {
    const parsed = parseFilterString(entry.filter);
    if (parsed && parsed.continent.include.size > 0) {
      return [...parsed.continent.include][0];
    }
  }
  return null;
}

/**
 * Zoom-note map (`{ code: { en, pl } }`) of the straddler classification notes,
 * but only for a continent-scoped puzzle. Empty object otherwise, so callers can
 * merge it unconditionally.
 *
 * @param {{ kind?: string, scope?: string, filter?: string } | null | undefined} entry
 * @returns {Record<string, { en: string, pl: string }>}
 */
export function buildContinentNotes(entry) {
  return continentScopeOf(entry) ? CONTINENT_NOTES : {};
}

/**
 * Merge several `{ code: { en, pl } }` note maps into one. When more than one
 * map carries a note for the same code, the texts are joined in argument order
 * so a flag can show, e.g., its population rank followed by its continent
 * classification. Nullish maps are skipped.
 *
 * Inputs use the loose `Record<string, Record<string, string>>` shape the zoom-
 * note pipeline passes around (baked `entry.notes`), so any note source merges
 * without a cast; the result is the concrete `{ en, pl }` shape.
 *
 * @param {...(Record<string, Record<string, string>> | null | undefined)} maps
 * @returns {Record<string, { en: string, pl: string }>}
 */
export function mergeNotes(...maps) {
  /** @type {Record<string, { en: string, pl: string }>} */
  const out = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [code, note] of Object.entries(map)) {
      if (!note) continue;
      const prev = out[code];
      out[code] = prev
        ? { en: joinSentence(prev.en, note.en), pl: joinSentence(prev.pl, note.pl) }
        : { en: note.en, pl: note.pl };
    }
  }
  return out;
}

/**
 * Join two caption sentences with a single space, ensuring the first ends in
 * terminal punctuation so the result reads as two sentences.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function joinSentence(a, b) {
  const left = a.trim();
  const punctuated = /[.!?]$/.test(left) ? left : `${left}.`;
  return `${punctuated} ${b.trim()}`;
}
