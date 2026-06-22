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

*(No active marketing work — file created 2026-06-22, pre-marketing phase.)*

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

### Item 6: Distribution channels — where to plant the daily puzzle

**Status:** unstarted. This is the work Jan-the-engineer is most likely to skip; calling it out as its own backlog item so it can't hide.

**Goal.** Identify the 3-5 places where geography/flag-curious people hang out and get a daily-puzzle presence there. Examples: `r/geography`, `r/vexillology`, `r/quiz`, language-learning Discords, `#geography` X/Twitter community, possibly a low-effort Mastodon or Bluesky account that posts each day's puzzle.

**Why this matters.** Programmatic SEO (Item 2) is the long-tail compounding play; channel posting is the short-tail "where do today's first 100 visitors come from" play. Both matter. Channel posting also generates the small wave of social proof that makes the SEO results more clickable later (sites that show up in social *and* search feel more legitimate than sites that only show up in one).

**Open design calls:**
- **Manual vs automated daily post.** A scheduled GitHub Action that posts the day's puzzle to X/Bluesky is technically trivial. But: Jan's memory has a "data-as-state over scheduled jobs" rule from the three failed scheduler attempts. Suggest manual posting from Jan's own account for v1 — the channel work is a marketing experiment, not infrastructure, and a 30-second daily post is the kind of routine that proves the channel works before automation is justified.
- **Subreddit posting etiquette.** Self-promotion rules vary per subreddit; some require moderator pre-approval. Worth one-time research per target subreddit before posting.
- **Tone.** "I built a thing" gets downvoted; "today's daily flag puzzle if anyone's bored" gets upvoted. Same site, different framing.

---

## Done

*(Nothing yet — file created 2026-06-22.)*
