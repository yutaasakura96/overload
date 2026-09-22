# 05 — Design System

**Direction:** Instrument (picked 2026-09-16 — see `docs/06-decision-log.md`).
**Extracted from:** the six `.dc.html` artboards in `design/`, 2026-09-16.

Every value here was lifted from the artboard source. Nothing is rounded to a 4/8px grid and nothing
is invented. Where a value appears once, or where two artboards disagree, that is recorded rather
than smoothed over — see *Deviations found in extraction* at the end.

The "THE SYSTEM" sticky note on page 1 of the canvas was the starting point. It is not accurate: it
lists four text tones where the files use six, omits two colours, and gives one colour
(`#12161A`) more prominence than its single use supports. This document supersedes it.

---

## 1. Colour

### 1.1 Surfaces

| Token | Hex | Where it is used |
| --- | --- | --- |
| `surface/ground` | `#0B0D0F` | Body background of all six screens. |
| `surface/raised` | `#12161A` | Rest bar only (screen 1). The system's only raised surface. |
| `surface/active` | `#0F171B` | Active set card (1), active meal card (3), maintenance check (6). |
| `surface/accent` | `#10262E` | Fill behind every accent control: COMPLETE SET, SKIP, active span, active tab, EATEN AS PLANNED, CONFIRM ALL, APPLY TO TARGETS. |
| `surface/done` | `#15241E` | Completed set check cell (1), completed prep row check cell (5). |
| `surface/flag` | `#15110A` | Warning panel (4). |
| `surface/error` | `#170B0C` | Fill behind a refused item. Added 2026-09-22 (§1.4). |

### 1.2 Lines

| Token | Hex | Where it is used |
| --- | --- | --- |
| `line/row` | `#14191E` | Divider between rows inside a table (set rows on 1, prep rows on 5). Deliberately weaker than the hairline. |
| `line/hairline` | `#1A2026` | App-bar underline, resting card borders, section dividers, chart gridlines, meter tracks, timeline rail. The default border. |
| `line/border` | `#232B32` | Rest-bar top edge (1), chart baseline (2, 6), unconfirmed meal cards (4). |
| `line/field` | `#2A3440` | Secondary control borders (+30s, WARM, ADJUST, REPL, pending chip), inert overlay swatches, unfilled timeline dots. Every one of these sits beside a label or a redundant state cue, so it is not the thing that identifies the control. |
| `line/control` | `#55687A` | 3.38:1 on ground. Anything that must be seen and has no label to carry it: the inert check cell's border and check (1, 5) and the daily-weight discs and fallback rings (6). Added 2026-09-22 (§1.5). |
| `line/accent` | `#234A57` | Border of active panels and the suggested-weight chip. |
| `line/done` | `#2E4A40` | Border of done fills. |
| `line/flag` | `#4A3A1C` | Border of flag fills and the evidence tag. |
| `line/error` | `#501C1E` | Border of a refused item. Always beside a label, so it is not held to 3:1. Added 2026-09-22. |

### 1.3 Text

Four text tones and one placeholder tone. Until 2026-09-22 there were six; the bottom three failed
WCAG AA and were merged (§1.5, `docs/06` 2026-09-22).

| Token | Hex | Contrast on ground | Where it is used |
| --- | --- | --- | --- |
| `text/primary` | `#E6EDF3` | 16.48:1 | Every figure that is the answer to the screen's question, and every app-bar title. |
| `text/secondary` | `#A8B4C0` | 9.23:1 | Named things next to a figure: meal names, food names, exercise names in a list, secondary button labels. |
| `text/tertiary` | `#8A96A3` | 6.46:1 | Supporting figures (set number, RIR, per-food grams), the WARM and ADJUST/REPL control labels, the back chevron. |
| `text/quaternary` | `#738393` | 5.00:1 | Metadata under a title, the "last time" reference value, food-list strings, unit suffixes, 9px small-caps column heads and section labels, inline qualifiers (`cooked`), chart axis labels, macro-target denominators (`/180`), em-dash empty values, footer metadata. |
| `text/placeholder` | `#5A6673` | 3.32:1 | **Large text only (≥24px).** The unfilled figures in the active set: the REPS `10` and RIR `—` are 56px in this tone until entered. Never used below 24px. |

With the bottom of the ladder flattened, rank below `text/tertiary` is carried by size, case and
tracking, not tone: a 9px uppercase head at `0.1em` and an 11px mono value are both
`text/quaternary` and still read as different things. New quaternary against tertiary is only 1.29:1,
so do not rely on those two tones alone to separate adjacent items.

### 1.4 Accents

| Token | Hex | Contrast on ground | Where it is used |
| --- | --- | --- | --- |
| `accent` | `#3FB6D4` | 8.21:1 | The one accent. Active state, primary action, the e1RM and trend line, the "now" marker on the timeline. |
| `accent/pressed` | `#6FCDE3` | 10.68:1 | The label and border colour of an accent control while it is pressed. 8.6:1 on `surface/accent`. Renamed from `accent/hover` 2026-09-22: the app runs from the iPhone home screen and has no hover. Pressed motion and timing belong to the polish gate. |
| `done` | `#57C99A` | 9.48:1 | Completed, confirmed, on-target. Check marks, macro meter fills, the synced dot, positive deltas. |
| `flag` | `#E0A83C` | 9.12:1 | Needs attention, not an error. Pending count, unconfirmed count, `CARBS ↑`. The weight-trend overlay has the same hex but uses its own token, `series/weight` (§1.6). |
| `flag/dim` | `#947B45` | 4.80:1 | One use: the strength label in the evidence tag (3), at 9px. Raised from `#8A7340` 2026-09-22; 4.64:1 on `surface/flag`. |
| `error` | `#F2555A` | 5.77:1 | **The server refused the data**, and nothing else: a refused set, a rejected save, revoked access. Added 2026-09-22; 5.71:1 on `surface/error`. |

**Rules for `error`.**
- It never carries meaning alone (WCAG 1.4.1). A refused item always shows the word `REFUSED` and
  the info icon (§6), so no fifth icon is added.
- No signal is not an error: it stays neutral and pending (`docs/03` §7, kind 1). A service that is
  down is an inline message in `flag`, because nothing is lost. Red stays rare enough to mean
  something.
- It is not the evidence tag's "contested" colour (`docs/10` §7.1).
- Colour-vision check (Machado 2009, severity 1.0, OKLab distance), deuteranopia / protanopia:
  vs `flag` 0.110 / 0.191, vs `done` 0.100 / 0.227. The existing `flag`–`done` pair is 0.112 / 0.107,
  so the red is no less distinct than a pair the palette already relies on.

### 1.5 Contrast — measured, not assumed

Ratios computed against `surface/ground` (WCAG 2.1 relative luminance). AA normal text needs 4.5:1;
large text (≥24px, or ≥18.66px bold) needs 3.0:1. Non-text contrast (1.4.11) needs 3.0:1 for a
control boundary **only when nothing else identifies the control**: a button with a visible text
label passes without a contrasting border (W3C, *Understanding SC 1.4.11*, "Boundaries", checked
2026-09-22). Inactive controls are exempt from both.

| Tone | On ground | Lowest surface it sits on | Verdict |
| --- | --- | --- | --- |
| `text/primary` `#E6EDF3` | 16.48 | — | Passes everywhere. |
| `text/secondary` `#A8B4C0` | 9.23 | — | Passes everywhere. |
| `text/tertiary` `#8A96A3` | 6.46 | — | Passes everywhere. |
| `text/quaternary` `#738393` | 5.00 | 4.66 on `surface/active`, 4.67 on `surface/raised` | Passes AA at every size. Do not place it on `surface/accent` (4.03) or `surface/done` (4.14). |
| `text/placeholder` `#5A6673` | 3.32 | 3.09 on `surface/active` | Passes AA-large. Fails below 24px, which is why it is restricted to 24px and up. |
| `accent` `#3FB6D4` | 8.21 | — | Passes everywhere. |
| `done` `#57C99A` | 9.48 | — | Passes everywhere. |
| `flag` `#E0A83C` | 9.12 | — | Passes everywhere. |
| `error` `#F2555A` | 5.77 | 5.57 on `surface/flag` | Passes everywhere. |
| `flag/dim` `#947B45` | 4.80 | 4.64 on `surface/flag` | Passes AA. |
| `line/control` `#55687A` | 3.38 | 3.15 on `surface/active` | Passes 1.4.11 for unlabelled controls and chart observations. |
| `line/field` `#2A3440` | 1.54 | — | Below 3.0, and allowed: every use is beside a text label or a redundant state cue. Never make it the only thing that shows a control exists. |

**History.** As extracted on 2026-09-16, `#5A6673` (quaternary), `#4A5560` (micro, 2.56) and `#3C464F`
(faintest, 2.02) all carried information, and `flag/dim` was `#8A7340` (4.27) at 8px. The 2026-09-22
review raised only the tones carrying information (`docs/06`). Instrument's grammar is unchanged:
mono grid, one accent, 2px radius, density. What it lost is the three-step fade at the bottom of the
ladder.

### 1.6 Chart series

The overlays on the e1RM chart (S20, screen 2). Added 2026-09-22 (`docs/06`). These tokens are used
only for series: the line, its end label, and its chip. They carry no status meaning, and code refers
to `series/weight`, never `flag`, even though the two have the same hex.

| Token | Hex | On ground | Chip fill | Chip border | Dash |
| --- | --- | --- | --- | --- | --- |
| `series/weight` | `#E0A83C` | 9.12:1 | `#1A1509` | `#4A3A1C` | `3 3` |
| `series/intake` | `#8C7BE8` | 5.7:1 | `#14151E` | `#322E50` | `6 3` |
| `series/sleep` | `#DCD6CA` | 13.5:1 | `#1A1B1C` | `#4A4947` | `1.5 3` |
| `series/hrv` | `#C07A5A` | 5.7:1 | `#181514` | `#412E26` | `8 3 2 3` |

Weight's chip fill and border are the values drawn on screen 2. The other three fills and borders are
7% and 30% of the series colour over `surface/ground`, which is the ratio of weight's border. Each
series colour on its own chip fill is at least 5.29:1 (intake). Chip borders are below 3:1 and allowed,
because the chip is labelled (§1.5).

**Rules.**
- **Colour is the third cue, not the first.** A series is identified by its end label (§5) and its
  dash pattern, and only after that by its colour, so the chart passes WCAG 1.4.1 however the colours
  are perceived.
- **Measured separation** (Machado 2009, severity 1.0, OKLab distance, the worst of normal,
  deuteranopic and protanopic vision), against `accent` and against each other with all five lines on:
  the worst pair is `accent`–`series/intake` at 0.112. That is no worse than the existing `flag`–`done`
  pair (0.107). No set of four hues did much better: a brute-force search topped out near 0.16, and
  every winner included a second bright cyan.
- **Known collision.** `series/hrv` and `error` read almost the same under deuteranopia (0.026).
  Allowed, because `error` never appears on a chart, and the chip always names its series.
- Pinks and magentas are out: under deuteranopia they collapse onto `accent` (0.01–0.04).

---

## 2. Typography

### 2.1 Families

| Role | Family | Loaded weights |
| --- | --- | --- |
| Figures, units, timestamps, chart labels, anything monospaced | `JetBrains Mono` | 400, 500, 600 |
| Labels, names, prose, button text | `IBM Plex Sans` | 400, 500, 600 |

Fallback stack on the artboard root: `'IBM Plex Sans', system-ui, sans-serif`. Mono elements declare
`'JetBrains Mono', monospace` individually.

The split is strict: if it is a number the user compares against another number, it is mono. If it
names something, it is sans.

### 2.2 Size scale

Every size present in the six screens, with its use.

| px | Family | Where |
| --- | --- | --- |
| 8 | — | **Retired 2026-09-22.** The evidence-tag strength label moved to 9px (§1.5). Nothing is set at 8px. |
| 9 | Sans | All small-caps column heads and field labels. |
| 9 | Mono | Chart axis labels (SVG), macro denominators, yield percentages. |
| 10 | Sans | Button labels on 44px controls, inline explanatory text, section headings. |
| 10 | Mono | Timestamps, metadata, food-list strings, unit suffixes. |
| 11 | Sans | App-bar titles, card titles, control labels, overlay chip labels. |
| 11 | Mono | "Last time" values, meter values, chip figures, span labels. |
| 12 | Sans | Up-next names, grocery item names, "Implied maintenance". |
| 12 | Mono | `+30s`, grocery quantities, per-food grams in a list. |
| 13 | Sans | `CONFIRM ALL AS PLANNED`, prep food names. |
| 13 | Mono | Set number, RIR, the `+11.3` delta, the `−0.42` rate. |
| 14 | Sans | `COMPLETE SET`. |
| 14 | Mono | `kg` unit beside a 42px figure. |
| 15 | Sans | Exercise name (1), "meals unconfirmed" (4). |
| 15 | Mono | Prep raw/cooked gram figures (5). |
| 17 | Mono | **Working-set kg and reps (1). The app's standard figure size.** |
| 19 | Mono | If-confirmed kcal and protein (4). |
| 20 | Mono | Top set, volume load (2). |
| 22 | Mono | Avg intake, trend change (6). |
| 24 | Mono | Implied maintenance (6). |
| 26 | Mono | Day kcal total (3). |
| 30 | Mono | Rest timer (1). |
| 38 | Mono | Unconfirmed meal count (4). |
| 42 | Mono | e1RM headline (2), weight trend headline (6). |
| 56 | Mono | **Active set only (1). The named exception — §2.5.** |

### 2.3 Weight

| Weight | Use |
| --- | --- |
| 400 | Default for sans labels and prose. |
| 500 | Every mono figure at 13px and above. |
| 600 | App-bar titles, exercise name, primary button labels, active tab label, active span segment (mono). |

### 2.4 Tracking

| Tracking | Applied to |
| --- | --- |
| `-0.03em` | 42px and 56px figures. |
| `-0.02em` | 38px figure. |
| `-0.01em` | 26px and 30px figures. |
| `0.02em`–`0.04em` | Mono metadata on screen 1 (elapsed time, rep range). |
| `0.06em` | Exercise name, overlay chip labels, warm-up summary label. |
| `0.08em` | Small-caps labels and 44px button labels. |
| `0.1em` | 9px column heads and small-caps labels; larger button labels. |
| `0.12em` | Section headings and app-bar titles. |
| `0.14em` | One instance: `PUSH A` on the meal timeline (3). |

Figures above 26px are tightened. Labels below 12px are opened. Nothing between 12 and 26px carries
tracking.

### 2.5 Line height

| Value | Applied to |
| --- | --- |
| `0.86` | 56px active-set figures. |
| `0.9` | 38px and 42px headline figures. |
| `1` | 30px rest timer. |
| `1.55` | Wrapping prose at 10–11px. |
| `1.6` | Mono food-list strings at 10px. |

### 2.6 The 56px exception — named, single, not a second scale

**Rule.** The app's figure size is 17–18px. One element breaks it: the weight, reps and RIR of the
*currently active working set* on screen 1, at 56px / weight 500 / `-0.03em` / line-height 0.86.

**Why.** This is a deliberate borrow from the rejected Heavy direction, covering the one moment
Instrument is weakest at: mid-set, arm's length, bad gym light, one hand free. The decision log
records this as the recoverable part of Heavy's narrow win. The 42px headlines on screens 2 and 6
are a separate, smaller step and are read seated, not mid-set.

**Constraints on its use.**
- It applies to exactly one row at a time — the active set, inside `surface/active`.
- The moment the set is completed it drops to the 17px table row. There is no 56px history.
- No other screen may introduce it. A new screen that wants a bigger figure uses 42px.
- Its unfilled state is the same 56px in `text/placeholder` `#5A6673`, not a smaller placeholder.

If a second 56px use is ever proposed, it is a request to change the type scale and belongs in the
decision log, not in a component.

---

## 3. Geometry

| Property | Value |
| --- | --- |
| Artboard | 390 × 844 (iPhone 14/15 logical) |
| Side gutter | 16px, both edges, on every screen |
| Content width | 358px — SVG charts are authored at exactly 358 wide, confirming the gutter is the rule and not a coincidence |
| Corner radius | **2px everywhere.** No other radius exists except `50%` for status and timeline dots |
| Border width | 1px, with one exception: the active set card's 2px left edge in `accent` |
| Rest progress bar | 2px tall |

### 3.1 Grids

| Screen | Columns | Gap | Computed 1fr |
| --- | --- | --- | --- |
| 1 — set table | `24px 58px 1fr 50px 38px 46px` | 6px | 112px (the KG column) |
| 1 — active set | `1fr 88px 62px` | 8px | 162px (KG), inside a 328px card interior |
| 2 — span selector | `repeat(5, 1fr)` | 5px | 66.8px |
| 2 — secondary stats, overlays | `repeat(2, 1fr)` | 8px / 7px | 175px / 175.5px |
| 3 — macro meters | `repeat(4, 1fr)` | 10px | 74.5px |
| 3 — timeline | `42px 1fr` | 10px | 306px |
| 4 — if-confirmed | `repeat(2, 1fr)` | 12px | 173px |
| 5 — tabs | `repeat(2, 1fr)` | 5px | 176.5px |
| 5 — prep table | `1fr 74px 74px 44px` | 8px | 142px (the COOK column) |
| 6 — maintenance figures | `1fr 1fr` | 14px | 157px inside the card |

### 3.2 Touch targets

The rule is 44px minimum. It holds across the six screens. The one drawn exception, the 30px back chevron, is corrected below.

| Height | Controls |
| --- | --- |
| 44 | Set check cell (46 × 44), prep check cell (44 × 44), span selector, tabs, `EATEN AS PLANNED`, `ADJUST` (62 wide), `REPL` (78 wide) |
| 46 | Overlay chips, `+30s` (min-width 62), `SKIP` (min-width 72), `LEAVE DAY INCOMPLETE` |
| 52 | `APPLY TO TARGETS` |
| 60 | `CONFIRM ALL AS PLANNED` |
| 64 | `COMPLETE SET`, `WARM` (52 wide) |
| 44 | Back chevron (2): 44 × 44 target around the 18px icon, taken from the app bar's left padding so the title does not move. Drawn as 30px; superseded 2026-09-22. |

Two further elements read as tappable but have no target: the `+ 4 more` grocery link (5, 11px text
only) and the chart data points (2, r=2.5–3.5). Both need 44px targets or an explicit decision that
they are not interactive.

### 3.3 Spacing

The vertical rhythm is bespoke — it is not a 4px or 8px grid, and the extraction confirms this
rather than contradicting it.

- **App bar padding:** `18px 16px 13px 16px` on screens 3–6, `18px 16px 14px 16px` on 1 and 2.
- **Section top padding:** 14, 16, 18, 20 or 22px depending on the weight of the break.
- **Card interior padding:** 10–14px. Resting cards `10px 11px`; active cards `11px 12px` to `14px`.
- **Table row padding:** `9px 16px` (1), `11px 16px` (5).
- **Flush-bottom elements** are absolutely positioned at `bottom: 18px` (footnote rules on 2 and 6),
  `bottom: 20px` (actions on 4) or `bottom: 0` (rest bar on 1).
- **Gaps in use:** 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18px.

Treat the recurring values — 16px gutter, 9px and 11px row padding, 6–9px intra-component gap,
18–22px section break — as the system. Treat the rest as per-screen tuning.

---

## 4. Components

### 4.1 App bar
Flex row, `18px 16px 13–14px 16px`, bottom border `line/hairline`. Left: title, 11px sans / 600 /
`0.12em` / `text/primary`, uppercase. Right: one of — a mono metadata string at 10px
`text/quaternary`, an accent string at 10px (`TRAINING 18:30`), a status chip, or a status dot plus
string. Screen 2 replaces the title block with a back chevron plus a 12px / `0.1em` title.

### 4.2 Status chip
`7px 9px` padding, 1px `line/field`, radius 2. A 6px `50%` dot in the state colour, 7px gap, then a
10px mono label at `0.08em` in `text/secondary`. Used for the offline pending count. The synced
indicator on screen 6 is the same idea without the border: a 5px `done` dot plus a 10px mono string.

### 4.3 Section label
9px sans, `0.12em`, `text/quaternary`, uppercase. Sits 8–10px above its content. This is the only
sectioning device — there are no rules, no card headers and no larger headings anywhere in the app.

### 4.4 Data table
Column heads at 9px / `0.1em` / `text/quaternary`, then a 1px `line/hairline` inset to the gutters, then
rows separated by `line/row` `#14191E`. Rows are `9px 16px` (set table) or `11px 16px` (prep table).
Numeric columns are right-aligned in the prep table and left-aligned in the set table.

### 4.5 Active card
1px `line/accent` border, `surface/active` fill, radius 2. On screen 1 only it also carries a 2px
`accent` left edge. Interior padding 11–14px, internal gap 9–13px. Opens with a label row: an accent
10px `0.12em` title on the left, contextual reference on the right.

### 4.6 Buttons

| Variant | Border | Fill | Label |
| --- | --- | --- | --- |
| Primary | 1px `accent` | `surface/accent` | `accent`, 600, `0.1em`, 12–14px, often with a 20–22px check icon and an 11px gap |
| Secondary | 1px `line/field` | none | `text/tertiary`, 10px, `0.08em` |
| Tertiary | 1px `line/hairline` | none | `text/quaternary`, 11px, `0.08em` |

Primary scales with importance: 44px inline, 52px in a card, 60px as a screen's terminal action,
64px mid-set.

### 4.7 Check cell
A square-ish control that carries done state instead of a label.
- **Inert:** 1px `line/control` `#55687A`, no fill, 15px check stroked `line/control`. It has no label,
  so its boundary is what identifies it and must meet 3:1 (§1.5).
- **Done:** 1px `line/done`, `surface/done` fill, 15–17px check stroked `done` `#57C99A`.

Check icon geometry is fixed across the app: `viewBox="0 0 24 24"`, path `M4 12.5 9.5 18 20 6.5`,
`stroke-linecap`/`linejoin` round, stroke width 2.5 (3 at small sizes).

### 4.8 Segmented control
Equal columns, 5px gap, 44px tall, radius 2. Inactive: 1px `line/hairline`, 11px label in
`text/quaternary`. Active: 1px `accent`, `surface/accent`, 11px label in `accent`. Weight on the
active segment is 600 in both the span selector (2, mono) and the tabs (5, sans). The artboard's
700 on `12W` is superseded (§7).

### 4.9 Meal card — four states

| State | Border | Fill | Marker | Content |
| --- | --- | --- | --- | --- |
| Confirmed (3) | `line/hairline` | none | `done` filled 7px dot | Title in `text/secondary` + check and `EATEN` in `done`; foods as one mono string |
| Active (3) | `line/accent` | `surface/active` | `accent` 1px ring, 7px | Title in `text/primary`; foods as a name/quantity list; three actions |
| Planned (3) | `line/hairline` | none | `line/field` 1px ring, 7px | Title in `text/secondary` + kcal/protein; foods as one mono string |
| Unconfirmed (4) | `line/border` | none | none — listed, not on a rail | Time + title + kcal; foods as one mono string; three actions |

Action row is constant: `EATEN AS PLANNED` / `AS PLANNED` (flex-grow, 44px), `ADJUST` (62 × 44),
`REPL` (78 × 44, with a 13px swap icon). On screen 3 the first is primary; on screen 4 all three are
secondary because the screen's own primary is `CONFIRM ALL AS PLANNED`.

### 4.10 Macro meter
Stacked: a label row (9px `text/quaternary` head, 11px mono value in `text/secondary`), a 3px track in
`line/hairline` with a fill in `done`, then a 9px mono denominator in `text/quaternary`. Fill width is
percent-of-target and is capped visually at 100% — the PRO meter reads 182 against 180 at 100%
width.

### 4.11 Timeline rail
`42px 1fr` grid, 10px gap. The rail column stacks a 10px mono time, a marker, then a 1px
`line/hairline` line that flex-grows to the next entry. Markers: 7px `done` filled disc (done), 7px
1px-ringed disc in `accent` (active) or `line/field` (future), and a 9px **square** in `accent` for
the training block — the only non-round marker.

### 4.12 Evidence tag — partial
As drawn on screen 3: 1px `line/flag`, radius 2, padding `2px 6px`, containing a 9px mono claim in
`flag` (`CARBS ↑`), a 1px × 9px `line/flag` divider, and a 9px sans strength label at `0.06em` in
`flag/dim` (8px as drawn; raised 2026-09-22). Only the moderate state is drawn. Strong (`done`), contested (`text/tertiary` on
`line/field`) and the 44 × 44 route to a sources sheet were decided 2026-09-22 — see `docs/10` §7.1.

### 4.13 Overlay chip
46px tall, `0 12px`, 9px gap, radius 2. A 14 × 2px swatch, then an 11px `0.06em` label.
- **Off:** 1px `line/hairline`, swatch `line/field`, label `text/quaternary`.
- **On:** 1px border in the series' chip border, fill in the series' chip fill, swatch and label in
  the series colour. All four series are specified in §1.6. The swatch draws the series' dash
  pattern, so the chip and the line match without relying on colour.

### 4.14 Rest bar
Pinned to the bottom edge, `surface/raised` with a top border in `line/border`. A 2px progress track
in `line/hairline` sits on the very top edge with an `accent` fill (62% in the artboard). Below:
`REST` at 9px `0.12em` `text/quaternary` over a 30px mono timer, and two controls right-aligned.

### 4.15 Footnote rule
Absolutely positioned at `bottom: 18px`, 12px padding above a `line/hairline` top border, holding a
10px sans statement on the left and a 10px mono formula or metadata string on the right in
`text/quaternary`. Used for the Epley formula (2) and the phase/week footer (6).

---

## 5. Charts

Two chart types exist, both authored as inline SVG at 358px wide.

| Property | e1RM (2) | Weight trend (6) |
| --- | --- | --- |
| Canvas | 358 × 192 | 358 × 186 |
| Plot x-range | 14 → 344 | 14 → 344 |
| Baseline | y = 160, `line/border` | y = 160, `line/border` |
| Gridlines | y = 26.7 / 76.7 / 126.7, `line/hairline` | y = 31.5 / 85.4 / 139.2, `line/hairline` |
| Scale | 50px per 6 kg | 53.85px per 1.0 kg |
| Value labels | right-anchored at x=356, 9px mono `text/quaternary` | same |
| Date labels | y = 178, 9px mono `text/quaternary`; start left-anchored, end right-anchored | same |
| Primary series | `accent`, 2px polyline, round caps | `accent`, 2px polyline, 7 smoothed points |
| Data points | r=2.5 rings, 1.5px `accent` stroke on `surface/ground` fill | r=2 discs in `line/control` (daily weights); a fallback daily weight is an r=2 ring, 1.5px `line/control` stroke |
| Latest point | r=3.5 solid `accent` | r=3.5 solid `accent` |
| Overlay series | `series/*` (§1.6), 1.5px, each with its own dash pattern, opacity 0.75. As drawn: weight only, `3 3` | — |

Conventions that carry to any new chart: the primary series is solid `accent` at 2px; overlays are
dashed at 1.5px in their own colour at 0.75 opacity, each with its own dash pattern; raw observations are inert `line/control` discs
and the derived line is `accent`; the most recent point is always solid and larger.

**Overlay end label** (added 2026-09-22, not yet drawn). Each overlay that is on is named at the
right end of its line: 9px mono, in the series colour at full opacity, holding the series name and
its latest value (`HRV 48`). This label, not the colour, is what identifies the line. Placement and
collision handling (labels closer than 11px, and the y-axis value labels at x=356) are left to the
scoped design pass.

A legend appears only where raw and derived data are both plotted (6): 14 × 2px swatch or 5px dot,
7px gap, 10px sans in `text/quaternary`, 18px between entries.

---

## 6. Iconography

All icons are inline SVG on a 24 × 24 viewBox, `fill="none"`, round caps and joins, stroke coloured
to match the adjacent label.

| Icon | Path | Sizes / strokes in use |
| --- | --- | --- |
| Check | `M4 12.5 9.5 18 20 6.5` | 12–13px @3, 15px @2.5, 17px @2.5, 20–22px @2.5 |
| Back chevron | `M15 5 8 12l7 7` | 18px @2 |
| Swap | `M3 8h13l-3.5-3.5M21 16H8l3.5 3.5` | 13px @2 |
| Info | `M12 8v5M12 17h.01` + `circle cx=12 cy=12 r=9` | 14px @2 |

Four icons total across six screens. The density comes from type and rule, not from iconography;
adding a fifth icon should need a reason.

---

## 7. Deviations found in extraction

Recorded, not silently resolved. Each needs a decision before or during build.

1. ~~**Two amber panel fills.**~~ **Resolved 2026-09-22:** `#1A1509` is `series/weight`'s chip fill
   (§1.6), a series token, and `#15110A` is `surface/flag`. They mean different things, so both stay.
2. ~~**Active-segment weight is inconsistent.**~~ **Resolved 2026-09-22:** 600 everywhere (§2.3, §4.8).
3. ~~**The back chevron is a 30px target.**~~ **Resolved 2026-09-22:** 44 × 44 target, 18px icon (§3.2).
4. ~~**`accent/hover` is declared but unused.**~~ **Resolved 2026-09-22:** renamed `accent/pressed`
   (§1.4, `docs/06`).
5. ~~**No error or destructive colour exists.**~~ **Resolved 2026-09-22:** `error` `#F2555A`, with
   `surface/error` and `line/error` (§1.1, §1.2, §1.4, `docs/06`). No artboard draws a refused state
   yet.
6. ~~**Four tones fail WCAG AA.**~~ **Resolved 2026-09-22:** only the tones carrying information
   were raised; `text/micro` and `text/faintest` merged into `text/quaternary`, `text/placeholder`
   added for the 56px unfilled state, `line/control` added for unlabelled controls (§1.3, §1.5,
   `docs/06`). The `line/field` border was never a failure — see §1.5.

---

## 8. Token export

Names for implementation. Values are exactly as extracted.

```
--surface-ground:   #0B0D0F;
--surface-raised:   #12161A;
--surface-active:   #0F171B;
--surface-accent:   #10262E;
--surface-done:     #15241E;
--surface-flag:     #15110A;
--surface-error:    #170B0C;

--line-row:         #14191E;
--line-hairline:    #1A2026;
--line-border:      #232B32;
--line-field:       #2A3440;
--line-control:     #55687A;
--line-accent:      #234A57;
--line-done:        #2E4A40;
--line-flag:        #4A3A1C;
--line-error:       #501C1E;

--text-primary:     #E6EDF3;
--text-secondary:   #A8B4C0;
--text-tertiary:    #8A96A3;
--text-quaternary:  #738393;
--text-placeholder: #5A6673;   /* >= 24px only */

--accent:           #3FB6D4;
--accent-pressed:   #6FCDE3;
--done:             #57C99A;
--flag:             #E0A83C;
--flag-dim:         #947B45;
--error:            #F2555A;

--series-weight:    #E0A83C;   /* chip #1A1509 / #4A3A1C, dash 3 3 */
--series-intake:    #8C7BE8;   /* chip #14151E / #322E50, dash 6 3 */
--series-sleep:     #DCD6CA;   /* chip #1A1B1C / #4A4947, dash 1.5 3 */
--series-hrv:       #C07A5A;   /* chip #181514 / #412E26, dash 8 3 2 3 */

--font-mono:        'JetBrains Mono', monospace;
--font-sans:        'IBM Plex Sans', system-ui, sans-serif;

--radius:           2px;
--gutter:           16px;
--content:          358px;
--target-min:       44px;
```
