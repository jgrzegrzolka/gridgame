/**
 * Pure sanitiser for nickname strings. Rejects characters that have no
 * legitimate display-name use but can cause visual chaos when the result
 * lands in a shared surface like the daily leaderboard:
 *
 *   - C0 / C1 control chars (U+0000-001F, U+007F-009F) — usually pasted
 *     accidentally, occasionally on purpose to break terminals.
 *   - Bidi overrides + isolates (U+202A-202E, U+2066-2069) — would render
 *     text right-to-left or re-flow surrounding content. A nickname like
 *     "<RLO>OlleH" reads as "Hello" but stays a different string, so a
 *     benign-looking name could spoof a well-known user.
 *   - Zero-width / invisible chars (U+200B-200F, U+2028-2029, U+202F,
 *     U+205F, U+2060-2063, U+FEFF, U+034F) — could fake "two different"
 *     identical-looking names or render as empty.
 *
 * Also collapses internal whitespace (newlines, tabs, multiple spaces)
 * to a single space so a multi-line paste can't break the leaderboard
 * row layout. Leading/trailing whitespace is trimmed; the caller's
 * length check runs on the cleaned result.
 *
 * Returns `{ ok: true, value: <cleaned> }` or
 * `{ ok: false, error: 'invalid_nickname' }`. Reject (vs strip-silently)
 * means the client sees feedback that the name needs editing rather than
 * a save that quietly stored something different from what was typed.
 */

// Reject pattern, built via String.fromCharCode so the literal file
// stays clean of invisible characters that would themselves trip the
// linter / git diff tooling. Categories listed inline.
const REJECT_RE = new RegExp(
  '[' +
  // C0 control range MINUS \t (U+0009), \n (U+000A), \r (U+000D) — those
  // three are caught by the collapse step below and turned into spaces.
  // Everything else in C0 has no business in a display name.
  '\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F' +
  '\\u007F-\\u009F' +   // DEL + C1 control
  '\\u202A-\\u202E' +   // bidi embeds + overrides
  '\\u2066-\\u2069' +   // bidi isolates
  '\\u200B-\\u200F' +   // zero-width + LTR/RTL marks
  '\\u2028-\\u2029' +   // line / paragraph separator
  '\\u202F' +            // narrow no-break space
  '\\u205F' +            // medium mathematical space
  '\\u2060-\\u2063' +   // word joiner + invisible operators
  '\\uFEFF' +            // ZWNBSP / BOM
  '\\u034F' +            // combining grapheme joiner
  ']'
);

/**
 * @param {string} raw  — the body's nickname field, already type-checked
 *                       as a string by the caller.
 * @returns {{ ok: true, value: string } | { ok: false, error: 'invalid_nickname' }}
 */
function sanitizeNickname(raw) {
  if (REJECT_RE.test(raw)) {
    return { ok: false, error: 'invalid_nickname' };
  }
  // Collapse internal whitespace then trim ends. "Alice\nBraver" becomes
  // "Alice Braver"; a leading-space paste becomes "Braver". The caller's
  // min-length check runs on the cleaned result so a pure-whitespace
  // submission fails as "invalid_nickname" downstream.
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return { ok: true, value: collapsed };
}

module.exports = { sanitizeNickname };
