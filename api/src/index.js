// Explicit registration entry point. Each require() loads a function
// file, which calls app.http(...) at module-load time to register itself
// with the Azure Functions runtime. The v4 model technically supports a
// glob in package.json's `main`, but explicit requires are more
// predictable and easier to debug when something goes wrong at deploy.

// Central handler wrapping: patch app.http once, here, BEFORE the requires
// below run their registrations, so every handler — and every future one —
// gets the shared behavior in lib/httpHandler.js: (1) deviceId/puzzleId
// enrichment onto a correlated trace, and (2) rethrowing >= 500 responses as
// failed invocations so they reach the Failures blade. See PR #727/#728 for
// the sibling host.json fixes this builds on.
const { app } = require('@azure/functions');
const { wrapHandler } = require('./lib/httpHandler');
const registerHttp = app.http.bind(app);
app.http = (name, options) =>
  registerHttp(
    name,
    options && typeof options.handler === 'function'
      ? { ...options, handler: wrapHandler(options.handler) }
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
