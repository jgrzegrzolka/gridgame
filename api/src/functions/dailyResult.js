const { app } = require('@azure/functions');

// Diagnostic probe — surface what require('../lib/validate') actually
// returns in production so we can see why the previous handler 500'd
// on every code path that touched validateResult.
let resolveError = null;
let validateModule = null;
try {
  validateModule = require('../lib/validate');
} catch (e) {
  resolveError = { message: e.message, code: e.code, stack: e.stack };
}

app.http('dailyResult', {
  route: 'v1/daily/result',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async () => ({
    status: 200,
    jsonBody: {
      resolveError,
      moduleType: typeof validateModule,
      moduleKeys: validateModule ? Object.keys(validateModule) : null,
      validateResultType: validateModule ? typeof validateModule.validateResult : null,
    },
  }),
});
