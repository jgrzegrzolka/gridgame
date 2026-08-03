# Design system

The values in use today, read out of the repo's 17 stylesheets. Descriptive, not
prescriptive: where two things disagree, both are recorded. Companion to
`docs/design-context.md`, which names the screens and component groups this file
gives values for.

Every count below is a declaration count over `git ls-files '*.css'` — one pass
per file, so a rule is counted once. (The first version of this file counted some
stylesheets twice and missed two nested ones; if you re-derive a number and it
disagrees, trust your own pass and fix the line here.)

## 1. Colour

### The ten tokens

All declared on `:root` in `common.css`. Order is the order they appear there.

| Token | Hex | Semantic name | Used for |
|---|---|---|---|
| `--primary-color` | `#2B1D24` | Ink / brand near-black | Body text, interactive text and icons (via `--link-color`), burger bars, active pill borders, the tile rank badge fill |
| `--secondary-color` | `#C2899F` | Brand pink accent | Wordmark and favicon, chrome hover/press borders, nickname value, give-up reveal, validation errors, the daily hearts, achievement icons |
| `--muted-color` | `#999` | Quiet text | Captions, counts, section micro-labels, "you are here" menu items, placeholder text, disabled links |
| `--muted-soft-color` | `#eee` | Hairline / divider | 1px rules, panel and tile borders, resting button borders, scrollbar thumb |
| `--surface-color` | `#fff` | Elevated surface | Chrome buttons, panels, popovers, dialog cards, pills, the dock pill on desktop |
| `--selected-color` | `#f0f0f0` | Selected / applied | `.pill.active`, `.filter-chip`, `.mhub-chip.on`, keyboard-highlighted suggestion row, avatar placeholder box |
| `--page-bg-color` | `#fdfdfd` | Page background | `body`, the fixed chrome strip, sticky action rows |
| `--hover-color` | `#f9f9f9` | Hover wash | Every casual "you can click this" hover: game rows, chrome, pills, chips, cells, buttons |
| `--accent-rose` | `#9F6D82` | Interaction rose | Dock item hover/press, every `:focus-visible` ring, the primary CTA's border and ink |
| `--border-strong-color` | `#e2e2e2` | Hover hairline | One step sharper than `--muted-soft-color`; the pressable button family's `:hover` border only |
| `--control-line-color` | `#d0d0d0` | Bare-control line | The resting line of a control with no box of its own: the switch track and the start screens' underlined room-code field |

`--link-color` is an alias resolving to `--primary-color`.

### The semantic pair

Separate from the ten, and reserved for "this answer was right / wrong" plus the
two success confirmations already wearing the green (copy succeeded, new
personal best):

| Token | Hex | Used for |
|---|---|---|
| `--correct-color` | `#2a9d4a` | Correct answer tiles, the copied checkmark, the new-record badge, the correct-guess count pulse |
| `--wrong-color` | `#c0392b` | Wrong answer tiles, the wrong-cell wash, failed leaderboard status, missed map fills |

Both feed the `ring-correct` / `ring-wrong` keyframes through `color-mix`, so
the solid ring and the halo growing out of it cannot drift.

### Documented exceptions

Colours that deliberately sit outside the token set, each scoped and commented
where it is defined:

| Value(s) | Scope | Purpose |
|---|---|---|
| `--cta-rose-soft: #F2EAEE`, `--cta-rose-hover: #ECDFE6` | `.lobby-btn.primary` | The primary CTA's pale-rose fill and its one-step-darker hover; the border and ink reuse `--accent-rose` |
| `--home-rose: #9f6d82`, `--home-rose-soft: #f2eaee` | `/index.css` `.home` | The same CTA rose pair, home-scoped, for the game-row icons and press wash |
| `--x-color: #2d6a8c`, `--o-color: #dd6688` | `ticTacToe/index.css` `:root` | The two player marks |
| `#f4c842` | `.cell.winning` | The gold winning-line ring |
| `#cfcfcf`, `#d6ac2a` | `flags/flagMap.css` | Map country fill and gold hover |
| `METRIC_HUES` (39 hex values, `flags/metricVisuals.js`) | Metric chips, panels, lens overlays, tinted criterion icons | One hue per world metric, injected inline as `--mc` |
| 8 `.pill-swatch[data-value]` fills: `#c0392b` red, `#f2f2f2` white, `#2d5fa8` blue, `#3a8f4a` green, `#e6c92e` yellow, `#2b2b2b` black, `#e08a2e` orange, `#7d5bbe` violet | Colour filter pills and chips | Literal flag colours, which cannot come from brand tokens |
| `#2a9d8f`, `#c65f9a`, `#2f6fd0`, `#241f22`, `#f4efe6` | Home hero stamps | The invented-flag palette; decorative, `aria-hidden` |
| `rgba(0, 0, 0, 0.7)` | The wrong-tile name band (`.flag-choice.wrong`, `.opt`) | Text band over a flag image |
| `rgba(0, 0, 0, 0.6)` | `.find-tile-metric`, `.find-stats-pct` | The tile corner pills, over a flag image |
| `rgba(28, 28, 28, 0.85)` | `.flag-tile::after` | The hover name-strip band |
| `rgba(194, 137, 159, 0.2)` | `.cell.revealed img` | 20% `--secondary-color`, written out because alpha-on-a-var needed a detour |

### Raw values outside both sets

Present in the CSS today, not covered by a token or a documented exception:

- Greys used as text or fill: `#666` (×3 — `.time`, `.result-links`, a daily
  caption), `#888` (×2 — the burger nickname row, an archive caption), `#333`
  (×2), `#555`, `#444`, `#ddd`.
- `#fbeef3` (×3) — the paled-pink hover on `.pill.exclude` and two ideas-page rules.
- `#fff3b0`, `#ffe066`, `#1d3557` — daily highlight fills.

### Backgrounds and shadows

- Dialog backdrops: `rgba(0,0,0,0.6)` (zoom), `0.4` (rules / help), `0.35`
  (achievement info), `0.85` (flag lightbox).
- Shadows: `0 4px 12px rgba(0,0,0,0.08)` (burger panel), `0 2px 6px
  rgba(0,0,0,0.08)` (colour-count dropdown), `0 6px 20px rgba(0,0,0,0.08)`
  (suggestion list), `0 4px 24px rgba(0,0,0,0.22)` (dialog cards), `0 6px 24px
  rgba(43,29,36,0.1)` (desktop dock pill), `0 12px 32px rgba(43,29,36,0.25)`
  (achievement card), `0 8px 40px rgba(0,0,0,0.5)` (lightbox image), `0 2px 6px
  rgba(0,0,0,0.15)` (answer tile hover lift), `0 1px 2px rgba(0,0,0,0.25)`
  (switch thumb).
- The dock's mobile fill is `color-mix(in srgb, var(--page-bg-color) 94%,
  transparent)` behind `backdrop-filter: blur(6px)`.

## 2. Type

**Family:** `system-ui, sans-serif` on `body`, inherited everywhere. The only
exception is `'Courier New', monospace` for room codes (`.join-code`,
`.room-line strong`).

### Weights

Four tokens are declared; the system runs on two of them.

| Token | Value | Declarations | Scope |
|---|---|---|---|
| `--weight-regular` | 400 | 28 | Body text, the final-score line, tile name bands |
| `--weight-bold` | 700 | 57 | All emphasis: pills, chips, badges, titles, percentages |
| `--weight-medium` | 500 | 3 | Burger menu links, the nickname value, dock item labels |
| `--weight-light` | 300 | 2 | `.hero-title` (home) and `.daily-score-value` (the 34px daily score) |

The light weight has exactly two users, both large display type — the only size
at which 300 reads as designed rather than anaemic.

Eleven raw `font-weight: 600` declarations remain outside the tokens, in exactly
four files: `findFlag/index.css` (×3, including `.find-cat` and
`.result-section-title`), `flagsdata/index.css` (×2), `privacy/index.css` (×3),
`profile/sync/index.css` (×3). One raw `700` and two raw `400` are the two ends of
`findFlag`'s `find-count-pulse` keyframes; two raw `500` sit in `flagsdata` and
`profile/sync`.

### Size scale

Every `font-size` in px, by declaration count:

| Size | Count | Typical role |
|---|---|---|
| 8px, 9px | 2 each | The achievement card's uppercase hat, micro-labels |
| 10px | 6 | The tile corner pills, the tile hover name-strip |
| 11px | 25 | Dock item label, tier counts, achievement status |
| 12px | 39 | Pills, chips, hub labels, hover-tip bubble, the burger nickname row |
| 13px | 33 | Scope-toggle label, achievement name, body copy in cards, wrong-tile name band |
| 14px | 48 | The workhorse: menu links, buttons, action rows, counts, dialog body, leaderboard status |
| 15px | 9 | Leaderboard name |
| 16px | 23 | Inputs, zoom dialog country name, lobby buttons, square icon buttons |
| 17px | 4 | Dialog `h2` |
| 18px | 5 | Screen titles (`.find-cat`), room code |
| 19px, 20px | 1, 2 | One-off headings |
| 22px | 4 | Flags-link glyph, larger headings |
| 28px | 4 | `.final-score` |
| 32px, 34px | 1 each | Party score display, the daily score |

Outliers: `clamp(36px, 11.5vw, 44px)` on the home hero headline; two fractional
sizes (`11.5px`, `12.5px`) in Flag Party.

### Line height

`1.2` and `1` (10 each) for tight display and single-line labels; `1.4` (10) and
`1.45`/`1.5` (2 / 4) for body copy; `1.55` (4) for prose blocks (privacy, story
panels); `1.3` (2), `1.35`, `1.02`; `1.06` on the hero headline.

### Letter spacing

`-0.04em` on the hero headline only. Positive tracking on uppercase micro-labels:
`0.04em` (leaderboard title, hub label, achievement status), `0.06em`
(`.result-section-title`, achievement hat). `4px` on the monospace room code.

`font-variant-numeric: tabular-nums` on every changing number: timers, scores,
counts, percentages, ranks, the lang toggle.

## 3. Spacing and geometry

### Step values

Single-value `gap` / `padding` / `margin` declarations:

| Step | Count | | Step | Count |
|---|---|---|---|---|
| 2px | 15 | | 12px | 44 |
| 3px | 17 | | 14px | 8 |
| 4px | 26 | | 16px | 15 |
| 6px | 40 | | 20px | 6 |
| 8px | 51 | | 24px | 11 |
| 10px | 24 | | 32px | 5 |

Beyond 32px the values thin out into one-off layout decisions: 34, 36, 40, 44,
48, 52, 56, 64, 78, 84, 112 (1–4 uses each). Odd steps (1, 5, 7, 9, 11, 13, 18,
22, 26, 28, 30) exist but are rare (1–9 uses each). The practical scale is
**2 / 4 / 6 / 8 / 12 / 16 / 24**, with 3 and 10 as common in-betweens.

### Page constants

| Constant | Value | Meaning |
|---|---|---|
| `--page-top` | 104px | Body top padding, clearing the fixed chrome |
| `--strip-height` | 70px | The fixed chrome strip's height |
| `--dock-height` | 66px | Reserved at page foot when a dock is present (+16px + safe-area) |
| `--chrome-x-offset` | `max(0px, calc(50vw - 378px))` | Inward push so chrome aligns with the 756px content cap |
| body padding | `var(--page-top) 24px 0` | Bottom stays 0 so sticky rows never detach |
| Content cap | 756px | Site-wide; also the derivation of the chrome offset |
| Lobby / chooser column | 360px | `.lobby`, `.party .pt-start`, `.find-chooser-actions` |
| Dock inner (mobile) | 420px max | Centred bar contents |
| Dialog card | `min(380px, 100vw - 64px)` | Rules / help; zoom is `min(80vw, 320px)`; achievement info `320px` |

### Radius scale

`6px` (19 uses — chrome buttons, inputs, panels, the base pill recipe), `8px`
(17 — cards, dialogs, icon buttons, the primary CTA), `999px` (14 — filter
pills, chips, the desktop dock pill and its items), `4px` (12 — small marks,
avatars, badges, the tile corner pills), `50%` (10 — dots, switch thumb), `10px`
(7), `3px` (6), `12px` (5 — the home game list), `2px` (4), `1px` (3). `5px`,
`7px`, `9px`, `11px`, `14px`, `16px` appear once each.

### Breakpoints

`max-width: 600px` (6 blocks), `max-width: 700px` (3), `max-width: 756px` (1),
`max-width: 379px` (1), `min-width: 700px` (2 — the dock's posture switch),
`min-width: 760px` (1). Plus `(hover: hover)` (3) and 21 `prefers-reduced-motion`
blocks (11 `reduce`, 10 `no-preference`).

## 4. Component groups

### Chrome

- Cluster: three fixed 44 × 44px `box-sizing: border-box` slots at `top: 15px`,
  right offsets `20px` / `72px` / `124px` plus `--chrome-x-offset` — a 52px step
  (44px slot + 8px gap). Radius 6px, transparent fill and transparent 1px border
  at rest, `border-color: var(--secondary-color)` on `:hover` (guarded by
  `(hover: hover)`) and on `:active`. `z-index` 25 / 25 / 20.
- Lang toggle: 14px, `--weight-bold`, uppercase, tabular; text comes from
  `content: attr(data-current)`.
- Burger bars: three 22 × 3px bars, radius 2px, 8px apart, `--link-color`.
- Wordmark: fixed `top: 19px`, height 36px, left `calc(20px + offset)` — centres
  on the same y-axis (37px) as the buttons.
- Strip: `body::before`, fixed, full width, `--strip-height`, filled
  `--page-bg-color`, `z-index: 10`, no divider on any viewport.
- Panel: fixed at `top: 64px`, `min-width: 180px`, padding `12px 16px`, radius
  6px, 1px `--muted-soft-color` border, shadow `0 4px 12px rgba(0,0,0,.08)`.
  Below 600px it goes edge-to-edge (radius 0, no side borders).
- Menu: items 14px `--weight-medium`, 10px apart; `.menu-divider` and
  `.menu-nickname` both use 12px padding + 12px margin around a 1px rule; the
  nickname row is 12px `#888` with a 24 × 24px radius-4 avatar at an 8px gap;
  `aria-current="page"` renders muted and inert.

### Dock

One component, two postures at 700px.

- Mobile: `position: fixed` full-width, 1px top hairline, 94% page-bg fill with
  `blur(6px)`. Inner is flex, `max-width: 420px`, padding `6px 10px calc(8px +
  env(safe-area-inset-bottom))`. Items are `flex: 1`, column-stacked, 4px gap,
  padding `8px 4px`, radius 10px, 20px icons, 11px `--weight-medium` labels.
- Desktop (`min-width: 700px`): `position: static`, no border or blur, padding
  `32px 0 40px`. Inner becomes an inline-flex pill: surface fill, 1px border,
  radius 999px, shadow `0 6px 24px rgba(43,29,36,.1)`, 2px gaps, 4px padding.
  Items go horizontal — 7px gap, padding `10px 14px`, radius 999px, 16px icons,
  13px labels.
- States: `--link-color` at rest, `--accent-rose` on hover, `scale(0.88)` +
  rose on press, `--accent-rose` focus ring at 2px offset. No item is ever
  greyed. Press transform drops under `prefers-reduced-motion: reduce`.

### Buttons and controls

- **Pill family** (`.profile-save`, `.lobby-btn`, `.rules-close`, `.help-close`,
  `.match-close`, `.rules-btn`, `.help-btn`, `.picker-close`, `.zoom-close`, and
  the four `.map-*` controls): 14px inherited font, `--link-color` ink,
  `--surface-color` fill, 1px `--muted-soft-color` border, radius 6px, padding
  `10px 16px`. Hover fills `--hover-color` and sharpens the border to
  `--border-strong-color`. Disabled is `opacity: 0.45`.
- **Size variants:** `.lobby-btn` padding `12px 20px` at 16px; `.help-close`
  padding `6px 14px`; the square set (`.rules-btn`, `.help-btn`, `.zoom-close`,
  `.match-close`, `.rules-close`, `.picker-close`) is a fixed 32 × 32px slot at
  16px with zero padding.
- **Primary CTA** (`.lobby-btn.primary`): `#F2EAEE` fill, `--accent-rose` ink and
  border, radius 8px; hover deepens the fill to `#ECDFE6` without changing hue.
- **Press grammar:** `--press-scale` per size — `.96` default (`.pressable`),
  `.985` wide (lobby buttons, suggestion rows, home game rows), `.90` icon-only,
  `.88` dock. Transitions are `150ms cubic-bezier(0.23, 1, 0.32, 1)` for colour
  and `180ms cubic-bezier(0.34, 1.56, 0.64, 1)` for the spring-back transform.
  Every `:active` scale sits inside `prefers-reduced-motion: no-preference`;
  hover colour cues do not.
- **Focus:** `outline: 2px solid var(--accent-rose)` at `outline-offset: 2px` on
  `:focus-visible`; `outline: none` on `:focus:not(:focus-visible)`. Also
  `dialog:focus { outline: none }` so a modal card never draws the UA ring.
- **Icon button** (`.icon-btn`, `.share-link`): 34 × 34px, radius 8px, surface
  fill, `--muted-color` ink darkening to `--primary-color` on hover. The 16 ×
  16px glyph is a CSS mask; `.copied` swaps the mask to a checkmark in
  `--correct-color` for 1.5s.
- **Switch** (`.scope-toggle`): 13px label, 12px gap, a 32 × 18px track
  (`--control-line-color`, radius 9px, `--link-color` when checked) and a 16 × 16px surface
  thumb (radius 50%, shadow `0 1px 2px rgba(0,0,0,.25)`) sliding `1px → 15px`
  over `0.15s`. The real checkbox stays focusable at `opacity: 0`.
  `.is-disabled` mutes the label and drops the switch to `opacity: 0.5`.
- **Join code** (`.join-code`): a bare underline, no box. Monospace 15px
  (16px on phones), `letter-spacing: 0.22em`, uppercase, 96px wide (110px on
  phones), `border-bottom: 1px solid var(--control-line-color)` going
  `--accent-rose` on focus and `--secondary-color` under `.join-form.is-error`.
  The placeholder opts out of the uppercase and the tracking.
- **Text link** (`.text-link`, `.daily-mistake-toggle`): a `<button>` reset to
  `font: inherit` at `--weight-bold` in `--accent-rose`, hovering to
  `--primary-color` over `0.15s`, `--accent-rose` focus ring at 2px offset.
  `:disabled` is `opacity: 0.45` with no hover response.
- **Text input** (`.find-input`): full width, padding `12px 14px`, 16px, 1px
  `--muted-soft-color` border, radius 6px; focus swaps the border to
  `--primary-color` and drops the outline; `.wrong` swaps it to
  `--secondary-color` for 700ms; `.shake` runs `find-shake 200ms`.

### Filter vocabulary

- `.pill`: 12px `--weight-bold`, `--muted-color` ink on `--surface-color`, 1px
  `--muted-soft-color` border, radius 999px, padding `3px 10px`, line-height 1.4.
  `:hover` → `--hover-color`. `.active` → `--selected-color` fill with
  `--primary-color` ink and border. `.exclude` → `--secondary-color` ink and
  border with `line-through`, hovering to `#fbeef3`. `.pill-modifier` is the same
  pill with a dashed border.
- `.pill-swatch`: 9 × 9px circle, 1px `--muted-soft-color` ring, 6px from its
  label.
- `.filter-chip`: mirrors `.pill.active` — 12px bold, `--selected-color` fill,
  `--primary-color` ink and border, radius 999px, padding `3px 6px 3px 10px`, 5px
  gap. `.is-exclude` takes the pink strike idiom; `.is-metric` outlines in the
  metric hue `--mc`. The `×` is 14px at `opacity: 0.75`, full on hover.
- Metric hub: chips are `.pill` + 6px gap + a 15 × 15px icon, padding
  `3px 10px 3px 7px`; `.on` colours border and ink in `--mc` over
  `--selected-color`. `+ N more` is dashed. The panel is a surface strip, radius
  8px, padding `9px 12px`, gaps `6px 10px`, with a 3px left border in `--mc`.
  Row label is 12px uppercase muted at `0.04em`.
- `.color-count-pill`: dashed until active, then solid with the `.pill.active`
  fill; its options strip floats absolutely 4px below so the pill never changes
  width.
- Inline criteria (`.crit`): marks are sized in `em` so they track the label —
  metric icon `0.95em` with `0.26em` right margin, flag/motif glyph `1.05em` with
  `0.24em`. Separator is a muted `·` with `0.4em` margins.

### Flags

- `.flag-tile` / `.find-tile`: `aspect-ratio: 4 / 3`, 1px `--muted-soft-color`
  border, `overflow: hidden`, `cursor: zoom-in`. Grids are
  `repeat(auto-fill, minmax(64px, 1fr))` at an 8px gap.
- Hover name-strip: `.flag-tile::after` renders `attr(data-name)` as a
  `rgba(28,28,28,0.85)` band, surface ink, 10px, padding `2px 4px`, ellipsised,
  fading in over 80ms on `:hover` or `:focus-within`.
- Tile corner pills (`daily/index.css`): one recipe, three corners — absolute,
  `z-index: 2`, 10px, `line-height: 1`, padding `2px 4px`, surface ink, bold,
  tabular, `pointer-events: none`. They differ only in corner, fill and which
  radius is rounded: `.find-tile-rank` top-left on `--primary-color`
  (bottom-right 4px), `.find-tile-metric` top-right on `rgba(0,0,0,0.6)`
  (bottom-left 4px), `.find-stats-pct` bottom-right on `rgba(0,0,0,0.6)`
  (top-left 4px). Measured on a live 65 × 49px tile they are 14px tall, inset 1px
  from their corners, and cover 38% of it. `.find-stats-pct` carries the
  community find-rate on the found/missed grids and the `×N` count on the
  mistake rail — one class, both grids. No full-width band survives on any grid
  (locked design 2a); the rail's `.is-user-wrong::before` marker holds the
  remaining top-right corner as a 10 × 10px `--wrong-color` square with a 1px
  black outline.
- Entry animation: `find-tile-in` scales `0.6 → 1` with a fade over 320ms.
- Zoom dialog: `min(80vw, 320px)`, 16px padding, radius 8px, 1px border, shadow
  `0 4px 24px rgba(0,0,0,.22)`. Opens by scaling X `0 → 1` over 350ms with a
  150ms opacity fade, using `@starting-style` and `allow-discrete`; the backdrop
  fades to `rgba(0,0,0,0.6)` over 200ms. The name is 16px centred; the optional
  note is 14px muted at line-height 1.4.
- Lightbox: a bare full-viewport dialog, image capped at `92vw / 92vh`, shadow
  `0 8px 40px rgba(0,0,0,.5)`, backdrop `rgba(0,0,0,0.85)`, `cursor: zoom-out`.
- Answer tiles (`.flag-choice`, `.opt`): 7px padding, no border, surface fill.
  **One edge carries every state, and it is the flag's own** — a 1px
  `--primary-color` ring at rest, becoming 2px `--correct-color` +
  `ring-correct 1.1s` infinite when right, 2px `--wrong-color` +
  `ring-wrong 1.1s` when wrong, and 2px `--secondary-color` for Flag Party's
  locked-in `.opt.sel` (which also tints the tile `--selected-color`).
  Transition `120ms cubic-bezier(.23,1,.32,1)`. **No hover and no pressed
  state:** the ring lands in the same frame as the tap, both would move the
  tile while the player reads it, and hover does not exist on a phone. The
  wrong tile's name band insets 7px (`rgba(0,0,0,0.7)`, 13px, padding
  `3px 4px`).
- Board cells: `.cell.winning` is `inset 0 0 0 3px #f4c842`; `.cell.shake` runs
  `cell-shake 0.4s` with a `::before` inset 10px carrying 20% `--wrong-color` and
  a 2px inset ring; `.cell.shake-win` reuses the same keyframes ×3 without the
  wash; `.cell.revealed img` gets a 2px `--secondary-color` outline, a 20%
  secondary wash, and `revealed-bounce 0.55s ×3`.

### Feedback and results

- `.loading-dots`: three 4px dots, 1px apart, `--muted-color` at `opacity: .25`,
  each offset 200ms in a 1.2s wave; under reduced motion they hold at `.6`.
- `#result`: `margin-top: 32px`, entering with `result-in 500ms
  cubic-bezier(0.2, 0.7, 0.2, 1)` — opacity plus a 16px `top` slide (not a
  transform, so the fixed dock is not captured).
- `.final-score` 28px regular; `.time` 14px `#666`; `.best` 14px muted, hidden
  when empty; `.new-badge` in `--correct-color` bounces once over 2s.
- `.result-section-title`: 14px, weight 600, uppercase, `0.06em`,
  `--muted-color`, margins `24px 0 12px`.
- Sticky rows (`.actions-row`, `.result-links`): `position: sticky; bottom: 0`,
  page-bg fill, `-24px` horizontal bleed plus a `100vw` `::before` band, 12px
  bottom padding, and a content-width 1px hairline on `.row-inner` at 12px
  padding-top.
- Hover tip: `attr(data-tip)` in a `--primary-color` bubble with surface ink,
  12px, padding `4px 8px`, radius 4px, 4px above the host, fading over 80ms. The
  `--cursor` variant tracks the pointer at `opacity: 0.8`.
- Leaderboard: `margin: 56px auto 16px` above a 1px top rule at 20px padding;
  title 14px bold uppercase muted `0.04em`; rows are a
  `28px | 24px | minmax(0,max-content) | auto` grid at a 10px gap; name 15px
  regular ellipsised; failed status takes `--wrong-color`.
- Hearts: 13px squares in `--secondary-color` at a 6px gap, filled or outlined
  from one shared path (2.8 units of stroke on a 24-unit viewBox); the last
  remaining heart pulses `scale(1.15)` over 1.4s rather than turning red.
- Celebrations: confetti pieces are 8 × 14px; the achievement card is 140px wide,
  radius 10px, 2px `--secondary-color` border, shadow `0 12px 32px
  rgba(43,29,36,.25)`, falling with `ach-fall-bump 1.6s
  cubic-bezier(0.34, 1.56, 0.64, 1)` and four diminishing bounces — replaced by a
  0.25s fade under reduced motion.

### Dialog shells

- `.rules-help` / `.help-dialog`: `min(380px, 100vw - 64px)`, padding
  `16px 18px 14px`, 1px border, radius 8px, shadow `0 4px 24px rgba(0,0,0,.22)`,
  backdrop `rgba(0,0,0,0.4)`. `h2` 17px with an 8px bottom margin; `p` 14px at
  line-height 1.4 with a 14px bottom margin. Close is the 32px square button
  absolutely placed at `top: 10px; right: 10px`.
- `.achievement-info`: `max-width: 320px`, `width: calc(100% - 32px)`, radius 8px,
  1px `--muted-color` border, card padding `20px 18px 16px` at an 8px gap; icon
  44px, name 16px bold, status 11px bold uppercase `0.04em`, body 13px at 1.45.
- `.quiet-scroll`: 8px thin scrollbar, `--muted-soft-color` thumb at radius 4px
  on a transparent track.
- `.find-suggestions`: absolute, 4px below the input, surface fill, 1px border,
  radius 6px, shadow `0 6px 20px rgba(0,0,0,.08)`, `max-height: 280px`. Rows are
  `6px 12px` at a 10px gap, 14px text; `:hover` takes `--hover-color`, the
  keyboard-selected row takes `--selected-color`.

### Layout blocks

- Start / lobby column (`.lobby`, `.party .pt-start`): `max-width: 360px`,
  centred horizontally, left-aligned inside, and **top-anchored** 152px from the
  viewport top (128px on phones) — never vertically centred, so the column does
  not drift down as the monitor grows. On desktop the in-flow dock pill sits 64px
  below it. Eyebrow is a 26 × 1px `--accent-rose` rule + an 11px bold `0.2em`
  uppercase rose label at a 10px gap; headline is 34px `--weight-light` at
  `1.15` / `-0.02em` (32px on Tic-Tac-Toe, 30px / 28px on phones). CTA
  (`.start-cta`) is the full-width `.lobby-btn.primary` at 17px bold,
  `18px 20px`, 44px above (38px on Tic-Tac-Toe); `.start-mode` pills are
  full-width `.lobby-btn` at 15px, `14px 20px`, stacked at an 8px gap. The join
  row (`.join-form`) sits 64px below (44px on Tic-Tac-Toe), baseline-aligned at a
  14px gap: a 96px underlined `.join-code` (`--control-line-color`, rose on
  focus, `--secondary-color` under `.is-error`) and a `.text-link` Join, inert
  until the code is 5 characters. Phones grow the join row's targets to 44px and
  its type to 16px (below that, iOS zooms the page on focus).
- Home game list: surface card, radius 12px, 1px border; rows are 58px tall with
  16px side padding and a 13px gap, separated by 1px rules, hovering to
  `--hover-color` and pressing to `--home-rose-soft` with a `.985` spring.
- Answer grid (`.choices`): two equal columns, 12px gap, `width: min(90vw, 480px)`.
- Avatar: 24 × 24px, radius 4px, `--selected-color` placeholder.
