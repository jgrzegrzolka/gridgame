const { app } = require('@azure/functions');
const { validateResult } = require('../lib/validate');

// Validate-only build until the lib/ deployment is confirmed working.
// Cosmos insert returns in the next PR.
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
