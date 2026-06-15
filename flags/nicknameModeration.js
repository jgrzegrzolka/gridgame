/**
 * Client-side mirror of `api/src/lib/blockedNicknames.js` so the
 * profile page can live-disable the Save button while the user is
 * typing an offensive name — no round-trip, no chance of hitting the
 * 60/min rate limit by clicking Save repeatedly on a rejected string.
 *
 * The server-side module remains the source of truth (defence in
 * depth): a determined client that bypasses this check still gets
 * rejected at the API. The duplication here buys faster, calmer UX
 * for the common case.
 *
 * **Keep this list in sync with `api/src/lib/blockedNicknames.js`.**
 * Both files use the same normalisation (strip combining diacritics
 * + non-alphanumerics, lowercase) and substring-match the result.
 * Server-side is CommonJS; this is ESM. Tests on both sides pin the
 * same alphabetical list so drift is loud.
 *
 * Same caveats as the server-side version:
 *   - English + Polish only.
 *   - Substring match — catches "shitty" via "shit", will sometimes
 *     fire on innocent strings whose substring matches.
 *   - Basic leetspeak only (alphanumeric stripping handles `sh!t`,
 *     `s.h.i.t`, not `5h1t`).
 *   - No compound-word patterns. Acceptable for a hobby site.
 */

const BLOCKED = Object.freeze([
  // English
  'admin',
  'arsehole',
  'asshole',
  'bastard',
  'bitch',
  'cock',
  'cunt',
  'dick',
  'fag',
  'faggot',
  'fuck',
  'kike',
  'mod',
  'moderator',
  'nazi',
  'nigger',
  'nigga',
  'piss',
  'pussy',
  'retard',
  'shit',
  'slut',
  'spic',
  'twat',
  'whore',
  // Polish (no diacritics — accent-fold strips them before match)
  'chuj',
  'cipa',
  'dupek',
  'fiut',
  'huj',
  'jebac',
  'kurwa',
  'pierdol',
  'piczka',
  'pizda',
  'skurwiel',
  'spierdalaj',
  'szmata',
  'zjebany',
]);

/**
 * Strip combining marks (accent-fold) and non-alphanumeric characters,
 * then lowercase. "Łukasz" → "lukasz", "F.U.C.K" → "fuck", "Sh!t" →
 * "sht". Substring match runs on the result.
 *
 * @param {string} s
 * @returns {string}
 */
function normalise(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

/**
 * True if any BLOCKED entry appears as a substring of the normalised
 * input. Empty / whitespace-only inputs return false — upstream length
 * checks own that case.
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function isOffensiveNickname(raw) {
  if (typeof raw !== 'string') return false;
  const n = normalise(raw);
  if (n.length === 0) return false;
  for (const term of BLOCKED) {
    if (n.includes(term)) return true;
  }
  return false;
}

export { BLOCKED };
