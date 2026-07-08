'use strict';

/**
 * Wrap an Azure Functions HTTP handler so that a >= 500 response fails the
 * invocation.
 *
 * Azure Functions stamps request telemetry `success = true` whenever the
 * handler *returns* — even with `status: 500`. Only a *thrown* invocation is
 * recorded as a failure (`success = false`, plus an `exceptions` row). The
 * App Insights Failures blade and any failed-request alert key off that flag,
 * so a returned 500 is invisible there. This wrapper inspects the response and
 * rethrows for any status >= 500 so the host records the failure.
 *
 * Client impact is nil: the daily/stats clients fall back to `http_<status>`
 * when a 500 carries no JSON body (see daily/statsSubmit.js), so losing the
 * generic `{ error: 'server_error' }` body on the thrown path changes nothing
 * observable.
 *
 * 4xx are intentionally left as successful requests: a client error is not a
 * server failure and must not page anyone. They remain queryable in App
 * Insights by `resultCode` (that's what the Host.Results logLevel fix enabled).
 *
 * @param {(req: any, context: any) => Promise<any>} handler
 * @returns {(req: any, context: any) => Promise<any>}
 */
function wrapServerErrorsAsFailures(handler) {
  return async function wrapped(req, context) {
    const res = await handler(req, context);
    const status = res && typeof res.status === 'number' ? res.status : 200;
    if (status >= 500) {
      const name = context && context.functionName ? context.functionName : 'unknown';
      // The thrown Error is what the host turns into a failed request +
      // exception telemetry. Name the function in the message so the Failures
      // blade points at the right handler (the stack alone lands here).
      throw new Error(`server_error: ${name} returned ${status}`);
    }
    return res;
  };
}

module.exports = { wrapServerErrorsAsFailures };
