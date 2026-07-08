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
 * @param {{ get?: (k: string) => (string | null) } | undefined} query
 * @param {any} body
 * @returns {Record<string, string>}
 */
function pickTelemetryIds(query, body) {
  const fromQuery = (k) =>
    query && typeof query.get === 'function' ? query.get(k) : null;
  /** @param {unknown} v */
  const str = (v) => (typeof v === 'string' && v.length > 0 ? v : '');

  /** @type {Record<string, string>} */
  const out = {};
  const deviceId = str(body && body.deviceId) || str(fromQuery('deviceId'));
  const puzzleId = str(body && body.puzzleId) || str(fromQuery('puzzleId'));
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

    // Correlated trace: shares this invocation's operation_Id, so it joins to
    // the auto-collected request row. Only emit when we actually have an id —
    // no point in an empty trace for health checks. Needs `Function` at
    // Information in host.json or the host filters it (same trap as the
    // original request-telemetry bug).
    if (Object.keys(ids).length > 0 && context && typeof context.info === 'function') {
      context.info('apiTelemetry', { ...ids, status });
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
