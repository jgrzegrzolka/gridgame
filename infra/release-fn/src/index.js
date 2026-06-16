/**
 * Function App entry — registers the timer-triggered releaseDaily
 * function so the Azure Functions v4 programmatic model can pick it up
 * at indexing time. Mirrors the api/src/index.js pattern in this repo.
 */

import './releaseDaily.js';
