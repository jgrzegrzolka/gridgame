# Achievements

How the achievement system fits together — for the next person (or agent) about to add a rule or change the storage model.

## Layers

The snapshot the predicates evaluate against is **stitched from two sources**: server-derived fields (daily streak, mastery, quiz aggregates, nickname/linked, TTT counters) and localStorage-derived fields (the engagement section: share counts, coffee click, 60s-quiz streak). Phase 4.5 of Feature S inverted the engagement source so achievement-on-action celebration doesn't depend on the syncBlob push cadence.

```
┌──────────────────────────────────────┐   ┌──────────────────────────────────┐
│  COSMOS                              │   │  LOCALSTORAGE                    │
│  ───────                             │   │  ────────────                    │
│  dailyResults  (daily plays)         │   │  gridgame.engagementState        │
│  quizRecords   (quiz PBs)            │   │    { shares.{daily/flagquiz/     │
│  tttPairs      (TTT counters)        │   │      findflag/ttt},              │
│  profiles      (nickname, linkedAt,  │   │      coffeeClickCount,           │
│                  syncBlob for sync)  │   │      quiz60sDayLog }             │
└──────────────────────────────────────┘   └──────────────────────────────────┘
              │ cross-partition / point reads                │
              ▼                                              │
┌──────────────────────────────────────┐                     │
│  SERVER COMPUTE — api/v1/daily/me    │                     │
│  api/src/functions/dailyMe.js        │                     │
│    → computeStreak   (daily axis)    │                     │
│    → computeMastery                  │                     │
│    → computeQuiz                     │                     │
│    → computeTttSignals               │                     │
│    → computeEngagement(profile,      │                     │
│           profile.syncBlob.engagement)                     │
│  60s in-memory TTL cache per device. │                     │
└──────────────────────────────────────┘                     │
              │ GET /api/v1/daily/me                         │
              ▼                                              │
┌──────────────────────────────────────────────────────────────┐
│  CLIENT — flags/engagementSnapshot.js                        │
│  mergeEngagementOverlay(serverSnap, localStorage, today):    │
│    → reads engagementCounters state                          │
│    → derives engagement fields (shares, coffeeClicked,       │
│      quiz60s* via flags/streakCompute.js)                    │
│    → overlays them onto the server snapshot (local wins)     │
└──────────────────────────────────────────────────────────────┘
              ▼
┌──────────────────────────────────────────────────────────────┐
│  CLIENT — flags/achievements.js                              │
│  evaluateAchievements(snapshot)                              │
│    → for each rule: { rule, earned: rule.predicate(snap) }   │
│  diffNewlyEarnedAchievements(before, after)                  │
│    → rules earned in `after` but not `before` (celebration)  │
└──────────────────────────────────────────────────────────────┘
              │
              │ centralised via flags/achievementsBaseline.js
              │ (primeAchievementsBaseline + refreshAchievementsAndDiff
              │  apply the overlay; profile/page.js applies it directly
              │  for its badge grid)
              ▼
      profile/page.js       daily/page.js       (& earn-moments
      badge grid +          diff on finish +     in flagQuiz, findFlag,
      info dialog           celebrate()          ticTacToe, common.js)
```

Cards & info dialog: `flags/achievementCelebrate.js` (shared cascade) + `.ach-celebrate*` / `.achievement-info*` in `common.css`.

## The snapshot shape (the contract)

Everything below the line in `evaluateAchievements` is data-driven. Predicates only see what the snapshot exposes:

```
{
  // Daily streak / mastery (server, from dailyResults)
  currentStreak, maxStreak, winPercent,
  totalPlayed, totalCompleted,
  cleanSweeps, flawlessSweeps,
  attemptedFinishes, zeroScoreFinishes,

  // Quiz aggregates (server, from quizRecords)
  quizAttempts60s, quizVariantsTouched60s, quizBestScore60s,
  quiz60sClearedVariants,
  quizAttemptsAll, quizVariantsTouchedAll, quizAllLowWrongAny,
  quizAllPerfectedVariants,

  // Identity (server, from profiles row)
  hasNickname, hasLinkedDevice,

  // Engagement (LOCALSTORAGE, via mergeEngagementOverlay — Phase 4.5)
  dailySharesCount, quizSharesCount, findflagSharesCount,
  coffeeClicked,
  quiz60sCurrentStreak, quiz60sMaxStreak, quiz60sDistinctDays,

  // TTT (server, from tttPairs)
  tttGamesPlayed, hasWonTtt, hasLostTtt,
}
```

**Adding a new counter:**
- If it derives from server-side data (a new `dailyResults` field, a new TTT outcome): add the compute call in `dailyMe.js`, add the field to the typedef in `flags/achievements.js`.
- If it derives from client-side engagement (a new share surface, a new local counter): add the bump function in `flags/engagementCounters.js`, surface the field in `flags/engagementSnapshot.js#buildEngagementOverlay`, add it to the typedef.

Otherwise predicates have nothing to read.

## Where state lives and why

| State | Storage | Why there |
|---|---|---|
| Daily play history | Cosmos `dailyResults` | Cross-user community stats; high-value historical data. |
| Quiz PBs | Cosmos `quizRecords` | Daily-leaderboard joins need cross-user reads. |
| TTT match counters | Cosmos `tttPairs` | Two-device shared state. |
| Nickname, linkedAt | Cosmos `profiles` | Cross-device identity. |
| **Engagement counters** | **localStorage** | Per-device, high-frequency, no cross-user reads. Throttled mirror in `profile.syncBlob.engagement` for cross-device sync only. See Feature S Phase 4.5. |
| **Earned-achievement timestamps** | **localStorage** (`gridgame.achievements.earned`) | Once a player passes a predicate, the badge latches forever on the device. Cleared only if the player clears localStorage. |

**Engagement push cadence:** `pushEngagementBlob` (in `flags/engagementCounters.js`) is throttled at 30 minutes per device. Achievement evaluation doesn't wait for the push — the predicate reads the fresh local state directly via the overlay. The push is purely for cross-device sync.

**Engagement migration:** first boot on any device runs `flags/engagementMigration.js` once. It pulls the server's syncBlob; if populated, inflates localStorage from it (the typical case after Feature S). If the blob is empty, falls back to a one-time `dailyMe` read to seed the device. Sentinel `gridgame.engagementMigrated` latches; migration never re-runs on the same device.

## Compute-on-read, not stored centrally

There's no `userAchievements:{deviceId}` doc on Cosmos. Two consequences:

- **Adding a rule is cheap.** No backfill, no migration. Every existing player auto-qualifies the next time they fetch.
- **Server snapshot cost scales with `dailyResults` rows per device.** Today (~50 rows/player, free Cosmos tier) the cross-partition scan is negligible. The `dailyMe.js` comment pins the trigger to revisit (~2.5K docs / partition fan-out as the warning line).

The engagement section IS stored client-side (in localStorage, mirrored to `profile.syncBlob.engagement`), but the achievement predicates themselves run on every fetch — no cached "earned set" beyond the localStorage `earnedAt` timestamps.

## When to denorm

FEATURE.md already calls this out — switch to a server-side denormalised `userAchievements:{deviceId}` point-read doc when one of these fires:

- **RU cost.** Cosmos metrics show `/api/v1/daily/me` materially contributing to RU/s spend.
- **Rule count > 30.** Client-side predicate compute starts visibly delaying paint.
- **Server-side "just earned X" needed.** Push notifications / emails / outbound webhooks — none of these are on the roadmap today; if any land, denorm becomes mandatory because the client diff isn't observable from the server.

Until then, the indirection costs more than it saves.

## See also

- `flags/achievements.js` — rule library, `evaluateAchievements`, `diffNewlyEarnedAchievements`.
- `flags/achievements.test.js` — pins predicates + diff + rule hygiene.
- `flags/achievementCelebrate.js` — the cascade celebration overlay (cards + info dialog).
- `flags/achievementsBaseline.js` — `primeAchievementsBaseline` + `refreshAchievementsAndDiff`; the centralised path where the overlay applies.
- `flags/engagementSnapshot.js` — the localStorage→snapshot projection + overlay logic (Feature S Phase 4.5).
- `flags/engagementCounters.js` — the localStorage counter primitives + throttled push.
- `flags/engagementMigration.js` — once-per-device pull-first hydrate from syncBlob.
- `flags/streakCompute.js` — client port of `computeStreak` + `dayLogToStreakRows` for the 60s-quiz axis.
- `api/src/lib/masteryCompute.js` — `cleanSweeps` + `zeroScoreFinishes` from raw rows.
- `api/src/lib/streakCompute.js` — server `currentStreak` / `maxStreak` / `totalCompleted` / `winPercent` for the daily axis.
- `FEATURE.md` Feature O — original achievement design notes; Feature S — the storage redesign that moved engagement to localStorage.
