# 10 — Screen Specifications

**Direction:** Instrument. Tokens and components are defined in `docs/05-design-system.md`; this
document does not restate them.
**Extracted from:** the six `.dc.html` artboards in `design/`, 2026-09-16.

Each artboard is 390 × 844 and static. Where the real screen is longer than one viewport, that is
stated and the scroll behaviour is listed as a gap (§7.3), not invented here.

| # | Screen | Artboard | PRD stories | Milestone |
| --- | --- | --- | --- | --- |
| 1 | Live workout session | `Main.dc.html` | S1, S2, S3, S5, S6 | M1 |
| 2 | Exercise progress | `Progress.dc.html` | S7, S20 | M1 / M3 |
| 3 | Today's meal plan | `MealPlan.dc.html` | S16, S18 | M2 |
| 4 | End-of-day check | `EndOfDay.dc.html` | S18 | M2 |
| 5 | Prep plan + grocery | `PrepList.dc.html` | S13, S17 | M2 |
| 6 | Weight + maintenance | `WeightTrend.dc.html` | S11, S18a | M2 |

---

## 1. Live workout session

The screen that has to work. It is read mid-set, at arm's length, one-handed. Everything else is
subordinate to the active set block.

**Fits one viewport.** Content measures roughly 701px against a rest bar that starts at y=767 —
about 66px of slack. It must stay that way: the warm-up collapse (§7.2) is what buys the room.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 14px`, bottom `line/hairline` | Left: routine name (`PUSH A`) 11px/600/`0.12em` over elapsed time 11px mono `text/quaternary`, 3px gap. Right: offline pending chip |
| Exercise header | `15px 16px 9px`, baseline-aligned row | `Bench Press` 15px/600/`0.06em` uppercase; right: `6–10 · +2.5` 10px mono `text/quaternary` — the rep range and this exercise's increment |
| Warm-up summary | Inset 16px, `10px 11px`, 1px `line/hairline` | 13px `done` check, `2 WARM-UP SETS` 11px `text/quaternary`; right: `40 × 10 · 60 × 6` 11px mono `text/quaternary` |
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

- **Suggestion source (S3).** Double progression. The suggested weight appears only when the last
  session's data supports it, and the reason string always states why in plain words.
- **First time doing an exercise (S2, PRD empty states).** No LAST column value, no suggestion chip
  and no reason string; the row reads `first session`.
- **Set completion** collapses the card to a 17px table row and promotes the next set to active. The
  rest timer starts on completion.
- **Offline (S1).** Every control works offline. The pending chip counts sets not yet synced and is
  `flag`, not an error — nothing is lost. It is the only offline indicator in the app (§7.4).

---

## 2. Exercise progress

Read seated. Four independently toggleable overlays are the reason the whole app is Instrument.

**Fits one viewport.** The Epley footnote is pinned at `bottom: 18px`.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 14px`, 12px gap | 30px back chevron (18px icon, `text/tertiary`), then `Bench Press` 12px/600/`0.1em` |
| Headline | `18px 16px 0`, `align-items: flex-end` | `ESTIMATED 1RM` section label over `110.0` 42px mono/500/`-0.03em`/0.9 + `kg` 14px mono `text/quaternary`. Right, bottom-aligned: `+11.3` 13px mono `done` over `OVER 12W` 9px `0.08em` `text/quaternary` |
| Span selector | `16px 16px 0`, 5 × 1fr, 5px gap, 44px | `4W · 12W · 6M · 1Y · ALL`. Active segment: `12W` |
| Chart | `20px 16px 0`, SVG 358 × 192 | See `docs/05` §5 |
| Secondary stats | `6px 16px 0`, 2 × 1fr, 8px gap | Two `12px`-padded cards, 1px `line/hairline`: `TOP SET` → `82.5` 20px mono + `× 10` 11px; `VOLUME LOAD` → `2,475` 20px mono + `kg` |
| Overlays | `20px 16px 0`, 9px gap | `OVERLAY` section label, then a 2 × 2 grid of 46px chips, 7px gap: `WEIGHT TREND` (on), `INTAKE`, `SLEEP`, `HRV` |
| Footnote | `bottom: 18px` | `e1RM from the best working set` / `Epley · w × (1 + r/30)` |

### States and rules

- **Primary series** is e1RM from the best working set of each session, per the decision log.
- **Overlays (S20, M3).** Four series, each independently toggleable, each with its own colour when
  on. Only the weight-trend series has a colour assigned (`flag` on `#1A1509`). **Intake, sleep and
  HRV have no colours** — three more series colours must be chosen and contrast-checked, and they
  must remain distinguishable from `accent` and from each other when two or three are on together.
  Not solved by this artboard.
- **Fewer than 2 sessions** (PRD empty states): no chart is drawn, message reads
  `Not enough data yet`. The headline, span selector and overlays have no defined empty treatment.
- **Data points are r=2.5.** If a point is tappable to reach that session, it needs a 44px target
  (`docs/05` §3.2).

---

## 3. Today's meal plan

**Longer than one viewport in reality.** The artboard shows five timeline entries plus the training
marker and ends flush; a real day with six meals plus adjustments will exceed 844. Scroll behaviour
is a gap — §7.3.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 13px` | `TUE 16 SEP`; right: `TRAINING 18:30` 10px mono `0.06em` `accent` |
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
  and it is the reason the evidence-tag component exists — §7.1.
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
| App bar | `18px 16px 13px` | `END OF DAY`; right: `TUE 16 SEP · 22:40` 10px mono `text/quaternary` |
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
- **Zero unconfirmed meals** has no artboard. The screen should not be reachable, or should state
  the day is complete and show the same "if confirmed" figures as a summary.

---

## 5. Prep plan + grocery

**Longer than one viewport in reality.** The artboard shows five cook rows and a five-item grocery
preview with `+ 4 more`; a real week has nine grocery items and may have more cook rows. §7.3.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 13px` | `WEEK OF 16 SEP`; right: `7 DAYS` 10px mono `text/quaternary` |
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
| Chart | `18px 16px 0`, SVG 358 × 186 | 30 raw weigh-in discs in `line/control`, 7-point smoothed `accent` trend, solid latest point |
| Legend | `4px 16px 0`, 18px gap | 14 × 2px `accent` swatch + `Smoothed trend`; 5px `line/control` dot + `Morning weigh-in` |
| Maintenance check | `20px 16px 0`, active card, `14px` padding, 13px gap | See below |
| Phase footer | `bottom: 18px` | `CUT` 10px `0.08em` `text/quaternary` + `target −0.5%/wk` 10px mono `text/quaternary`; right: `week 6` |

### Maintenance check card (S18a)

| Row | Spec |
| --- | --- |
| Header | `MAINTENANCE CHECK` 10px `0.12em` `accent`; right: `14 COMPLETE DAYS` 10px mono `text/quaternary` |
| Figures | `1fr 1fr`, 14px gap: `AVG INTAKE` → `2,450` 22px mono + `kcal`; `TREND CHANGE` → `−0.1` 22px mono + `kg/wk` |
| Divider | 1px `line/hairline` |
| Result | `Implied maintenance` 11px `text/secondary`; right: `≈ 2,500` 24px mono/500 in `accent` + `kcal` |
| Caveat | `Read-only. Your targets are unchanged until you apply this.` 10px/1.55 `text/quaternary` |
| Action | `APPLY TO TARGETS` 52px primary |

### States and rules

- **Read-only until applied**, per the decision log. The caveat sits directly above the action, and
  the `≈` on the result is part of the number, not decoration.
- **14 complete days is the gate.** The card should not appear below that count; the PRD says the
  provisional formula estimate is used instead and labelled as such. That state has no artboard.
- **Fewer than 3 days of weight data** (PRD): raw points only, no trend line. The legend's first
  entry and the headline rate both need a treatment for that case.
- **First morning reading before 10:00 counts** (PRD edge case). Later readings are stored but are
  not plotted as trend inputs. Whether they appear as discs at all is undecided.

---

## 7. Gaps carried out of Phase 2

Four things were left undesigned deliberately. They are specified here as far as the extracted
system allows, and marked where a decision is still needed.

### 7.1 The evidence tag — one component, three strengths, a route to the source

Screen 3 draws one state. S23 (plateau protocols) needs the same component with strong, moderate and
contested, plus a way to reach the evidence. Specifying it once, for both uses:

**Anatomy, as drawn (moderate).** 1px border, radius 2, padding `2px 6px`, containing a 9px mono
claim, a 1px × 9px divider in the border colour, and an 8px sans strength label at `0.06em` (9px from 2026-09-22).

**Proposed extension.** Keep the anatomy; vary only the colour pair by strength, and add a third
slot for the source route.

| Strength | Claim + border | Strength label | Meaning |
| --- | --- | --- | --- |
| Strong | `done` `#57C99A` / `line/done` `#2E4A40` | `done` at reduced weight | Multiple controlled trials or a meta-analysis agree |
| Moderate | `flag` `#E0A83C` / `line/flag` `#4A3A1C` | `flag/dim` `#947B45` | Mixed or limited evidence — **as drawn on screen 3** |
| Contested | **needs a colour** / **needs a border** | — | Commonly believed, not supported |

**Three decisions this still needs.**
1. **A contested colour.** The palette has no fourth accent. Contested is not an error, so it does
   not reuse `error` (`docs/05` §1.4). A neutral treatment —
   `text/tertiary` on `line/field` — is the option that needs no new token, and it reads as "noted,
   not endorsed", which is the correct meaning.
2. **The route to the source.** The tag as drawn is 13px tall and has no touch target. For S23 it
   must be tappable to a citation. Options: make the whole tag a 44px control where it is the
   subject of the row (S23) while keeping the inline 13px form non-interactive where it annotates
   something else (S16); or always make it 44px and accept the extra row height on screen 3. The
   first preserves screen 3; prefer it unless the citation must be reachable from the meal plan too.
3. ~~**The 8px strength label fails AA.**~~ Resolved 2026-09-22: 9px in `flag/dim` `#947B45`,
   4.80:1 (`docs/05` §1.5).

### 7.2 Expanded warm-up sets

Screen 1 collapses warm-ups to a 37px summary row to buy vertical space, and the screen's ~66px of
slack depends on it. Expanding is undesigned.

What is known: warm-up sets are logged (S6), they use the same set-table grammar, and the summary row
already carries the check and the `40 × 10 · 60 × 6` string. Two warm-up rows in the existing table
form cost about 126px, which does not fit above the active card without pushing `UP NEXT` off.

**Decisions needed:** whether expanding scrolls the screen, replaces the active card temporarily, or
opens a sheet; and whether warm-up rows use the same 17px figures as working sets or a reduced size
that signals they are not progression data.

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

### 7.4 Offline pending count on the other five screens

The pending chip exists only on screen 1. Sets sync offline-first (S1), so the count is meaningful
anywhere in the app, and a user who leaves the session screen currently loses the only evidence that
unsynced data exists.

What is known: the chip is `7px 9px`, `line/field`, a 6px `flag` dot and a 10px mono label, and it
sits in the app bar's right slot. On screens 2–6 that slot is already occupied — by metadata (2, 4,
5), an accent string (3), or the sync indicator (6).

**Decisions needed:** whether the chip appears on every screen (requiring the right slot to hold two
items, or the displaced metadata to move), only where it is relevant, or only when the count is
non-zero. Screen 6's `SYNCED 06:41` indicator is the closest existing relative and suggests a single
shared "data state" slot that shows whichever condition is true — that is the option worth trying
first, and it needs one design pass, not a decision in the build.

---

## 8. Not covered by any artboard

Flagged so they are not discovered mid-build. None of these are gaps in the six screens; they are
screens and states the PRD requires that Phase 2 did not draw.

- **Session start and routine selection** (S4), including the no-routines empty state.
- **Exercise library and picker** (S8).
- **Food list management** (S12) and manual label entry.
- **Goal phase and macro target setup** (S14), routine and meal count (S15).
- **The grocery list proper** (S17) — only a preview card exists.
- **Invite administration and revoked access** (S9), export and delete (S10).
- **Health connection setup and the health dashboard** (S19, S24).
- **Photo and text meal estimation** (S22) and its confirm-before-save step.
- **Plateau protocols** (S23) beyond the evidence tag itself.
- **Every error and failure state.** The colour exists since 2026-09-22 (`error`, `docs/05` §1.4), but
  no artboard shows a failed save, a refused sync, or revoked access.
