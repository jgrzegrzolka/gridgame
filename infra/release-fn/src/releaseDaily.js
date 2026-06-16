/**
 * Timer-triggered daily-puzzle promotion.
 *
 * Owns midnight release in Warsaw — replaces the GitHub Actions workflow
 * + Logic App pair entirely (see FEATURE.md Feature P Phase 2).
 *
 * Scheduling: Linux Consumption ignores `WEBSITE_TIME_ZONE` and rejects
 * the `CRON_TZ=Europe/Warsaw` prefix, so a single-fire UTC schedule
 * would drift by 1 hour twice a year at DST boundaries. The workaround
 * is a dual-fire UTC schedule (`0 5 22,23 * * *`) — exactly one of
 * those two fires per day lands on Warsaw midnight regardless of season,
 * and the handler skips the other. Idempotent: a second fire on the
 * same Warsaw day (e.g. after a manual `admin/functions/releaseDaily`
 * POST) sees the catalog already promoted and no-ops.
 *
 * Flow:
 *   1. Read live + backlog from the catalog blob (`styetanotherquiz`).
 *   2. Decide whether to act (`shouldRun(now, live[last].n)`):
 *        - Skip if Warsaw hour isn't 0 (wrong cron leg fired).
 *        - Skip if today's puzzle is already in live.
 *   3. Promote backlog[0] → end of live in memory.
 *   4. Run hard-rule validation (drift detector + structural checks). On
 *      any rule violation, throw — the catalog stays unchanged in blob,
 *      App Insights records the exception, Jan sees the failure in the
 *      morning and refills/fixes.
 *   5. Overwrite live.json + backlog.json on the blob. Players see
 *      the new puzzle within ~60s (Cache-Control max-age=60).
 *
 * No git, no SWA deploy, no Logic App, no GitHub-Actions secrets in the
 * runtime path.
 */

import { app } from '@azure/functions';
import { readJsonBlob, writeJsonBlob } from './lib/blob.js';
import { promote } from './lib/promote.js';
import { validateCatalog } from './lib/validate.js';
import { shouldRun } from './lib/warsawTime.js';

const ACCOUNT = 'styetanotherquiz';
const CONTAINER = 'catalog';

app.timer('releaseDaily', {
  // Fires twice per UTC day; the handler runs at whichever fire is
  // Warsaw midnight (00:05) — 22:05 UTC during CEST, 23:05 UTC during
  // CET — and skips the other. DST-resilient with no manual bumps.
  schedule: '0 5 22,23 * * *',
  handler: async (timer, context) => {
    const now = new Date();

    const live = await readJsonBlob(ACCOUNT, CONTAINER, 'live.json');
    const backlog = await readJsonBlob(ACCOUNT, CONTAINER, 'backlog.json');

    const lastLiveN = live.length > 0 ? live[live.length - 1].n : 0;
    const decision = shouldRun(now, lastLiveN);
    if (!decision.run) {
      context.log(`releaseDaily: ${decision.reason}`);
      return;
    }

    context.log(`releaseDaily: live has ${live.length} entries; backlog has ${backlog.length}`);

    const { live: newLive, backlog: newBacklog, n } = promote(live, backlog);

    validateCatalog({ live: newLive, backlog: newBacklog });

    await writeJsonBlob(ACCOUNT, CONTAINER, 'live.json', newLive);
    await writeJsonBlob(ACCOUNT, CONTAINER, 'backlog.json', newBacklog);

    context.log(`releaseDaily: promoted #${n}. backlog now has ${newBacklog.length} entries.`);
  },
});
