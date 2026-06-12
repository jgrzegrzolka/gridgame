/**
 * Soft moderation gate for nicknames. Pure function; substring match
 * against a small curated EN + PL list after normalising the input
 * (lowercase, accent-fold, strip non-alphanumeric). Catches the common
 * casual asshat — not a real anti-abuse system. Limits to know:
 *
 *   - **English + Polish only.** Other languages will slip through.
 *   - **Substring match.** Catches "shitty" by hitting "shit". Will
 *     occasionally fire on innocent strings whose substring happens to
 *     match (e.g. "Scunthorpe"); we accept this for a hobby site where
 *     a save-rejected user can just rename. Live with the false-positive
 *     rate rather than blowing up our complexity.
 *   - **Basic leetspeak only.** Stripping non-alphanumeric handles the
 *     common evasions (`s.h.i.t`, `sh!t`). Determined evaders (`5h1t`,
 *     `phuck`) get through. Not worth a cat-and-mouse arms race here.
 *   - **No combined-word patterns.** "fuckface" hits "fuck"; "fjuck"
 *     does not — and that's fine.
 *
 * The list is intentionally small and well-known. If you find yourself
 * tempted to grow it into hundreds of entries: switch to the npm
 * `obscenity` package (or similar), don't reinvent the wheel.
 *
 * CLAUDE.md / FEATURE.md Feature H baseline still applies — moderation
 * is best-effort, collisions are allowed, no uniqueness check. This
 * lib just raises the bar above "no check at all".
 */

// Each entry is the normalised (already lowercased, alphanumeric-only)
// form of a slur, common in-the-wild offensive term, or impersonation
// name we want to block. EN + PL only. Sorted alphabetically. Substring
// match means short forms catch longer compounds.
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
 * Strip Unicode combining marks (accent-fold) and non-alphanumeric
 * characters, then lowercase. After this, "Łukasz" → "lukasz",
 * "F.U.C.K" → "fuck", "Sh!t" → "sht". The substring match below runs
 * on the result.
 *
 * @param {string} s
 * @returns {string}
 */
function normalise(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

/**
 * Returns true if any entry in the blocklist appears as a substring of
 * the normalised input. Empty / whitespace-only inputs return false —
 * the upstream length check is responsible for those.
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isOffensiveNickname(raw) {
  const n = normalise(raw);
  if (n.length === 0) return false;
  for (const term of BLOCKED) {
    if (n.includes(term)) return true;
  }
  return false;
}

module.exports = { isOffensiveNickname, BLOCKED };
