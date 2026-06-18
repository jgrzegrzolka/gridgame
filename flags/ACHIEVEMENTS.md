# Achievements

How the achievement system fits together — for the next person (or agent) about to add a rule or change the storage model.

## Layers

```
┌────────────────────────────────────────────────────────────────┐
│  RAW                                                           │
│  Cosmos `dailyResults` (puzzleId, deviceId, foundCodes,        │
│  totalCount, submittedAt, …)                                   │
└────────────────────────────────────────────────────────────────┘
                          │ cross-partition query by deviceId
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  SERVER COMPUTE — api/v1/daily/me                              │
│  api/src/functions/dailyMe.js                                  │
│    → computeStreak   (api/src/lib/streakCompute.js)            │
│    → computeMastery  (api/src/lib/masteryCompute.js)           │
│  Output: `Snapshot` shape (see flags/achievements.js).         │
│  60s in-memory TTL cache per deviceId.                         │
└────────────────────────────────────────────────────────────────┘
                          │ GET /api/v1/daily/me?deviceId=…
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  CLIENT — flags/achievements.js                                │
│  evaluateAchievements(snapshot)                                │
│    → for each rule: { rule, earned: rule.predicate(snapshot) } │
│  diffNewlyEarnedAchievements(before, after)                    │
│    → rules earned in `after` but not `before` (celebration)    │
└────────────────────────────────────────────────────────────────┘
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
        profile/page.js       daily/page.js
        renders the grid +    diffs on finish +
        info dialog           fires celebrate()
```

Cards & info dialog: `flags/achievementCelebrate.js` (shared cascade) + `.ach-celebrate*` / `.achievement-info*` in `common.css`.

## The snapshot shape (the contract)

Everything below the line in `evaluateAchievements` is data-driven. Predicates only see what the snapshot exposes:

```
{
  currentStreak, maxStreak, winPercent,
  totalPlayed, totalCompleted,
  cleanSweeps, zeroScoreFinishes,
}
```

To add a new counter (e.g. a TTT or quiz field), the corresponding server-side `compute*` function must produce it, *and* the typedef in `flags/achievements.js` must list it. Otherwise predicates have nothing to read.

## Compute-on-read, not stored

Snapshots are computed every cache miss; predicates run every fetch. **No `userAchievements:{deviceId}` doc, no localStorage cache.** Two consequences:

- **Adding a rule is cheap.** No backfill, no migration. Every existing player auto-qualifies the next time they fetch.
- **Snapshot computation cost scales with rows-per-deviceId.** Today (~50 rows/player, free Cosmos tier) the cross-partition scan is negligible. The `dailyMe.js` comment pins the trigger to revisit (~2.5K docs / partition fan-out as the warning line).

## When to denorm

FEATURE.md already calls this out — switch to a server-side denormalised `userAchievements:{deviceId}` point-read doc when one of these fires:

- **RU cost.** Cosmos metrics show `/api/v1/daily/me` materially contributing to RU/s spend.
- **Rule count > 30.** Client-side predicate compute starts visibly delaying paint.
- **Server-side "just earned X" needed.** Push notifications / emails / outbound webhooks — none of these are on the roadmap today; if any land, denorm becomes mandatory because the client diff isn't observable from the server.

Until then, the indirection costs more than it saves.

## See also

- `flags/achievements.js` — rule library, `evaluateAchievements`, `diffNewlyEarnedAchievements`.
- `flags/achievements.test.js` — 30 tests pinning predicates + diff + rule hygiene.
- `flags/achievementCelebrate.js` — the cascade celebration overlay (cards + info dialog).
- `api/src/lib/masteryCompute.js` — `cleanSweeps` + `zeroScoreFinishes` from raw rows.
- `api/src/lib/streakCompute.js` — `currentStreak` / `maxStreak` / `totalCompleted` / `winPercent`.
- `FEATURE.md` Feature O — original design notes (rule ideas, tiered-vs-binary, the denorm trigger).
