import { MAX_SEATS } from '../flags/partyRoom.js';

/**
 * The empty seat at the foot of the lobby's player list — the invitation to add
 * a bot.
 *
 * A bot is a SEAT, not a game setting, which is why this lives with the seats
 * instead of in the host's setup card: pressing "Add bot" there changed a list
 * in a different panel, and the field competed for attention with the two
 * settings every player reads. So its visibility is a seat question, not a
 * settings one:
 *
 * - only the HOST may add one (the server enforces this too — the client just
 *   doesn't offer what would be refused);
 * - only in the LOBBY, because a seat cannot join a game already running;
 * - only while the room has room, and here the seat HIDES rather than
 *   disabling. A chair that isn't there says "room full" more plainly than a
 *   greyed-out button, and it leaves one less dead control on a screen that
 *   already had too many.
 *
 * @param {{ isHost: boolean, inLobby: boolean, seatCount: number }} s
 * @returns {boolean} whether to render the empty seat
 */
export function showBotSeat({ isHost, inLobby, seatCount }) {
  return isHost && inLobby && seatCount < MAX_SEATS;
}
