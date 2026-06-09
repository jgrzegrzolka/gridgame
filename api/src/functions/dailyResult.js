const { app } = require('@azure/functions');
const { validateResult } = require('../../lib/validate');

// Diagnostic build: temporarily skips the Cosmos insert to isolate
// whether @azure/cosmos is what's breaking the SWA distribution.
// If this deploys cleanly, the dep is the problem and we'll re-add
// it differently. If it still fails, the issue is elsewhere.
app.http('dailyResult', {
  route: 'v1/daily/result',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req) => {
    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json' } };
    }
    const v = validateResult(body);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };
    return { status: 204 };
  },
});
