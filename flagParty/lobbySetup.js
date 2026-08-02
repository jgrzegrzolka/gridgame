/**
 * Lobby setup card: the two rules the collapsed card and the start button need,
 * kept out of the DOM glue so both can be pinned by a test.
 *
 * The card collapses now (see `.setup-head` in index.css), so the summary line
 * IS the setup for anyone who never opens it — a wrong or stale summary is a
 * host reading the wrong game back. That is the reason it resolves here rather
 * than being assembled inline where the chevron is wired.
 */

/**
 * The collapsed card's one-line summary, as i18n descriptors rather than text —
 * `t()` lives on the page, and keeping this pure is what lets the test assert
 * the composition instead of a rendered string in one language.
 *
 * Three parts, in the order the mock reads them: what you play first, how big
 * the game is, and how many rounds that works out to. The middle part changes
 * shape with the sizing mode — the length table names a size ("Short"), even
 * picks names a per-player count ("Everyone picks 2") — because those are the
 * two different things the host actually chose.
 *
 * The rounds part is `muted: true`: it is arithmetic derived from the other
 * two, not a third choice, and painting it in the caption grey is what stops
 * the line reading as three equal settings.
 *
 * @param {object} o
 * @param {{ key: string | undefined, fallback: string | undefined }} o.mode
 *   the first round's SHORT label, already resolved (`modeShortLabel`) — passed
 *   in rather than resolved here so this module stays free of the mode catalog.
 * @param {string} o.length  'short' | 'medium' | 'long' (ignored when picks is set)
 * @param {number | null} o.picks  per-player rounds when even-picks is on, else null
 * @param {number} o.rounds  what the game would actually deal right now
 * @returns {Array<{ key: string, fallback: string, args?: Record<string, string | number>, muted?: boolean }>}
 */
export function setupSummaryParts({ mode, length, picks, rounds }) {
  /** @type {Record<string, { key: string, fallback: string }>} */
  const LENGTHS = {
    short: { key: 'party.lengthShort', fallback: 'Short' },
    medium: { key: 'party.lengthMedium', fallback: 'Medium' },
    long: { key: 'party.lengthLong', fallback: 'Long' },
  };
  const size = picks === null
    ? (LENGTHS[length] || LENGTHS.medium)
    // Its own key rather than the field label plus a number: "Everyone picks" and
    // "Everyone picks 2" are not the same sentence, and a language where the
    // count lands anywhere but the end could not build the second from the first.
    : { key: 'party.everyonePicksN', fallback: 'Everyone picks {n}', args: { n: picks } };
  return [
    // A mode with no short key would print "undefined"; MODE_LABELS covers every
    // first-round option and `modeLabels.test.js` pins that, so this fallback is
    // belt-and-braces for a mode id that never reaches the radiogroup.
    { key: mode.key || 'party.modeShort.flagsAll', fallback: mode.fallback || 'Flags' },
    size,
    { key: 'party.lengthRounds', fallback: '{r} rounds', args: { r: rounds }, muted: true },
  ];
}

/**
 * Whether the host may start. **Two seats, not one.** A room of one used to be
 * allowed on the reasoning that you might want to play alone and that more
 * players can still join before the tap — but Flag Party is a race: every
 * scoring bucket the show has (speed, only-one-right, closeness) is a comparison
 * against other seats, so a solo game silently pays out on a scoreboard of one
 * and none of it means anything. Adding a bot is one tap away in the seat
 * directly above the button, which is why the gate can afford to be firm.
 *
 * Bots count. They are seats the server drives (`partyGameServer.syncBots`) and
 * they buzz, so a host plus one bot is a real race — the mock's pale button
 * clears the moment a bot is seated, and that is the rule here.
 *
 * @param {{ seatCount: number }} o  seats PRESENT (bots included)
 */
export function canStartGame({ seatCount }) {
  return seatCount >= 2;
}
