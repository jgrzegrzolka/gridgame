// Explicit registration entry point. Each require() loads a function
// file, which calls app.http(...) at module-load time to register itself
// with the Azure Functions runtime. The v4 model technically supports a
// glob in package.json's `main`, but explicit requires are more
// predictable and easier to debug when something goes wrong at deploy.
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
