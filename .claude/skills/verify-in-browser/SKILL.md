---
name: verify-in-browser
description: How to verify a gridgame change in a real browser FAST via Playwright MCP — which dev script to boot (flagParty needs the full `npm run dev`, not `dev:swa`), how to clear ports without killing Jan's own session, how to beat the SWA CLI's aggressive cache so you aren't testing stale modules, and how to drive a timed game at full speed (buzz instantly, 0.9s clean reveal, 100ms polling, stop at the first evidence) instead of playing it at human pace. Use before any browser verification of flagParty / daily / flagQuiz / findFlag / ticTacToe. Read it even for a "quick look" — every rule here exists because ignoring it cost real minutes or broke something.
---

# Verify in a browser, fast

Unit tests pin logic. The browser answers "does it actually render and wire up".
Both are required — Jan's standing rule is **don't skip the browser**. But a slow
verify is its own failure: it burns his time watching you play a game at human
speed. The whole skill is: *boot the right thing, make sure you're testing fresh
code, get to the one screen that answers the question, stop.*

## 0. The rule that governs all of this

**Drive to the smallest observable thing that proves the change, then stop.**

Before touching the browser, answer: *what single screen or DOM read settles
this?* Usually one. Assert it and quit. Do not play a game to completion, do not
loop "until final", do not collect data you won't read.

Anti-example that actually happened: proving a card appears in the pick hand by
re-picking it **153 times over four minutes**. One pick screen proved it.

If a verify looks like it will exceed ~30s of wall clock, that's the signal to
find a shortcut, not to wait.

## 1. Boot the right dev script

| Page under test | Script | Why |
|---|---|---|
| `flagParty/` (any) | `npm run dev` | **Needs PartyKit on `ws://localhost:1999`.** |
| `ticTacToe/` online | `npm run dev` | Same — PartyKit. |
| `daily/`, `flagQuiz/`, `findFlag/`, `flagsdata/` | `npm run dev:swa` | No websocket; skips PartyKit's footprint. |

**`dev:swa` excludes PartyKit.** Boot it for flagParty and the page sits there
showing *"Disconnected. Reconnecting"* — which looks like a bug in your change
and isn't. This has been mistaken for a real defect; don't repeat it.

Wait for readiness by polling the log, never a fixed sleep:

```bash
until grep -q "emulator started" "<task-output-file>"; do sleep 2; done
```

## 2. Clearing ports — look before you kill

A stale Azurite on `:10000` makes `npm run dev` SIGTERM the whole stack (symptom:
`ws://localhost:1999` refused). See memory `project_dev_stack_azurite_killswitch`.

**But Jan plays on localhost too.** Killing every listener on 4280/10000/1999/7071
has dropped a game he was in the middle of. So:

1. **List first**, and look at what you're about to kill:
   ```powershell
   foreach ($p in 4280,10000,1999,7071) {
     Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
       ForEach-Object { "$p -> PID $($_.OwningProcess)" } }
   ```
2. If anything is listening and **you didn't start it this session**, say so and ask
   before killing. A running stack may be his.
3. Only then kill, and prefer stopping your own background task (`TaskStop`) over
   `Stop-Process` — `kill %1` from Bash does *not* take the stack down.

## 3. Beat the SWA CLI cache — or you're testing old code

The emulator serves `max-age=1yr` with a constant ETag, so a plain reload keeps
handing the browser **stale modules**, and query-string busting doesn't reach
transitively-imported ones. Symptom: your change simply isn't there, or two files
disagree (`does not provide an export named 'X'`), or the page renders unstyled.

Walk the module graph and the stylesheets with `cache: 'reload'`, then navigate:

```js
// browser_evaluate, on the page, BEFORE the run that matters
const seen = new Set(); const queue = ['/flagParty/page.js'];
while (queue.length) {
  const url = new URL(queue.shift(), location.origin).pathname;
  if (seen.has(url)) continue; seen.add(url);
  let src; try { src = await fetch(url, { cache: 'reload' }).then(r => r.text()); } catch { continue; }
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+\.js)['"]/g))
    queue.push(new URL(m[1], location.origin + url).pathname);
}
for (const l of document.querySelectorAll('link[rel=stylesheet]'))
  await fetch(new URL(l.getAttribute('href'), location.href).href, { cache: 'reload' });
for (const p of ['/i18n/en.json', '/i18n/pl.json']) await fetch(p, { cache: 'reload' });
```

Then `browser_navigate` again. **Verify you got fresh code** before trusting a
result — e.g. read back a symbol you just added. Never conclude "cache" without
checking the served file first (memory `feedback_verify_before_blaming_cache`).

## 4. Play a timed game at full speed

Play it **normally**, through the real server — just don't wait for anything you
can skip.

Flag Party's clock (`flags/partyTiming.js`):

| Constant | Value | Meaning for you |
|---|---|---|
| `QUESTION_SECONDS` | 20 | Only elapses if **nobody buzzes**. Never wait it out. |
| `CLEAN_REVEAL_SECONDS` | 0.9 | Reveal after everyone answers correctly. |
| `MISS_REVEAL_SECONDS` | 2.5 | Reveal after a wrong/missed answer. |
| `ROUND_INTRO_SECONDS` | 2 | Round title card between rounds. |
| `PICK_TIMEOUT_SECONDS` | 45 | Invisible anti-stall. Never wait for it — click a card. |

So the floor per question is ~1s, not 20s. Rules:

- **Buzz the instant the grid renders.** Solo play auto-reveals on buzz, which
  collapses the 20s question to the reveal beat.
- **A correct answer is ~1.6s cheaper per question** than a wrong one (0.9 vs 2.5).
- **Poll at ~100ms.** Sleeping 500-1500ms per loop iteration was the single
  biggest source of dead time in past runs.
- **Click the pick card immediately** when a hand appears.
- **Break the moment the assertion is satisfied.** Never `for (i=0; i<200; i++)`
  over game rounds.

Shape that works:

```js
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 400; i++) {           // a cap, not a plan
  const cards = [...document.querySelectorAll('#pick-hand button')];
  if (cards.length) { /* ASSERT HERE, then */ return result; }
  const tile = document.getElementById('flags-grid')?.querySelector('button:not([disabled])');
  if (tile) tile.click();
  await sleep(100);
}
```

Do **not** fake the server by injecting synthetic WebSocket messages — Jan asked
for a real game. Speed comes from not idling, not from bypassing the server.

## 5. Reading the result

- Prefer a **DOM read** (`browser_evaluate` returning the specific text/class you
  care about) over a screenshot — it's faster, exact, and diffable.
- Take a screenshot when the question is *visual* (layout, colour, spacing) or
  when reporting to Jan. Save to `.playwright-mcp/`, read it, then **delete it** —
  screenshots must never be committed.
- Screenshots have caught bugs the whole suite missed (a literal `{blocks}`
  placeholder, `CHOOSE THE NEXT BLOCK` after a rename). If copy changed, *look*.
- Hover/pointer states need a real pointer — scripted clicks leave no `:hover`
  (memory `feedback_verify_ui_with_real_pointer`).

## 6. Known Playwright-MCP gotchas

- **Refs reshuffle between snapshots.** Re-snapshot before clicking by ref, or
  use a CSS selector as `target` (`#create-room`), which is stabler.
- **Screenshots must go under the repo** (`.playwright-mcp/…`); absolute temp
  paths are rejected as outside the allowed roots.
- **`browser_evaluate` has a ~120s ceiling** — it gets moved to background and
  floods context on return. Another reason to keep runs short.
- **Fullscreen needs a real user gesture**; a screenshot can drop fullscreen.
  See the `verify-flag-map-ui` skill for map-specific traps.

## 7. Clean up

- `TaskStop` the dev-stack task (a Bash `kill %1` does not stop it).
- Delete screenshots and `.playwright-mcp/`.
- `git status --short` before committing — verification debris must not ride
  along in the PR.

## When the browser genuinely isn't the tool

If the change has no runtime surface a browser can show — a pure source-level
invariant, a test-only change — say so and rely on the test. But that is a narrow
exception: anything that renders, wires an event, or changes copy gets a browser
pass. When in doubt, look.
