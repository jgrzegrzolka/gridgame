const { app } = require('@azure/functions');
const { queryDocs, deleteDoc } = require('../lib/cosmos');
const { isLocalRequestUrl } = require('../lib/requestHost');

/**
 * Dev-only endpoint: delete every `dailyResults` doc tagged `local: true`.
 *
 * The mark is set server-side by `dailyResult` whenever the request
 * URL is a localhost host (see `api/src/lib/requestHost.js`), so this
 * endpoint exists to clean up after dev sessions without manually
 * poking around the Cosmos data explorer.
 *
 * Localhost-gated by the same server-trusted hostname check used to set
 * the mark. Prod traffic never reaches a localhost-bound Functions
 * runtime, so `isLocalRequestUrl(req.url)` returns false in prod — the
 * endpoint refuses with 403. Belt-and-braces: there's no version of
 * "tag a row local, then delete it from prod" that succeeds.
 */

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyResults';

app.http('clearLocalRows', {
  route: 'v1/dev/clear-local-rows',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    if (!isLocalRequestUrl(req.url)) {
      return { status: 403, jsonBody: { error: 'localhost_only' } };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Cross-partition scan: rows tagged `local: true` can sit in any
    // puzzleId partition, and we don't know which ones up-front.
    // Projecting just id + puzzleId keeps the response small.
    const queryResult = await queryDocs({
      connString: conn,
      dbName: DB_NAME,
      containerName: CONTAINER_NAME,
      query: 'SELECT c.id, c.puzzleId FROM c WHERE c.local = true',
      parameters: [],
      enableCrossPartition: true,
    });
    if (!queryResult.ok) {
      context.error('cosmos query failed', queryResult);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    let deleted = 0;
    /** @type {{ id: string, reason: string }[]} */
    const failed = [];
    for (const row of queryResult.docs) {
      try {
        const r = await deleteDoc({
          connString: conn,
          dbName: DB_NAME,
          containerName: CONTAINER_NAME,
          partitionKey: row.puzzleId,
          id: row.id,
        });
        if (r.ok || r.error === 'not_found') {
          deleted++;
        } else {
          failed.push({ id: row.id, reason: `${r.error}${r.status ? `:${r.status}` : ''}` });
        }
      } catch (err) {
        failed.push({ id: row.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      status: 200,
      jsonBody: { scanned: queryResult.docs.length, deleted, failed },
    };
  },
});
