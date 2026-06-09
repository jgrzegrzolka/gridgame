/**
 * Minimal Cosmos DB SQL REST client. We talk to Cosmos over plain HTTPS
 * rather than via @azure/cosmos because the SDK + its transitive deps
 * consistently triggered SWA's "Failure during content distribution" at
 * deploy time, even after the type/minify/lib-path landmines from B2b
 * were all closed. The REST surface we actually need is tiny — one POST
 * to insert a document, mapped to HTTP status codes for success / 409
 * conflict / other.
 *
 * Auth shape (per Cosmos REST docs):
 *
 *   Authorization: type=master&ver=1.0&sig=<base64-hmac-sha256>
 *
 * where the signature is HMAC-SHA256 of the canonical string
 *
 *   <verb>\n<resourceType>\n<resourceLink>\n<date>\n\n
 *
 * all lowercased, using the master key (base64-decoded) as the HMAC key.
 * The final header value is URL-encoded.
 */

const crypto = require('node:crypto');

const COSMOS_API_VERSION = '2018-12-31';

/**
 * Parse the connection string Azure hands us:
 *   "AccountEndpoint=https://<acct>.documents.azure.com:443/;AccountKey=<base64>;"
 */
function parseConnString(conn) {
  const parts = {};
  for (const segment of String(conn || '').split(';')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    parts[segment.slice(0, idx).trim()] = segment.slice(idx + 1).trim();
  }
  if (!parts.AccountEndpoint || !parts.AccountKey) {
    throw new Error('Invalid Cosmos connection string');
  }
  return { endpoint: parts.AccountEndpoint, key: parts.AccountKey };
}

/**
 * Build the Authorization header value for a Cosmos REST request.
 * Returns the URL-encoded value ready to drop into `Authorization:`.
 */
function signRequest(verb, resourceType, resourceLink, date, masterKey) {
  const text =
    `${verb.toLowerCase()}\n` +
    `${resourceType.toLowerCase()}\n` +
    `${resourceLink}\n` +
    `${date.toLowerCase()}\n` +
    `\n`;
  const keyBuf = Buffer.from(masterKey, 'base64');
  const sig = crypto.createHmac('sha256', keyBuf).update(text, 'utf8').digest('base64');
  return encodeURIComponent(`type=master&ver=1.0&sig=${sig}`);
}

/**
 * Insert a single document. Returns:
 *   - { ok: true }                                            on 201 Created
 *   - { ok: false, error: 'conflict' }                        on 409
 *   - { ok: false, error: 'cosmos_error', status, body }      otherwise
 *
 * Network errors throw — callers can decide whether to surface as 500.
 */
async function insertDoc({ connString, dbName, containerName, partitionKey, doc }) {
  const { endpoint, key } = parseConnString(connString);
  const resourceLink = `dbs/${dbName}/colls/${containerName}`;
  const url = `${endpoint.replace(/\/$/, '')}/${resourceLink}/docs`;
  const date = new Date().toUTCString();
  const authorization = signRequest('POST', 'docs', resourceLink, date, key);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'x-ms-date': date,
      'x-ms-version': COSMOS_API_VERSION,
      'Content-Type': 'application/json',
      // Cosmos wants the partition key as a JSON-encoded array (even though
      // there's only ever one value).
      'x-ms-documentdb-partitionkey': JSON.stringify([partitionKey]),
    },
    body: JSON.stringify(doc),
  });

  if (res.status === 201) return { ok: true };
  if (res.status === 409) return { ok: false, error: 'conflict' };

  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  return { ok: false, error: 'cosmos_error', status: res.status, body };
}

module.exports = { parseConnString, signRequest, insertDoc, COSMOS_API_VERSION };
