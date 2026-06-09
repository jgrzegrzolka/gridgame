const { app } = require('@azure/functions');

app.http('dailyResult', {
  route: 'v1/daily/result',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async () => ({ status: 204 }),
});
