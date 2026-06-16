/**
 * Timer-triggered daily-puzzle promotion.
 *
 * Replaces the GitHub Actions release workflow + Logic App pair
 * (see FEATURE.md Feature P Phase 2). Fires at 00:05 Warsaw daily
 * via the Functions timer trigger. WEBSITE_TIME_ZONE app setting
 * (Central European Standard Time) follows DST.
 *
 * Flow:
 *   1. Read live + backlog from the catalog blob (`styetanotherquiz`).
 *   2. Move backlog[0] → end of live in memory (promote).
 *   3. Validate the resulting catalog against hard rules (drift,
 *      sequential numbering, sovereign codes). If any rule fails,
 *      throw — nothing is written, the Function App marks the run as
 *      Failed, App Insights records the exception, the next morning
 *      Jan sees the failure and refills/fixes.
 *   4. Overwrite live.json + backlog.json on the blob. Players see
 *      the new puzzle within ~60s (Cache-Control max-age=60).
 *
 * No git, no SWA deploy, no Logic App involvement in the runtime path.
 */

import { app } from '@azure/functions';
import { readJsonBlob, writeJsonBlob } from './lib/blob.js';
import { promote } from './lib/promote.js';
import { validateCatalog } from './lib/validate.js';

const ACCOUNT = 'styetanotherquiz';
const CONTAINER = 'catalog';

app.timer('releaseDaily', {
  // Linux Consumption ignores WEBSITE_TIME_ZONE and the CRON_TZ= prefix
  // syntax is rejected by the indexer ("not recognized as a valid cron
  // expression"). For now, hardcode UTC and pin to 22:05 UTC — that's
  // 00:05 Warsaw during CEST (the half of the year that's in effect now).
  // DST shift to CET in late October bumps Warsaw +1h relative to UTC,
  // so this schedule will then fire at 23:05 Warsaw instead of 00:05.
  // Bump to '0 5 23 * * *' on the last Sunday of October when CET starts;
  // bump back to '0 5 22 * * *' on the last Sunday of March. See
  // FEATURE.md Feature P Phase 2.5 for the proper fix (env-var TZ on a
  // Premium plan, or 2 schedules joined with a runtime gate).
  schedule: '0 5 22 * * *',
  handler: async (timer, context) => {
    context.log('releaseDaily: reading live + backlog from blob');

    const live = await readJsonBlob(ACCOUNT, CONTAINER, 'live.json');
    const backlog = await readJsonBlob(ACCOUNT, CONTAINER, 'backlog.json');

    context.log(`releaseDaily: live has ${live.length} entries; backlog has ${backlog.length}`);

    const { live: newLive, backlog: newBacklog, n } = promote(live, backlog);

    validateCatalog({ live: newLive, backlog: newBacklog });

    await writeJsonBlob(ACCOUNT, CONTAINER, 'live.json', newLive);
    await writeJsonBlob(ACCOUNT, CONTAINER, 'backlog.json', newBacklog);

    context.log(`releaseDaily: promoted #${n}. backlog now has ${newBacklog.length} entries.`);
  },
});
