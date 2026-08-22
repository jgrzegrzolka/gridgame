# Marketing

Working document for in-progress work on **distribution and monetization** — anything whose purpose is to spread the product (share loops, SEO, social, channels) or earn from it (ads, sponsorships, affiliate, subscriptions). Kept separate from `FEATURE.md` (program / hosting / infra) and `DATA_FEATURE.md` (flag-data maintenance) so the three streams don't tangle in one file.

Driving question for *this* tracker: **"what makes the product spread or earn?"** — not "what should the product do?" (that's FEATURE.md) and not "what should the data say?" (that's DATA_FEATURE.md). If a piece of work is dual-purpose (e.g. a share button is both a product feature *and* a distribution mechanism), pick the file that matches the dominant axis and cross-reference from the other.

A fresh agent picking this up should:

1. Read `CLAUDE.md` (project rules).
2. Read this file.
3. Find the **first uncompleted item** under `## Now`, locate its **next step**, and continue.
4. **`## Backlog` is off-limits to agents** — items there are deferred-but-not-forgotten, not next-up. Jan promotes a backlog item to `## Now` when he decides to ship it.
5. Update this file as each step completes (check off boxes, move finished items to `## Done`).

**Branching:** each phase = one branch off `main` + one PR. Run `git checkout main && git pull` *before* `git checkout -b ...`. Don't auto-merge — Jan merges each PR himself.

**Concurrent-work caution:** Jan often has a separate agent in flight on program / data / perf work. Before committing here, run `git status` and **stage marketing files by name only** — never `git add -A` or `git add .`, both of which would scoop up the other agent's WIP.

---

## Background framing

The constraints that shape every item below:

- **Site is not yet marketed.** As of 2026-06-22, traffic is essentially Jan + people Jan has personally shown the site to. Cloudflare Web Analytics is wired (Feature M Part A, see FEATURE.md `## Done`) so we'll be able to measure once any channel is turned on. App Insights for the player-facing site is parked but not in place (Feature Q, FEATURE.md `## Backlog`) — funnel-level instrumentation will need to land before the third or fourth marketing experiment, not before the first.
- **$2k/month is ~80% a traffic problem and ~20% a monetization problem** at this scale. Monetizing 100k pageviews/month is well-trodden; getting 100k pageviews is the whole game. Most items in this file are therefore distribution items. The money items are deliberately boring and stacked (ads + sponsor + affiliate) rather than ads-alone — at hobby scale a stacked $500 floor is far more credible than chasing 200k pageviews on display-ad RPM.
- **Engineering bias is the failure mode.** Jan is a software engineer; the default failure mode for solo-dev hobby projects at this stage is shipping feature #6 (another game mode, another polish PR) instead of doing the unglamorous distribution work. **Features are not the bottleneck.** This file exists partly so distribution items have a tracker of their own to compete for attention against FEATURE.md.
- **Already shipped (baseline):**
  - **Daily-puzzle share artifact** — Wordle-style emoji-grid text via `daily/squares.js` + `buildShareText`, pushed through `shareText` (mobile share sheet → clipboard → legacy textarea fallback). Inline share-icon button at the end of the daily-stats headline (`daily/page.js:433` `createShareButton`). Touch-only by design (matches TTT / findFlag; desktop OS share sheets are heavy and clipboard-only feedback is too quiet). Engagement event posted on `'shared'` / `'copied'`; chains achievement diff (catches "Daily Sharer"). The mechanic exists — what we have not yet evaluated is whether it's at *centerpiece* prominence the way Wordle / Flagle make it.
  - **Buy Me a Coffee** chrome button on every page (`.coffee` slot). Donations channel, covers nothing meaningful financially today but the surface is in place.
  - **No display ads, no affiliate links, no sponsor slots, no AdSense account, no Mediavine / Raptive application** as of 2026-06-22.

---

## Now

### Item 2, phase 1: Search Console + sitemap plumbing

**Status:** code side shipped 2026-08-21. One step left, and it is Jan's to do.

Phase 1 of Item 2 (below) is "zero new pages, just plumbing." Promoted out of the backlog because it gates every other SEO decision: without Search Console there is no way to tell whether anything we do next is indexed, or what queries the site already surfaces for.

**Done (this branch):**

- [x] **Canonical host unified on `www`.** Every `rel=canonical` and `og:url` pointed at the **apex** (`https://yetanotherquiz.com/...`) while `sitemap.xml` pointed at `www`. The apex 301-redirects to www (verified), so every canonical named a URL that does not return 200, and the sitemap contradicted it. All 11 pages rewritten to the www origin.
- [x] **Sitemap expanded 6 -> 11 URLs.** Added `/flagParty/`, `/daily/archive.html`, `/ticTacToe/solo/`, `/ticTacToe/offline/`, `/privacy/` — real public destinations that were relying on crawl discovery alone.
- [x] **`noindex` on personal views.** `/profile/`, `/profile/sync/`, `/flagQuiz/stats/` had no robots meta. Added.
- [x] **`robots.txt` Disallow/noindex conflict removed.** The file disallowed `/flagQuiz/stats/`, which blocks the crawl and therefore prevents the crawler ever *reading* a noindex. Disallow and noindex on one path cancel out. Now nothing is disallowed; the noindex metas do the work.
- [x] **Canonical + description added** to `ticTacToe/solo/` and `ticTacToe/offline/`, which had neither.
- [x] **`seo.test.js`** pins all of the above: one origin everywhere, every indexable page in the sitemap, every sitemap entry a real non-noindex file, noindex present where intended, and no path both disallowed and noindexed. Each pin was verified to go red against the unfixed state.

**Search Console: already done, discovered 2026-08-21.**

It turns out the property was set up on **2026-06-22**, the same day this file was created, and was never recorded here. Verified as a **Domain property** (`yetanotherquiz.com`), which is the right type — it covers apex + www + http + https under one verification, and DNS-TXT verification leaves no trace in the repo, which is why a codebase check said "not wired". Don't re-derive this; check the property in Search Console before concluding anything about setup state.

- [x] Domain property created and verified via DNS TXT on the Cloudflare zone.
- [x] `https://www.yetanotherquiz.com/sitemap.xml` submitted 2026-06-22. Status Success, last read 2026-08-17, 6 pages discovered (matching the pre-expansion file). It re-reads on its own, so the 11-URL version needs no resubmission.
- [x] Three malformed sitemap entries removed 2026-08-21 (`.../sitemap.xml/sitemap.xml` and two apex variants, all permanently "Couldn't fetch" — someone pasted a full URL into a field that already prefixes the origin). Removal is not in the row-level menu; open the sitemap's own detail view and use the menu there.

**Next check-in: around 2026-09-04.** Coverage and Performance need roughly two weeks after the canonical fix deploys before the numbers mean anything. What to look at then: how many of the 11 URLs are indexed, and which queries the site already surfaces for. That is the baseline every later SEO decision gets measured against.

**What phase 1 does not include:** any new page. Per-country / per-continent / per-motif generation is phase 2+ of Item 2 and stays in the backlog until Search Console has a baseline to measure against.


### Item 6: Distribution channels — where to plant the daily puzzle

**Status:** live as of 2026-08-22. Promoted from Backlog and started the same day. Step 1 is done; steps 2-4 are dated below and are Jan's to run (agents can't post to Reddit, and shouldn't).

**Goal.** Identify the handful of places where geography/flag-curious people hang out and get a daily-puzzle presence there. Channel posting is the short-tail "where do today's first 100 visitors come from" play; programmatic SEO (Item 2) is the long-tail compounding one. Both matter, and this is the one Jan-the-engineer is most likely to skip.

**Why this matters.** Channel posting also generates the small wave of social proof that makes later SEO results more clickable — sites that show up in social *and* search feel more legitimate than sites that only show up in one.

#### Subreddit rules, read 2026-08-22

Checked directly against each sub's `about/rules.json`. **Two obvious-looking candidates are closed** — recorded here so nobody re-derives them:

| Sub | Size | Verdict | The rules that bind |
| --- | --- | --- | --- |
| **r/WebGames** | 142k | **Open, best fit** | P3: title must start with the game's name. P4: direct link, **no collections or directories**. P5: no signup. P2: no repost for 3 months. |
| **r/flags** | 90k | **Open, relaxed** | Must be flag-related. No low-effort. No politics. No self-promotion rule at all. |
| **r/vexillology** | 1.0M | **Open, strict** | R5 concise descriptive title. R6 **must seed a context comment** or the post is removed. R10 flair required. R8 "no fluff" is the live risk. |
| r/geography | 6M+ | **Closed to standalone posts** | R3 names *"flag posts, geography trivia, geography quiz results"* as extraneous. R8: *"No standalone quiz/game/challenge posts. See stickied monthly thread."* Monthly thread is the only route and wasn't visible in hot. |
| r/dailygames | 1.6k | **Closed, wrong genre** | Not a Wordle-clone directory — it's comment-driven daily *fiction*: *"Daily Games are required to be affected by the comments."* Plus *"No Advertising: no sending links to personal channels."* |
| r/InternetIsBeautiful | 16.6M | **Closed** | *"No Webgames: webgames are not allowed. This includes quizzes, puzzles, etc."* Not a one-shot to save for later. Simply not eligible. |

**Consequence worth remembering:** the **homepage is a directory** for r/WebGames' purposes (it hubs several games), so channel links point at `/daily/`, never `/`.

#### Rollout

- [x] **Step 1 — 2026-08-22: r/WebGames.** Link post to `/daily/` + context comment. Post URL: _(paste here)_
- [ ] **Step 2 — 2026-08-23 to 08-25: measure, don't post.** Watch Cloudflare Web Analytics, answer comments, log any bug anyone reports. The gap is also what stops three posts reading as a spam run.
- [ ] **Step 3 — 2026-08-28 (Fri): r/flags.** Text post, draft below. Dated to the day puzzle **#84** (red-and-yellow-only, 4 answers) is live, so a click-through lands on exactly the puzzle the post describes.
- [ ] **Step 4 — week of 2026-09-01: r/vexillology.** Only if steps 1 and 3 surfaced no embarrassing bugs. Biggest room and strictest mods, so it goes last: every earlier post is a rehearsal that costs little if it goes badly; this is the one worth regretting.
- [ ] **2026-09-04: read both numbers together** — the Search Console baseline (Item 2 phase 1) and whatever these channels sent. First time the site has two traffic sources to compare.

**Cadence rule:** never the same link to multiple subs in one evening. Reddit-wide norm is roughly 90/10 participation to self-promotion (r/InternetIsBeautiful writes it into its rules), so ordinary commenting between posts is part of the work.

**Silent removals:** Reddit removals are invisible to the poster — a removed post still looks fine while logged in. Check each post logged out, in a private window, ~30 min after submitting.

#### Post drafts

**r/WebGames** (used 2026-08-22). Title, then link, then the context as the first comment (a link post has no body):

```
Yet Another Quiz: a daily flag puzzle. One rule, find every flag that matches it.
```
```
https://www.yetanotherquiz.com/daily/
```
```
Today's rule is "Asian flags with yellow but no white". There are six.

New puzzle every day, same for everyone, free, no signup and no ads. Takes about
a minute. If the daily isn't your thing, the same site has a flag quiz, a
find-all-flags-by-category mode, flags tic-tac-toe, and a live multiplayer round.

I build it solo in my spare time. Happy to take feedback, especially on anything
that felt unfair or ambiguous.
```

**r/flags** (step 3). Text post — the flag fact is the content and the link rides along:

```
Only four national flags use nothing but red and yellow
```
```
China, Kyrgyzstan, North Macedonia, Vietnam. That's the complete list of
sovereign flags whose entire palette is red and yellow, nothing else.

The near-misses are the interesting part. Spain reads red-and-yellow at a glance
but the coat of arms drags in half a dozen more colours. Same story for a few
others that feel like they belong.

I found this building a daily flag puzzle, which is exactly this kind of
question: https://www.yetanotherquiz.com/daily/
```

**r/vexillology** (step 4). Link goes at the **end of the required context comment**, not in the title, or it reads as an ad and trips "no fluff":

```
Only four sovereign flags use red and yellow and no other colour
```
```
The four: China, Kyrgyzstan, North Macedonia, Vietnam.

What makes the count debatable is where you draw the line on charges. Spain's
field is red-yellow-red, but the arms carry blue, white, silver and more, so on
a strict "every colour on the flag" reading it's out. Kyrgyzstan's sun and tunduk
stay within the two. Whether a coat of arms counts as part of the palette or as
a separate device is the whole question, and I don't think there's a settled
answer.

I hit this while building a daily flag puzzle that asks these questions as
puzzles. Today's is Asian flags with yellow but no white:
https://www.yetanotherquiz.com/daily/
```

Drafts deliberately carry **no em dash** — they're user-facing copy, and the repo's rule is that the long dash reads as AI outside repo docs.

#### Open design calls

- **Manual vs automated daily post.** Still manual, deliberately. A scheduled Action posting each day's puzzle to X/Bluesky is trivial to build, but the "data-as-state over scheduled jobs" rule applies and, more to the point, the channel work is a marketing experiment rather than infrastructure. Prove a channel converts with 30-second manual posts before automating it.
- **Settled by the rules pass:** subreddit etiquette (per-sub, table above) and tone ("I built a thing" gets downvoted; leading with the puzzle or the flag fact does not — see drafts).
- **Not yet tried:** Bluesky / Mastodon accounts, language-learning Discords, the `#geography` X community. Revisit once the Reddit posts give a sense of whether channel traffic sticks or spikes and dies.

---

## Backlog

Items here are not blocking current work but deserve durable memory. Agents reading MARKETING.md to find their next task should **not** pick from this section; Jan promotes a backlog item to `## Now` when he decides to actually ship it.

### Item 1: Daily-share artifact — evaluate centerpiece prominence

**Status:** unstarted. Frame this as an audit + maybe a small UX move, not a re-build.

**Goal.** Decide whether the existing daily share button is prominent enough to act as a share-loop centerpiece, or whether it should be promoted to a full-width result-card button on the finish screen (Wordle / Flagle pattern). The mechanic is built; the question is placement and visual weight, not functionality.

**Why this matters.** The daily-puzzle share artifact is the single highest-leverage distribution mechanic the product has — it manufactures free distribution every time a player finishes a puzzle, costs nothing per-share, and compounds. The technical pieces (Wordle-style text, share sheet, clipboard fallback, engagement event) are already shipped. What's worth checking is whether the *presentation* invites the share the way category-leaders do.

**Open design calls (settle when work starts, not now):**
- **Is "touch-only" still the right call once distribution is the priority?** The current rule (one across the whole site — see comment at `daily/page.js:422-426`) is a deliberate UX decision: desktop OS share sheets are heavy, clipboard-only feedback is too quiet. But desktop sharers are real (X/Twitter is mostly desktop). Worth re-examining specifically for the daily-puzzle finish screen, even if the rule stays the same elsewhere.
- **OG image** for shared URLs. The current share text includes a `/daily/?n={n}` link. When that URL is pasted into a group chat or X, what does the unfurl look like? If it's a generic site card, an OG image rendering "Daily Flag Puzzle #142 — 4/5 ⬛🟩🟩🟩🟩" would make pasted links carry the result visually, not just textually. Probably an Azure Function that generates the image server-side (or a static template per puzzle baked into the deploy).
- **Share-text copy.** Current title line is `Yet Another Quiz — Daily Flag Puzzle #{n} — {score}/{total}`. Wordle-style brevity is the genre norm (`Wordle 1,124 4/6`). Worth a copy pass.

**Out of scope:**
- Rebuilding the share mechanic from scratch (it works).
- Adding share-to-specific-platform buttons (Twitter/X/WhatsApp deep links) — the OS share sheet handles platform routing on mobile; deep links proliferate buttons without proportionate gain.

### Item 2: Programmatic SEO from `flagsdata/`

**Status:** unstarted. Highest-ROI distribution item on the board because the data already exists.

**Goal.** Generate a set of durable, search-indexed pages from `flags/countries.json` that catch evergreen flag-related search intent. Each page is a genuinely useful destination (real flag image, tags, related-flag links into findFlag / flagsdata filters), not a thin data dump. Examples of intents to cover:
- `flag of [country]` (≈ 200 pages — one per country)
- `flags of [continent]` (5-7 pages)
- `flags with [motif]` — stars, crosses, animals, etc.
- `red and white flags`, `blue flags`, `flags with three stripes`, etc.

**Why this matters.** Flags are an evergreen, high-intent search niche, and `flags/countries.json` already encodes everything the pages need. For a solo dev with a day job this is the best traffic-per-effort ratio available — work that compounds while Jan sleeps. The site already has the engine (`findFlag/` uses these same filters interactively); the SEO work is largely a server-rendered surface over the same data, with each page deep-linkable into the interactive surface.

**The Helpful-Content-Update caveat.** Post-HCU Google penalises templated pages that read as data dumps. Each generated page needs at least one piece of human-written context (a fact about the flag's symbolism, an adoption date, a story) to clear the bar. The data exists for some of this (`adoptionYear`, motif tags, ambiguity notes), but for "real fact" content per country we'd need a one-time data-side pass to add it. That work belongs in DATA_FEATURE.md and is the gating prerequisite — empty templated pages would actively hurt SEO, not help it.

**Open design calls:**
- **Static vs server-rendered.** SWA serves static HTML beautifully and Google indexes static HTML beautifully. Probably generate at deploy time via a Node script, write to `flagsdata/country/[code].html` etc., let SWA serve them. No Function App involvement.
- **URL shape.** `/flags/poland`, `/flags/europe`, `/flags/red-white`, `/flags/with-stars`? Or nested? Affects internal linking and the deep-link back into findFlag.
- **Internal linking.** Every generated page should link to (a) findFlag with the matching filter pre-selected, (b) related country pages, (c) daily puzzle (homepage). Internal link graph is half of why SEO compounds.
- **Indexing.** Sitemap.xml regenerated on every deploy; `robots.txt` needs to allow these paths. Google Search Console needs to be wired (it isn't yet).

**Likely phasing:**
1. Google Search Console verification + sitemap.xml infrastructure (zero new pages, just plumbing).
2. Per-country pages (200 pages, templated, with the existing data — accept the HCU risk for v1, measure indexing).
3. Per-continent and per-motif pages (compound coverage).
4. One-time data-side pass via DATA_FEATURE.md adding human-written symbolism / history snippets where they're missing. This is the move that turns "templated" into "genuinely useful."
5. Re-measure indexing rate and impressions after the data pass.

### Item 3: AdSense — revenue floor

**Status:** unstarted. Don't pull this lever until Item 2 (or some other traffic source) has produced indexed real traffic. Display ads at 0 visitors return $0 and add clutter for no reason.

**Goal.** First-pass monetization that's mechanical and passive. Get an AdSense account approved (the account-application step itself has a bar — usually wants real content + traffic + a privacy policy + a contact page). Place ads in spots that don't compromise the polished look Jan has built — probably a single bottom-of-page slot on game-finish screens and a sidebar on `flagsdata/`.

**Why not Mediavine / Raptive first.** Those have traffic thresholds (Mediavine: 50k sessions/month; Raptive: 100k pageviews/month) — they're a later milestone, not the entry point. RPM is meaningfully higher than AdSense (often 2-3x for an engaged audience), so the eventual upgrade path is real and worth optimising toward. Track session counts via CF Web Analytics to know when to apply.

**Realistic expected contribution.** $200-300/mo of a $500 stack at modest engaged traffic. Geography / education audiences with US/EU skew can hit $5-10 RPM; conservative planning RPM is $4. At 50k pageviews/month and $5 RPM that's $250. Below 10k pageviews/month it's not worth turning on at all.

**Open design calls:**
- **Where to place.** Daily-puzzle finish screen (where engagement is highest and the player is paused to read stats anyway) is the natural slot, but also the slot most likely to hurt the share-loop conversion. Worth A/B-ing or starting with `flagsdata/` (the lowest-engagement, highest-pageview surface) instead.
- **Privacy policy + cookie banner.** AdSense requires a consent flow in EU/UK. Adds the first cookie banner the site has ever had. Match the polish of the rest of the site — don't ship a generic vendor banner.
- **AdSense Auto Ads vs manual unit placement.** Auto Ads = less control, more revenue density. Manual = full control, fewer ads, better UX. Start manual.

### Item 4: Daily-puzzle sponsor slot

**Status:** unstarted. Needs traffic first; can't pitch a sponsor on a site no one visits.

**Goal.** A small "Today's flags brought to you by [X]" line on the daily-puzzle finish screen (or on the share-result card). Single sponsor at a time, monthly billing, no programmatic ad-network involvement. Audience fit candidates: language-learning apps (Babbel, Memrise, Lingoda), travel sites (Kayak, Booking, Hostelworld), map/globe shops, online geography courses.

**Why this matters.** Sponsorships consistently outperform display RPM for engaged niche audiences and don't require a 50k-sessions threshold to start. Even a single small sponsor is $100-300/mo. Realistic when the daily puzzle has a modest, engaged audience (think low thousands of DAU, not tens of thousands).

**Open design calls:**
- **How to find the first one.** Cold email to a marketing manager at a language-learning brand is the obvious path; harder than it sounds because hobby-site outreach gets filtered. Other paths: posting on `r/geography` / `r/vexillology` with the site link and letting interested sponsors find Jan; a "Sponsor this puzzle" page with rate card.
- **Placement.** Above the daily-stats headline? Inside the share text (`Daily Flag Puzzle #142 4/5 · Sponsored by [X]`)? Latter is more valuable per dollar (carries in every share) and more intrusive (sharer is associating the result with the brand). Probably finish-screen only, never in share text — share text is sacred user-generated content.

### Item 5: Affiliate placements

**Status:** unstarted. Low effort, low payout, can layer on top of Items 3 + 4.

**Goal.** Contextually-relevant affiliate links on the surfaces where they make sense. Candidates: world atlases / globes (`flagsdata/`), language-learning apps (game-finish screens), travel gear (no obvious surface yet — maybe a "where would you visit?" page if traffic justifies a new page). Amazon Associates is the lowest-friction starting point; specialist programs (Babbel, Skillshare) pay better but require approval per program.

**Realistic expected contribution.** $50-150/mo at modest engaged traffic — not a primary lever, but real money for ~one day of integration work and no ongoing maintenance.

**Open design calls:**
- **Where placements actually fit naturally.** Forcing affiliates onto game screens cheapens the polish; not placing them anywhere makes this item moot. The honest answer is probably "one tasteful 'further reading' / 'recommended atlases' panel on `flagsdata/`, that's it."
- **Disclosure.** FTC + EU rules require visible affiliate disclosure. Match the polish — a one-line note in the footer beats a generic disclaimer.

---

## Done

*(Nothing yet — file created 2026-06-22.)*
