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

*(nothing in flight — pick the next feature from `## Backlog` or open a new one)*

---

## Backlog

Items here are not blocking current work but deserve durable memory — the next-time-this-comes-up question, the deferred fix that would otherwise vanish into PR archeology. Agents reading FEATURE.md to find their next task should **not** pick from this section; Jan promotes a backlog item to `## Now` when he decides to actually ship it.

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

### Feature C: Cross-device identity via WebAuthn passkey

**Status:** parked. Don't start until there's actual demand for cross-device stats. Feature B (the daily community-stats data path) is shipped; this is the cross-device identity layer that turns "stats per browser" into "stats per person across all their browsers."

**Goal:** an existing user can opt-in to "save my progress across devices" with one click + Face ID / Touch ID / Windows Hello. From that point on, their stats follow them between phone, laptop, and any other browser-connected device — without registering, without a password, without an email field.

**Relationship to Feature H:** Feature H ships the device-profile layer (L1 — anonymous deviceId + nickname). Feature C is the user-account layer (L2 — multiple deviceIds linked under one userId). When C comes off the parking brake, H's `profiles` container and unified deviceId already exist; C grafts accounts on top via a separate `users` container that links N profiles together. The auth mechanism (passkey vs. recovery code vs. QR handshake vs. magic link) is the open design call to be made when C starts; see the discussion below.

**Partition-key flag for when C lands:** `dailyResults` is partitioned by `/puzzleId`, not by `/deviceId`. The current per-puzzle community-stats query is single-partition and cheap. The "lifetime stats per linked identity" query C implies ("show me my stats across every puzzle I've ever played, merged across my linked devices") is fundamentally cross-partition — it needs every `puzzleId` partition scanned and filtered by the device's identityId. This is acceptable for cache-friendly aggregates but worth designing for explicitly when C lands: either a pre-aggregated `lifetime:{identityId}` doc maintained on each submission, or accepting a one-time cross-partition scan + edge cache. Don't try to change the `dailyResults` partition key retroactively — keep the lifetime view as a separate read path.

**Why not OAuth / magic-link / fingerprinting:**
- **Browser fingerprinting** (UA + canvas + screen) — GDPR risk, breaks on Safari/Brave, ~70% accurate.
- **IP-based** — high false-positive rate on NAT/mobile.
- **OAuth (Google / GitHub / etc.)** — defeats the "no registration" intent.
- **Magic-link email** — requires email infra + user action; passkey is the better cross-device path.

**Storage-shape compatibility (already designed for):**
- Add an optional `identityId` field to existing `dailyResult` docs. Anonymous rows (no `identityId`) stay valid forever.
- When a user creates a passkey for the first time, backfill all existing docs with their `deviceId` to also have the new `identityId`. One Cosmos query, one bulk update.
- Stats aggregation can dedupe by `identityId` where present, `deviceId` otherwise — so a user who plays on two devices counts as one player.

**Likely phases when this comes off the parking brake:**
1. New Cosmos container `users` with `(identityId, publicKey, createdAt)`.
2. `@simplewebauthn/server` integrated into a new `api/src/functions/passkey.js` (register + authenticate endpoints).
3. "Save across devices" button on the finish screen → browser passkey prompt → server stores public key → `identityId` returned to the client → write into `localStorage.gridgame.identityId`.
4. Client sends `identityId` alongside `deviceId` on submissions; server fills in the doc.
5. Optional later: stats UI surfaces "verified player" vs "anonymous browser" so users can tell whether their cross-device merge actually happened.

**Out of scope even for Feature C:** usernames, email, profile pages, social features. The passkey is the only piece of identity.

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

---

## Done

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
