// Explicit registration entry point. Each require() loads a function
// file, which calls app.http(...) at module-load time to register itself
// with the Azure Functions runtime. The v4 model technically supports a
// glob in package.json's `main`, but explicit requires are more
// predictable and easier to debug when something goes wrong at deploy.

// Central failure wrapping: a handler that RETURNS a 5xx leaves request
// telemetry success=true, so the App Insights Failures blade / alerts never
// see it (verified in prod — see PR #727 for the sibling logLevel fix). We
// patch app.http once, here, BEFORE the requires below run their
// registrations, so every handler — and every future one — has its >=500
// responses rethrown as failed invocations. See lib/httpFailure.js.
const { app } = require('@azure/functions');
const { wrapServerErrorsAsFailures } = require('./lib/httpFailure');
const registerHttp = app.http.bind(app);
app.http = (name, options) =>
  registerHttp(
    name,
    options && typeof options.handler === 'function'
      ? { ...options, handler: wrapServerErrorsAsFailures(options.handler) }
      : options,
  );

require('./functions/health');
require('./functions/dailyResult');
require('./functions/dailyStats');
require('./functions/dailyMe');
require('./functions/quizRecord');
require('./functions/quizLeaderboard');
require('./functions/profile');
require('./functions/profileEnsure');
require('./functions/profileSyncBlob');
require('./functions/profileDeletion');
require('./functions/getProfile');
require('./functions/tttResult');
require('./functions/getTttResult');
require('./functions/clearLocalRows');
require('./functions/syncClaimToken');
require('./functions/syncClaimRedeem');
require('./functions/syncPreview');
require('./functions/syncMerge');
require('./functions/syncLink');
require('./functions/syncHydrate');
