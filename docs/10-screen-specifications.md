# 10 — Screen Specifications

**Direction:** Instrument. Tokens and components are defined in `docs/05-design-system.md`; this
document does not restate them.
**Extracted from:** the six `.dc.html` artboards in `design/`, 2026-09-16. Updated 2026-09-22 from the
scoped design pass (review 2b), which also added seven state artboards (table below).

Each artboard is 390 × 844 and static. Where the real screen is longer than one viewport, that is
stated and the scroll behaviour is listed as a gap (§7.3), not invented here.

| # | Screen | Artboard | PRD stories | Milestone |
| --- | --- | --- | --- | --- |
| 1 | Live workout | `Main.dc.html` | S1, S2, S3, S5, S6 | M1 |
| 2 | Exercise progress | `Progress.dc.html` | S7, S20 | M1 / M3 |
| 3 | Today's meal plan | `MealPlan.dc.html` | S16, S18 | M2 |
| 4 | End-of-day check | `EndOfDay.dc.html` | S18 | M2 |
| 5 | Prep plan + grocery | `PrepList.dc.html` | S13, S17 | M2 |
| 6 | Weight + maintenance | `WeightTrend.dc.html` | S11, S18a | M2 |

State artboards, on the canvas page *States (review 2b)*:

| Screen | State | Artboard |
| --- | --- | --- |
| 1 | Warm-ups expanded | `Main-Warmups.dc.html` |
| 1 | Refused set | `Main-Refused.dc.html` |
| 2 | Four overlays with end labels | `Progress-Overlays.dc.html` |
| 3 | Sources sheet | `MealPlan-Sources.dc.html` |
| 6 | Under 14 complete days | `WeightTrend-Countdown.dc.html` |
| 6 | Low recent logging, fallback weights | `WeightTrend-LowLogging.dc.html` |
| — | Evidence tag, three strengths | `EvidenceTag.dc.html` |

---

## 1. Live workout

The screen that has to work. It is read mid-set, at arm's length, one-handed. Everything else is
subordinate to the active set block.

**Fits one viewport.** Measured in the browser on 2026-09-22, the last UP NEXT row ends at y=709 and the
rest bar starts at y=763: 54px of slack. (The 2026-09-16 figure of about 66px was an estimate, and the
warm-up summary has since grown from 37 to 44px.) Expanded warm-ups leave 6px and the refused state
leaves 4px, so both still fit. Nothing else can be added to this screen without a scroll decision.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 14px`, bottom `line/hairline` | Left: routine name (`PUSH A`) 11px/600/`0.12em` over elapsed time 11px mono `text/quaternary`, 3px gap. Right: the data-state slot, drawn in its pending form |
| Exercise header | `15px 16px 9px`, baseline-aligned row | `Bench Press` 15px/600/`0.06em` uppercase; right: `6–10 · +2.5` 10px mono `text/quaternary` — the rep range and this exercise's increment |
| Warm-up summary | Inset 16px, 44px tall, `0 11px`, 1px `line/hairline`. The whole row is the target that expands it (§7.2) | 13px `done` check, `2 WARM-UP SETS` 11px `text/quaternary`; right: `40 × 10 · 60 × 6` 11px mono `text/quaternary` |
| Column heads | `16px 16px 7px`, then 1px `line/hairline` inset | `SET · LAST · KG · REPS · RIR` 9px/`0.1em` `text/quaternary`; sixth column unlabelled |
| Completed set rows | `9px 16px`, `line/row` bottom | Set no. 13px mono `text/tertiary`; last time 11px mono `text/quaternary`; kg and reps 17px mono/500 `text/primary`; RIR 13px mono `text/tertiary`; done check cell 46 × 44 |
| **Active set card** | `14px 16px 0`, 1px `line/accent` + 2px `accent` left edge, `surface/active`, `14px 14px 16px`, 13px gap | See below |
| Up next | `18px 16px 0`, 8px gap | `UP NEXT` section label; then rows at `13px 12px`, 1px `line/hairline`: name 12px `text/secondary`/`0.03em`, target 11px mono `text/quaternary` |
| Rest bar | Pinned `bottom: 0` | 2px track, `REST` label, 30px mono timer, `+30s` and `SKIP` |

### Active set card

| Row | Spec |
| --- | --- |
| Label row | `SET 3` 10px `0.12em` `accent`; right: `LAST` 9px `text/quaternary` + `80 × 10` 12px mono `text/tertiary`, 7px gap |
| Figures | Grid `1fr 88px 62px`, 8px gap, `align-items: end`. Each column: 9px `0.1em` `text/quaternary` label, 6px gap, then a 56px mono/500/`-0.03em`/0.86 figure |
| Suggestion | 9px `SUGGESTED` label, 9px gap, then `82.5` 11px mono `accent` in a `4px 7px` box with a 1px `line/accent` border, then the reason in 10px `text/quaternary` — `hit 10 on every set last time` |
| Actions | 8px gap. `WARM` 52 × 64 secondary; `COMPLETE SET` flex-grow × 64 primary with a 22px check and 11px gap |

**Figure states.** Entered values are `text/primary`. Unentered are the same 56px in `text/placeholder`
`#5A6673` — reps shows the suggested rep count as a placeholder, RIR shows `—`. The completion
control is enabled regardless; reps and RIR are pre-filled from the suggestion.

### States and rules

- **Suggestion source (S3).** Double progression. A suggestion always shows once the exercise has a
  last time: plus the increment if every working set reached the top of the rep range, otherwise the
  same weight. The reason string always says which, in plain words.
- **First time doing an exercise (S2, PRD empty states).** No LAST column value, no suggestion chip
  and no reason string; the row reads `first workout`.
- **Set completion** collapses the card to a 17px table row and promotes the next set to active. The
  rest timer starts on completion.
- **Offline (S1).** Every control works offline. The pending chip counts sets not yet synced and is
  `flag`, not an error — nothing is lost. It is the screen-1 form of the data-state slot every screen carries (§7.4).
- **Refused set** (`09` F4, drawn in `Main-Refused`). The row stays in the table on a `surface/error` band
  (`docs/05` §4.17): the figures as entered, an info icon in place of the check, and a second row with
  `REFUSED`, the reason in plain words (`Weight over 500 kg`), `EDIT` and `DISCARD`. The actions are
  always visible on a refused row rather than behind a tap, because the row exists to be acted on. The
  slot shows `1 REFUSED` and outranks the pending count. `DISCARD` asks to confirm (not drawn).

---

## 2. Exercise progress

Read seated. Four independently toggleable overlays are the reason the whole app is Instrument.

**Fits one viewport.** The Epley footnote is pinned at `bottom: 18px`.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 14px`, 6px gap | Back chevron in a 44 × 44 target (18px icon, `text/tertiary`), pulled out with `-7px 0 -7px -14px` margins so the bar keeps its height and the title stays at x=52; then `Bench Press` 12px/600/`0.1em`. Right: the data-state slot |
| Headline | `18px 16px 0`, `align-items: flex-end` | `ESTIMATED 1RM` section label over `110.0` 42px mono/500/`-0.03em`/0.9 + `kg` 14px mono `text/quaternary`. Right, bottom-aligned: `+11.3` 13px mono `done` over `OVER 12W` 9px `0.08em` `text/quaternary` |
| Span selector | `16px 16px 0`, 5 × 1fr, 5px gap, 44px | `4W · 12W · 6M · 1Y · ALL`. Active segment: `12W` |
| Chart | `20px 16px 0`, SVG 358 × 192 | Plot 24 → 290, end-label gutter to 358. See `docs/05` §5 |
| Secondary stats | `6px 16px 0`, 2 × 1fr, 8px gap | Two `12px`-padded cards, 1px `line/hairline`: `TOP SET` → `82.5` 20px mono + `× 10` 11px; `VOLUME LOAD` → `2,475` 20px mono + `kg` |
| Overlays | `20px 16px 0`, 9px gap | `OVERLAY` section label, then a 2 × 2 grid of 46px chips, 7px gap: `WEIGHT TREND` (on), `INTAKE`, `SLEEP`, `HRV`. Each swatch draws its series' dash, off chips in `line/field` |
| Footnote | `bottom: 18px` | `e1RM from the best working set` / `Epley · w × (1 + r/30)` |

### States and rules

- **Primary series** is e1RM from the best working set of each workout, per the decision log.
- **Overlays (S20, M3).** Four series, each independently toggleable, any combination on at once.
  Each series has a colour, a dash pattern and an end label: `series/weight`, `series/intake`,
  `series/sleep` and `series/hrv` (`docs/05` §1.6, decided 2026-09-22). The end label and the dash
  pattern identify a series; colour is the third cue. The resting artboard has weight trend on with
  its end label. `Progress-Overlays` has all four on, with three labels pushed apart by the collision
  rule (`docs/05` §5).
- **Fewer than 2 workouts** (PRD empty states): no chart is drawn, message reads
  `Not enough data yet`. The headline, span selector and overlays have no defined empty treatment.
- **Data points are r=2.5.** If a point is tappable to reach that workout, it needs a 44px target
  (`docs/05` §3.2).

---

## 3. Today's meal plan

**Longer than one viewport in reality.** The artboard shows five timeline entries plus the training
marker and ends flush; a real day with six meals plus adjustments will exceed 844. Scroll behaviour
is a gap — §7.3.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 13px` | `TUE 16 SEP`; right: the data-state slot. `TRAINING 18:30` was dropped on 2026-09-22 because the timeline already marks 18:30 |
| Macro totals | `14px 16px 13px`, bottom `line/hairline`, 11px gap | Row 1: `2,480` 26px mono/500/`-0.01em` + `/ 2,500 kcal` 12px mono `text/quaternary`; right: `−0.8%` 11px mono `done` in a `3px 7px` box with a `line/done` border. Row 2: four macro meters — `PRO 182/180`, `CARB 276/280`, `FAT 76/78`, `FIB 36/35` |
| Timeline | `14px 16px 0`, `42px 1fr` grid, 10px gap per entry, 11px bottom padding between entries | Five meal entries plus a training marker |

### Timeline entries as drawn

| Time | State | Card |
| --- | --- | --- |
| 07:00 | Confirmed | `BREAKFAST` + check and `EATEN` in `done`; foods as one 10px mono string at 1.6 |
| 11:30 | Active | `LUNCH` + `745 kcal · P 58`; four foods as name/quantity rows at 11px, `cooked` qualifiers in `text/quaternary`; three actions |
| 16:30 | Planned | `PRE-TRAINING` + **evidence tag** `CARBS ↑ · MODERATE`; foods as one string |
| 18:30 | Training | 9px `accent` square marker, `PUSH A` 10px `0.14em` `accent`, 24px tall row |
| 19:45 | Planned | `POST-TRAINING` + `690 kcal · P 56` |
| 21:30 | Planned | `EVENING` + `310 kcal · P 24`; last entry, rail line omitted |

### States and rules

- **The plan is the log (S18).** A meal is confirmed, never typed. `EATEN AS PLANNED` is the primary
  action on the active card; `ADJUST` edits quantities; `REPL` swaps the meal for something else.
  An unconfirmed meal never counts as eaten.
- **Only the next-due meal is active.** All others are confirmed or planned. The rail marker and the
  card border carry the state together.
- **Carb timing.** The pre-training meal's tag is the only recommendation surfaced on this screen,
  and it is the reason the evidence-tag component exists — §7.1. Tapping it opens the sources sheet
  (`MealPlan-Sources`).
- **The tag's 44px hit area fits without a taller row.** The tag sits in the card's header row, 10px
  below the card top. A 44px-tall area centred on it reaches 4.5px above the card, into the 11px gap
  between entries, and about 7px down over the food string. Neither holds another target. This holds
  only while a planned card's body is not itself tappable; if it becomes so, the tag's area wins inside
  its bounds.
- **Macro meters cap at 100%.** PRO reads 182 against 180 at full width. An over-target macro is not
  visually distinguished from an on-target one. If overshoot must be visible, that is a new state.
- **Food list empty** (PRD): the plan cannot be built; prompt to add a protein source first. No
  empty artboard exists for this screen.

---

## 4. End-of-day check

The sweep that keeps expenditure data honest. Read once, late, on a phone, with the intent of
tapping one button.

**Fits one viewport** with two unconfirmed meals. Three or more will push the pinned action block —
this screen has the same scroll gap as 3, 5 and 6 (§7.3).

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 13px` | `END OF DAY` over a subline, `TUE 16 SEP · 22:40` 11px mono `text/quaternary` (moved from the right on 2026-09-22); right: the data-state slot |
| Headline | `22px 16px 0`, 10px gap | `2` 38px mono/500/`-0.02em`/0.9 in `flag` + `meals unconfirmed` 15px `text/primary` |
| Consequence panel | `11px 12px`, 1px `line/flag`, `surface/flag`, 9px gap | 14px info icon in `flag`, then 11px/1.55 `text/secondary`: leaving these marks the day `incomplete` (the word in `flag`) and it will not count towards the expenditure estimate |
| Unconfirmed list | `20px 16px 0`, 9px gap | `UNCONFIRMED` section label, then one card per meal: 1px `line/border`, `12px` padding, 9px gap — time 11px mono + title 11px `0.08em` `text/primary` + kcal right; foods as one mono string; three secondary actions |
| If confirmed | `20px 16px 0`, 1px `line/hairline`, `13px` padding, 11px gap | `IF CONFIRMED` label; 2 × 1fr of `2,480 / 2,500` and `182 / 180` at 19px mono over 9px `KCAL` / `PROTEIN` labels; 1px divider; `Complete days this phase` with `11 → 12` |
| Actions | `bottom: 20px`, 9px gap | `CONFIRM ALL AS PLANNED` 60px primary with a 20px check; `LEAVE DAY INCOMPLETE` 46px tertiary |

### States and rules

- **The whole screen is a preview.** Nothing is written until an action is tapped. The "if confirmed"
  block states the exact consequence, including the complete-day counter that feeds S18a and S21.
- **Per-meal actions are all secondary** here, unlike screen 3, because the screen has one primary.
- **Leaving the day incomplete is a real choice**, not a dismissal. It is offered at equal
  prominence in tertiary weight, and the consequence is stated above the fold.
- **Reached from a card on Today**: the evening card, 60 minutes before bedtime, or the next
  morning's "Yesterday" card (`09` F11). **Leave day incomplete** writes nothing to the server; the
  phone remembers the date so neither card asks again.
- **Zero unconfirmed meals** is unreachable: a card shows only for a day with at least one
  unconfirmed meal (decided 2026-09-22, `09` F11). No artboard needed.

---

## 5. Prep plan + grocery

**Longer than one viewport in reality.** The artboard shows five cook rows and a five-item grocery
preview with `+ 4 more`; a real week has nine grocery items and may have more cook rows. §7.3.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 13px` | `WEEK OF 16 SEP`; right: the data-state slot. `7 DAYS` was dropped on 2026-09-22 because the title already says it |
| Tabs | `14px 16px 0`, 2 × 1fr, 5px gap, 44px | `PREP PLAN` (active, 600) / `GROCERY` |
| Yield source | Inset 16px, `10px 11px`, 1px `line/hairline` | `Using yields from your last batch` 10px `text/quaternary`; right: `9 SEP` 10px mono `text/quaternary` |
| Column heads | `18px 16px 7px`, then 1px `line/hairline` inset | `COOK · RAW · COOKED` 9px `0.1em` `text/quaternary`; RAW and COOKED right-aligned; fourth column unlabelled |
| Cook rows | `11px 16px`, grid `1fr 74px 74px 44px`, 8px gap, `line/row` bottom | Name 13px `text/primary` over a 9px mono yield note in `text/quaternary`; raw 15px mono `text/primary`; cooked 15px mono `text/quaternary`; 44 × 44 check cell |
| Grocery preview | `22px 16px 0`, 10px gap | `GROCERY LIST` label + `9 ITEMS · RAW` 10px mono `text/quaternary`; then a card at `12px` padding, 8px gap: name 12px `text/secondary` / quantity 12px mono `text/tertiary`; `+ 4 more` 11px mono `accent` |

### Cook rows as drawn

| Food | Yield note | Raw | Cooked | Check |
| --- | --- | --- | --- | --- |
| Chicken breast | `yield 75%` | 1,400 | 1,050 | inert |
| Rice | `yield 280%` | 900 | 2,520 | done |
| Potato | `yield 90%` | 1,200 | 1,080 | inert |
| Broccoli | `no batch — raw weight` | 1,050 | `—` | inert |
| Okra | `rotates with broccoli` | 600 | `—` | inert |

### States and rules

- **Yields are per-batch and recorded (S13).** The yield note is the row's provenance and carries
  three cases as drawn: a recorded percentage, no batch recorded, and a rotation rule. A fourth case
  from the PRD — falling back to the database's cooked values, marked approximate — has no
  treatment. It should reuse the yield-note slot.
- **Cooked is `—`** where no conversion applies. The raw figure is the one to shop and cook by,
  which is why raw is `text/primary` and cooked is `text/quaternary`.
- **The check cell is a prep-progress toggle**, not a done-state display: it is the only interactive
  element in the row.
- **The grocery tab is undesigned.** Only the preview card exists. The grocery list itself needs a
  screen — 9 items, raw quantities, presumably checkable, and it is what gets read in a shop.
- **`+ 4 more` has no touch target** (`docs/05` §3.2). It either becomes a 44px row or the preview
  card gets a footer control.

---

## 6. Weight + maintenance

**Longer than one viewport in reality** once the phase footer and any history below it are real.
§7.3.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 13px` | `WEIGHT`; right: 5px `done` dot + `SYNCED 06:41` 10px mono `text/quaternary` |
| Headline | `18px 16px 0` | `TREND` label over `82.4` 42px mono + `kg`. Right: `−0.42` 13px mono `done` over `KG / WEEK` |
| Chart | `18px 16px 0`, SVG 358 × 186 | 30 daily-weight discs in `line/control`, 7-point smoothed `accent` trend, solid latest point. Value labels on the left edge |
| Legend | `4px 16px 0`, 18px gap | 14 × 2px `accent` swatch + `Smoothed trend`; 5px `line/control` dot + `Morning weigh-in`; when a fallback weight is in view, a 5px ring (1.5px `line/control`) + `Not a morning weigh-in` |
| Maintenance check | `20px 16px 0`, active card, `14px` padding, 13px gap | See below |
| Phase footer | `bottom: 18px` | `CUT` 10px `0.08em` `text/quaternary` + `target −0.5%/wk` 10px mono `text/quaternary`; right: `week 6` |

### Maintenance check card (S18a)

| Row | Spec |
| --- | --- |
| Header | `MAINTENANCE CHECK` 10px `0.12em` `accent`; right: `LAST 14 DAYS · 12 COMPLETE` 10px mono `text/quaternary` |
| Figures | `1fr 1fr`, 14px gap: `AVG INTAKE` → `2,450` 22px mono + `kcal`; `TREND CHANGE` → `−0.1` 22px mono + `kg/wk` |
| Divider | 1px `line/hairline` |
| Result | `Implied maintenance` 11px `text/secondary`; right: `≈ 2,500` 24px mono/500 in `accent` + `kcal` |
| Caveat | `Read-only. Your targets are unchanged until you apply this.` 10px/1.55 `text/quaternary` |
| Action | `APPLY TO TARGETS` 52px primary |

### States and rules

- **Read-only until applied**, per the decision log. The caveat sits directly above the action, and
  the `≈` on the result is part of the number, not decoration.
- **The window** is always the trailing 14 calendar days, counting complete days only (S18a, the same
  window as S21). The header says both: `LAST 14 DAYS · 12 COMPLETE`. The original `14 COMPLETE DAYS`
  was replaced, because after the gate the window can hold fewer than 14 complete days.
- **Under 14 complete days in total** (`WeightTrend-Countdown`): the card shows its header, with the
  right side reading `9 OF 14 COMPLETE` (a count towards the gate, since there is no window yet), then
  `5` at 22px mono with `complete days to go`, and one 10px line saying what a complete day is.
  No figures, no result, no action. It is not replaced by the provisional estimate, which is a
  calorie target (`CONTEXT.md`), not this check.
- **Too little recent logging** (fewer than 5 of the newest 7 days complete, S18a;
  `WeightTrend-LowLogging`): one 11px line in `flag` with the 14px info icon, above the caveat,
  `Based on too little recent logging`. `APPLY TO TARGETS` stays enabled;
  the estimate is read-only until applied either way.
- **Fewer than 3 days of weight data** (PRD): raw points only, no trend line. The legend's first
  entry and the headline rate both need a treatment for that case.
- **Only daily weights are plotted** (`CONTEXT.md`): the first weigh-in before 10:00, or failing
  that the day's first weigh-in. A fallback daily weight feeds the trend like any other and is
  drawn as a hollow ring in `line/control` (1.5px stroke, r=2) instead of a filled disc, with a third
  legend entry, `Not a morning weigh-in`. The day's other readings are stored but not drawn.
- The countdown, the low-logging line, the ring and the third legend entry are drawn in the two
  state artboards (2026-09-22).

---

## 7. Gaps carried out of Phase 2

Four things were left undesigned deliberately. Three were decided and drawn in the 2026-09-22 design
pass. Scroll and sticky stay open for M2.

### 7.1 The evidence tag — one component, three strengths, a route to the source

Screen 3 draws one state. S16 and S23 need the same component with strong, moderate and
contested, plus a way to reach the evidence. Specifying it once, for both uses:

**Anatomy, as drawn (moderate).** 1px border, radius 2, padding `2px 6px`, containing a 9px mono
claim, a 1px × 9px divider in the border colour, and an 8px sans strength label at `0.06em` (9px from 2026-09-22).

**Proposed extension.** Keep the anatomy; vary only the colour pair by strength, and add a third
slot for the source route.

| Strength | Claim + border | Strength label | Meaning |
| --- | --- | --- | --- |
| Strong | `done` `#57C99A` / `line/done` `#2E4A40` | `done` at reduced weight | Multiple controlled trials or a meta-analysis agree |
| Moderate | `flag` `#E0A83C` / `line/flag` `#4A3A1C` | `flag/dim` `#947B45` | Mixed or limited evidence — **as drawn on screen 3** |
| Contested | `text/tertiary` `#8A96A3` / `line/field` `#2A3440` | `text/quaternary` `#738393` | Commonly believed, not supported |

The strength word is always printed, so colour is never the only cue (WCAG 1.4.1). Contested is
neutral: it is not `error` (`docs/05` §1.4), and it reads as "noted, not endorsed". Decided
2026-09-22.

**Route to the source — decided 2026-09-22 (`docs/06`).** Every evidence tag opens its sources,
wherever it appears (S16 on screen 3, and S23), because `CONTEXT.md` defines the tag as the label
*with* its route. The tag stays 13px tall visually. Its tap area is 44 × 44, expanded into the space
around it, so screen 3's row height does not change. A tap opens a sources sheet: the claim, its
strength, and the citations. This replaces the earlier proposal to keep the inline S16 form
non-interactive.

**Drawn 2026-09-22.** All three strengths are on the `EvidenceTag` board. Screen 3 has room for the hit
area without a taller row (§3). The **sources sheet** (`MealPlan-Sources`, `docs/05` §4.16) holds, top to
bottom: `EVIDENCE` and `CLOSE`; the tag; the claim as one 15px sentence; one 11px paragraph saying what
the strength means for this plan; then `SOURCES`, one 44px row per citation with the title (12px
`text/secondary`) over authors, journal and year (10px mono `text/quaternary`). The citations drawn
(Kerksick et al. 2017, Aragon & Schoenfeld 2013) are illustrative. The real list comes from the evidence
content written at build, and each row opens the source.

The 8px strength label was fixed 2026-09-22: now 9px in `flag/dim` `#947B45`, 4.80:1 (`docs/05` §1.5).

### 7.2 Expanded warm-up sets

Screen 1 collapses warm-ups to a 44px summary row to buy vertical space, and the screen's 54px of
slack depends on it.

What is known: warm-up sets are logged (S6), they use the same set-table grammar, and the summary row
already carries the check and the `40 × 10 · 60 × 6` string. Two warm-up rows in the existing table
form cost about 126px, which does not fit above the active card without pushing `UP NEXT` off.

**Decided 2026-09-22 (`docs/06`), drawn in `Main-Warmups`.** Tapping the summary row expands it in
place. The header keeps its 44px height and swaps the set string for `HIDE`. Each warm-up is one row of
about 23px on the set table's columns: `W1` in 11px mono `text/quaternary` in the SET column, kg and reps
at 13px mono/500 `text/tertiary`, RIR `—`, no LAST value and no check cell. The smaller size says they
are not progression data. Two warm-ups add 46px and leave 6px of slack; three or more scroll the
screen, with the rest bar still pinned. Warm-ups are still logged through the active card's `WARM`
toggle; the expanded rows are for review. Editing one from here is left to M1's `/grill-with-docs`.

### 7.3 Scroll behaviour and sticky headers

Screens 3, 4, 5 and 6 are single-viewport artboards of screens that are longer in reality. Screen 1
and 2 fit and need no scroll.

What the artboards imply but do not specify:

| Screen | Should plausibly stick | Currently drawn as |
| --- | --- | --- |
| 3 | App bar + macro totals — the running total is the reason to look | Static block, 13px bottom border |
| 4 | The action block is already pinned at `bottom: 20px`; it must stay pinned when the list scrolls behind it | Absolutely positioned |
| 5 | App bar + tabs; column heads while the cook table scrolls | Static |
| 6 | Nothing needs to stick; the footer is pinned at `bottom: 18px` and should become a normal bottom block instead | Absolutely positioned |

**Decisions needed:** which blocks stick, what a stuck block looks like (the artboards have no
elevation, no shadow and one raised surface — `surface/raised` `#12161A`, currently used only by the
rest bar), and whether a stuck block keeps its hairline or gains the heavier `line/border`.

**Where it is decided:** in each screen's `/grill-with-docs` during M2, when real content lengths
exist. Reviewed and kept as open on 2026-09-22.

### 7.4 Data-state slot — decided and drawn

The pending chip exists only on screen 1. Sets sync offline-first (S1), so the count is meaningful
anywhere in the app. The chip is therefore the screen-1 form of one **data-state slot** in every
screen's app bar (`CONTEXT.md`; decided in `docs/06` 2026-09-19, with its priority order 2026-09-22).

- **Always present**, on every screen. At zero pending it shows the resting state (`09` F4).
- **One condition at a time**, in this priority order:
  1. **Refused** — *N* refused, in `error` (`docs/05` §1.4). First, because it is the only state
     that needs the user to act.
  2. **Pending** — *N* pending, in `flag`, with the 6px `flag` dot. This is the chip as drawn on screen 1.
  3. **Cached data age** — offline with nothing pending: the age of the data on screen, `text/quaternary`.
  4. **Last sync time** — the resting state, `text/quaternary`. Screen 6's `SYNCED 06:41` is this
     state as drawn.

Drawn forms are in `docs/05` §4.2: refused (`Main-Refused`), pending (screen 1) and resting (screens 2–6).
Cached data age is not drawn.

**Layout, decided 2026-09-22.** The slot takes the app bar's right side on every screen. What used to sit
there was dropped where it repeated something on screen (`TRAINING 18:30` on 3, `7 DAYS` on 5), or moved
under the title as a subline (the date and time on 4, the same form as screen 1's elapsed time).

---

## 8. Not covered by any artboard

Flagged so they are not discovered mid-build. None of these are gaps in the six screens; they are
screens and states the PRD requires that Phase 2 did not draw.

- **Workout start and routine selection** (S4), including the no-routines empty state.
- **Exercise library and picker** (S8).
- **Food list management** (S12) and manual label entry.
- **Goal phase and macro target setup** (S14), routine and meal count (S15).
- **The grocery list proper** (S17) — only a preview card exists.
- **Invite administration and revoked access** (S9), export and delete (S10).
- **Health connection setup and the health dashboard** (S19, S24).
- **Photo and text meal estimation** (S22) and its confirm-before-save step.
- **Plateau protocols** (S23) beyond the evidence tag itself.
- **S18a and S21 with too few weigh-ins to estimate** (`03` §8.3): `Weigh in to see this` in place of the figure. Added by review 2026-09-22.
- **Every error and failure state except the refused set.** The refused set is drawn
  (`Main-Refused`, 2026-09-22). A rejected save elsewhere, revoked access and the discard confirm are not.
