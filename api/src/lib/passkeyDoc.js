/**
 * Pure builder for the Cosmos `passkeys` row written after a
 * successful registration. One row per credential — a user with N
 * devices has N rows, all carrying the same `identityId`.
 *
 * Doc shape (Feature C / Cosmos container `passkeys`, partition
 * `/credentialID`, no TTL):
 *   {
 *     id:            credentialID,    // same as partition key — point reads by either field hit the same row
 *     credentialID:  string,           // base64url, returned by the browser
 *     identityId:    string,           // UUID — the *user* identity, links credentials across devices
 *     publicKey:     string,           // base64url COSE-encoded public key from the attestation
 *     counter:       number,           // signature counter for replay protection (bumped on each verify)
 *     transports:    string[],         // platform / cross-platform / nfc / etc. — informs future auth UI
 *     deviceIdHint:  string,           // the deviceId of the registering browser. Advisory: lets a future
 *                                      //   management UI render "this credential came from your phone"
 *                                      //   without us tracking it strictly. NOT trusted for security.
 *     createdAt:     number,           // unix ms
 *     v:             1,
 *   }
 *
 * Why credentialID as partition key + id: the auth flow's only lookup
 * pattern is "browser sent me this credentialID, find me the matching
 * public key". A single point-read on partition + id is the cheapest
 * Cosmos op. The cross-partition "all credentials for this identityId"
 * query (used by a future management UI) is rare and fine to be
 * cross-partition.
 *
 * `identityId` lives on every row; no separate `users` container in
 * V1. If we later need per-user metadata, add `users` then.
 *
 * Time + uuid injected for pinnable tests.
 */

/**
 * @param {{
 *   credentialID: string,
 *   identityId: string,
 *   publicKey: string,
 *   counter: number,
 *   transports?: string[],
 *   deviceIdHint: string,
 *   now: number,
 * }} input
 * @returns {| { ok: true, doc: Record<string, unknown> }
 *            | { ok: false, error: string }}
 */
function buildPasskeyDoc({ credentialID, identityId, publicKey, counter, transports, deviceIdHint, now }) {
  if (typeof credentialID !== 'string' || credentialID.length === 0) {
    return { ok: false, error: 'invalid_credentialID' };
  }
  if (typeof identityId !== 'string' || identityId.length === 0) {
    return { ok: false, error: 'invalid_identityId' };
  }
  if (typeof publicKey !== 'string' || publicKey.length === 0) {
    return { ok: false, error: 'invalid_publicKey' };
  }
  if (!Number.isInteger(counter) || counter < 0) {
    return { ok: false, error: 'invalid_counter' };
  }
  if (typeof deviceIdHint !== 'string' || deviceIdHint.length === 0) {
    return { ok: false, error: 'invalid_deviceIdHint' };
  }
  if (!Number.isInteger(now) || now <= 0) {
    return { ok: false, error: 'invalid_now' };
  }
  /** @type {string[]} */
  const cleanTransports = Array.isArray(transports)
    ? transports.filter((t) => typeof t === 'string' && t.length > 0).slice(0, 8)
    : [];

  return {
    ok: true,
    doc: {
      id: credentialID,
      credentialID,
      identityId,
      publicKey,
      counter,
      transports: cleanTransports,
      deviceIdHint,
      createdAt: now,
      v: 1,
    },
  };
}

module.exports = { buildPasskeyDoc };
