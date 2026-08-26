'use strict';

/**
 * Central wrapper applied to every HTTP handler (see api/src/index.js). It
 * does two things the SWA-managed Functions host won't do for us:
 *
 *  1. Enrich telemetry with the caller's identity. deviceId (and puzzleId
 *     when present) is stamped onto a per-invocation trace that shares the
 *     request's operation_Id, so any request/exception can be pivoted to its
 *     device and back via a join. This is the server-side echo of the
 *     browser JS-SDK telemetry initializer in analytics/index.js. We can't
 *     stamp the auto-collected request row directly without the
 *     applicationinsights SDK (deploy-packaging + double-instrumentation
 *     risk — see CLAUDE.md's @azure/cosmos note), so a correlated trace is
 *     the no-dependency equivalent.
 *
 *  2. Turn a >= 500 response into a failed invocation. Azure Functions
 *     stamps request telemetry success=true whenever the handler *returns*
 *     (even a 500); only a *thrown* invocation is recorded as a failure and
 *     lands in the Failures blade / failed-request alerts. 4xx are left as
 *     successful requests on purpose: client errors must not page anyone.
 */

/**
 * Pull the identifiers worth stamping on per-request telemetry from a
 * request's query params and parsed body. Pure, so it's unit-tested; the
 * async request-reading glue lives in wrapHandler.
 *
 * Body wins over query for a given key (POST bodies are the authoritative
 * source; query is the GET fallback). Missing / non-string values are
 * omitted, never emitted as "undefined".
 *
 * `puzzleId` is additionally accepted as a NUMBER, because that is its real
 * wire shape — `validateResult` requires an int, so the client always posts
 * one. The original string-only gate therefore dropped it from every trace
 * the daily endpoints emitted, and a rejected submission on 2026-08-26 could
 * not be pivoted to the puzzle it belonged to. `deviceId` stays string-only:
 * it is an opaque UUID and a numeric one would be a bug worth seeing as one.
 *
 * @param {{ get?: (k: string) => (string | null) } | undefined} query
 * @param {any} body
 * @returns {Record<string, string>}
 */
function pickTelemetryIds(query, body) {
  const fromQuery = (k) =>
    query && typeof query.get === 'function' ? query.get(k) : null;
  /** @param {unknown} v */
  const str = (v) => (typeof v === 'string' && v.length > 0 ? v : '');
  /** @param {unknown} v */
  const idish = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));

  /** @type {Record<string, string>} */
  const out = {};
  const deviceId = str(body && body.deviceId) || str(fromQuery('deviceId'));
  const puzzleId = idish(body && body.puzzleId) || str(fromQuery('puzzleId'));
  if (deviceId) out.deviceId = deviceId;
  if (puzzleId) out.puzzleId = puzzleId;
  return out;
}

/**
 * Read telemetry ids off a request without consuming the body the handler
 * will read. Query params are free; a JSON body is read from a `.clone()`
 * so the original stream stays intact. Any failure (non-JSON body, no clone
 * support) degrades to whatever the query yielded, never throws.
 *
 * @param {any} req
 * @returns {Promise<Record<string, string>>}
 */
async function readTelemetryIds(req) {
  try {
    const method = req && req.method ? String(req.method).toUpperCase() : 'GET';
    let body;
    if (method !== 'GET' && method !== 'HEAD' && req && typeof req.clone === 'function') {
      try {
        body = await req.clone().json();
      } catch {
        body = undefined;
      }
    }
    return pickTelemetryIds(req && req.query, body);
  } catch {
    return {};
  }
}

/**
 * Wrap an Azure Functions HTTP handler with the enrichment + failure
 * behavior described above.
 *
 * @param {(req: any, context: any) => Promise<any>} handler
 * @returns {(req: any, context: any) => Promise<any>}
 */
function wrapHandler(handler) {
  return async function wrapped(req, context) {
    const ids = await readTelemetryIds(req);
    const res = await handler(req, context);
    const status = res && typeof res.status === 'number' ? res.status : 200;

    // Every endpoint answers a rejection with `{ error: <stable code> }`, but
    // that code only ever reached the caller — nothing recorded WHY a request
    // was refused. On 2026-08-26 a real 13/13 daily submission was rejected
    // 400 and the reason was unrecoverable afterwards: the status alone can't
    // tell `invalid_durationMs` from `not_released`. Lifting the code here
    // (rather than logging in each handler) covers every 4xx the API can
    // return, present and future.
    const error = status >= 400 && res && res.jsonBody && typeof res.jsonBody.error === 'string'
      ? res.jsonBody.error
      : '';

    // Correlated trace: shares this invocation's operation_Id, so it joins to
    // the auto-collected request row. Only emit when we actually have an id —
    // no point in an empty trace for health checks. A rejection is worth a
    // trace even with no ids at all, since the error code is the whole point.
    // Needs `Function` at Information in host.json or the host filters it
    // (same trap as the original request-telemetry bug).
    if ((Object.keys(ids).length > 0 || error) && context && typeof context.info === 'function') {
      context.info('apiTelemetry', { ...ids, status, ...(error ? { error } : {}) });
    }

    if (status >= 500) {
      const name = context && context.functionName ? context.functionName : 'unknown';
      // The thrown Error is what the host turns into a failed request +
      // exception telemetry. Name the function so the Failures blade points
      // at the right handler (the stack alone lands here).
      throw new Error(`server_error: ${name} returned ${status}`);
    }
    return res;
  };
}

module.exports = { wrapHandler, pickTelemetryIds };
