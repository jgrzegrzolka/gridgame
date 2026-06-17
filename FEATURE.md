# Tasks

Working document for in-progress work that spans multiple sessions. A fresh agent picking this up should:

1. Read `CLAUDE.md` (project rules).
2. Read this file.
3. Find the **first uncompleted feature** under `## Now`, locate its **next step**, and continue.
4. **`## Backlog` is off-limits to agents** — items there are deferred-but-not-forgotten, not next-up. Jan promotes a backlog item to `## Now` when he decides to ship it.
5. Update this file as each step completes (check off boxes, move finished features to `## Done`).

**Branching:** each phase = one branch off `main` + one PR. Run `git checkout main && git pull` *before* `git checkout -b ...`. Don't auto-merge — Jan merges each PR himself.

**Shared decisions (apply to all features below):**

- **Backend stack:** Azure Static Web Apps (Free SKU) + bundled Azure Functions (Node) + Azure Cosmos DB NoSQL with **Free Tier toggle ON**. Reason: Jan is a C# Azure dev — personal-project portfolio + learning value. Stays $0/month on always-free quotas indefinitely. (Cloudflare Workers + D1 was equally valid technically; Jan opted into Azure on 2026-06-09.)
- **Naming convention:** code, pages, repo stay `gridgame` (historical). Azure resources use `yetanotherquiz` (matches subscription, current product framing). Don't mix.
- **Subscription:** `yetanotherquiz` / `6da299d6-bdfe-4277-a544-ae8ef68f99a0`. Resource group is in West Europe and most resources live there (Cosmos, RG metadata); the SWA itself is `swa-yetanotherquiz-v3` in **West US 2** after the 2026-06-10 WE failover — see Done / Feature D for the why and the recovery playbook.
- **Cost protection in place:** €5/month budget on the subscription, email alerts at 50% / 80% / 100% to `jangrzegrzolka@gmail.com`. Don't re-add. Created via `az rest` on `Microsoft.Consumption/budgets/monthly-5eur`.

---

## Now

*(No active feature work — Feature R closed 2026-06-17, see `## Done` below.)*

---

## Backlog

Items here are not blocking current work but deserve durable memory — the next-time-this-comes-up question, the deferred fix that would otherwise vanish into PR archeology. Agents reading FEATURE.md to find their next task should **not** pick from this section; Jan promotes a backlog item to `## Now` when he decides to actually ship it.

### Feature Q: Observability for the player-facing site (Application Insights)

**Status:** parked 2026-06-16, updated 2026-06-17 after Feature R demolition. Jan plans to revisit ~next session. Gap surfaced during the Feature P cleanup audit; **widened** by Feature R Phase 3 which deleted the only AI instance in the resource group along with the Function App that owned it.

**Problem.** As of 2026-06-17 there is **no App Insights instance** in `rg-yetanotherquiz` at all (`ai-yetanotherquiz-release` was deleted with the rest of the scheduler stack). **The player-facing site has no telemetry at all.** Specifically:

- The SWA-managed Function App (which runs `api/dailyResult`, `api/dailyStats`, `api/engagementEvent`, etc.) has `APPLICATIONINSIGHTS_CONNECTION_STRING = null`. Exceptions thrown inside any of those handlers go to /dev/null. When a player's submission fails, Jan doesn't know.
- The frontend ships no App Insights JS SDK. Page views, JS exceptions, network errors, slow page loads — all invisible.
- The only signal that prod is broken today is "Jan or someone tells me" or "Cosmos rows look wrong."

Cloudflare Web Analytics (Feature M Part A, shipped 2026-06-14) covers some of the pageview gap but not application errors.

**Likely shape when this comes off the parking brake:**

1. **App Insights on the SWA-managed Function App.** Create a fresh `ai-yetanotherquiz` (or `ai-yetanotherquiz-api`) + Log Analytics workspace via Bicep. One `az staticwebapp appsettings set` call to wire the connection string. Captures every `api/*` exception, dependency call, and latency distribution. ~15 min of work, no code change in `api/`.
2. **App Insights JS SDK on the frontend.** One inline script in the shared HTML chrome, plus an `Application Insights Connection String` config. Captures page views, JS errors, performance timings, and (optionally) custom events for user funnels. ~5 min of work; adds ~30 KB to the page bundle (deferred load — no first-paint cost).

Both stages land within the 5 GB/month free tier at our traffic.

**Open design calls (settle when work starts, not now):**
- **Single AI instance or split?** Function App vs SWA Function App vs frontend — three workload types. A single shared instance is cheaper to manage and cross-correlates traces; splitting is cleaner per-workload reporting. Probably one instance with `cloud_RoleName` tagging per source.
- **Sampling.** Free tier is 5 GB/month — likely fine at current scale, but if traffic grows the JS SDK's default sampling (100%) becomes the first thing to tune.
- **Alerts.** Wire failure-rate or `requests | where success == false` alert to Jan's email (`jangrzegrzolka@gmail.com`)? The €5/mo budget already alerts at 50/80/100% — observability alerts would complement that.

**Out of scope even for Feature Q:**
- Full APM with distributed tracing across PartyKit + Cosmos + SWA hops (overkill for traffic).
- Custom dashboards / workbooks (start with the default Failures + Performance blades).
- Sensitive data filtering — none of our paths log PII today, but worth a one-time grep before turning on `enableAutoRouteTracking` in the JS SDK.

### Feature I: Per-puzzle stats snapshots for long-term retention

**Status:** parked until ~2027-05. **Hard deadline: must ship before 2027-06-09** — that's when the oldest `dailyResults` row (a puzzleId=1 submission from 2026-06-09 20:33 UTC) reaches its 1-year TTL set in Feature F phase 2. After that date, the row auto-purges from Cosmos, and from then on every puzzle's data ages off one day at a time. Missing the deadline means losing per-flag find-rate aggregates for those puzzles forever, with no way to reconstruct them.

**Goal:** survive the 1-year `defaultTtl` on `dailyResults` (Feature F2) without losing historical per-puzzle community stats. Once raw submission rows age off, the daily-stats endpoint should fall back to a frozen snapshot of "what the aggregate looked like when this puzzle was retired" instead of returning empty.

**Why this is a separate feature, not part of F:** F2 set the TTL because storage discipline is the right policy for a Free Tier hobby site, but it traded raw-row analyzability for storage cleanliness. Feature I restores the analytic value at a fraction of the storage cost (~1 KB per puzzle instead of 5 MB of raw rows at 10K plays). Decoupled from F because (a) the deadline is ~6 months out, no rush, (b) the trigger/read-path design needs more thought than F's near-term phases, and (c) F can finish and move to `## Done` without waiting on this.

**Likely shape when this comes off the parking brake:**

- New Cosmos container `puzzleSnapshots`, partition key `/puzzleId`, one row per puzzle (~1 KB).
- Row contents mirror the aggregator's return shape: `{ id: puzzleId, puzzleId, snapshotAt, totalAttempts, perCodeFinds, perWrongCode, mean, topPct, v: 1 }`.
- `dailyStats.js` checks the snapshot first; if present, returns it. Falls through to scanning raw rows only when no snapshot exists. (Net effect: a puzzle has live stats from raw rows for its first year, then frozen stats from the snapshot forever after.)

**Open design calls (settle when work starts, not now):**

- **Trigger.** Three options: (a) snapshot every puzzle when the *next* one is released — `release-daily.yml` writes the previous puzzle's snapshot alongside the promotion commit; (b) snapshot lazily on the first `dailyStats` request after rows start aging out; (c) a periodic background job (Logic App?) walks puzzles ageing out within N days. Option (a) is simplest and aligns with the puzzle-release cadence we already have via Feature E's Logic App.
- **Re-snapshot policy.** Freeze at first snapshot, or re-take as more submissions arrive before rows fully expire? "Freeze early" is simpler; "re-snapshot until rows expire" is more accurate. Probably "snapshot once when puzzle ages out, after that the snapshot is final."
- **Local-dev rows.** Snapshot should exclude `local: true` rows, same as the live aggregator does today (see `daily/extraStats.js`). Same exclusion logic, just frozen in time.

**Storage cost at long horizons:** ~1 KB × 365 puzzles/year × 10 years = ~3.6 MB total. Rounding noise vs. the 25 GB Free Tier ceiling. The deadline is the constraint, not storage.

**Out of scope even for Feature I:**

- **Snapshot of per-row data.** Would defeat F2's TTL policy — the whole point is to keep aggregates without keeping raw rows.
- **Cross-puzzle aggregates** (lifetime per-flag rates across every puzzle ever). Could be added later as a different snapshot type, but not load-bearing for the 2027-06-09 deadline.
- **Re-snapshot on every new submission.** The point is to capture a final aggregate when the raw data is about to age out, not maintain a live materialised view.

### Cleanup: rename `PASSKEY_HMAC_SECRET` → `SYNC_HMAC_SECRET`

**Status:** parked, no deadline. Cosmetic — the secret is load-bearing for QR-claim sync token signing, but it's misnamed after the **passkey** approach that was replaced by QR-claim in Feature C (shipped 2026-06-16). `api/src/functions/syncClaimToken.js:41-44` already carries an apologetic comment about the legacy name.

**What to do when this comes off the parking brake:**
1. Add new SWA app setting `SYNC_HMAC_SECRET` with the same value as `PASSKEY_HMAC_SECRET` (zero-downtime overlap).
2. Update the 4 api/ readers to fall through `process.env.SYNC_HMAC_SECRET ?? process.env.PASSKEY_HMAC_SECRET`. Deploy.
3. Confirm signing/verification still works end-to-end (one round-trip suffices).
4. Remove the fallback line + the `PASSKEY_HMAC_SECRET` app setting. Deploy.

**Why parked:** the secret is functionally correct under either name; the rename is pure hygiene. Real cost is one careful SWA deploy + a brief overlap window; real benefit is "future-me reading `syncClaimToken.js` doesn't have to think 'what's passkey doing here?'". Not urgent.

### Cleanup: remove the puzzle #1 → Liechtenstein migration

**Status:** parked until ~2026-07-11. **Trigger to act:** ~30 days after 2026-06-11, once every active player has loaded the daily page at least once and had their `daily.scores` patched by `migrateScores()`.

**What to remove:**
- `applyScoreMigrations` + `migrateScores` in `daily/scores.js` (and the calls from `daily/page.js` + `daily/archive.js`).
- The associated tests in `daily/scores.test.js`.
- `scripts/backfill-puzzle1-add-li.cjs` + its test (one-shot Cosmos script that should already have been run with `--apply` by the time this cleanup happens).

**What stays:** the puzzle data itself — `daily/daily_puzzles.json` #1 (10 answers including `li`), the `cross` motif on the 8 European COA-cross flags in `flags/countries.json`, and the `motif:!coat-of-arms` token on the #1 filter. Those are the durable change; the migration is just scaffolding for the trust transition.

**Why parked:** a player who hasn't visited in a month is unlikely to come back and notice their score regress from "9/9" to "9/10". The migration is cheap to keep around but adds boot-time overhead and a test surface we don't need forever. Removing in a month gives long-tail returners a window without leaving the code permanently fatter.

### Feature J: Platform decision — keep SWA Free, upgrade SWA, or migrate to CF Pages

**Status:** decision pending. Worker proxy (`infra/edge-proxy/`) keeps SWA Free usable in the meantime — this isn't blocking, but the question keeps re-surfacing every time SWA misbehaves.

**Why this question exists.** SWA Free SKU has burned us twice in 36 hours: the 2026-06-10 West Europe content-distribution outage (forced V3 failover, see Done / Feature D) and the 2026-06-11 custom-domain-edge flap that needed the Worker workaround (see PR #353 and `infra/operations.md` "Known issues"). The Worker insulates users from the specific 404-flap symptom but doesn't insulate from the next SWA Free issue, whatever it is.

**Three options on the table:**

1. **Stay on SWA Free + Worker proxy.** Status quo as of #353. $0/month. Vulnerable to whatever Azure-side issue hits next. Worker only covers the custom-domain-edge symptom; the WE-outage-class problem still requires hand-cranked failover per Feature D's playbook.
2. **Upgrade to SWA Standard SKU.** ~$9/month. Real SLA (99.95%), Microsoft support tickets, possibly different edge infrastructure. *Uncertain* whether the custom-domain edge issue is fixed by tier upgrade or shared with Free — would need to test by upgrading and temporarily removing the Worker.
3. **Migrate to Cloudflare Pages + Workers.** Free for our traffic. Already deep in CF ecosystem (DNS, Turnstile, PartyKit, edge proxy). The Cosmos client is plain-HTTPS (see CLAUDE.md "API / Azure Functions") so it ports to Workers without the `@azure/cosmos` SDK headache that bit B2b. Loses "Azure as portfolio/learning" reason from the original 2026-06-09 stack decision (see Shared decisions at top of this file). Migration: ~1–3 focused sessions.

**Decision criteria worth deciding on cold:**

- How much does "Azure as portfolio/learning" still matter? (Original reason for the stack — Shared decisions at top.)
- How much does the next SWA Free flap cost in Jan's time vs $9/month?
- Is migrating to CF Pages also re-opening the original stack decision, or separable from it?

**Out of scope here:** the second-region (WE sibling) plan in Feature D. That helps if we stay on SWA Standard, but is unnecessary on CF Pages. Decide platform first.

### Feature O: Profile-page achievements (replaces the "stats dashboard" direction)

**Status:** parked. Pivot decided 2026-06-15 — the profile page becomes a collection of earned achievements ("Cartographer", "First daily", "Perfect week", "All-Europe", "Revenge win") instead of a raw-numbers dashboard. Streak + best-streak from Feature N stay; everything else on the profile page becomes achievement-driven.

**Why this exists, not "win rate" / extended stats:** the win-rate concept settled in Feature N ("win = completion, any score") collapsed under the 2026-06-15 audit — a 1/4 finish and a 4/4 finish both count as 100%, which doesn't match any natural reading of "win rate" on a quiz site. Score-weighted "average accuracy" would be conceptually cleaner but still adds up to a single number that's hard to make playful. Achievements turn the same underlying data into something with a story — "you've cleaned-swept 5 different Europe puzzles" reads better than "your average score is 73%."

**Achievement inventory (audited 2026-06-15) — what's already in the data vs what needs Feature M Part B first:**

| Achievement | Data status | Source when promoted |
|---|---|---|
| 2 / 10 / N day streaks | ✓ ready | `dailyResults` → `computeStreak.maxStreak` |
| Daily clean sweep (4/4, 9/9, etc.) | ✓ ready | `dailyResults.foundCodes.length === totalCount` |
| Daily zero-score finish | ✓ ready | `dailyResults.foundCodes.length === 0` |
| Play quiz N times (total / per mode) | ✓ ready | `quizRecords.records[configKey].attempts` (Feature F5) |
| Play quiz Europe / All / Africa / etc. | ✓ ready | Same — `configKey` encodes the mode |
| Play TTT (count of games) | ✓ ready | Sum of `m3x3.{w,l,d} + m9x9.{w,l,d}` across `tttPairs` rows |
| Win / Lose / Draw TTT | ✓ ready | Same, broken out per counter |
| Share daily score N times | ✗ needs Feature M Part B `engagementEvents` `share` | One container with `kind` discriminator, instrumented at `shareText()` resolve |
| Share a custom findFlag puzzle (the `?f=…` deep-link case) | ✗ needs Feature M Part B `engagementEvents` `share` | Same container, `kind:'share'`, `payload.surface:'findflag'`, `payload.contextHint = filter` |
| Share a flagQuiz result (e.g. `/flagQuiz/?n=60s`) | ✗ needs Feature M Part B `engagementEvents` `share` | Same container, `kind:'share'`, `payload.surface:'flagquiz'`, `payload.contextHint = configKey` |
| TTT revenge win (lost before, won now) | ✗ needs Feature M Part B `tttPairs.lastOutcome` | Single field on the existing pair row — separate from `engagementEvents` |
| Play a custom findFlag puzzle (make-a-puzzle) | ✗ needs Feature M Part B `engagementEvents` `findflag_play` | Same container, `kind:'findflag_play'`, instrumented on the Play button click |
| Try N distinct findFlag filters | ✗ needs `engagementEvents` `findflag_play` | Same container, distinct-`payload.filter` count per `deviceId` |

**Why the inventory matters:** seven achievement categories ship data-ready today; six more unlock when Feature M Part B lands. Lets a Feature O v1 ship without waiting on M Part B, and v2 add the share / revenge / custom-puzzle achievements once the events are flowing. Also makes the cost-benefit case for each M Part B addition concrete — every line item in the table maps to ≥ 1 achievement consumer.

**Likely shape when this comes off the parking brake:**

- Pure achievement-rule library (`flags/achievements.js` or `api/src/lib/achievements.js` depending on where the compute lives) — each rule is a `{ id, predicate(snapshot) => boolean, tier? }`. Snapshot is the union of streak / daily / quiz / TTT data the page already fetches.
- Profile page renders the earned set as a grid of badges + a locked set as silhouettes. Hidden until the player has at least one earned achievement (same "no signal, no clutter" rule the finish screen uses).
- Compute path: client-side derivation from already-fetched data for v1 (zero new endpoint), OR server-side denormalised `userAchievements:{deviceId}` doc updated on each submission (point-read pattern from Feature G). v1 client-side is the cheaper start; promote to server-side denorm if the achievement set grows past ~30 rules or the client compute starts visibly delaying paint.

**Open design calls (settle when work starts, not now):**

- **Achievement *naming* and the storytelling layer.** "Cartographer" vs "Continental Master"? Each achievement needs a name, description, icon. Bigger writing task than the implementation. EN + PL.
- **Tiered vs binary.** "Played 10 daily puzzles" / "100" / "1000" as one tiered achievement with bronze/silver/gold, or three separate achievements? Tiered is denser; flat is simpler to design and easier to read.
- **Locked-state visibility.** Show silhouettes with hints ("Win a TTT match against someone you previously lost to") or hide entirely until earned (pure-surprise model)? Hints encourage replay; surprise feels rewarding.
- **Retroactivity.** Existing `dailyResults` / `quizRecords` / `tttPairs` rows mean v1 ships with many players already qualifying for streak / play-count achievements. Award them silently on first profile-page visit after Feature O launches, or run a one-time backfill notification? Silent is cheaper and matches the "calm" Feature N tone.
- **Animation on earn.** When an achievement is earned mid-session (player finishes a daily that crosses the 10-streak threshold), show a small celebration inline? Or only surface it the next time the player opens `/profile/`? Inline celebration is more delightful but adds wiring everywhere achievements can be earned.

**Out of scope even for Feature O:** point/XP system, achievement leaderboards (Feature K territory), social sharing of individual achievements (achievement-specific share grids), hidden / "secret" achievements ("play at 3am"), time-limited / seasonal achievements (Christmas badges etc.), missing-data backfill for events that aren't being tracked today (e.g. there's no way to retroactively award "shared 10 daily scores" for shares that happened before `shareEvents` started recording — that's the irretrievable-data argument for promoting Feature M Part B sooner rather than later).

---

## Done

### Feature R: Eliminate the daily-release scheduler — *shipped 2026-06-17*

**Problem.** The daily-release path failed three nights in a row (2026-06-15, 2026-06-16, 2026-06-17 — see `infra/release-incidents.md` for the journal). Three different scheduler attempts had bitten us across one week: GH Actions cron (drifted past Warsaw midnight by 75–135 min), Azure Logic App (worked briefly), Function App (host wedged after a Bicep redeploy, App Insights silent, would not register the `releaseDaily` function). The unit of failure was **the existence of a scheduler** — anything that has to "do a thing at a specific time" is a separate process whose health is a separate concern, and every variant we tried failed differently. With a 3-day trip coming up Jan needed structural change, not another debugging round.

**Goal that shipped.** Time becomes data, not a trigger. Every entry in `puzzles.json` carries its own `date`; the daily page filters `entries.filter(p => p.date <= warsawToday())` on every load. No scheduler, no Function App, no cron, no DST math at the trigger level. The whole class of "the autoreleaser failed" incidents is now impossible.

**Architecture that shipped:**

- **Storage:** `styetanotherquiz` blob storage (kept from Feature P — that part of the architecture works). One container `catalog/` with four blobs: **`puzzles.json`** (single source of truth, every entry past/present/future with its own `date`), `ideas.json`, `parked.json`, `policy.json`. Anonymous public-read, `Cache-Control: max-age=60`, blob versioning ON.
- **Reader:** `daily/page.js` fetches `puzzles.json`, computes `warsawToday()` via `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' })`, filters entries via `flags/puzzleFilter.js` `visiblePuzzles()` + `latestPuzzle()`. `daily/archive.js` uses the same filter. `daily/backlog/page.js` shows only future-dated entries (`date > warsawToday()`).
- **Validator** (`flags/dailyValidate.js`): `validateCatalog({ puzzles })` instead of `{ live, backlog }`. New rule 4b: every entry has `date: "YYYY-MM-DD"`, dates are unique, dates are contiguous (no gaps). Per-entry rules 1, 2, 3, 5, 6, 7, 14, 15 unchanged.
- **Server-side defence** (`api/src/functions/dailyResult.js`): the dated catalog is public-read, so a client could `POST` for a future `puzzleId` and pollute its aggregate. New `isReleased(puzzleId, warsawToday())` check rejects with 400 `not_released`. Implemented as pure `api/src/lib/puzzleDate.js` + `api/src/lib/warsawTime.js` (CJS twins of the page-side helpers, since `api/` is CommonJS).
- **Authoring:** `authoring/push.mjs` pushes `puzzles.json`; `authoring/pull.mjs` pulls 4 blobs; generator + ambiguity audit read `puzzles.json`. Append-with-date workflow: `n = prev.n + 1`, `date = prev.date + 1 day`. No promote step.

**Three phases, three PRs, all 2026-06-17:**

1. **R.1 (#483) — dated catalog + page filter + server-side `puzzleId` rejection.** One-shot migration script `scripts/migrate-to-dated-catalog.mjs` reads `.catalog/{live,backlog}.json` and writes `puzzles.json` with `date = anchor (N=12 → 2026-06-17) ± days`. Page + archive + backlog preview switch to the new shape; `live.json` + `backlog.json` blobs left in place as Phase-1 safety net. 32 new unit tests (warsawTime, puzzleFilter, puzzleDate, migrate-to-dated-catalog).
2. **R.2 (#484) — single-blob authoring + validator rewrite + skill rewrite.** Validator collapses to `{puzzles}` with date rules. Authoring tools (`push.mjs`, `pull.mjs`, generator, audit) drive off the single FILES list `[puzzles, ideas, parked, policy]`. Daily-puzzle-author skill rewritten: "promote" step disappears, replaced by "append with next free date." Decorative cleanup: dead `'live'`/`'backlog'` entries from `daily/catalogSource.js`, stale Logic-App/Function-App comments from `flags/daily.js` header.
3. **R.3 (#?) — demolition.** Deleted Azure resources `func-yetanotherquiz-release`, `plan-yetanotherquiz-release`, `ai-yetanotherquiz-release`, `log-yetanotherquiz-release`, `stfuncyetanotherquiz`, plus the auto-created `Application Insights Smart Detection` action group. Deleted code: `infra/release-fn/` (whole tree), `infra/funcapp-release-daily.bicep`, `scripts/build-release-fn.mjs`. Docs updated: `infra/operations.md` (drop Resources rows + Bicep-redeploy runbook), `infra/README.md` (drop Function App sections), `daily/README.md` (no more midnight Function diagram), `CLAUDE.md` "API / Azure Functions" (no second Function App). `infra/release-incidents.md` marked resolved by Feature R demolition, history preserved.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `flags/warsawTime.js` `warsawClock` + `warsawToday` (and CJS twin at `api/src/lib/warsawTime.js`) — Warsaw-date helpers, DST-safe via `Intl.DateTimeFormat`. Reusable for any feature that needs "what Warsaw calendar day is it now?".
- `flags/puzzleFilter.js` `visiblePuzzles` + `latestPuzzle` — pure date-based catalog filters. The pattern (filter by date locally rather than schedule a job) is the load-bearing idea, not the helper.
- `api/src/lib/puzzleDate.js` `puzzleDateIso` + `isReleased` — server-side puzzle-id → date mapping. Couples to the "contiguous 1-per-day" invariant the validator enforces; if that invariant ever loosens, this switches to a blob lookup.
- `flags/dailyValidate.js` with the date-contiguity rule — every new puzzle is checked against the rule at push time. Gaps and duplicates fail before publish.
- `puzzles.json` blob shape itself — `{ n, date, filter | kind:'manual'+title, answers, description }`. Future schedulers (if we ever bring back time-of-day flexibility, holiday skips, etc.) extend this rather than adding a separate trigger.

**Key decisions, preserved for future "why don't we just …" questions:**

- **Why client-side filter, not API-side.** Every daily page load would route through a Function App, taking on cold starts (Free SKU = 1–2 s after idle) and a new boot-failure surface. The daily page is now static-page + public-blob = the most reliable surface on the site. Client filter keeps it that way.
- **Why one blob, not per-date blobs.** Per-date would mean N fetches for the N-day archive page. One blob is ~28 KB at 72 entries — rounding noise.
- **Why public-read despite the "anyone can curl tomorrow" trade-off.** Knowing "Europe + cross + blue" doesn't solve any puzzle for you — the player still has to recognise flags. Security-through-obscurity wasn't load-bearing. If it ever becomes load-bearing: encrypt entries with a date-derived key on the page (~10 lines), don't add a server.
- **Why `n` preserved across the migration.** Every `dailyResults` Cosmos row references `puzzleId === n`; same for leaderboard partition keys and share links. Switching the identity scheme would have required a Cosmos migration on top of everything else. Just stamping `date` onto the existing `n` was free.
- **Why "dates contiguous (no gaps)" was the validator rule rather than "monotonically increasing."** Strict contiguity catches the "tonight's puzzle is missing" bug at test time before it ships. The cost (can't deliberately skip a day) is small and reversible — switch to a "fill with a placeholder entry" pattern if needed.

**Notable journey, preserved for posterity:**

- The original instinct on the morning of 2026-06-17 was to debug the wedged Function App. Diagnostic commands were drafted in `infra/release-incidents.md`, then deleted in Phase 3. Time spent debugging the scheduler would have been time not building the alternative; the right call was to write down what would have been the next session's plan, then delete it.
- The first migration cut (R.1) hardcoded five fields when copying entries to the new shape and dropped #72's `kind: 'manual'` + `title` fields silently. Caught by tests in R.2. Fixed by spread-then-stamp-date pattern. Lesson pinned: when migrating between shapes, prefer field-preserving spread + explicit overrides over field-listing object construction.
- Feature R inherited Feature P's blob storage + authoring CLI surface, then deleted Feature P's Function App. Feature P was the first move ("get release off the SWA deploy"); Feature R was the second ("get release off any scheduler"). Both shipped within 48 hours of each other — the second was triggered by the first failing on the same night the second night of the new architecture.

**Out of scope, intentionally deferred** (captured here so they don't drift back in): encrypted future entries on the blob (one-line escape hatch tracked above); a new admin UI for catalog management (the agent skill is the UI); per-puzzle release-date *time* (puzzles release at midnight Warsaw implicit in the `date` field — bring it back if needed by adding a `time` field); migrating `dailyResults` Cosmos rows (they reference `puzzleId === n` which is preserved — no data migration); rename `daily/backlog/` URL (kept for stability; "future schedule preview" semantics).

**Key PRs.** #482 (Feature R spec drafted), #483 (R.1 — dated catalog + page filter), #484 (R.2 — single-blob authoring + validator + skill), Phase 3 PR (R.3 — demolition).

### Feature P: Decouple daily-puzzle release from the SWA deploy — *shipped 2026-06-15, superseded by Feature R 2026-06-17*

**Status.** Feature P shipped its three phases on 2026-06-15/16 — Phase 1 (blob exists, page reads, workflow uploads) and Phase 3 (repo files out, CLI tools in) survived intact and are still load-bearing. Phase 2 (timer-triggered Function App as the midnight runner) was the part that failed under real-world conditions, and Feature R demolished it on 2026-06-17.

**What Feature P solved that's still live:** the daily page reads its catalog from a public-read Azure blob (`styetanotherquiz/catalog/`) instead of bundled JSON files, so an SWA deploy flake (Docker pull throttle, content-distribution flap, regional outage) no longer blocks the puzzle from updating. The authoring CLI (`authoring/pull.mjs` + `push.mjs`) replaced the commit-and-deploy authoring loop. `.gitignore` adds `.catalog/`. Validation extracted to `flags/dailyValidate.js`.

**What Feature P got wrong:** Phase 2 traded "shared GH Actions runner / Logic App" for "standalone Function App" — same fundamental architecture (a runner that must fire at a specific time), different failure modes. The Function App wedged after a Bicep redeploy on 2026-06-16 (host returned 503 below the admin surface, App Insights silent), the GH Actions fallback Jan re-introduced also failed, and the manual `push.mjs` was the only working path. Feature R's "delete the scheduler entirely" was the structural response.

**Key PRs from the Feature P era.** #463 (spec), #464 (Phase 1 — page reads blob), #465 (Phase 2 — Function App provisioned), #466 (Phase 2 cleanup — DST-resilient schedule + delete dormant code), #467 (Phase 3 — blob is sole source of truth), #468–#472 (audit passes, dead-script cleanup). Phase 2-related code (`infra/funcapp-release-daily.bicep`, `infra/release-fn/`, `scripts/build-release-fn.mjs`) deleted by Feature R Phase 3.

### Feature C: Cross-device link via QR-claim — *shipped 2026-06-16*

**Goal.** A user playing on phone + laptop links the two browsers in one round-trip so daily streaks, archive PBs, quiz records, and nickname follow them across both. No accounts, no passwords, no email. Existing rows from the "joining" device migrate into the "host" device's namespace so history is real, not just forward-looking.

**Design that shipped (QR-claim, *not* passkey — see "Notable journey" below):**

- **No new Cosmos container.** Original plan added `passkeys`; the QR pivot deleted it. The merge writes into existing rows (`dailyResults`, `quizRecords`, `tttPairs`, `engagementEvents`, `profiles`) by rewriting their `deviceId` to the target's.
- **Two new HMAC-signed-token endpoints (stateless, no transient container):**
  - `POST /api/v1/sync/claim/token` — Device A mints a 5-min claim token + claim URL + inlineable SVG QR. Token wraps `{ deviceId, expiresAt }` under `PASSKEY_HMAC_SECRET` (name preserved across the pivot — the secret's job, HMAC over short-lived tokens, didn't change).
  - `POST /api/v1/sync/claim/redeem` — Device B posts the token. Server validates HMAC + expiry and returns Device A's `deviceId`.
- **Merge pipeline (four endpoints — `syncMerge` + `syncPreview` survived the pivot; `syncLink` + `syncHydrate` added in #458):** `sync/preview` (server-side conflict diff: nickname mismatch + overlapping daily puzzles), `sync/merge` (atomic per-row deviceId rewrite), `sync/link` (target's self-discovery: GET checks `profiles[deviceId].linkedAt`), `sync/hydrate` (post-merge pull of `dailyResults` + `quizRecords` + `nickname`).
- **Flow.**
  1. Device A: `/profile/` → "Sync across devices" → `/profile/sync/` → auto-mints QR on boot.
  2. Device B: scans QR (or opens the fallback link) → `/profile/sync/?claim=<token>` → server redeems → server-side preview.
  3. If conflicts: two-question wizard (nickname source, daily-overlap source) with iOS-toggle UI; if no conflicts: silent merge.
  4. Server rewrites Device B's rows into Device A's `deviceId`, stamps `linkedAt` on the target profile row, both clients now share one deviceId.
  5. Client hydrates: overwrites `localStorage.daily.scores` + `flagquiz.best.*` + `gridgame.nickname` from server.
- **Ambient background sync.** `trySyncDevices()` fires on the boots of `daily/page.js`, `daily/archive.js`, `flagQuiz/page.js`. Two gates: (1) no `localStorage.gridgame.identityId` → immediate return, zero network — **the 99% of unlinked players pay one localStorage read per page load**; (2) 1h staleness gate, stamped before the await so concurrent tabs don't double-fire. Worst case for linked players: 24 hydrates/day.
- **Burger-menu integration.** Static "Sync across devices" item mounted by `common.js` `mountSyncMenuItem` + `paintSyncState` — single source of truth across daily / archive / flagQuiz / findFlag / profile. No "✓ Synced" toggle (was misleading — the link still goes somewhere actionable).

**What shipped (seven PRs, no clean phase numbering because the design pivoted mid-feature):**

1. **C.1 — passkey backend (#452).** `passkeys` container provisioned. `@simplewebauthn/server` integrated. Four endpoints (register/auth × begin/verify). HMAC-signed stateless challenges via `PASSKEY_HMAC_SECRET`. Pure libs (`passkeyDoc.js`, `passkeyVerify.js`) + tests. **All ripped out in #456.**
2. **C.2 — passkey UI behind `?test` (#453).** `flags/passkeyClient.js` + `/profile/`-mounted "Save across devices" / "Claim from another device" buttons. `syncMerge.js` engine + 26 tests landed here and survived the pivot. Gated behind `?test` for real-device validation. (#455 patched a first-link auth-cancel fallthrough.)
3. **The pivot — QR-claim (#456).** Real-device validation surfaced cross-ecosystem friction: rpID scoping (`yetanotherquiz.com` vs. `www.yetanotherquiz.com`), TPM-bound credentials that wouldn't sync, hybrid-QR chicken-and-egg on iOS↔Android. Replaced WebAuthn entirely with a QR-displaying-a-signed-token. **Net diff: −1500 lines.** Deleted: 4 passkey endpoints, 5 passkey libs, `flags/passkeyClient.js`, `@simplewebauthn/server` + 23 transitive deps, the `passkeys` Cosmos container (via `az`). Added: `syncToken.js` (HMAC), `syncClaimToken` + `syncClaimRedeem` endpoints, `syncClaimClient.js`, `qrcode-svg` in `api/package.json`. The merge engine + wizard + `?test` gate carried over unchanged.
4. **Gate removal + wizard iteration (#457).** Dropped `?test` — sync went GA. Wizard radios → iOS-style two-label toggle; compacter copy; auto-mint QR on `/profile/sync/` boot (dropped intro paragraph, "Show QR" button, help dialog). Kept `?wizard-preview` URL helper for future iteration.
5. **Four-bug triage + ambient background sync (#458).** (a) Burger menu no longer flips to "✓ Synced" after link. (b) Target device now self-discovers linked state via the new `linkedAt` field on its profile row + boot poll. (c) QR stays visible after linking (was gated behind "not yet linked"). (d) Archive / quiz PBs hydrate post-merge via new `sync/hydrate` endpoint. Plus `trySyncDevices()` ambient hook on daily / archive / flagQuiz boots. Shared `.loading-dots` graduated to `common.css`.
6. **Nickname hydration + linked-state polish (#460).** Hydrate endpoint extended with `nickname`; client writes to `localStorage.gridgame.nickname`; `profile/page.js` self-heals on first visit after link (bypasses staleness gate). Loading states for profile-stats + sync-mint reuse `.loading-dots`. QR fallback URL collapsed into `<details>`. "Device is linked." pane pulses 3× via the shared `cell-shake` keyframes (per CLAUDE.md "same mechanism = same code") on the unlinked→linked transition only.
7. **Profile cleanup + wizard rewrite + menu colour (#461).** Streak block dropped from `/profile/` (concept moved to Feature O achievements per the 2026-06-15 pivot). "Buy me a coffee" reverted to primary near-black (was overridden to pink). Wizard buttons restyled to text-link idiom matching `/profile/` actions-row; question labels collapsed to two short lines; `?wizard-preview` now switches between all three real shapes (`=both` / `=profile` / `=daily`).

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/syncToken.js` — generic HMAC-signed short-lived token wrap/unwrap (5-min default). Any future "device A hands a one-time capability to device B" reuses this verbatim — same pattern would work for, e.g., transferring a custom puzzle without going through the share-link surface.
- `api/src/lib/syncMerge.js` — pure merge engine: nickname/daily/quiz/tttPairs row-rewriting under a single `targetDeviceId`. 26 tests pin the merge semantics. Survived the pivot intact.
- `api/src/functions/syncHydrate.js` + `flags/syncHydrate.js` — server contract + client hydrator. The server-side "pull every row this device owns into one payload" shape is the canonical mechanism for "linked device just opened a stale browser" recovery.
- `flags/syncHydrate.js` `trySyncDevices()` — the ambient background-sync substrate. Identity-gated (free for unlinked) + staleness-gated (1h default) + concurrent-tab-safe. Any future per-device cross-tab freshness check uses this pattern.
- `linkedAt` field on profile rows — target's self-discovery hook. Pattern: write a field on the target when the source mutates state, target polls cheaply on boot, client back-fills `identityId` locally to short-circuit subsequent loads.
- `mountSyncMenuItem` + `paintSyncState` in `common.js` — single source of truth for the menu's sync entry across every page. New pages with chrome pick it up by calling these.
- Shared `.loading-dots` in `common.css` — pulsing-dots loading idiom, originated on daily-stats, now consumed by sync-mint + profile-stats + post-scan progress.

**Notable journey, preserved for posterity** (so the next "why don't we just use passkeys?" comes with built-in context):

- Original plan (2026-06-15 promotion, PR #451) was identityId-propagation: every write-path endpoint gains an optional `identityId`, all existing rows get cross-partition-backfilled on first passkey registration. The C.3 mega-diff (25 files) was rolled back mid-flight — too much surface area, too many partition-key implications, too much retroactive write amplification on top of an unsettled identity model.
- Pivoted to **adopt-deviceId + auto-merge**: the joining device adopts the host's deviceId on first link, all subsequent writes naturally land in the right partition with zero per-write identityId plumbing. Shipped as #453 (UI behind `?test`).
- Real-device validation immediately surfaced WebAuthn cross-ecosystem friction (see #456 description). The signed-token-in-a-QR replacement was both simpler and trivially cross-ecosystem — the QR is just bytes; any browser camera resolves it. Passkey deletion was net-zero infra impact and −1500 lines.
- **Takeaway pinned for future feature design:** when a cross-platform UX touchpoint is the load-bearing path, prototype on the *actual* second platform before locking in the protocol. WebAuthn's spec looks clean on paper; the rpID scoping, TPM-bound-credentials, and hybrid-QR realities only show up under real-device validation.

**Out of scope, intentionally** (captured so they don't drift back in): unlink / revocation UI ("remove this device's link" — V1 deferral, possibly never if the rare-case feedback is "just clear my localStorage"); recovery if both linked devices are lost simultaneously (passkey ecosystem-sync was supposed to be the recovery story; with QR-claim the answer is "nothing automatic — re-bootstrap from server-side rows tagged with the lost deviceId" which today means contacting Jan); >2 devices in a link chain (today: any third device that scans the QR adopts the same deviceId, which works but isn't a designed UX); cross-link transfer ("merge two existing pairs into one identity"); usernames / emails / login forms; `dailyResults` partition-key change (Feature C-era plan that became moot once the model dropped identityId-propagation).

**Key PRs.** #451 (promotion — passkey-era plan, now historical), #452 (C.1 passkey backend, ripped out), #453 (C.2 passkey UI behind `?test`, partially ripped out — `syncMerge.js` + wizard survived), #455 (auth-cancel fallthrough, removed with #456), #456 (the pivot — passkey → QR-claim, −1500 LOC), #457 (`?test` gate removal + wizard iteration), #458 (four-bug triage + ambient background sync), #460 (nickname hydration + linked-state polish), #461 (profile streak drop + wizard rewrite + menu colour).

### Feature M Part B: Engagement-event substrate — *shipped 2026-06-15*

**Goal.** Capture engagement signals (shares, custom-puzzle plays, daily starts, TTT outcome ordering) that are cheap to write but irretrievable if not captured — the rule Jan settled on 2026-06-15. Two consumers, same writes: Feature O reads to award achievements; Jan reads for DAU / completion-rate / D1 / D7 retention.

**Design that shipped (one container + one field):**

- **Container:** `engagementEvents` — partition `/deviceId`, autoscale 100–1000 RU/s, TTL 31_536_000 (1 year). Provisioned 2026-06-15 (M.B.1).
- **Doc shape:** `{ id, deviceId, kind, dayId, occurredAt, payload, local?, v: 1 }` — `kind` discriminates `'daily_start' | 'findflag_play' | 'share'`; `payload` is a tagged union validated server-side per kind. `dayId` is `warsawDayNumber` (integer) — matches `streakCompute`'s axis.
- **Per-kind id schemes:** `daily_start:{dayId}:{puzzleId}` (deterministic — 409 is the natural "already started" dedup); `findflag_play:{uuid}` and `share:{uuid}` (non-deterministic — every play / share is a distinct row).
- **Per-kind payload:** `daily_start: { puzzleId }`; `findflag_play: { filter, mode: 'random' | 'custom' }`; `share: { surface: 'daily' | 'findflag' | 'flagquiz' | 'ttt', contextHint? }`.
- **Endpoint:** `POST /api/v1/event` — anonymous, 60/min/IP rate-limited, server-stamps `dayId`, `occurredAt`, `local` (from request-host check).
- **Lib:** `api/src/lib/engagementDoc.js` `buildEngagementDoc(...)` — pure, per-kind payload validation, defensive payload stripping.
- **Client:** `flags/eventSubmit.js` `submitEngagementEvent(deviceId, event)` — single fire-and-forget helper used by every call site. Never throws; treats 201 + 409 as success.
- **`tttPairs.lastOutcome` field:** lives on the existing pair row (not in `engagementEvents`) because it's per-pair *state* (helps detect revenge), not an event-stream item. `mergePairResult` sets it on every upsert. Zero migration: pre-existing rows treat missing field as "no prior history."

**What shipped (four phases):**

1. **M.B.1 — substrate + `share` wiring.** Container provisioned via `az`; lib (23 tests) + endpoint + client helper (8 tests) added. Share events wire from `common.js` `shareText()` / `shareUrl()` on `'shared'` or `'copied'` (not `'dismissed'` / `'failed'`) — fires across daily, flagQuiz, findFlag, TTT 3x3, TTT 9x9 share buttons.
2. **M.B.2 — `findflag_play` wiring.** Fires on findFlag page-mount when `?f=…` resolves to a playable puzzle. Mode hint flows through a one-shot `sessionStorage['findFlag.mode']` flag the Random buttons set before navigating (Play button + externally-shared links default to `'custom'`).
3. **M.B.3 — `daily_start` wiring.** Fires once per round on first focus of the country-search input — the clearest "intent to play" signal on the text-input flow (no cell-click grid). One-shot via `{ once: true }`. Author-only sister pages (`daily/ideas/`, `daily/backlog/`) don't pass the callback so previews stay event-free.
4. **M.B.4 — `tttPairs.lastOutcome` field.** Single field add; `mergePairResult` sets it on every upsert. Unlocks the future "revenge win" achievement (Feature O) — detect `existing.lastOutcome === 'loss' && new outcome === 'win'` at write time without a per-game container.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/engagementDoc.js` `buildEngagementDoc` + tests — every future kind composes a payload validator and an id scheme through this same dispatcher.
- `api/src/functions/engagementEvent.js` — single `POST /api/v1/event` endpoint. New kinds extend the lib's validator, no new endpoint or container needed.
- `flags/eventSubmit.js` — fire-and-forget contract. Any future client surface uses this verbatim.

**Open design calls settled in flight (preserved for forward reference):**

- **`dayId` semantics.** `warsawDayNumber` integer — Warsaw because that's the daily-puzzle clock (Logic App at 00:05 Warsaw per Feature E).
- **Fire-trigger for `daily_start`.** First focus of the search input. Page-mount over-counted (bots, preview-renderers, curious-bouncers); first cell click doesn't map to a text-input flow.
- **`share` tracks success-only.** After the share/copy resolves. `'dismissed'` and `'failed'` don't fire — count reflects shares that actually happened.
- **Cosmos write volume.** Worst case ~1 daily_start + a few findflag_plays + 0–1 share per device per day. At Free Tier 1000 RU/s this is rounding noise.
- **Admin gate for DAU/D1/D7 reads.** Out of scope — pure-SQL via Cosmos Data Explorer covers the first six months. Real `/admin/metrics` page deferred until SQL-pasting friction is felt.

**Storage cost.** ~200 bytes × (~5 events) × ~50 DAU × 365 days ≈ ~18 MB/year. Rounding noise vs the 25 GB Free Tier ceiling.

**Key PRs.** #446 (M.B.1 — substrate + share + container provisioning), #447 (M.B.2 — findflag_play + operations.md follow-up), #448 (M.B.3 — daily_start), #449 (M.B.4 — tttPairs.lastOutcome).

**Out of scope, intentionally deferred** (captured so they don't drift back in): per-cell heat-map of where players drop, partial-completion analytics (started 10 cells, finished 3), per-game TTT history rows (`lastOutcome` field handles ordering), A/B testing infra, public stats page, GA4 / Plausible / self-hosted Umami (CF Analytics covers visit counts), findFlag *result* events (no fixed round end — Play-start is the only meaningful trigger), flagQuiz *play-start* events (every flagQuiz play writes `quizRecords` with `attempts+1` per F5, so start is already captured downstream — only share is new data here), make-a-puzzle as a *separate* event kind (findFlag custom-play IS make-a-puzzle — same wire).

### Feature M Part A: Cloudflare Web Analytics — *shipped 2026-06-14*

Zero code; CF auto-injects the beacon at the edge for proxied zones. First setup pass left the EU-exclude default on, which silently dropped all Polish (and other EU) traffic — the dashboard showed only US/Canada visits despite Jan's known PL user base. Flipped to "Enable" (no EU exclusion); CF Web Analytics is cookieless and hashes IPs, so the GDPR posture is acceptable for the hobby-site use case. Privacy page disclosure shipped in PR #421. Dashboard now shows DAU + visit count + Top Pages + per-country geographic breakdown, bot-filtered server-side. Defends the "are we even seeing humans" question that prompted the whole L/M/N framing. **Part B** (engagement-event substrate for achievements + analytics) is now in `## Now` — promoted 2026-06-15 with a globally-designed single-container shape (`engagementEvents`) instead of the originally-spec'd three-container split.

### Feature N: Daily streaks — finish screen + profile page — *shipped 2026-06-15*

**Goal.** Surface a returning-player number on the daily finish screen that makes coming back tomorrow feel like it matters, and a dashboard view of the same numbers on `/profile/` for the "I want my stats" surface. Derived server-side from existing `dailyResults` rows — no new container, no migration.

**Shape that shipped.** Finish screen splits "your stats" from "community stats" by position: personal block inline in the headline (only when `currentStreak ≥ 2` — no signal, no clutter), community block below. Profile page reads the same endpoint and renders Current streak + Best streak (hidden until `totalPlayed ≥ 1`). Win-rate row deliberately omitted on the profile page — by construction every `dailyResults` row is a completion, so even with the M Part B start-event denominator the resulting "submitted ÷ started" ratio doesn't measure what a player would intuit from "win rate" (a 1/4 finish and a 4/4 finish both count as 100%). Profile direction pivots from "stats dashboard" to "achievements" — see Feature O. The endpoint still returns `winPercent` in case a future surface wants it, but no user-facing UI plans to render it.

**What shipped (four phases):**

1. **N1 — pure compute + tests.** `api/src/lib/streakCompute.js` exports `computeStreak({rows, latestId?})` (rows are `{id, completed}` keyed on any consecutivity axis — for daily streaks the caller passes Warsaw day-numbers) and `submissionsToStreakRows(docs, dayFn)` (the dedupe layer; multiple submissions on the same calendar day collapse to one entry). 22 unit tests. *(Originally landed at `flags/streakCompute.js` in PR #438; relocated to `api/src/lib/` during N2. N1 spec originally said "consecutive puzzleIds" — corrected during N3 to "consecutive Warsaw days" after Jan caught that doing archive puzzles #1, #2, #3 in one sitting would incorrectly show streak = 3.)*
2. **N2 — read endpoint.** `GET /api/v1/daily/me?deviceId=…` in `api/src/functions/dailyMe.js`. Cross-partition `SELECT c.submittedAt FROM c WHERE c.deviceId = @did` against `dailyResults`, maps to Warsaw day-numbers via `warsawDayNumber`, dedupes, calls `computeStreak` with `latestId = today` (server computes "today" itself so a player who skipped today gets `currentStreak: 0`). 60s in-Function cache keyed by `deviceId`, `?fresh=1` bypass, 60/min/IP rate limit, `local:true` rows included.
3. **N3 — finish screen wiring.** New `daily/streakClient.js` (`fetchDailyMe`, never-throws, defensive shape normalisation, 11 tests). `daily/page.js` fires the fetch after both natural-finish and revisit paint, but **only when `n === todayN(catalog)`** — an archive finish doesn't extend the streak counter, so surfacing the line there would falsely suggest the archive play bumped it. `paintStatsPanel` composes the streak inline ("Twój wynik: 2/27 · Średni wynik: 20.6/27 · Seria dni: 2 · ⌬") only when `currentStreak ≥ 2`. i18n strings under `daily.streak.line`. **N3 also corrected the puzzleId → Warsaw-day semantics from N1/N2:** added `api/src/lib/warsawDay.js` (DST-safe via `Intl.DateTimeFormat`, 8 tests) and renamed the StreakRow field `puzzleId` → `id`.
4. **N4 — profile page wiring + adjacent palette cleanups.** `/profile/` imports `fetchDailyMe` and renders Current streak + Best streak; form re-orders so Save · Home stays anchored at the bottom whether stats are shown or not. Title key renamed `nickname.editTitle` → `profile.title` (page is no longer nickname-only). Folded into the same PR per the "UI polish iterates on one branch" rule: `findFlag/index.css` `.find-input.wrong` red border + red wash → pink border via `var(--secondary-color)`, no wash (fixes both findFlag and daily since daily includes findFlag/index.css); `flagQuiz/index.css` `@keyframes penalty-flash` red `#c5302d` → `#666` swapped to `var(--secondary-color)` → `var(--muted-color)` so the timer's penalty pulse uses brand pink and lands back on the same muted colour `.play-timer` declares at rest.

**Open design calls settled in flight (preserved for forward reference):**

- **Win = completion** (any score). Score-threshold definition creates a "what counts as a win" debate every time a puzzle gets harder.
- **Streak break = missed day OR played-but-didn't-finish.** Otherwise half-trying every day keeps the streak alive, which dilutes the badge. (Today no source produces a `completed:false` row — `submissionsToStreakRows` always emits `completed:true`. The shape stays open for Feature M Part B's start-event signal.)
- **Identity scope: per-deviceId today.** After Feature C lands, dedupe by identityId where present, deviceId otherwise.
- **Why not localStorage caching:** the explicit reason for server-side compute was "streaks survive browser cache clears." LocalStorage caching reintroduces the staleness / cross-device-drift problem we're avoiding. The 60s in-Function cache covers the same RU concern without that downside.

**When to materialize a per-device aggregate doc** (deferred until felt): ship a new container `dailyStreaks` partitioned by `/deviceId`, doc shape `{ id: deviceId, currentStreak, maxStreak, totalPlayed, totalCompleted, daysSet, lastUpdatedAt, v }`, upserted from `dailyResult.js` on every finish. `dailyMe.js` becomes a point-read (~1 RU). Same pattern Feature G uses for `tttPairs`. **Trigger any one of:**

- Cosmos account total RU/s consumption sits sustained above **800 RU/s** (80% of Free Tier 1000) — visible in `cosmos-yetanotherquiz-jg` portal metrics.
- `/api/v1/daily/me` p95 latency creeps above **500ms** (today ~50-100ms warm, ~1-2s cold) — Application Insights `dependencies` panel filtered to `dailyMe`.
- Puzzle count crosses **~300** (~10 months of daily releases from 2026-06-15) — at that fan-out, ~10-15 RU per uncached fetch starts being felt.

Don't ship before any of these fire — the write amplification (every `dailyResult` insert gains a second Cosmos round-trip) buys nothing until the read path actually hurts.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/streakCompute.js` `computeStreak` + `submissionsToStreakRows` — pure, generic, keyed on any consecutivity axis. Any future "streak counter on X" reuses these.
- `api/src/lib/warsawDay.js` `warsawDayNumber` — DST-safe Warsaw-day mapping via `Intl.DateTimeFormat`. Reusable for any feature that needs "did these two events fall on the same Warsaw calendar day?".
- `daily/streakClient.js` `fetchDailyMe` — the contract for reading `/api/v1/daily/me`. Both the finish screen and the profile page compose this; future surfaces (archive grid badge, etc.) do the same.

**Key PRs.** #438 (N1), #439 (N2), #440 (N3), #441 (N3 follow-up: live offensive-nickname check + pink moderation colours), #442 (N4 + red→pink palette fixes).

**Out of scope, intentionally deferred** (captured so they don't drift back in): streak freezes / makeup days, weekly streaks, public streak leaderboards (Feature K territory — already shipped for *daily* leaderboards), retroactive push notification, in-grid "your streak" badge on the archive page, per-mode streaks if the daily ever forks, the win-rate row on the profile page (concept dropped permanently — see the Shape note above; profile direction moves to Feature O achievements).

### Feature L: Wordle-style shareable result grid + touch-only share alignment — *shipped 2026-06-14*

**Goal.** After finishing the daily puzzle, the player taps a small share icon inline at the end of the stats headline ("Your score: 2/4 · Average score: 3.4/4 · ⌬") to copy a Wordle-style teaser to their clipboard or fire the OS share sheet. Payload: title line + emoji grid (🟩 found / ⬛ missed, canonical answer-set order, 5 cells per row) + the daily URL. No country names, no flag emojis — the grid is a structural teaser, share-safe.

**What shipped (one PR, six-commit branch, 2026-06-14):**

1. **Pure renderer** `flags/shareGrid.js` `buildShareText()` + 8 unit tests covering all-found / all-missed / ragged-tail / canonical-order / off-set inputs.
2. **`shareText()`** added to `common.js` as a sibling of `shareUrl()` with the same three-tier fallback (`navigator.share` → `navigator.clipboard.writeText` → legacy textarea + `execCommand('copy')`). 4 tests pin the payload-shape difference vs `shareUrl`.
3. **Daily wiring** in `daily/page.js` — `setShareCtx` + `createShareButton` pair. `paintStatsPanel` appends the button inline at the end of `.daily-stats-headline` on every repaint (loading → score-only → score-with-stats). Module-ref state so the panel-paint code stays oblivious to puzzle details.
4. **i18n** EN + PL: `daily.share.aria` (button label) + `daily.share.title` template `"Yet Another Quiz — Daily #{n} — {score}/{total}"`.
5. **Touch-only share-icon rule, site-wide.** Daily, findFlag (`#game-share` + `#result-share`), and TTT's `#share-link` are all gated behind `matchMedia('(pointer: coarse)')`. The findFlag side was previously always-on; brought into line in the same PR (briefly its own PR #423, folded in during consolidation). Single rule across the whole site now: share-icons are touch-only.

**Why touch-only.** On desktop, `navigator.share()` opens the OS share sheet (Windows Share dialog with Teams / Outlook / Copilot tiles, macOS share menu) which is visually heavy for what is conceptually "copy this string somewhere." A silent clipboard-only path was the alternative but proved too quiet to be discoverable. Hiding the icon on desktop where the share-loop audience isn't anyway is cleaner than introducing a bespoke desktop feedback affordance.

**Mid-flight finds captured in commits (real lessons, not nits):**

- First wiring wrapped `#final-score-line` in a new `.final-score-row` div to host the button. That broke `#result > .final-score { display: none }` (selector no longer matched the now-grand-child) and the historically-hidden "You found 2 / 4" line came back big and ugly above the panel. Revert the wrapper; move the icon into the stats headline.
- Vertical alignment was off because the headline `<p>` was inline + `vertical-align: middle` on the share-link. Switch the headline to `display: flex; align-items: center` — same pattern findFlag's `.final-score-row` and TTT's `.room-line` already use.
- Separator spacing was asymmetric (text-internal `·` vs flex-gap `·`). Fold the trailing " · " into the text span so the rhythm matches `"score: 7/9 · Average"`.
- Icon colour clashed (brand red link colour vs `#333` headline). `color: inherit` inside the headline.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `flags/shareGrid.js` + tests — the contract for "render an emoji grid from a found/answer set". Future game modes that want a similar share grid compose the same module.
- `common.js` `shareText()` — the three-tier fallback for any future multi-line share payload (sibling to the existing `shareUrl()` for bare URLs).
- The "share-icons are touch-only across the site" rule — pinned in TTT, findFlag, and daily via the same `matchMedia('(pointer: coarse)')` check. Apply the same gate when adding share affordances to any future surface.

**Key PR.** #422 (six commits; folded in the touch-only alignment work that was briefly #423 before consolidation).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): **Open Graph / Twitter Card meta** on `daily/index.html` so the chat-app link-preview card shows something puzzle-specific instead of the generic site favicon (~10-line follow-up; consider as a quick win to amplify the share loop). **Canvas-to-PNG image rendering** for visually-rich shares. **`?d=YYYY-MM-DD` deep-link routing** so a recipient sees the same puzzle on click-through (currently `daily/` always serves today's). **Share-count tracking** — would need a Cosmos write per share; wait for Feature M Part B's event-counter infrastructure.

### Feature K: Daily leaderboard on flag-quiz finish screen — *shipped 2026-06-12*

**Goal.** After a flag-quiz round (Europe 60s, All endurance, etc.) the result screen shows the player's own score *and* today's top-10 leaderboard for that exact configKey, with the caller's row highlighted when visible and a "…N. You" suffix when their rank is past the top 10. Today = UTC, auto-resets nightly via the container's 48 h TTL. Per-configKey (one for `europe:60s:sov`, one for `africa:all:sov`, etc.) — reuses the existing quiz-record key, no new taxonomy.

**What shipped (two phases, both 2026-06-12):**

1. **K1 — backend.** New Cosmos container `dailyLeaderboards` partitioned by `/pk = "<configKey>|<UTC-date>"`, autoscale 100–1000 RU/s, `defaultTtl: 172_800` (48 h — yesterday's rows auto-purge), composite indexes on `(score, durationMs)` both directions for higher-wins (timed) and lower-wins (endurance) modes. Indexing policy frozen in `infra/dailyLeaderboards-index-policy.json` and provisioned via `az`. Extended `api/src/functions/quizRecord.js` to fire a best-effort today-PB write after the existing upsert — parallel point-reads of `profiles` (nickname denorm) + today's leaderboard row, upsert only on PB, `local: true` stamp in dev so the public read excludes them. New endpoint `api/src/functions/quizLeaderboard.js` at `GET /api/v1/quiz/leaderboard/{configKey}?deviceId=…` — 60 s TTL cache on top-10 per partition (cache key includes order so a future direction flip can't serve a wrong-direction list), per-request rank query, `?fresh=1` bypass.
2. **K2 — frontend + i18n + audit fixes + UX polish.** `flags/dailyLeaderboardFetch.js` (defensive shape-normalising GET helper, never throws), `flags/dailyLeaderboardRender.js` (pure `createElement`-only renderer, XSS-safe), `flags/leaderboardLifecycle.js` (pure submit-then-fetch lifecycle, lifted out of `page.js` for testability), wiring in `flagQuiz/page.js`'s `showResult` (paints loading state immediately, then chains the fresh fetch onto `submitQuizRecord`). i18n strings under `quiz.leaderboard.*` in `en.json` + `pl.json`. CSS keeps the result-screen aesthetic; a 56 px / 20 px / 1 px-hairline section break separates the player's own block from the community list.

**Notable mid-flight finds (real audit catches, not nits):**

- **Security fix during K2 review:** the K1 leaderboard writer trusted the client-supplied `body.lowerWins`, letting a caller post a worse score with `lowerWins:true` and overwrite the today-PB row. K2 fixed it by deriving `lowerWins` server-side from the configKey via `lowerWinsFromConfigKey`; unknown mode skips the write rather than guessing direction. The personal-record write still trusts the body (unchanged trade-off — only that one device's row is affected). Updated the stale "no leaderboard reads this yet" comment in `validate.js`.
- **Handler-extraction precedent.** Two new pure libs (`api/src/lib/leaderboardRank.js` for the cmp/find/compute logic and `flags/leaderboardLifecycle.js` for the submit-then-fetch wiring) demonstrate the pattern for lifting non-trivial logic out of handlers/`page.js` glue so it can be unit-tested. Apply the same pattern when future features grow their own untested handler tails.

**Standing artifacts** (the load-bearing outputs future work inherits):

- `api/src/lib/leaderboardRank.js` + tests — pure `rankCmpClause` + `findMineInTop` + `computeYou`. Any future ranking surface should compose these; cmp-flip on `lowerWins` is pinned to a regression test so a refactor that conflates the two branches gets caught.
- `flags/leaderboardLifecycle.js` + tests — pure `runLeaderboardCycle` for "paint loading → submit → fetch → paint result". Locks the ordering invariant (fetch lands after submit) and the resolve/reject/contract-drift paths.
- `infra/dailyLeaderboards-index-policy.json` — the composite indexing spec is now a tracked file, not a one-shot `az` argument, so future container migrations have the source of truth.

**Key PRs.** #385 (K1 backend + container provisioning), #386 (K2 frontend + audit fixes + UX polish + spacing iterations, squashed).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): lifetime / weekly / all-time leaderboards (each is a different aggregation surface — pick when felt). Per-country leaderboards. "Friends only" / linked-account filtering (Feature C territory). Pre-submission live leaderboard while mid-round. Pagination past 10 (the "…N. You" suffix is the only escape from top-N). UTC vs Europe/Warsaw cutoff (UTC for now; pure server-side derivation, easy to flip if players grumble). **Score-cap per configKey variant** (audit M1) — the leaderboard validates `score ≤ 1000` regardless of variant, so a determined caller could post `score: 1000` on `europe:60s:sov` (real cap ~50) and own #1. Acceptable griefing surface at current scale; revisit if it actually shows up in the wild.

### Feature H: Identity unification + device profiles — *shipped 2026-06-11*

**Goal.** Collapse the two device-identity keys (`gridgame.player.id` for TTT online, `gridgame.deviceId` for daily) into one canonical deviceId, then layer an optional server-stored nickname on top so the daily community stats and the TTT online room can surface "Alice" instead of an anonymous device. This is Layer 1 (device profile) in the three-layer identity model — Layer 0 is the anonymous deviceId we already had, Layer 2 (account-level cross-device linking via passkey) stays parked as Feature C. Each layer is additive: users can stay anonymous, opt up to a nickname, opt up further to a linked account — none of it forced.

**What shipped (four phases, all 2026-06-11):**

1. **H1 — client-side key unification.** One-time migration on first load: if `gridgame.player.id` exists alongside `gridgame.deviceId`, drop player.id; if only player.id exists, copy its value into deviceId and drop player.id. PartyKit took no change — it already accepts the id via `?pid=` and doesn't care what the value represents. Unblocked Feature G's per-device aggregation.
2. **H2 — `profiles` container + nickname UI.** New Cosmos container partitioned by `/deviceId`, doc shape `{ id: deviceId, deviceId, nickname, createdAt, updatedAt, v: 1 }`. New `PUT /api/v1/profile` endpoint (anonymous, rate-limited, Turnstile-gated like daily — currently soft-disabled in prod, same as the other endpoints). Burger-panel "set nickname" affordance.
3. **H2.5 — `/profile/` page + deterministic default nicknames.** Promoted nickname editing from a burger control to a dedicated `/profile/` page. Devices that haven't customised their nickname render a deterministic default derived from the deviceId, so unedited opponents still see a legible name instead of a UUID.
4. **H3 (TTT side) — inline opponent name in the online room.** New `GET /api/v1/profile?id=…` returns one device's nickname (or null). TTT online room renders `vs <Opponent>` inline next to the role badge once `peerId` is known, via `flags/profileFetch.js` (injectable fetch, defensive shape normalisation, never throws). Built with `createElement`, not `innerHTML`, so a malicious nickname like `<script>` can't escape into the page.

**Standing artifacts.**

- `flags/profileFetch.js` + tests — the contract for the read side of the profile container; reused by anything that wants to display "this device's chosen name".
- `flags/tttPairFetch.js` + tests + `GET /api/v1/ttt/result` — head-to-head **score** UI is deliberately not rendered yet (design on hold), but the read-path backend and client helper shipped as scaffolding so re-enabling it is a single page.js change. Data is already accumulating in Cosmos via Feature G.
- Deterministic-default-nickname helper — every "what name does this deviceId display as?" answer flows through one function.

**Key PRs.** #359 (H1), #360 (H2 — soft-disabled Turnstile), #361 (H2.5), #363 (H3 TTT side).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): H3 daily-side surfacing ("Alice scored 67%") — no per-player surface exists in the daily UI today; needs a new leaderboard or row-list element, pick up when the demand is felt. Head-to-head score display in the TTT room — backend ready, UI on hold pending design sign-off. UA / browser / locale fingerprint storage — privacy hygiene; don't collect what no feature reads. Nickname uniqueness / moderation — display-only and collisions allowed; revisit if profanity or impersonation become real problems. Cross-device linking — Feature C's job, fundamentally a different layer.

### Feature G: TTT online — head-to-head score per device pair — *shipped 2026-06-11*

**Goal.** Persist online TTT outcomes so per-device matchup stats become possible. Before this, the PartyKit Durable Object held the room state and evicted it once the game ended — no head-to-head history existed at all. **Design pivot during build:** abandoned the original "one row per game, two perspectives" shape in favour of a much leaner **one row per (deviceA, deviceB) pair** holding both modes' rolling counters. Justification: the only planned read surface is "Alice vs Bob: 3-2 in 3×3, 1-1 in 9×9"; storing every game would bloat Cosmos for analytics nobody will run. Trade-offs accepted (and explicit so they're not re-litigated): no replay, no `movesCount`/`durationMs`, give-up squashed into win/loss client-side, refresh-after-finish can double-count once (no gameId minting).

**What shipped (one phase, 2026-06-11):**

- **`tttPairs` Cosmos container.** Partition key `/deviceId`, 400 RU/s manual, no TTL. Doc shape: `{ id: "<deviceId>:<opponentId>", deviceId, opponentId, m3x3: { wins, losses, draws }, m9x9: { wins, losses, draws }, lastPlayedAt, v: 1 }`. One row per (this device, that opponent) holding both modes — storage grows with distinct opponents, not games played.
- **`POST /api/v1/ttt/result`.** Anonymous, 10/min/IP rate limit, Turnstile-scaffolded (soft-disabled in prod alongside the other endpoints). Read-then-upsert via `api/src/lib/tttPairDoc.js`'s pure `mergePairResult({ existing, deviceId, opponentId, mode, outcome, now })` — tolerant of partial/garbage existing rows (missing or malformed counter buckets normalise to 0). Validation enforces `deviceId !== opponentId`, mode ∈ {"3x3","9x9"}, outcome ∈ {"win","loss","draw"}.
- **Client wiring.** Both TTT clients fire-and-forget `submitTttResult` after the `finished` effect arrives in `onlineClient.js`. Failures don't block the UI. The deviceId unification from H1 was a hard prerequisite — pre-H1, the TTT side used `gridgame.player.id` and the daily side used `gridgame.deviceId`, so the same browser would have shown up as two different identities to the `tttPairs` writer.

**Standing artifacts.**

- `api/src/lib/tttPairDoc.js` `mergePairResult` (pure) + tests — every future per-pair counter mutation routes through this; the defensive normalisation of partial existing rows is the load-bearing piece.
- `flags/tttResultSubmit.js` — the fire-and-forget submit contract; matches the daily-submit shape.

**Server-side trust note.** Both clients independently report the same outcome (Alice's "win" and Bob's "loss"). Mismatches are detectable but not currently blocked — store both, log if cheating becomes visible later. The escalation path is a PartyKit-signed `finished` payload the SWA endpoint validates against PartyKit's public key.

**Key PR.** #362.

**Out of scope, intentionally deferred:** gameId minting + server-side dedupe of refresh-after-finish double-counts (revisit if it shows in data), per-game rows with `movesCount`/`startedAt`/`finishedAt` (the only read surface is the aggregate — game-level data would be bytes with no consumer), `gave_up`/`opponent_gave_up` distinction (squashed into win/loss at the client; revisit when the read surface wants it), spectator/observer roles, anti-cheat hardening beyond rate limit.

### Feature F: Cosmos data discipline + analytics readiness — *shipped 2026-06-11*

**Goal.** Tighten the Cosmos data hygiene we'd accumulated over Features A/B/E, capture a handful of analytic signals we'd otherwise lose forever, and lock in a standing migration playbook for every future shape change — without adding new containers or breaking the "storage scales with users, not engagement" property. Sets the precedent every future Cosmos-touching feature (G/H/Feature I) inherits.

**What shipped (five phases, all 2026-06-11):**

1. **F1 — `dailyResults` throughput 400 → 1000 RU/s.** Free Tier covers it via the account-wide 1000 RU/s quota. Headroom for the read-RU concern flagged in `infra/operations.md`.
2. **F2 — `dailyResults` `defaultTtl: 31_536_000` (1 year).** Rows auto-purge from `_ts + 1y`. Earliest auto-deletion lands **2027-06-09**; Feature I (parked) must ship before then to preserve per-puzzle aggregates past the TTL.
3. **F3 — `v: 1` on the daily writer + migration playbook in `infra/operations.md`.** Every native write now self-describes its schema version. The standing migration playbook documents: every future shape change ships a backfill that (a) fills missing analytical fields with sensible defaults, (b) sets `backfilled: true` ONLY when an analytical field was defaulted (not on metadata-only patches), (c) bumps `v`.
4. **F4 — first exercise of the policy: 20 pre-v:1 `dailyResults` rows backfilled.** 1 row pre-PR-#317 (missing `wrongCodes`) got group-A treatment (`wrongCodes: [], backfilled: true, v: 1`); 19 rows had `wrongCodes` natively → group B (added `v: 1` only, no `backfilled` marker). F4 surfaced the "metadata-only patches don't get `backfilled`" nuance that the policy now captures explicitly.
5. **F5 — `attempts` + `lastPlayedAt` per `records[configKey]` in `quizRecords`; write-on-every-finish.** Server-side `mergeQuizRecord` no longer short-circuits on non-PB; the `flagQuiz/page.js` client lost its mirroring `if (isNew)` gate (caught during local verification, not by tests — see "honest gaps" in #356). 5 docs / 10 sub-entries backfilled with `attempts: 1, lastPlayedAt: submittedAt`, doc-level `backfilled: true, v: 1`.

**Standing artifacts** (these are the load-bearing outputs future work inherits):

- `infra/operations.md` "Cosmos data migration policy" — the contract every future migration follows.
- `scripts/backfill-daily-v1.cjs` and `scripts/backfill-quiz-v1.cjs` — the template shape for future backfills: pure `planRow()` exported for testability, idempotent dry-run by default, system fields stripped before upsert.

**Key PRs.** #350 (F1+F2 prod config), #351 (F3 writer + policy doc), #352 (parked **Feature I** — per-puzzle snapshots, hard deadline 2027-06-09 to outlive F2's TTL), #355 (F4 backfill + policy nuance), #356 (F5 writer + handler + client + backfill).

**Out of scope, intentionally deferred** (captured here so they don't drift back in): pre-aggregated `stats:{puzzleId}` for read performance (cache covers it; the retention-driven version is Feature I, different motivation), per-pick timestamps on daily, `openedFlagsdataDuringPlay` honesty signal (BroadcastChannel-based; partial coverage gives illusion of detection), lifetime totals on `quizRecords` (derivable from `sum(records[*].attempts)`), per-finish quiz event-log container (would break the "1 row per device" property).

### Feature E: Reliable daily-puzzle auto-release via Azure Logic App — *shipped 2026-06-10*

**Problem.** GitHub Actions `schedule:` cron on `release-daily.yml` was firing very late — observed firings on the night of 2026-06-09→10 (run IDs `27242130968`, `27244311244`, both `event=schedule` per GitHub's own record) landed at ~01:19 and ~02:15 Warsaw, i.e. 75–135 min after the 00:00 nominal target. The manual morning dispatch always won the race, so from a user's POV the puzzle never auto-released; the 14-firings-per-night defensive burst was masking lateness, not curing it.

**Fix.** Moved the *trigger* to an Azure Logic App (Consumption tier) with a Recurrence trigger at 00:05 Warsaw. The Logic App POSTs `workflow_dispatch` to the existing `release-daily.yml`; everything downstream is unchanged — the workflow still promotes `daily/daily_backlog.json[0]` → `daily/daily_puzzles.json`, commits, kicks `deploy.yml`, and the static site ships the new puzzle as part of the normal deploy path.

**Architecture.** Single `Microsoft.Logic/workflows` resource (`logic-yetanotherquiz-release-daily`) in `rg-yetanotherquiz`, West Europe. Recurrence trigger uses Windows TZ identifier `Central European Standard Time` (auto-follows DST). HTTP action authenticates with a fine-grained GitHub PAT stored as a `securestring` WDL parameter — never baked into the deployed workflow JSON, masked in portal + run history. No managed identity, no storage account, no Function App — Logic App Consumption is a single resource. Cost: $0 (free grant covers ~31 executions/month vs the ~30 we use). Defined in `infra/logicapp-release-daily.bicep` as single source of truth — round-trip every change through the template and `az deployment group create`, no portal click-edits.

**The "fires on registration" quirk.** When `az deployment group create` *creates* the Logic App, the Recurrence trigger fires once immediately as part of registration, then settles into its schedule for subsequent runs. Documented Logic Apps behaviour, not a bug. In practice the first deploy doubles as a free end-to-end smoke test, and future redeploys (e.g. for PAT rotation) fire one extra `workflow_dispatch` that `release-daily.yml`'s "already released today" guard catches cleanly. Pure update deploys that don't recreate the resource (e.g. tag changes) do NOT trigger this. Captured in `infra/README.md`.

**Verification.** All hops verified live during deploy day before the schedule-cutover commit:
1. Deploy-time auto-fire 16:16:29Z 2026-06-10 → Logic App run `08584204986959706003361452862CU13` Succeeded → workflow run `27289674634` (`event: workflow_dispatch`, 14s, guard hit cleanly).
2. One-off scheduled fire at 19:10 Warsaw — schedule swapped to `hours:[19] minutes:[10]` for a 15-min test window, then reverted same hour. Logic App run `08584204954564865890913776253CU32` fired at 19:10:28 Warsaw → workflow run `27292799473` (13s, guard hit cleanly). Log line: `Already released today (2026-06-10 Warsaw, last commit was 2026-06-09T22:40:38Z) — skipping.`
3. Reverted-schedule deploy → trigger metadata `nextExecutionTime: 2026-06-10T22:05:28Z` = 00:05 Warsaw 2026-06-11.
4. First natural 00:05 Warsaw fire on 2026-06-11 → `daily: release #6 — auto-promoted from backlog` commit on `main`.

Soak window skipped — Logic Apps don't have GitHub cron's "sometimes fires" failure mode that justified multi-night observation.

**PAT lifecycle.** Fine-grained GitHub PAT, repo-scoped to `jgrzegrzolka/gridgame`, permission `Actions: write` only (auto-grants `Metadata: Read-only` as a forced dependency). Initial mint 2026-06-10 with 90-day expiry; future rotations will use GitHub's 1-year max. Rotation = mint new PAT + `az deployment group create` with the new value. GitHub emails 7 days before expiry — that's the reminder.

**Future considerations** (captured so the question doesn't need re-deriving):
- **Option: GitHub App + OIDC federation.** Replace the PAT with Logic App managed identity → OIDC ID token → GitHub App installation token. Zero secrets stored, zero rotation ever. Cost: a few hours of plumbing (create GitHub App, install on repo, configure federated credential on the Logic App identity, swap HTTP action auth). Re-examine if rotation becomes friction or extended absence (>1 year) is planned.
- **Option (ruled out): Move backlog to Cosmos + new `/api/daily/today` endpoint.** Kills GitHub from the runtime path entirely — no PAT, no daily release commit. Loses two values explicitly preserved in this project: "the file is the released state" (git as source of truth, `git log` as audit trail) and the per-puzzle authoring workflow (edit JSON + commit + PR is more locality than tool-mediated Cosmos writes). Authoring happens ~weekly, PAT rotation ~annually — bad swap as long as authoring is done by hand.

**Rollback playbook.**
- *Logic App firing wrong / spamming runs*: portal → `logic-yetanotherquiz-release-daily` → **Disable**. Stops all future runs instantly. Re-enable when fixed.
- *PAT compromised or leaked*: revoke at GitHub Settings → Developer settings → PATs. Logic App's HTTP action will start returning 401 (visible in Logic App run history). Mint new PAT, redeploy Bicep with new value.
- *Logic App entirely broken*: temporarily restore the `schedule:` block to `.github/workflows/release-daily.yml` (GH cron is flaky but better than nothing) and disable the Logic App.

Key PRs: #341 (Bicep template scaffolded, no deploy), #342 (`schedule:` removal + FEATURE.md promotion + docs cleanup — this PR).

### Feature D: Emergency SWA failover migration — *shipped 2026-06-10*

**What happened.** Around 10:21 UTC the Azure Static Web Apps deploy-promotion pipeline broke for `swa-yetanotherquiz` (West Europe, Free SKU). Every deploy after the 09:02 success uploaded its artifact to Azure in ~3 seconds, then sat in `Polling on deployment` for 10 minutes until the GitHub action gave up with `Upload Timed Out`. Azure's `/builds` endpoint showed `status: Uploading` indefinitely, then eventually flipped to `Failed` with no error message. 4 retries and a local `swa deploy` CLI attempt all failed the same way. Portal's **Diagnose and solve problems → Content Deployment** was itself broken with `Sorry, an error occurred`. No public Azure incident acknowledged.

**Why it mattered.** PR #336 (Turnstile soft-disable) was unshipped, meaning legitimate users hitting Cloudflare Turnstile 401s (e.g. Firefox with strict tracking protection) were having their daily-puzzle submissions silently dropped — and every hour of delay locked more bias into community stats.

**Diagnosis path.**
1. Created `swa-yetanotherquiz-v2` (West Europe, fresh) — same failure → ruled out instance-specific corruption.
2. Created `swa-yetanotherquiz-v3` (West US 2, fresh) — **deployed cleanly in 32 seconds**, confirmed the issue was West Europe regional, not service-wide.
3. Filed a public issue at https://github.com/Azure/static-web-apps/issues so Microsoft sees it.

**Cutover.** Removed `www.yetanotherquiz.com` from V1, added to V3 with DNS-TXT validation, flipped the Cloudflare CNAME from `black-dune-...` → `wonderful-ground-01bf3091e.7.azurestaticapps.net`. V1 was accidentally deleted mid-cutover (a queued `az staticwebapp delete` finally executed during the WE control-plane chaos) — not a problem since V1 was unusable anyway.

**Resulting topology.**
- **Active prod:** `swa-yetanotherquiz-v3` (West US 2), serving `www.yetanotherquiz.com`.
- **Deleted:** `swa-yetanotherquiz` (V1, WE), `swa-yetanotherquiz-v2` (V2, WE).
- **Workflow:** single `.github/workflows/deploy.yml` using GH secret `AZURE_STATIC_WEB_APPS_API_TOKEN_V3`.
- **Latency cost:** Functions in WUS2 + Cosmos in WE = ~300 ms cross-region per API call. Acceptable for low-volume endpoints.

**Recovery playbook — for when Azure WE recovers** (or when we want lower API latency):
1. Verify WE is healthy: create a throwaway SWA in WE via `az staticwebapp create`, trigger one deploy. If it completes in seconds (not 10 minutes), WE is back.
2. Create `swa-yetanotherquiz-we` (or reuse the `swa-yetanotherquiz` name) in West Europe. Copy `COSMOS_CONN` + `TURNSTILE_SECRET` app settings. Add its deploy token as GH secret `AZURE_STATIC_WEB_APPS_API_TOKEN_WE`.
3. Add a sibling `.github/workflows/deploy-we.yml` (copy of the current `deploy.yml`, swap the secret). Two independent workflows = both fire on push, neither blocks the other if the other fails.
4. Add `www.yetanotherquiz.com` as a custom domain on the new WE SWA via TXT validation while V3 is still serving (Azure requires the source SWA to release first — same conflict we hit today; remove from V3 before adding to WE).
5. Flip Cloudflare CNAME back to the WE hostname. Validate. Done — V3 stays as hot-standby for next time.

**2026-06-11 follow-up — redirect rule hardening + Cloudflare cleanup.** The CF apex→www redirect "Redirect from root to WWW [Template]" was firing intermittently. Its wildcard `https://yetanotherquiz.com/*` only matched HTTPS with a trailing path — plain-HTTP requests and edge cases fell through to the 4 stale GH Pages A records (`185.199.108-111.153`), surfacing as unstyled stale content or Azure 404s on apex. The "functionally irrelevant" rationale in the original cleanup list was wrong: those records were one rule-misfire away from being the actual origin. Rewrote the rule to match by host header instead — Match: `(http.host eq "yetanotherquiz.com")`, Target (Dynamic): `concat("https://www.yetanotherquiz.com", http.request.uri.path)`, 301, preserve query string. Then deleted all 4 GH Pages A records and replaced with a single placeholder A record (`192.0.2.1`, TEST-NET-1, proxied) so apex stays resolvable for the rule to fire on, but any future rule misfire falls through to an unroutable IP rather than a real stale server. Also removed the stale apex TXT `_9n7yl364eeo06i0bnmr5hyuxtpcpff2` (the original SWA's hostname validation token, no longer used). All Feature D Cloudflare-side cleanup is now closed.

Key PRs from the day: #336 (Turnstile soft-disable, the fix that needed to ship), #337 (deploy-v2.yml diagnostic, deleted in #339), #338 (deploy-v3.yml diagnostic, repurposed into the new `deploy.yml` in #339), #339 (this cleanup).

Current-state reference for what's deployed and the runbook for these symptoms: [`infra/operations.md`](infra/operations.md).

### Feature B: Daily challenge — global stats — *shipped 2026-06-10*

Per-flag find rates aggregated across everyone who attempted the same daily puzzle, plus an "Average today: X/Y" headline below the result. Live in production.

**Architecture in one paragraph:** Cosmos doc `id = "{puzzleId}:{deviceId}"` enforces single-submission-per-device. `POST /api/v1/daily/result` (5/min/IP rate-limited; was originally Turnstile-verified but **soft-disabled 2026-06-10** after CF started 401-blocking legitimate users — see CLAUDE.md "Local development" for the rationale) inserts a row; 409 on duplicate. `GET /api/v1/daily/stats/{puzzleId}` aggregates to `{totalAttempts, perCodeFinds, mean, topPct}`, in-Function cached 60s, with `?fresh=1` bypass for the player who just submitted. Permanent infra/API plumbing facts (Functions v4 layout, CommonJS pin, Cosmos REST instead of `@azure/cosmos`, etc.) moved to `CLAUDE.md` "API / Azure Functions" section.

**Closed unbuilt:**
- **B6 — archive integration** — delivered indirectly by B4. Clicking an archive square already routes through the daily revisit branch, which fetches the same stats. Inline aggregate hints on the archive grid itself weren't worth doing at current per-puzzle N.
- **B7 — player-percentile headline ("you're in the top X% today")** — the existing "Average today" line covers the job at current traffic. Adding a server distribution endpoint (`SELECT COUNT(*) GROUP BY ...`) + client aggregation isn't a felt need yet. Re-open when traffic justifies.

Key PR milestones: #284 (api skeleton), #293 (validate-only POST), #296 (Cosmos REST insert), #304 (identity + submitted tracking), #315 (local dev scaffolding), #322 (median → mean).

### Local development setup — *shipped 2026-06-10*

Full local stack runs via `npm run dev:swa` (static site + Functions API + Cosmos round-trips against real prod Cosmos + Azurite for the Storage health check). Permanent setup/run docs live in `README.md` (setup + run sections) and `CLAUDE.md` "Local development" (Azurite trade-offs, deeper notes). Dev reset toolbar mounts localhost-only on the daily + archive pages for one-click localStorage + Cosmos-local-rows cleanup. Key PR milestones: #315 (scaffolding), #335 (Azurite + dev reset toolbar + `/api/v1/dev/clear-local-rows`).

### Feature A: Migrate site hosting to Azure SWA — *shipped 2026-06-09*

GitHub Pages → Azure Static Web Apps (Free SKU). Public URL `https://www.yetanotherquiz.com` (apex 301-redirects to www via Cloudflare). Resources: `rg-yetanotherquiz`, `swa-yetanotherquiz` (the original WE instance — replaced by `swa-yetanotherquiz-v3` in West US 2 during Feature D's failover the next day). Permanent hosting facts moved to `CLAUDE.md` "Hosting" section; PR #281 + #282 + the wrap-up PR have the implementation history.
