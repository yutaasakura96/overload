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
That decision was made on 2026-10-03 (§7.3): the artboard fits, and the built screen scrolls when
an exercise outgrows it.

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
| Rest bar | Fixed `bottom: 0`, over the safe-area inset | 2px track, `REST` label, 30px mono timer, `+30s` and `SKIP`. At zero: `REST OVER`, `+0:12` counting up in `accent`, `DISMISS` (`05` §4.14) |

### Active set card

| Row | Spec |
| --- | --- |
| Label row | `SET 3 OF 4` 10px `0.12em` `accent` (the artboard draws `SET 3`; see *Target*, below); right: `LAST` 9px `text/quaternary` + `80 × 10` 12px mono `text/tertiary`, 7px gap |
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
- **Target (S4), decided 2026-10-03** (`06`). The label counts working sets against
  `target_sets`: `SET 3 OF 4`, then `SET 5 · EXTRA` past the target, and `SET 3` with no target.
  With the warm-up toggle on it reads `WARM-UP`, and a warm-up never moves the count.
- **Set completion** collapses the card to a 17px table row and promotes the next set to active. The
  rest timer starts on completion. The new card comes into view and takes focus (§7.3). The set
  that reaches the target opens the next exercise with sets left; an extra set stays where it is.
- **What the card opens on.** The weight is the last set logged today, else the suggestion, else
  empty (`0` for a bodyweight exercise). Reps are a placeholder: last time's reps for that set when
  the weight repeats, the bottom of the range when it goes up. Left empty, the placeholder is what
  is logged. RIR is optional.
- **A figure the server would refuse** is refused on the card before anything is written: `Refused`
  and the reason under the figures, focus on the figure at fault. Reps 1–100, RIR 0–10, weight 0 to
  9999.99 kg. The refused *row* below is for what the server turns away.
- **Rest over, decided 2026-10-03** (`06`). A short tone at zero, and the bar counts over until
  `DISMISS` or the next set. The screen is kept awake while rest counts, where the browser allows.
  A rest setting of 0 seconds starts no rest bar or tone.
- **Weights in pounds.** With the profile's unit set to `lb`, every weight on the screen is shown
  and typed in pounds, to the tenth; the column head and the weight label read `LB`.
- **The other exercises.** `UP NEXT` lists the exercises with sets left, then `DONE` the ones at
  their target, as `3 / 3 × 6–10`. A row opens that exercise, in any order.
- **Finish.** A tertiary `Finish workout` under the lists, which becomes the question in place
  (`Finish Push A? 9 sets logged.` — `Keep going` / `Finish`), the delete pattern of §8.1. With no
  set logged it says nothing is kept (`09` F3).
- **Offline (S1).** Every control works offline. The pending chip counts sets not yet synced and is
  `flag`, not an error — nothing is lost. It is the screen-1 form of the data-state slot every screen carries (§7.4).
- **Refused set** (`09` F4, drawn in `Main-Refused`). The row stays in the table on a `surface/error` band
  (`docs/05` §4.17): the figures as entered, an info icon in place of the check, and a second row with
  `REFUSED`, the reason in plain words (`Weight over 500 kg`), `EDIT` and `DISCARD`. The actions are
  always visible on a refused row rather than behind a tap, because the row exists to be acted on. The
  slot shows `1 REFUSED` and outranks the pending count. `DISCARD` asks to confirm (not drawn).
  **As built, 2026-10-08** (`06`), with what the artboard does not draw:
  - `EDIT` replaces the second row with three fields (weight, reps, RIR; `05` §4.18) over `CANCEL`
    and `SAVE SET`. A figure the server would refuse is refused there, as on the card.
  - `DISCARD` replaces it with the question in place, `Discard set 2? It is removed from this
    device and is not saved.`, over `KEEP` and `DISCARD` (the delete pattern of §8.1).
  - A refused set still counts as a set of the exercise: the label after it is `SET 3 OF 4`.
  - A refused warm-up leaves the warm-up summary and is listed in the table, numbered `W`.
  - A set refused as `parent_missing` shows `DISCARD` alone.
  - An exercise that is not the one open and holds a refused set says `1 REFUSED`, in `error`
    with the info icon, under its name in `UP NEXT` or `DONE`.
  - **Today** lists the refused sets of workouts that have ended under `Refused sets`, above the
    workout in progress: one `surface/error` card each, with the exercise, the workout's name and
    the figures (`60 kg × 500`), then the same word, reason and actions.

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
  `Not enough data yet`. The same on any span whose workouts all fall on one local date. The
  headline, span selector and overlays have no defined empty treatment.
- **Data points are r=2.5.** If a point is tappable to reach that workout, it needs a 44px target
  (`docs/05` §3.2).

**As built, 2026-10-10** (slice 5, `06`), with what the artboard does not draw:

- **The way in** is a `Progress` row above the form on the exercise's screen (§8.1), at
  `/exercises/{id}/progress`. Back returns there. The span is in the address (`?span=6m`).
- **Headline.** The latest e1RM in the span, and its change since the span's first workout over
  `OVER 12W` (`ALL TIME` for all): `done` when up, `text/tertiary` when down or level. With one
  workout there is no change; with none the figure is an em dash.
- **Cards.** Both are the span's: the heaviest top set with the most reps done at it, and the
  volume load of every workout in the span together.
- **Chart.** Drawn at the width of the screen, the plot ending 68px short as on the artboard. The
  date axis is the span and runs in proportion to time; its labels carry the year when the span
  crosses one. The value scale is three gridlines a round step apart. Rings are drawn only while
  every workout stays 7px from the next.
- **Reading a workout.** A touch or pointer on the chart picks out the workout nearest in time,
  with a `line/control` hairline and a solid disc, and the headline reads it: its e1RM, with its
  top set over its date where the change was. A finger lifting leaves it; the keyboard has a
  slider over the chart, whose focus ring is drawn round the chart. A point is not a target.
- **`Workouts in this span`**, a tertiary disclosure under the cards, lists every point as `05`
  §4.4's table: date, e1RM, top set and volume, newest first.
- **Another span loading** keeps the last one at half opacity. The chart's place is kept by the
  empty state, `Not enough data yet` over one sentence, so the cards do not move.
- **Overlays** are not drawn in M1: no `OVERLAY` block and no chips.
- **Footnote.** A normal bottom block: the screen is at least one viewport tall and grows with
  the list.
- **Pounds.** Every weight is shown in the profile's unit, e1RM to the tenth and volume whole.
- **Without a profile** the screen says to save one on Today, as local dates need the time zone.

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

Screens 3, 4, 5 and 6 are single-viewport artboards of screens that are longer in reality. Screen 2
fits and needs no scroll. Screen 1's artboard fits, but a real exercise can outgrow it.

**Screen 1, decided 2026-10-03** (`06`). The document scrolls. The app bar sticks to the top on
`surface/ground` and keeps its `line/hairline`: no shadow, no heavier line. The rest bar is fixed
to the bottom over the safe-area inset, and the screen keeps matching padding under itself.
Nothing else sticks. Completing a set scrolls the new active card into view (`nearest`, instant
under reduced motion) and focuses it. `scroll-padding` keeps a focused control clear of both bars.

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
     state as drawn. Use the last fetch time of the data on that screen; screen 1 displays device
     workout records, so use the last acknowledged upload. A later workout upload does not change
     the exercise library's displayed time.

Drawn forms are in `docs/05` §4.2: refused (`Main-Refused`), pending (screen 1) and resting (screens 2–6).
Cached data age is not drawn.

**Layout, decided 2026-09-22.** The slot takes the app bar's right side on every screen. What used to sit
there was dropped where it repeated something on screen (`TRAINING 18:30` on 3, `7 DAYS` on 5), or moved
under the title as a subline (the date and time on 4, the same form as screen 1's elapsed time).

---

## 8. Not covered by any artboard

Flagged so they are not discovered mid-build. None of these are gaps in the six screens; they are
screens and states the PRD requires that Phase 2 did not draw.

- **Workout start** (S4) from a routine. Routine selection and the no-routines empty state are
  specified in §8.1, from slice 2; Today and the start itself in §8.2, from slice 3. Start empty,
  changing a live workout and the finish summary are not designed yet.
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

### 8.1 Routines and the exercise library (slice 2, S4 and S8)

No artboard exists, so these were designed in the build (issue #2) from `05`'s tokens and
components, and pass the polish gate (`AGENTS.md`). Nothing here adds a token or an icon.

**Shared parts.**

- **Tabs.** `Today`, `Routines` and `Exercises`, `05` §4.8's tabs as links with `aria-current`,
  under the app bar of the three top-level screens. Since slice 3 `/` is Today and the library is
  `/exercises` (`06`, 2026-10-03).
- **Back.** Screen 2's back chevron plus a 12px title, the chevron's 44px target reaching into the
  bar's padding. Its accessible name says where it goes.
- **Fields.** An 8px small-caps label over a 44px input with a 1px `line/control` border, since an
  empty field's border is what shows where to type (`05` §1.5). Text is 16px sans and figures 17px
  mono, so iOS never zooms into a focused field (`06`, 2026-10-01). A note beside the label says
  `Default` or `Yours`. A refused field gets an `error` border, and under it the word `Refused`, the
  info icon and the reason; focus moves to the first one.
- **Save notices.** `Not saved` in `flag` when the server was not reached: the form keeps
  everything, and saving again later works. `Refused` in `error` when the server refused, or before
  sending when a figure is not a number (`Enter a number, in digits only`), so it never goes as
  `null`, which would mean the default, or when a slot has one end of its rep range (`Set both ends
  of the range, or neither`). Neither queues offline (`06`, offline scope).
- **Opening an editor.** An existing routine or exercise shows only its app bar while a stale copy,
  such as the one restored at launch (`08` §5), is being fetched again, so the edit starts from the
  server's state. Offline, or when that fetch fails, it opens on the saved copy.
- **Saving a routine.** Its slots go before its name, so a refused slot list saves nothing. A name
  refused after the slots landed says `The exercises were saved; the name was not.`
- **Delete.** A tertiary button that becomes the question in place, with `Keep` and `Delete`. Focus
  moves to `Keep`, and back to the button on `Keep`. `error` is never the colour of a destructive
  button (`05` §1.4).
- **Chevrons.** The back chevron turned 90°, 180° or 270° for up, forward and down, not a new icon.

**Routine list** (`/routines`). A row per routine: name, `N EXERCISES · N SETS` in mono small caps,
and the first three exercise names, with a forward chevron. The row opens the editor; a workout
starts from Today (§8.2). `New routine` under the list. Empty: `No routines yet`, one sentence on
what a routine is, and a primary `Create a routine`.

**Routine editor** (`/routines/new`, `/routines/{id}`). The name, then the slots as a numbered list.
A slot is the exercise name with `Remove`, then `Sets`, `Reps low` and `Reps high` with the move up
and move down buttons. The first slot's up and the last slot's down are `aria-disabled`, so focus
stays on a button that has just moved to the end. Empty rep fields show the exercise's range as
placeholders: left empty, the slot follows the exercise. A slot's refusals print once under the slot,
as the figures are too narrow. The figures narrow to 44px so the slot fits a 320px screen. Removing
a slot moves focus to the slot now in its place. `Add exercises`, then the primary save at the foot.
A hidden exercise still in the routine says `· Hidden`. Leaving without saving discards the edit.

**Exercise picker.** Opens inside the editor, so nothing typed is lost. A search field, `New
exercise`, then the library without hidden exercises, filed and searched as the library is (below).
Each row is a native checkbox stretched invisibly over it, drawn as `05`'s check cell, so a tap
anywhere ticks it; the focus ring goes on the row. Ticked exercises join the routine in the order
they were ticked. The
sticky action bar holds the primary `Add N exercises`, which reads `Tick exercises to add` while
nothing is ticked. Back to the editor, focus lands on `Add exercises`.

**Exercise form** (`/exercises/new`, `/exercises/{id}`, and from the picker).

- *New or custom:* name, equipment, muscle group (`None` or one of the eleven), then increment,
  rest (s) and the rep range. The increment
  follows the equipment class until the user types one, and is shown and typed in the profile's
  unit, kg or lb; it is stored in kg.
- *Seeded:* only the user's own values, each with its `Default`/`Yours` note, and `Restore
  defaults` once any is the user's.
- Above the form of an existing exercise, outside the picker: a `Progress` row with a forward
  chevron, which opens screen 2 for it (§2).
- Under both: `Hide from pickers` (`Show in pickers again`), and for a custom exercise the delete.
  A delete refused because routines use it names them and suggests hiding instead.

**Exercise library** (`/exercises`). A search field and `New exercise` above the list, as in the
picker. Each row opens the exercise form. A `Hidden exercises` disclosure under the list fetches the
hidden ones when first opened.

**Muscle groups and search** (library and picker; `06`, 2026-10-08). The list is filed under its
muscle groups in a fixed order: chest, back, shoulders, biceps, triceps, forearms, quads,
hamstrings, glutes, calves, core, then `Other` for a custom exercise filed under none. Each group is
`05` §4.3's section label as an `h3`, one step brighter (`text/tertiary`) than the column heads;
a group with no rows is not drawn. Rows keep name order inside a group. Search keeps the rows whose
name and aliases together hold every word typed, so
`rdl` finds `Barbell Romanian Deadlift`. While searching,
the heading reads `N matching` and is announced; with nothing left it says to check the spelling or
use `New exercise`.

### 8.2 Today and the start of a workout (slice 3)

No artboard exists, so these were designed in the build (issue #3) from `05`'s tokens and
components, and pass the polish gate (`AGENTS.md`). Nothing here adds a token or an icon. The meal
cards join Today in M2.

**Today** (`/`). The app bar's title is `Today` over the date in the profile's time zone, with the
data-state slot. Under the tabs, in order:

- **Ended by the 3-hour rule:** one line, `Push A ended at 10:14`, on the launch that ended it
  (`09` F3).
- **In progress:** `05` §4.5's active card with the workout's name, `4 SETS · STARTED 18:32` and a
  primary `Resume workout`.
- **Start a workout:** a row per routine, as on the routine list, with `START` in `accent` in place
  of the chevron. One tap starts it and opens screen 1 (S4). While a workout is in progress the tap
  asks under the row instead: `Finish Push A first?` — `Resume` / `Finish`.
- **No routines:** the empty state of the routine list, `Create a routine`.
- **Profile:** `Time zone` (an IANA name, opened on the device's own) and `Weights shown in` —
  `05` §4.8's segments over two radios, `Kilograms` / `Pounds` — then a secondary save. Until the
  first save the heading reads `Set up your profile` with one sentence on what the two are for.
  Saved online only, like routines.
- **Account:** the email and `Sign out`. With sets not uploaded it asks first, in place:
  `2 sets not uploaded yet.` — `Upload now` / `Discard and sign out`. With a workout in progress it
  says to finish it first, and with one whose ending has not uploaded it says so with `Try again`;
  both offer neither (`08` §7).

**Data-state slot (§7.4) as built.** Refused and pending are counted from the set store on every
screen; the resting form shows the time §7.4 names for that screen. Cached data age is still not
drawn.
