# 10 — Screen Specifications

**Direction:** Instrument. Tokens and components are defined in `docs/05-design-system.md`; this
document does not restate them.
**Extracted from:** the six `.dc.html` artboards in `design/`, 2026-09-16. Updated 2026-09-22 from the
scoped design pass (review 2b), which also added seven state artboards (table below).

Each artboard is 390 × 844 and static. Screen 1's built scroll behavior is recorded in §7.3;
the reviewed workout prototype is in `docs/prototype/`. Screens 3 to 6 were redrawn, and every M2
screen no artboard drew was drawn, in the M2 prototype, approved 2026-10-16 (`docs/prototype/m2/`,
`06`). For those screens the prototype supersedes the artboards below.

| # | Screen | Artboard | PRD stories | Milestone |
| --- | --- | --- | --- | --- |
| 1 | Live workout | `Main.dc.html` | S1, S2, S3, S5, S6 | M1 |
| 2 | Exercise progress | `Progress.dc.html` | S7, S20 | M1 / M3 |
| 3 | Today, the whole day (was: today's meal plan) | `MealPlan.dc.html`, superseded by `docs/prototype/m2/` | S16, S18 | M2 |
| 4 | End-of-day check | `EndOfDay.dc.html`, superseded | S18 | M2 |
| 5 | The Food tab: prep, grocery, batches | `PrepList.dc.html`, superseded | S13, S17 | M2 |
| 6 | Weight, in Progress | `WeightTrend.dc.html`, superseded | S11, S18a | M2 |

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

**Scrolling.** The 2026-09-22 artboard fit one viewport. The built screen scrolls when an exercise
outgrows it (§7.3), including with the last-time and target block added on 2026-10-10. The rest bar
stays fixed at the bottom.

### Structure

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | `18px 16px 14px`, bottom `line/hairline` | Left: routine name (`PUSH A`) 11px/600/`0.12em` over elapsed time 11px mono `text/quaternary`, 3px gap. Right: the data-state slot, drawn in its pending form |
| Exercise header | `15px 16px 9px`, baseline-aligned row | `Bench Press` 15px/600/`0.06em` uppercase; right: `1 OF 5` 10px mono `text/quaternary`, the exercise's place in the workout. The artboard draws `6–10 · +2.5` there; the target line says both since 2026-10-10 |
| **Last time and target** | Inset 16px, 1px `line/hairline`, two rows (`05` §4.19). 8px above the warm-up summary | `LAST TIME`, its date and `80 kg × 10 · 10 · 10 · 9`; then `TODAY'S TARGET`, a `SAME WEIGHT` or `+2.5 KG` tag, `80 kg × 6–10` and the reason as a sentence. See *Last time and today's target*, below |
| Warm-up summary | Inset 16px, 44px tall, `0 11px`, 1px `line/hairline`. The whole row is the target that expands it (§7.2) | 13px `done` check, `2 WARM-UP SETS` 11px `text/quaternary`; right: `40 × 10 · 60 × 6` 11px mono `text/quaternary` |
| Column heads | `16px 16px 7px`, then 1px `line/hairline` inset | `SET · LAST · KG · REPS · RIR` 9px/`0.1em` `text/quaternary`; sixth column unlabelled |
| Completed set rows | `9px 16px`, `line/row` bottom | Set no. 13px mono `text/tertiary`; last time 11px mono `text/quaternary`; kg and reps 17px mono/500 `text/primary`; RIR 13px mono `text/tertiary`; done check cell 46 × 44 |
| **Active set card** | `14px 16px 0`, 1px `line/accent` + 2px `accent` left edge, `surface/active`, `14px 14px 16px`, 13px gap | See below |
| Up next | `18px 16px 0`, 8px gap | `UP NEXT` section label; then rows at `13px 12px`, 1px `line/hairline`: name 12px `text/secondary`/`0.03em`, target 11px mono `text/quaternary` |
| Rest bar | Fixed `bottom: 0`, over the safe-area inset, for the whole workout | With no rest counting: `REST TIMER` over `Starts by itself after each set: 3:00`, and `FULL SCREEN`. Counting: 2px track, `REST · NEXT: SET 3 OF 4`, 42px mono timer, `FULL SCREEN`, `+30s` and `SKIP`. At zero: `REST OVER`, `+0:12` counting up in `accent`, `FULL SCREEN` and `DISMISS` (`05` §4.14) |

### Active set card

| Row | Spec |
| --- | --- |
| Label row | `SET 3 OF 4` 10px `0.12em` `accent` (the artboard draws `SET 3`; see *Target*, below); right: `LAST TIME` 9px `text/quaternary` + `80 × 10` 12px mono `text/tertiary`, 7px gap: the same set last time |
| Figures | Grid `1fr 88px 62px`, 8px gap, `align-items: end`. Each column: 9px `0.1em` `text/quaternary` label, 6px gap, then a 56px mono/500/`-0.03em`/0.86 figure |
| Actions | 8px gap. `WARM` 52 × 64 secondary; `COMPLETE SET` flex-grow × 64 primary with a 22px check and 11px gap |

**Figure states.** Entered values are `text/primary`. Unentered are the same 56px in `text/placeholder`
(`docs/05` §1.3) — an empty figure shows `—`. The card opens with the figures it has a source for already
entered (*What the card opens on*), so the tone appears after a clear, or where there was nothing to
carry over: RIR with none recorded or a weight that goes up, weight with no suggestion. The
completion control is enabled regardless; a missing weight or reps is refused on the tap.

### States and rules

- **Suggestion source (S3).** Double progression. A suggestion always shows once the exercise has a
  last time: plus the increment if every working set reached the top of the rep range, otherwise the
  same weight. The reason always says which, in plain words.
- **Last time and today's target, decided 2026-10-10** (`06`; reference `docs/prototype/`). Each
  exercise opens with the two-row block of `05` §4.19, in place of the `SUGGESTED` chip the card
  carried and the coded range in the header. The suggestion is labelled `TODAY'S TARGET` on screen
  only (`CONTEXT.md`). The target weight and its rule are the API's; the screen words them:
  A bodyweight lift shows the counted load and which weigh-in supplied it, or says there was no
  weigh-in. The displayed Last time count can follow a newer cached weigh-in offline (`06`,
  2026-10-18). The target and entered weight still use the logged added load.
  - Weight up: `You reached 10 reps on every set last time, so the weight goes up by 2.5 kg. Aim
    for 6 or more.` The step named is the one the suggestion took, so a dumbbell that goes 30 to 32
    says 2 kg.
  - Same weight: `1 set of 4 stopped short of 10 reps last time. Reach 10 on all 4 and next time
    goes up to 82.5 kg.` (`All 4 sets` when none reached it.) The next weight is named only where
    the equipment makes every step its increment adds; for a dumbbell the sentence ends `and next
    time the weight goes up`, since which weight the rack makes is the API's to say.
  - With one set last time the sentences say `your only set` and `Your set`. Where the rep range has
    changed since and the count no longer fits the rule, the API's own reason is shown as a sentence.
  - The block is read, not tapped. Past sets are under the exercise's chart (§2), reached from the
    exercise screen and a workout's page (§9).
- **First time doing an exercise (S2, PRD empty states).** The block says so in words: `LAST TIME`
  reads `None yet`, with `This is your first time logging Bench Press, so there is nothing to
  compare with.` `TODAY'S TARGET` reads `Find your weight × 6–10`, tagged `FIRST WORKOUT`, with
  `Pick a weight you can lift for 6–10 reps with one to three left in you. From the next workout,
  this line shows what you did and what to aim for.` (`Bodyweight × 6–10` and `Do 6–10 reps…` for a
  bodyweight exercise.) No LAST column value; the card's label row reads `FIRST WORKOUT`.
- **Unknown last time.** If cached data was unavailable when the exercise joined the workout, or an
  older saved workout has no history flag, the block shows only `Last time could not be loaded.` It
  makes no claim about the connection or whether this is the first workout; no first-workout tag appears.
- **Target (S4), decided 2026-10-03** (`06`). The label counts working sets against
  `target_sets`: `SET 3 OF 4`, then `SET 5 · EXTRA` past the target, and `SET 3` with no target.
  With the warm-up toggle on it reads `WARM-UP`, and a warm-up never moves the count.
- **Set completion** collapses the card to a 17px table row and promotes the next set to active. The
  rest timer starts on completion. The new card comes into view and takes focus (§7.3). The set
  that reaches the target opens the next exercise with sets left; an extra set stays where it is.
- **What the card opens on.** The weight is the last set logged today, else the suggestion, else
  empty (`0` for a bodyweight exercise). Reps and RIR open as real values, on the assumption that the
  set is done again (`06`, 2026-10-10): the previous working set's today. The first set takes last
  time's reps and RIR when the weight repeats, and the bottom of the range with no RIR when it goes
  up. The user edits or clears them; reps cleared are refused, RIR cleared is none. A warm-up is not
  that set again: with the `WARM` toggle on, reps and RIR the user has not typed are empty, and they
  come back when it is turned off. Nothing typed is ever replaced.
- **RIR explained, 2026-10-10.** Under the figures, 12px `text/tertiary`: `RIR is reps in reserve: how
  many more reps you could have done. Optional.` and a `How to gauge it` toggle (`accent`, 44px
  target, `aria-expanded`). It opens a bordered guide in the card, so the workout is never left: `0`
  could not do another, `1–2` hard, `3+` comfortable, and that an empty RIR still counts the set.
- **A figure the server would refuse** is refused on the card before anything is written: `Refused`
  and the reason under the figures, focus on the figure at fault. Reps 1–100, RIR 0–10, weight 0 to
  9999.99 kg. The refused *row* below is for what the server turns away.
- **Rest over, decided 2026-10-03** (`06`). A short tone at zero, and the bar counts over until
  `DISMISS` or the next set. The screen is kept awake while rest counts, where the browser allows,
  and for the whole workout while full screen is on (below). A rest setting of 0 seconds starts no
  rest or tone.
- **The rest bar is always there, decided 2026-10-10** (`06`). From the start of the workout, before
  any set, it says the timer starts by itself and how long the open exercise rests; it returns to
  that after `SKIP` or `DISMISS`. While counting, its label names the set that comes next.
- **Full screen, decided 2026-10-12** (`06`; reference `docs/prototype/`, `05` §4.22). `FULL
  SCREEN` on the rest bar switches the screen to a second layout with one exercise and one set on
  it; `EXIT FULL SCREEN`, in its bar, switches back. It is the app's own mode and is called that:
  "Focus" is Apple's (`CONTEXT.md`).
  - **What it holds.** The workout's name and elapsed time; the exercise's name over `EXERCISE 1
    OF 5 · 2 OF 4 SETS DONE` (`2 SETS DONE` with no target); the last-time block in its compact
    form; the active set card, unchanged; and at the foot the row to the iPhone Focus guide (§8.3).
  - **What it leaves out.** The data-state slot, the warm-up summary, the sets table, `UP NEXT`,
    `DONE`, `Finish workout` and the rest bar. They are hidden, not discarded: a set half typed,
    an open RIR guide and a refused set being edited are as they were on leaving. A set that
    reaches the target still opens the next exercise with sets left.
  - **Rest.** A rest takes the place of the block and the card: `REST` over the countdown at 56px,
    the track, `+30S` and `SKIP REST`; under it `NEXT · SET 3 OF 4` with the set as the card holds
    it, `80 kg × 10`, and the same set last time. At zero it reads `REST OVER`, counts up in
    `accent`, the tone plays as it does on the bar, and one control, `START SET 3 OF 4`, brings
    the card back. An exercise with no rest goes straight to the next card.
  - **Awake.** While it is on, the screen is kept awake for the whole workout, not only during
    rest, where the browser allows (`03` §11).
  - **Not remembered.** It is turned on by hand in each workout. A relaunch, and the next workout,
    open in the usual layout.
  - **Focus and scroll.** Each switch starts the screen from its top and moves focus to the
    control that switches back. A set completed in full screen moves focus to the rest; the rest
    ending moves it to the card.
  - **Width.** Drawn at 390px. The bar's three controls and a `10:00` countdown fit from 375px.
- **Weights in pounds.** With the profile's unit set to `lb`, every weight on the screen is shown
  and typed in pounds, to the tenth; the column head and the weight label read `LB`.
- **The other exercises.** `UP NEXT` lists the exercises with sets left, then `DONE` the ones at
  their target, as `3 / 3 × 6–10`. A row opens that exercise, in any order.
- **Changing the exercises, as built 2026-10-17** (`06`; `09` F3 step 4, S4). No artboard draws
  it; it is built from `05`'s tokens and §8.1's parts and passes the polish gate. A `CHANGE
  EXERCISES` section label under `UP NEXT` and `DONE`, then two buttons side by side: a secondary
  `Add exercises` (primary, and alone, while the workout has none) and a tertiary `Reorder or
  remove` with `aria-expanded`. Full screen hides the section.
  - `Add exercises` opens §8.1's picker over the workout, its back reading `Back to the workout`.
    The workout stays mounted under it, hidden as under the guide, so a set half typed and a rest
    counting are kept. Ticked exercises join the end of the workout in the order ticked, and focus
    comes back to `Add exercises`. `New exercise` opens the exercise form as in the routine editor.
  - `Reorder or remove` opens the routine editor's slot list in place, without figures: the number,
    the name (`· Open` on the exercise on screen), `Remove`; under them `2 SETS LOGGED` or `NO SETS
    YET` and the move up and move down buttons, `aria-disabled` at the ends so focus stays on the
    button that moved. Removing an exercise with no set is immediate and moves focus to the row now
    in its place. With sets, `Remove` becomes the question in place (§8.1's delete pattern):
    `Remove Bench Press? Its 3 logged sets go with it.` — `Keep` / `Remove`, focus on `Keep`.
  - The exercise on screen stays on screen through a reorder; removing it opens the first. A rest
    counted from a removed set stops. None of it changes the routine.
  - An empty workout reads `No exercises yet. Add them as you go: each one opens with last time
    and today's target.` in place of the exercise, over the rest bar's `Starts by itself after
    each set.`
- **Finish.** A tertiary `Finish workout` under the lists, which becomes the question in place
  (`Finish Push A? 9 sets logged.` — `Keep going` / `Finish`), the delete pattern of §8.1. With no
  set logged it says nothing is kept (`09` F3). Finishing opens the workout's page in History
  (§9), which is its summary; with nothing kept it opens Today.
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
- **Correcting a logged set, as built 2026-10-11** (`06`; `09` F3 step 4). A completed row's check
  cell is a button, named `Set 2 done. Edit` with `aria-expanded`. It opens the set editor (§9,
  `05` §4.20) in a row of its own under the set, indented to the LAST column: weight, reps and RIR
  over `Cancel` and `Save set`, with `Delete set` under them. One editor is open at a time. Saving
  or deleting returns focus to the tick, or to the exercise's name when the set has gone, and the
  active card is made again from the corrected set without taking the screen. A warm-up is
  corrected from History, where it is a row (§9).

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
- **A bodyweight exercise counts the lifter's weight** (#69, `06` 2026-10-17). Under the
  headline's e1RM, `Counted at 82 kg · your weigh-in of 10 Sep` in 10px mono (`text/quaternary`)
  for the latest workout, or the picked one; `that day’s weigh-in` when the workout's own day was
  weighed, `your first weigh-in, 12 Nov` for a workout older than the first, and `No weigh-in ·
  counted as logged` with none at all. Each past-sets row says it again under its sets, and the
  sets, top set and volume are of the counted load.

**As built, 2026-10-10** (slice 5, `06`), with what the artboard does not draw:

- **The way in** is a `Progress` row above the form on the exercise's screen (§8.1), at
  `/exercises/{id}/progress`, and since 2026-10-11 an exercise's name on a workout's page in
  History (§9). Back returns to whichever it was opened from, and to the exercise's screen when
  opened by its address. The span is in the address (`?span=6m`).
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
- **Past sets, 2026-10-11** (`06`), in place of the `Workouts in this span` disclosure. Under the
  cards, 22px down: a section label, `PAST SETS · 12 WORKOUTS`, then one row for each workout the
  chart draws, newest first, between a `line/hairline` top and `line/row` dividers. A row is
  at least 56px, `9px 16px`: `FRI 9 OCT · PUSH A` in 10px mono `text/quaternary` over the working
  sets in 13px mono/500 `text/primary`, `80 × 10 · 10 · 9` at one weight and `80×10 · 82.5×8`
  where the weight changed; on the right, across both lines, that workout's e1RM in 13px mono/500
  `text/tertiary` over `E1RM` in 9px `text/quaternary`. The row is a link to that workout in
  History (§9). With no workout in the span it reads `No sets logged in this span.`
- **Another span loading** keeps the last one at half opacity. The chart's place is kept by the
  empty state, `Not enough data yet` over one sentence, so the cards do not move.
- **Overlays** are not drawn in M1: no `OVERLAY` block and no chips.
- **Footnote.** A normal bottom block: the screen is at least one viewport tall and grows with
  the list.
- **Pounds.** Every weight is shown in the profile's unit, e1RM to the tenth and volume whole.
- **Without a profile** the screen says to save one on Today, as local dates need the time zone.

---

## 3. Today, the whole day (was: today's meal plan)

**Approved 2026-10-16** (`06`). Today became the whole day (Q7 of 2026-10-16), and the screen was
redrawn after the 2026-10-09 readability review in the M2 prototype (`docs/prototype/m2/`, its
screens 01 to 08). The prototype is the reference for layout, wording, order and sizes; the artboard
`MealPlan.dc.html` is superseded. What the redraw changed: totals and macros say in words where the
day stands, a meal lists its foods as rows, and every action is a word.

### Structure

| Block | Content |
| --- | --- |
| App bar | `TODAY` over `FRI 16 OCT · TRAINING DAY` (or `REST DAY`); right: the data-state slot. Sticks (§7.3) |
| Tabs | Five: `Today`, `Food`, `Progress`, `Routines`, `Exercises` (Q1 of the M2 review). `Food` is new |
| Day totals | `2,331` 26px mono/500 + `of 2,350 kcal planned` 13px; right: `−0.8%` in a 1px `line/done` box (`flag` beyond ±5%). Under it `Eaten so far: 521 kcal, 41 g protein`. Then four macro meters: label (`Protein`, `Carbs`, `Fat`, `Fiber`), `183 / 181` 13px mono, the 3px meter, and a word: `on target` (within 2 g), `24 g over` or `12 g to go`, uncoloured. Sticks under the app bar (§7.3) |
| End-of-day card | From 60 minutes before bedtime, or the next morning for yesterday (`09` F11): `2` 26px mono in `flag`, `2 meals not confirmed yet` (or `Yesterday: 2 meals not confirmed`) and a line of context, on `surface/flag` with `line/flag`. Opens screen 4. Shown only while a meal is unconfirmed and the date was not left incomplete |
| The day | `THE DAY` label, then the timeline (`05` §4.11, its time at 12px mono/500): each meal, and on a training day the workout at its training time |
| Other workouts | `OR START ANOTHER WORKOUT` (rest day: `REST DAY. START A WORKOUT ANYWAY`): §8.2's start rows for the other routines |
| Your plan | Two link rows: `Cut since 4 Sep · week 7` over `2,350 kcal, provisional · 181 g protein` (opens the goal phase, §8.6), and `Your day` over the meal counts (opens your day, §8.6). Q18 |

### Timeline entries

| Entry | Drawn as |
| --- | --- |
| A planned meal | A button card, `line/hairline`: the meal's name 15px, `467 kcal · 29 g protein` 12px mono `text/tertiary` on the right; the foods as rows, name 12px `text/tertiary` with `cooked` (and `approx.` without a batch), or `raw, no cooked match`, in `text/quaternary`, grams 12px mono. Tapping it opens it (Q6). A meal with more carbs for training carries the evidence tag `MORE CARBS · MODERATE` on its own row under the card, so the tag is never inside the card's button |
| The next meal due | Open, as `05` §4.5's active card: name 15px, then the macro line and the tag, then the foods at 13px with grams 13px mono/500 `text/primary`, then the actions |
| A confirmed meal | One row: name 15px `text/secondary` and, in `done` with the check, `Eaten as planned`, `Eaten, adjusted`, `Replaced` or `Skipped`. Opened, it says `Confirmed. Changing it replaces this, never adds to it.` over `Adjust` / `Replaced` / `Undo` |
| The workout | A 9px `accent` square on the rail; a card with a 2px `accent` left edge: `WORKOUT` 10px `0.12em` `accent`, the routine's name 15px, `5 exercises · 17 sets · last done Mon 12 Oct`, and a 44px primary `Start` (Q5) |

Meals are named by their place in the day: `Breakfast`, `Lunch`, `Before training`, `After training`,
`Evening`; a rest day's are `Breakfast`, `Lunch`, `Afternoon`, `Dinner` (Q19).

### Actions (S18)

Four, on any meal (Q6, Q7): `Eaten as planned`, a 48px primary with the check, then `Adjust`,
`Replaced` (with the swap icon) and `Skipped` as three equal secondaries. `Skipped` counts nothing for
the meal and still lets the day be complete.

- **Adjust** (its own screen, back to Today): one row per food, its name 15px over `cooked weight`,
  `whole pieces` or `as weighed`, and a stepper (`−` / the amount 17px mono / `+`, 44px buttons) in
  5 g steps or whole pieces. A food in a rotation group offers the others in it as swap chips. A
  box shows the meal `578 → 593 kcal` and protein before and after. `Save as eaten, adjusted`, a
  tertiary `Cancel`. Taking a food to 0 g is refused in place (`notice--error`, `REFUSED` and the
  reason) and the meal stays as planned (`09` F11, a 422 on adjust).
- **Replaced** (its own screen): `From my foods` / `By hand` segments. From the list: a search and
  rows with `ADD 100 G`, the picked foods under `EATEN INSTEAD` with `Remove`. By hand: what it was,
  and calories, protein, carbs and fat. One line says photo and text estimates arrive in M3.
  `Save as replaced`.

### States and rules

- **The plan is the log (S18).** A meal is confirmed, never typed; an unconfirmed meal never counts.
- **The macro meters cap at 100% and say the rest in words** (Q8). An over-target macro is not
  coloured.
- **The tag's 44px hit area** (§7.1) sits on its own row under a closed card and inside an open one,
  so it never shares a target with the card.
- **First run** (`09` F10): the first missing step is Today's empty state, `STEP 1 OF 4 · YOUR MEAL
  PLAN` in `accent` mono over the step's title, one sentence and its primary (`Add your details`,
  `Add a food`, `Set your goal`, `Set your day`), then the four steps listed with a check for each one
  done. Starting a workout stays under it, as `START A WORKOUT`.
- **While the plan is made:** skeleton blocks in `line/hairline` for the totals and four entries, and
  `Making today's plan from your foods…`. The skeleton pulses only without reduced motion.
- **Shortfall** (PRD edge case): a `notice--flag` under the totals, `PROTEIN 22 G SHORT`, a sentence
  saying the foods cannot reach the target without going over calories and that nothing else was
  padded, and a secondary `Add a protein source`. The meter says `22 g to go`.
- **Calorie gap after a capped portion** (PRD edge case): a `notice--flag` under the totals says
  calories remain short because a portion reached its sensible maximum; the plan leaves the gap
  visible. The sample portions, meal cards, day total and end-of-day preview use the same capped
  plan. Reachable in the prototype's Today screen map.
- **Offline** (`09` F11): the slot reads `OFFLINE · FROM 07:12`; a `notice--flag` says the plan is
  as it was at that time and confirming waits for a connection. The actions are disabled, with one
  line under them saying nothing is lost.
- **Food list empty** opens the first-run step `Your foods`. A plan day older than 7 days is
  read-only: the same cards without actions (`09` F11).
- **As built in M2 slice 4** (`#79`, `06` 2026-10-18), at `/`, checked at 390px in both themes on
  invented foods:
  - The setup steps are `About you`, `Your foods`, `Goal phase` and `Your day`, in that order;
    `About you` is done with height, sex, birth date and a weigh-in, and `Your day` once every day
    type the training weekdays need is saved. A save on one of them returns to Today, which says
    `Saved.` while a step is left and `Saved. The week’s plan is made again from it.` once none is.
  - Once set up, Today reads today through today + 6 and generates any day missing, once. Before
    the day type's wake time, today is still the day before, so a night past midnight stays on the
    day it belongs to. It
    failing says `No plan yet`: `Couldn’t make today’s plan. Try again when you have signal.`
  - Meal cards are not buttons, and there are no actions, until confirming arrives (`#80`). The meal
    due is open: the first no more than an hour past its time.
  - The totals stick at the top of the scroll, below the status bar, since Today's app bar does not
    stick; what takes focus comes to rest below them. The setup screens' app bars stick (§7.3). `Fiber` shows
    its total with `no target`.
  - The workout entry is the day's routine, the one done longest ago, with `Start`; once started it
    reads `In progress` with `Resume` (and the `In progress` section above the day is left out), once finished `Done`, and with no routine `No routine yet`
    with `Create`. The start list leaves the day's routine out.
  - Shortfalls: `PROTEIN 22 G SHORT` as drawn, and an energy gap as `CALORIES 140 SHORT` with the
    capped-portion sentence, or one that the foods cannot fill the day, with `Add a food`.
  - An `approx.` item adds a footnote under the timeline: the food table's cooked values are used
    because no batch has been weighed yet, and weighing one makes it exact.
  - A `raw, no cooked match` item adds its own footnote: a batch-cooked food the food table has no
    cooked values for is planned at its raw weight, and weighing a batch gives it cooked amounts
    (`06`, 2026-10-18).

---

## 4. End-of-day check

**Approved 2026-10-16** (`06`), redrawn in the M2 prototype (`docs/prototype/m2/`, screens 09 and
10). Read once, late, on a phone, with the intent of tapping one button. Reached from the
end-of-day card on Today (§3).

### Structure

| Block | Content |
| --- | --- |
| App bar | Back chevron, `END OF DAY` over `FRI 16 OCT · 22:05` (or `· YESTERDAY`); right: the data-state slot |
| Headline | `2` 38px mono/500/`-0.02em`/0.9 in `flag` + `meals are not confirmed` 15px |
| Consequence | `notice--flag` with the info icon: `If you leave them, the day is incomplete (the word in flag): it stays out of the maintenance check, and nothing is counted as eaten.` |
| Not confirmed | `NOT CONFIRMED` label, then a card per meal (`line/border`, 12px padding): time 12px mono, name 15px, kcal 12px mono on the right; the foods as rows at 12px; four secondaries, `As planned` (with the check), `Adjust`, `Replaced`, `Skipped` |
| If you confirm them all | `line/hairline` box: `2,331 / 2,350` `kcal eaten` and `183 / 181` `g protein` at 19px mono over 11px labels; a hairline; `Complete days this phase` with `30 → 31` |
| Actions | Pinned to the foot over a `line/hairline` top edge on `surface/ground` (§7.3): `Confirm all as planned`, 60px primary with a 20px check; `Leave day incomplete`, 46px tertiary |

### States and rules

- **The whole screen is a preview.** Nothing is written until an action is tapped.
- **Per-meal actions are all secondary** here, because the screen has one primary.
- **Leaving the day incomplete is a real choice**, at equal width in tertiary weight, and asked once
  (`09` F11). Back on Today a confirmation line says it won't ask again.
- **Confirming the last meal one by one** turns the screen into its done state: `Every meal is
  confirmed`, the day counted towards the maintenance check, and `Back to Today`.
- **Zero unconfirmed meals** is never reached from a card (decided 2026-09-22, `09` F11).

---

## 5. The Food tab: prep plan, grocery list, batches

**Approved 2026-10-16** (`06`), redrawn in the M2 prototype (`docs/prototype/m2/`, screens 11 to
14). The Food tab (Q7) holds four sections as `05` §4.8's segments under the tabs: `Prep`, `Grocery`,
`Foods`, `Batches`, opening on `Prep` (Q3). `Foods` is §8.6.

**As built in M2 slice 3** (`#78`, `06` 2026-10-17): the Food tab is the fifth tab, at `/food`, and
holds `Foods` only. With one section the segments are not drawn; they come with Prep and Grocery
(`#81`), and the tab opens on `Prep` then. Five tabs fit 390px with the tabs' tracking at 0.04em.

### Prep (S17, Q8)

| Block | Content |
| --- | --- |
| App bar | `FOOD` over `PREP FOR THE WEEK OF 19 OCT`; right: the data-state slot |
| Lede | 13px: raw grams to cook, from next week's plan and each food's last weighed batch; shop and cook by the raw figure |
| A cook day | One section per cook day (Q10). Its head sticks under the app bar while its rows pass (§7.3): `Sunday 18 Oct` 15px over `FIRST COOK DAY` (or `SECOND COOK DAY`) 10px `accent`, and the column heads `RAW · COOKED`. Then one 11px line on what it covers, `Covers Monday to Wednesday.`, and on the second day why it exists: `Chicken keeps 4 days, so Sunday's batch runs out after Wednesday.` |
| Cook row | Grid `1fr 70px 56px 44px`: the food 15px over the yield note 11px and `For Mon 19 to Wed 21` 10px mono; raw 17px mono/500 with `g`; cooked 13px mono `text/quaternary` (`≈ 644` without a batch); the 44 × 44 check cell |
| Not batch-cooked | A section saying which foods are cooked on the day by the meal's grams, and which days use another food from the group because a batch would not keep (rice keeps 3 days, so Wednesday and Sunday use potato) |
| Grocery link | Link row `Grocery list` over `13 items, raw weight, both cook days summed` |
| Footnote | `Next week's plan, made Fri 16 Oct` / `7 days · 2 cook days` (`05` §4.15, as a normal block) |

**The yield note** is a sentence, one of four: `Yield 75% from your batch of 11 Oct. Keeps 4 days.`;
the same over a week old, in `flag`, ending `Weigh this week's batch.` (`09` F12); with no batch,
in `flag`, `No batch weighed yet, so cooked amounts are approximate (MEXT's boiled values).`; or a
rotation rule. **Ticking a row** marks it cooked and opens `Record a batch` with that cook's raw
grams filled in (Q12). Untick undoes it.

### Grocery (S17)

`FOOD` over `GROCERY FOR THE WEEK OF 19 OCT`. A count line, `13 of 13 left to buy` (the figure
17px mono) with `RAW WEIGHT` on the right. Two sections, `FOR THE COOK DAYS` and `FOR THE WEEK`. Each
item is one 60px button row: the 44 × 44 check cell, the food 15px over its note 10px mono (`1,400 +
1,850 for two cooks`, `for the first cook`, `for the week`), and the quantity 17px mono/500, in `g`
or `pieces`. A ticked row is `text/quaternary` and struck through. `Clear the ticks` appears once one
is ticked. One list for the week (Q11); the ticks are kept on the phone only. Footnote: `Ticks stay
on this phone` / `13 items`.

### Batches (S13)

`FOOD` over `BATCHES`. A lede saying what a batch is and that the newest is the one in use, then a
primary `Record a batch`. A section per batch-cooked food, `CHICKEN BREAST, SKINLESS · KEEPS 4 DAYS`,
with the flag line when its newest batch is over a week old or missing, and one row per batch,
newest first: the food 13px with `CURRENT` (9px in a `line/accent` box) on the newest, `Sunday 11 Oct
· 1,400 g raw → 1,050 g cooked` 11px mono, and the yield 15px mono on the right.

**Record a batch** (its own screen, `RECORD A BATCH` over `WEIGHED AFTER COOKING` or `FROM THE PREP
PLAN`): the food (a select of batch-cooked foods), `Cooked on` (a date, today by default), `Raw
weight` and `Cooked weight` side by side, a yield box (`75%` 26px mono and `100 g cooked counts as
133 g raw. Plans made from now on use it; past ones keep theirs.`), and `Keeps for … days` with the
note `EVERY BATCH OF THIS FOOD` and a line on what it does to the plan. `Save batch`. Either weight
at 0 is refused under the cooked field; cooked above raw is accepted (`09` F12).

---

## 6. Weight, a section of Progress

**Approved 2026-10-16** (`06`), redrawn in the M2 prototype (`docs/prototype/m2/`, screens 27 to
32). Weight is the fourth section of Progress, after History, Strength and Balance (Q4; §9).

### Structure

| Block | Content |
| --- | --- |
| App bar | `PROGRESS` over `WEIGHT`; right: the data-state slot |
| Sections | The tabs, then §9's sections with a fourth, `Weight` |
| Headline | `TREND` label over `82.7` 42px mono + `kg`. Right: `−0.29 kg` 15px mono in `done` over `in the last week` |
| Span | Two segments, `30 DAYS` and `SINCE 4 SEP` (the phase's start) (Q16) |
| Chart | SVG 358 × 186: daily weights as discs in `line/control`, a weight that was not a morning weigh-in as a 1.5px ring, the trend in `accent` at 2px with its latest point solid; kg on the left edge, three dates along the foot |
| Legend | `Trend`; `Morning weigh-in`; when a ring is in view, `Not a morning weigh-in` |
| Weigh-in actions | Two side by side: secondary `Type a weight` (§8.6) and tertiary `Scale: set up` or `Scale: arrived 07:01` (§8.6) |
| Maintenance check | See below |
| Recent weigh-ins | The newest six: date, time 10px mono (`· not morning` when so), kg 15px mono, and `Scale` or, for a typed one, a tertiary `Delete` |
| Phase | A link row, `Cut since 4 Sep · week 7` over `Target: lose 0.5% a week, about 0.4 kg`, which opens the goal phase. A normal row, not pinned (§7.3) |
| Footnote | `The trend smooths each day's weight` / `10% a day` |

### Maintenance check card (S18a)

An active card (`05` §4.5, 14px padding, 12px gap).

| Row | Spec |
| --- | --- |
| Header | `MAINTENANCE CHECK` 10px `0.12em` `accent`; right: `LAST 14 DAYS · 12 COMPLETE` 10px mono |
| Figures | Two columns: `You ate, on average` over `2,339` 22px mono + `kcal a day`; `Your trend moved` over `−0.33` 22px mono + `kg a week` |
| Result | Over a hairline: `So your maintenance is about` 12px, and `≈ 2,700` 24px mono in `accent` + `kcal` |
| Caveat | `Read-only. Your targets stay at 2,350 kcal until you apply this.` 11px |
| Action | `Apply to targets`, 52px primary |

**Applying asks once** (Q17), in `05` §4.16's sheet: `Set your calories to 2,250 kcal a day?`, a
sentence that it is the maintenance figure less the deficit for the phase's rate (0.5% a week of
82.4 kg at 7,700 kcal per kg, about 450 kcal), that protein is unchanged, and that unconfirmed meals
and the rest of the week are planned again; `Now 2,350 provisional → New 2,250 measured`; `Apply
2,250 kcal` and `Not now`. Once applied the caveat says so and the action goes.

### States and rules

- **Read-only until applied.** The `≈` is part of the number.
- **The window** is the trailing 14 calendar days, complete days only (S18a, S21).
- **Under 14 complete days in total:** the header's right reads `9 OF 14 COMPLETE DAYS`, then `5`
  22px mono with `complete days to go`, and one line saying what a complete day is. No figures, no
  action.
- **Too few weigh-ins** (`03` §8.3; `07` §5 `needs_weigh_in`): `Weigh in to see this` 15px, a line
  saying it needs 3 weigh-ins in the window, one in its newest 7 days, how many there are and the
  newest's date, and a secondary `Type a weight`.
- **Too little recent logging** (fewer than 5 of the newest 7 days complete): one 11px line in
  `flag` with the 14px info icon above the caveat, `Based on too little recent logging: 3 of the last
  7 days are complete.` `Apply to targets` stays enabled.
- **Fewer than 3 days of weight** (PRD): the headline becomes `LATEST WEIGH-IN` over the reading,
  with `The trend starts from your third day of weigh-ins. 1 to go.` on the right; raw points only,
  no span segments, and the legend has no `Trend`.
- **No weigh-ins:** an empty state, `No weigh-ins yet`, a sentence on the two ways in, a primary
  `Type a weight` and a secondary `Set up the scale`.
- **Only daily weights are plotted** (`CONTEXT.md`); the day's other readings are stored, not drawn.
- **Several weigh-ins on one day** (PRD edge case): the first before 10:00 is the day's chart and
  trend point. Later readings remain in Recent weigh-ins, marked as stored but not in the trend.
  Reachable in the prototype's Weight screen map.
- **As built in M2 slice 1** (`#76`, `06` 2026-10-16), at `/progress/weight`: the headline, chart,
  legend, `Type a weight`, Recent weigh-ins and the footnote, every weight in the profile's unit
  (kg or lb) to the tenth and the week's change to the hundredth. The week's change is uncoloured
  until a phase gives it a direction. Not yet drawn, each with its slice: `Scale: set up` (`#77`),
  the maintenance check card (`#82`); with one span the span segments are left out and the chart is the last 30 days, with `No weigh-ins in the last 30
  days.` when it is empty. The empty state offers `Type a weight` alone, and says to type the
  morning weight before 10:00. A typed weigh-in's `Delete` acts at once and the screen says
  `Weigh-in deleted.`; without a profile the section asks for one first. The chart is hidden from
  screen readers and read out as one sentence instead; the list carries every value.
- **As built in M2 slice 4** (`#79`, `06` 2026-10-18): the span segments `30 days` and `Since 4 Sep`,
  shown when the open phase began before today and there is a trend; the chart's sentence names
  the span. The phase row, `Target: lose 0.5% a week, about 0.4 kg` (`maintain your weight` on
  maintenance), opens the goal phase. The week's change stays uncoloured (Q8).

---

## 7. Gaps carried out of Phase 2

Four things were left undesigned deliberately. Three were decided and drawn in the 2026-09-22 design
pass. Scroll and sticky were decided for M2 at the prototype review of 2026-10-16 (§7.3).

### 7.1 The evidence tag — one component, three strengths, a route to the source

Screen 3 draws one state. S16 and S23 need the same component with strong, moderate and
contested, plus a way to reach the evidence. Specifying it once, for both uses:

**Anatomy, as drawn (moderate).** 1px border, radius 2, padding `2px 6px`, containing a 9px mono
claim, a 1px × 9px divider in the border colour, and an 8px sans strength label at `0.06em` (9px from 2026-09-22).

**Proposed extension.** Keep the anatomy; vary only the colour pair by strength, and add a third
slot for the source route.

| Strength | Claim + border | Strength label | Meaning |
| --- | --- | --- | --- |
| Strong | `done` / `line/done` | `done` at reduced weight | Multiple controlled trials or a meta-analysis agree |
| Moderate | `flag` / `line/flag` | `flag/dim` | Mixed or limited evidence — **as drawn on screen 3** |
| Contested | `text/tertiary` / `line/field` | `text/quaternary` | Commonly believed, not supported |

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

The 8px strength label was fixed 2026-09-22: now 9px in `flag/dim` (`docs/05` §1.4–1.5).

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

**Screen 1, decided 2026-10-03** (`06`). The document scrolls. The app bar sticks to the top on
`surface/ground` and keeps its `line/hairline`: no shadow, no heavier line. The rest bar is fixed
to the bottom over the safe-area inset, and the screen keeps matching padding under itself.
Nothing else sticks. Completing a set scrolls the new active card into view (`nearest`, instant
under reduced motion) and focuses it. `scroll-padding` keeps a focused control clear of both bars.

**The M2 screens, decided 2026-10-16** (`06`; Q9 of the M2 review), as the approved prototype
(`docs/prototype/m2/`) behaves. Every screen's document scrolls and its app bar sticks, as on
screen 1. Under it:

| Screen | Sticks | Otherwise |
| --- | --- | --- |
| 3, Today | The day totals, directly under the app bar. The tabs scroll away | The end-of-day card, the timeline and the rest scroll |
| 4, End of day | The two actions, pinned to the foot over a `line/hairline` top edge, with the list scrolling behind them and the screen padded to clear them | — |
| 5, Prep | Each cook day's head (the day, which cook day, the column heads), under the app bar while its own rows pass; the next day's head replaces it | Grocery and Batches: only the app bar |
| 6, Weight | Only the app bar | The phase footer is a normal row at the end, no longer pinned |
| §8.6's screens | Only the app bar | Forms end in their action, not pinned |

**A stuck block looks like screen 1's bar:** `surface/ground` behind it, its own `line/hairline`, no
shadow, no raised surface, no heavier border. *Rejected at the review:* stuck blocks on
`surface/raised` with `line/border`; and only the app bar sticking, which lets Today's totals
scroll away.

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
  specified in §8.1, from slice 2; Today and the start itself in §8.2, from slice 3. The finish
  summary is the workout's page in History (§9, 2026-10-11). Start empty (§8.2) and changing a
  live workout's exercises (§1) were designed in the build, alongside M2 (`06`, 2026-10-16 and
  2026-10-17).
- **Food list management** (S12) and manual label entry, goal phase and macro target setup (S14),
  routine and meal count (S15), typed weight (S11) and the scale's setup. Drawn in the M2 prototype
  and approved 2026-10-16: §8.6.
- **The grocery list proper** (S17): drawn and approved 2026-10-16, §5.
- **Invite administration and revoked access** (S9), export and delete (S10). Both built from
  the system: §8.4 and §8.5.
- **Health connection setup and the health dashboard** (S19, S24).
- **Photo and text meal estimation** (S22) and its confirm-before-save step.
- **Plateau protocols** (S23) beyond the evidence tag itself.
- **S18a and S21 with too few weigh-ins to estimate** (`03` §8.3): `Weigh in to see this` in place of the figure. Added by review 2026-09-22; S18a's drawn 2026-10-16 (§6).
- **Every error and failure state except the refused set.** The refused set is drawn
  (`Main-Refused`, 2026-09-22). The M2 screens' error and empty states (a refused adjust, a shortfall,
  offline, the barcode and label-read failures, no foods, no weigh-ins) are drawn in the M2 prototype
  (§3 to §6, §8.6). Revoked access and the discard confirm are not.
- **Full screen and the iPhone Focus guide** (`#51`). Not in the artboards: built from the reviewed
  prototype (`docs/prototype/`). Full screen is in §1, the guide in §8.3.

### 8.1 Routines and the exercise library (slice 2, S4 and S8)

No artboard exists, so these were designed in the build (issue #2) from `05`'s tokens and
components, and pass the polish gate (`AGENTS.md`). Nothing here adds a token or an icon.

**Shared parts.**

- **Tabs.** `Today`, `Progress`, `Routines` and `Exercises`, `05` §4.8's tabs as links with
  `aria-current`, under the app bar of the four top-level screens. Since slice 3 `/` is Today and
  the library is `/exercises` (`06`, 2026-10-03); `Progress` joined on 2026-10-11 (§9). M2 adds
  `Food` second, making five: `Today`, `Food`, `Progress`, `Routines`, `Exercises` (approved
  2026-10-16, §3; merging Routines and Exercises was not taken).
- **Back.** Screen 2's back chevron plus a 12px title, the chevron's 44px target reaching into the
  bar's padding. Its accessible name says where it goes, or `Back` on a screen reached from more
  than one place (screen 2 and a workout in History), where it returns to the one it came from.
- **Fields.** An 8px small-caps label over a 44px input with a 1px `line/control` border, since an
  empty field's border is what shows where to type (`05` §1.5). Text is 16px sans and figures 17px
  mono, so iOS never zooms into a focused field (`06`, 2026-10-01). A note beside the label says
  `Default` or `Yours`. A refused field gets an `error` border, and under it the word `Refused`, the
  info icon and the reason; focus moves to the first one.
- **Save notices.** `Not saved` in `flag` when the server was not reached: the form keeps
  everything, and saving again later works. `Partly saved` in `flag` when a save's first writes
  landed and a later one did not: it says what was saved, then what was not (`Your details saved.
  The weigh-in wasn’t; save again when you have signal.`). `Refused` in `error` when the server refused, or before
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
exercise`, the `Show` filter, then the library without hidden exercises, filed, filtered and
searched as the library is (below).
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
picker. Under them `Show`, a select of `All exercises`, the four splits (`Push`, `Pull`, `Legs`,
`Core`) and the ten muscle groups other than core; selecting `Core` under Split covers the core
group. The filter narrows the list before the search matches within it, and a
custom exercise with no group is only in `All exercises`. A heading counts `N matching` while
either is in use. The filter is not remembered. Each row opens the exercise form. A `Hidden
exercises` disclosure under the list fetches the hidden ones when first opened.

**Muscle groups and search** (library and picker; `06`, 2026-10-08). The list is filed under its
muscle groups in a fixed order: chest, back, shoulders, biceps, triceps, forearms, quads,
hamstrings, glutes, calves, core, then `Other` for a custom exercise filed under none. Each group is
`05` §4.3's section label as an `h3`, one step brighter (`text/tertiary`) than the column heads;
a group with no rows is not drawn. Rows keep name order inside a group. Search keeps the rows whose
name and aliases together hold every word typed, so
`rdl` finds `Barbell Romanian Deadlift`. While searching or filtering,
the heading reads `N matching` and is announced; with nothing left it says to check the spelling or
filter, or use `New exercise`.

### 8.2 Today and the start of a workout (slice 3)

No artboard exists, so these were designed in the build (issue #3) from `05`'s tokens and
components, and pass the polish gate (`AGENTS.md`). Nothing here adds a token or an icon. In M2,
Today becomes the whole day (`06`, 2026-10-16): the meal timeline with the workout marked in it, and
starting a workout. Prep, grocery, the food list and batches go in a new Food tab, and weight joins
Progress as a section. The approved M2 prototype draws it (§3, `docs/prototype/m2/`): the start rows
below stay, under the day, and the M1 blocks after them keep their order.

**Today** (`/`). The app bar's title is `Today` over the date in the profile's time zone, with the
data-state slot. Under the tabs, in order:

- **Ended by the 3-hour rule:** one line, `Push A ended at 10:14`, on the launch that ended it
  (`09` F3).
- **In progress:** `05` §4.5's active card with the workout's name, `4 SETS · STARTED 18:32` and a
  primary `Resume workout`.
- **Start a workout:** a row per routine, as on the routine list, with `START` in `accent` in place
  of the chevron. One tap starts it and opens screen 1 (S4). While a workout is in progress the tap
  asks under the row instead: `Finish Push A first?` — `Resume` / `Finish`.
- **Last done, 2026-10-14:** under each routine's `5 EXERCISES · 16 SETS`, one `text-tertiary`
  line, `Last done Mon 5 Oct, 5 days ago`, or `Not done yet` for a routine with no finished
  workout. It reads `GET /api/workouts/last-done` (`07` §3), one call however long History is,
  with a workout finished on the device laid over it. Until that call has answered the line is
  left out, so `Not done yet` is never said early; so is a routine's line whose answer is a workout
  since deleted on the device, until the server answers again. A routine deleted and made again starts over.
- **Empty workout, 2026-10-17** (`09` F2 step 3): the last row of the start list, `Empty workout`
  over `NO ROUTINE` and `Add exercises as you go`, with `START`. The tap opens the name in place
  under the row: `Start an empty workout. Name it, or leave it as Workout.`, a `Workout name` field
  with `Workout` as its placeholder, then `Cancel` / `Start workout`. Left empty, the workout is
  named `Workout`; over 80 characters is refused on the field, `Shorten it to 80 characters or fewer`. While a workout is in progress the
  tap asks `Finish Push A first?` — `Resume` / `Finish`, as a routine does, and `Finish` then opens
  the name. Cancel returns focus to the row.
- **No routines:** the empty state of the routine list, `Create a routine`, with one more sentence,
  `Or start an empty workout and add exercises as you go.`, and a secondary `Start an empty
  workout` under it that opens the same name in place.
- **Last workout, 2026-10-11** (§9): a link row under the routines, `PUSH A · FRI 9 OCT` over
  `13 working sets · 54 min · yesterday`, with a forward chevron. It opens the newest finished
  workout's page in History, and is not drawn before the first workout is finished.
- **Profile:** `Time zone` (a searchable list of IANA names, initially set to the device's own; an existing saved choice takes precedence; typing narrows the list and only a chosen name is saved) and `Weights shown in` —
  `05` §4.8's segments over two radios, `Kilograms` / `Pounds` — then a secondary save. Until the
  first save the heading reads `Set up your profile` with one sentence on what the two are for.
  Saved online only, like routines.
- **Theme:** `05` §4.8's segments over three radios, `System` / `Light` / `Dark`, under the
  profile's save and outside its form: it takes effect on the tap, and it is there before the
  profile is set up. `System` follows the device's setting as it changes. One sentence under it
  says so, and that the choice is kept on this device (`05` §1.7; `06`, 2026-10-10).
- **Account:** the email, `Your data` (§8.5) and `Sign out`. With sets not uploaded it asks first, in place:
  `2 sets not uploaded yet.` — `Upload now` / `Discard and sign out`. With a workout in progress it
  says to finish it first, and with one whose ending has not uploaded it says so with `Try again`;
  both offer neither (`08` §7).

**Data-state slot (§7.4) as built.** Refused and pending are counted from the set store on every
screen; the resting form shows the time §7.4 names for that screen. Cached data age is still not
drawn.

### 8.3 The iPhone Focus guide (`#51`)

Built from the reviewed prototype (`docs/prototype/`, its screen 5; `06`, 2026-10-12) with `05`'s
tokens, and passes the polish gate. Static: it reads nothing from the phone and changes nothing on
the server.

**Where.** `/workout/focus`, opened from the row at the foot of full screen (§1). It opens over
the workout, which keeps running under it: a rest still counts and its tone still plays. After
opening the guide from full screen, the back chevron, the browser's back and `I have set it up`
return to the workout as it was, full screen still on. A direct visit after a relaunch shows the
guide above the workout in its usual layout, since full screen is not remembered. With no workout
open the address opens Today.

Closing the guide after opening it from the workout returns to the existing workout history entry;
opening `/workout/focus` directly replaces that address with `/workout` on close. Browser Back does
not reopen a guide just closed with the chevron or `I have set it up`.

**Structure.** The app bar with the back chevron, `iPhone Focus`, and the data-state slot. Then:

- **A `flag` notice, `What Overload cannot do`:** `A web app cannot turn a Focus on, or stop you
  opening other apps. iOS does that, so it is set up once in Settings. Full screen keeps the
  workout in front of you; the Focus keeps everything else quiet.`
- **Four steps** (`05` §4.22), each a check cell, a numbered title, the path through Settings and
  what to do there:
  1. `Create the Focus` — `Settings › Focus › Add › Custom`
  2. `Choose who can reach you` — `Workout › People › Allow Notifications From`
  3. `Choose which apps can notify` — `Workout › Apps › Allow Notifications From`
  4. `Have it turn on at the gym` — `Workout › Add Schedule › Location`
- **`I have set it up`**, a primary button, 52px.
- **The footnote** (`05` §4.15), directly under the button: `Steps from Apple’s iPhone User Guide,
  iOS 27` and `checked 10 Oct 2026`. When iOS moves these settings, the steps and that date change
  together.

**States and rules.**

- A check cell ticks and unticks its step (`aria-pressed`, named `Step 1 done`). The steps can be
  ticked in any order and none is required.
- `I have set it up` marks the guide done and goes back. From then on the row in full screen reads
  `iPhone Focus: set up` / `Open the guide again`. Done is not undone from the screen.
- The ticks and done are kept on the phone, in `localStorage`, for the device and not the account:
  they survive a relaunch and a sign-out, and are not sent anywhere (`06`, 2026-10-12).
- Opening it starts at the top with focus on the screen; going back returns focus to the row that
  opened it.

### 8.4 Invite administration and revoked access (slice 6, S9)

No artboard exists, so these were designed in the build (issue #6) from `05`'s tokens and the
routine list's rows. Nothing here adds a token or an icon.

**Invites** (`/admin/invites`, the admin only). Reached from `Invites`, a tertiary link beside
`Sign out` in the footer of each top-level screen, shown to the admin alone. The app bar has a back
chevron, the title `Invites` over `2 ACTIVE · 1 REVOKED`, and the data-state slot. In order:

- **Add:** `Google email` (an email field, no autocapitalise) and `Note`, marked `Optional`, then a
  primary `Add invite`. Under it one line: `Overload sends no email. Tell them yourself once they
  are added.`, which becomes `kenji@example.com can sign in now. …` after an add. An address the
  server refuses is marked on the field, `Enter a Google email address`; one already invited reads
  `Already invited. Restore it below if revoked` (`invite_exists`).
- **Invited:** a row per invite, newest first: the email at 15px, then a mono meta line, `INVITED
  THU 15 OCT`, or `REVOKED THU 15 OCT · INVITED …` with `Revoked` in `flag`, then the note. The
  admin's own invite is not listed; with no other, the list says `Only you have access.` (`09` F6).
- **Revoke** asks in place, as a delete does: `Revoke kenji@example.com? They are signed out
  everywhere and can't sign in again. Their data stays, and Restore brings it back.` — `Keep` /
  `Revoke`. A revoked row offers `Restore` in one tap, since it takes nothing away. Focus moves to
  the button that replaces the one pressed.
- The screen shows no member data, only what `07` §2 returns (`08` §4).

**Not found.** A member at `/admin/invites` gets `Not found` with `Nothing is here` and `Go to
Today`, and nothing about what the address holds (`08` §5). Other unknown addresses still open
Today.

**Revoked access** (`09` F4). The sign-in page's refusal reads `Your access was revoked.`, and when
the last account signed in on the device had sets the server had not taken, `1 set logged on this
device wasn't saved. It stays on this device until you discard it.` Those sets are refused with the
reason `Access to Overload was revoked` and offer Discard alone, wherever refused sets are shown.

### 8.5 Export and delete (slice 7, S10)

No artboard exists, so this was designed in the build (issue #7) from `05`'s tokens and the
profile form's blocks. Nothing here adds a token or an icon.

**Your data** (`/account`, every member). Reached from `Your data`, a tertiary link in the footer
of each top-level screen, before `Invites` for the admin. The footer's links keep one line each at
390px and the email ellipsizes. The app bar has a back chevron, the title `Your data`, and the
data-state slot. In order:

- **Export:** one sentence, `Everything you have logged, in one JSON file: your profile, exercises
  and their settings, routines, every workout with its sets, and weigh-ins.`, then a secondary
  `Export your data`. While it reads it says `Exporting… 2 of 5`, one step per section; when the file is handed to the browser,
  `Saved overload-export-2026-10-15.json.` under it, dated in the profile's time zone. A failure
  is a flag notice, `Not exported`, `Couldn’t reach Overload. Try again when you have signal.`, and
  the button stays for the retry (`09` F7).
- **Delete account**, under the profile form's rule. Two sentences: what goes (`your profile,
  exercises, routines, workouts and sets. Your invite goes too, so coming back takes a new one. It
  can’t be undone. Export your data first to keep a copy.`) and what outlasts it (`access records
  (ids, times, IP address and browser, no content) are kept for one year, and backups holding your
  data expire within 30 days.`). Then `Type DELETE to confirm`, a text field, and a secondary
  `Delete account`, disabled until the field reads exactly `DELETE`.
- **A session older than a day** (`08` §6) shows, in place of the form, `To delete your account,
  sign in with Google again first. It confirms it is you, and brings you back here.` and a secondary
  `Sign in with Google again`, which returns to `/account`. The server's `SESSION_EXPIRED` leads to
  the same.
- **The admin** sees only `This is the admin account, so it can’t be deleted. Name another admin
  first.`
- **What stops a delete** shows between the field and the button, and takes focus: a workout in
  progress (`Finish it first.`), a workout whose ending has not uploaded (`Try again`), and sets not
  uploaded, `2 sets not uploaded yet. Deleting doesn’t upload them. Upload them now to keep them in
  an export, or discard them and delete.` — `Upload now` / `Discard and delete`. `Upload now` only
  uploads. If rows remain pending after it, the notice says `Couldn’t confirm the upload finished.
  Some workout data may have uploaded. Your account was not deleted. Check your connection and try
  again.` If the signed-in account changed, the notice says to reload before deleting. A lost
  delete response says `Couldn’t confirm whether your account was deleted. Reload to check.` A
  definite server refusal says `Overload refused the deletion. Nothing was deleted. Reload and try
  again.`
- **Deleted:** the sign-out wipe runs (`08` §7), and the sign-in page opens with a flag notice,
  `Deleted`, `Your account was deleted.`

---

### 8.6 The M2 screens no artboard drew (approved 2026-10-16)

Drawn in the M2 prototype (`docs/prototype/m2/`, screens 15 to 26, 33 and 34) and approved at the
review of 2026-10-16 (`06`). Each is built from it at 390pt, dark and light, from `05`'s tokens, and
clears the polish gate. Every form below uses `05` §4.18's fields; a value saved per 100 g says so.

**Foods** (`Food` tab, `Foods` section; S12). `FOOD` over `YOUR FOODS · 14`. A search field
(`Name or brand`) that filters as you type, then a primary `Add a food`. One flat list by name (Q13):
each 60px row has the food 15px (and its brand in `text/tertiary`), `105 kcal · 23.3 g protein · per
100 g raw` 11px mono, and tags in 1px `line/field` boxes for its rotation group, `Batch-cooked ·
keeps 4 days` and `Counted in pieces`; a forward chevron opens it. No match: `None of your foods match
"xyz".` with `Add it as a new food`. Under the list a link row to `Rotation groups`, and the footnote
`Values per 100 g of the state named` / `raw or cooked`. **Empty** (PRD): `No foods yet`, a sentence
saying the plan is built only from them, starting with a protein source, and `Add a food`.

**One food.** The app bar has the name over its source (`MEXT FOOD TABLE · 11220`). `PER 100 G, RAW`
lists the five values (15px mono); `HOW THE PLAN USES IT` gives counted in, rotation group and
batch-cooked; a batch-cooked food lists its batches (§5) and offers `Record a batch`. Then `Edit` and
`Archive`, with one line: archiving takes it off the list and out of new plans, and past plans keep it.

**Add a food** (`09` F9, in its order). A search field, `Search the MEXT food table`; from two
characters, the matches as rows: the English name 14px, MEXT's own name 12px as MEXT prints it (`鶏
若どり むね 皮なし 生`), and `105 kcal · 23.3 g protein per 100 g · MEXT 11220`. No match says so and
points to the barcode. Under `NOT IN THE TABLE?`: `Scan a barcode`, `Photograph the label` and `Enter
it by hand`, each with a line on what it is. A pick opens the check screen; one already on the list
says so there.

**Scan a barcode.** The camera in a 260px box with a 2px `accent` frame and `Hold the barcode inside
the frame`. Found: straight to the check screen. Not found: `Not in Open Food Facts` with the code,
`Photograph the label` (primary) and `Enter it by hand`. Already on the list: `Already on your
list`, naming the food, with `Open` it. Open Food Facts down or limited: `notice--flag`, `Open Food
Facts isn't answering`, with the same two ways on.

**Photograph the label.** The camera with a square frame, `Fill the frame with the 栄養成分表示`, one
line (flat, good light, every line in view; the photo is read once and not kept) and `Take the
photo`. While it reads: `Reading the label. This takes a few seconds.` Unreadable: `Couldn't read the
label`, `Retake` and `Enter it by hand`. The daily cap: `notice--flag`, `Photo reads used up for
today`, and `Enter it by hand`. The reader down: `notice--flag`, `The reader isn't answering`, and
`Continue by hand`, which opens the check screen with what was read.

**Check before saving** (F9 step 5; a candidate is not a record). The app bar's subline names the
source (`LABEL PHOTO · READ 12:14`, `BARCODE · OPEN FOOD FACTS`, `TYPED BY HAND`). After a label or
barcode, an `AS PRINTED` box (Q14) gives the source's basis (`Per package (113 g)`) and its five
values, `not printed` (or `not read`) in `flag` where it gave none. Then name, brand, and `PER 100 G,
AS IT WILL BE SAVED` with `converted from the label`: calories, protein, carbs, fat and fiber, each
editable. A value the source did not give is empty with `—` and a note, `NOT ON THE LABEL: LEFT
EMPTY` or `NOT READ`; never guessed. Then `Raw` / `Cooked`, `One piece weighs` (empty: counted in
grams), `A cooked batch keeps for` (empty: not batch-cooked) and the rotation group, then `Save to
my foods` and a tertiary `Discard`. **By hand**, the same screen empty, with `The packet gives
values` as four segments (`Per 100 g`, `Per piece`, `Per serving`, `Per package`) and, for any but
the first, `That amount weighs`. For those other bases, the fields hold the packet's numbers and
the converted per-100 g values appear below them before saving. A duplicate shows `Already on
your list` with a link to it.

When a label or barcode gives values per piece, serving or package without its weight, `That amount
weighs` appears under `AS PRINTED`. The editable fields start with the source's figures on that
basis, and the converted per-100 g preview appears below them. Saving requires the weight and
sends those figures on the printed basis for conversion by the API.
For a label or barcode measured per 100 ml, the box says `Per 100 ml` and asks what 100 ml weighs;
the preview then converts the source values using that weight. A barcode serving measured in ml
also asks for the serving's weight.

**Rotation groups.** A lede (the planner varies the week within a group; Adjust offers the others as
swaps), then a section per group, `STARCH · 2`, with its foods as 48px rows and a tertiary `Remove`,
and `+ Add a food to starch`. A secondary `New group`.

**As built in M2 slice 3** (`#78`, `06` 2026-10-17), at `/food`, `/food/{id}`, `/food/{id}/edit`,
`/food/new`, `/food/new/barcode`, `/food/new/label`, `/food/new/check` and `/food/groups`, checked at
390px in both themes on invented foods:
- Calories print whole on the list, the picks, a food's page and the per-100 g preview, as everywhere
  else in the app; the stored value keeps its hundredths, and `As printed` shows what the source
  printed.
- MEXT's own name is printed without its leading food group (`＜魚類＞`), which the English name
  already says, and with one space between words. A food MEXT gives no English name is listed by
  that name.
- One food leaves out its batches and `Record a batch` until `#81`. `Archive` asks first, with
  `05`'s delete confirmation (`Keep` / `Archive`); archived, the list says `Archived. Past plans
  still name it.` once, and the food's page says it is archived.
- Both camera boxes are `surface/status-bar`, the one colour the same in both themes, with a
  `line/border` edge, and their caption sits under the box in `text/tertiary`: over it, no text token
  holds its contrast on black in light, nor over whatever the camera sees.
- Scan a barcode also takes the number typed (`Or type the number`, the number pad), for a phone
  without a camera or one not allowed; then the frame's caption says so. The camera is read with
  the browser's `BarcodeDetector`, or the ZXing ponyfill where there is none, its
  WebAssembly served by the app. A barcode not found is carried to the label photo or the form as
  the food's key.
- Photograph the label opens the phone's camera through the file input, and the photo is resized to
  1568px as JPEG before it is sent. The reader down, or no signal, offers `Continue by hand` and
  `Try another photo`: nothing was read, so the form opens empty, keeping a scanned barcode.
- A duplicate, from a pick already on the list or refused on saving (`food_exists`), says `Nothing
  was saved: it is on your list already.` with `Open it`.
- When an outcome replaces the button pressed (a lookup, a read, a group's change), focus moves to
  what replaced it.

**About you** (F10 step 0). `ABOUT YOU` over `STEP 1 OF 4`: weight (from a weigh-in when there is
one, noted so), height, birth date, and `Sex, for the formula only` as two segments. `Save`.

**Goal phase and targets** (S14). `GOAL PHASE` over `CUT SINCE 4 SEP · WEEK 7` (or `STEP 3 OF 4`).
`Cut` / `Maintain` / `Bulk` segments. Each field carries `DEFAULT`, `YOURS` or `PROVISIONAL` in its
note, and under it what it means in plain figures: target rate `0.5` `% bodyweight` → `That is about
0.4 kg a week at 82.4 kg.`; protein `2.2` `g per kg` → `181 g a day`, with why a cut starts at the
top; fat `27` `% of calories` → `71 g a day. Carbohydrate is what remains: 247 g.`; calories `2350`
`kcal a day`. Each default's source is an evidence tag in the line under it (`0.5–1% A WEEK ·
MODERATE`, `1.6–2.2 G/KG · STRONG`). A `PROVISIONAL` box on `surface/flag` says the calories are a
formula's estimate until the maintenance check is applied, and names the formula (chosen and cited
in slice 4). Changing the type while a phase is open says `A cut is open` and that saving ends it
today and keeps it; the action becomes `End the cut and start a bulk`.

**Your day** (S15). `YOUR DAY` over `MEAL TIMES AND COUNT` (or `STEP 4 OF 4`). `Training day` /
`Rest day` segments; training weekdays as seven 44px toggles; wake, bed, work start and end, and on
a training day the training time. A `RECOMMENDED` active card: a stepper with the meal count, the
times and names as a list, why (`181 g of protein over 5 meals is about 36 g each, 0.44 g per kg,
inside 0.4–0.55.` and the meals around training), its evidence tag (`0.4–0.55 G/KG A MEAL ·
MODERATE`), and under a hairline that meal count does not change fat loss at equal calories. A
changed count adds `Yours: 4 meals. The recommendation was 5.` in `flag`. `Use these meals`.

**As built in M2 slice 4** (`#79`, `06` 2026-10-18), at `/plan/about`, `/plan/phase` and
`/plan/day`, checked at 390px in both themes:
- About you's weight is the latest weigh-in, noted `From your weigh-in of …`; a changed weight is
  saved as a new weigh-in. Saving makes the week's plan again and returns to Today.
- Goal phase's fields start from the open phase of the same type, or the defaults, noted `Default`,
  `Yours`, `Provisional` or `Measured`. For a new phase the defaults are the fields' placeholders,
  not filled values, so the calories keep following the rate until one is typed. An open phase
  still on the formula shows the formula's figure for its rate as the placeholder too, and follows
  a new rate the same way; a figure typed into Calories is the member's own. Untyped calories are
  saved as provisional and the API works out their figure as it saves (`06`, 2026-10-21). Saving
  waits while the calories for a newly typed rate load, and Your day's `Use these meals` waits for
  the meals of newly typed times. The units read
  `% bodyweight`, `g per kg`, `% of calories` and `kcal a day`, as drawn. Fat's default is **25 %** (`06`), not the drawn 27. The
  `PROVISIONAL` box names Mifflin–St Jeor with its resting energy, activity level and the deficit
  or surplus. Changing the type while a phase is open says `A cut is open` and `Saving ends the cut
  yesterday and starts a bulk from today.` A phase begun today says `This phase began today. A new
  phase can start tomorrow.`; an attempted same-day start is refused.
- Your day starts on `Training day` unless it is saved and the rest day is not. The weekday toggles
  change the profile's training weekdays; while the phase's calories are still the formula's, the
  API moves them in the same write, and only when the weekdays change (`06`, 2026-10-21). When the
  week needs both day types and one is unsaved, saving the first says `Training day saved. Now
  your rest day.` and switches to it. Without a goal phase the recommendation says
  `Set up first` with a link to it.

**Type a weight** (S11; a permanent option, `06` 2026-10-16). `Weight` in kg, then `Date` and `Time`,
which start at now and can be changed (Q15). One line under them says how the time counts: before
10:00 it is the morning's weigh-in unless the scale sent an earlier one; after, it counts only on a
day with no reading before 10:00 and is marked as not a morning weigh-in. `Body fat`, optional.
`Save weigh-in`. Out of range is refused under the field (`A weight between 20 and 300 kg.`). One
line says a typed weigh-in can be deleted and one from the scale cannot. *Built in M2 slice 1* at
`/progress/weight/new`: the weight is typed in the profile's unit (`A weight between 44.1 and 661.3
lb.` in pounds), body fat is 1 to 75%, a time not yet come is refused under the time, and a second
typed weigh-in at the same time is refused (`weigh_in_exists`), with a link to the weight list to
delete the saved reading before typing a correction. Saved, it returns to Weight, which says
`Weigh-in saved.` once.

**Weight from the scale** (#77). A status box: `Weight from the scale` over `Never arrived` and
`Finish the steps below, then weigh in`, or on `surface/done` `Arrived today 07:01` with the reading.
Then numbered steps for the route the hardware tests pick (`06`, 2026-09-19); the prototype draws
both. *Google Health:* link Fitbit in EufyLife; allow Overload to read weight (`Connect Google`, then
`Connected as …`); weigh in. *Health Auto Export:* Premium; `Make a token`, shown once with `Copy`;
the automation's settings (`overload-weight`, metric Weight, the ingest address in a mono box, the
bearer header); weigh in and unlock, because iOS sends Health data only while unlocked. Then `Revoke
the token`.

## 9. Progress: History and a workout's page (issue #48)

No artboard exists. These were drawn first as a clickable prototype, reviewed and approved by the
owner on 2026-10-10 (`docs/prototype/`, `06` 2026-10-11), and built to match it at 390px from
`05`'s tokens. Nothing here adds a token or an icon; the two new components are `05` §4.20 and
§4.21.

**The Progress tab** (`/progress`). The fourth tab of §8.1, second in the row (third from M2, after
`Food`). Under the tabs, 14px down, three sections as `05` §4.8's segments, links with
`aria-current`: `History` (`/progress`), `Strength` (`/progress/strength`) and `Balance`
(`/progress/balance`). M2 adds a fourth, `Weight` (`/progress/weight`, §6), built in M2 slice 1;
the four share the row at 10px.

### History (`/progress`)

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | as §8.1 | `Progress` over `194 WORKOUTS`, 11px mono `text/quaternary`: every finished workout, not the ones loaded. Right: the data-state slot |
| Tabs, then sections | 44px each | As above; `History` is current |
| Month | `20px 16px 0` | `05` §4.3's section label as an `h2`: `OCTOBER 2026`, in the profile's time zone |
| Workout row | the routine list's row (§8.1), 8px under its month | `Push A`; `FRI 9 OCT · 54 MIN · 13 SETS` in mono small caps; then each exercise's top set, `Barbell Bench Press 80 × 10 · Seated Dumbbell Shoulder Press 24 × 10`, on one line that ends in an ellipsis; a forward chevron. The whole row is a link to the workout |
| Earlier | `05` §4.6 tertiary, under the list | `Show earlier workouts` while the server has another page of 30 |

- **Newest first**, by when the workout started. Sets are working sets; a warm-up is neither
  counted nor a top set (S6). Minutes are the whole minutes from start to end, and never 0.
- **Empty:** `No workouts yet` over `A finished workout is listed here by date, with every set
  open to correction.`
- **Removed:** arriving from a workout whose last set was just deleted, one line under the
  sections says `That was its last set, so the workout was removed.` (`05` §4.21), once.
- **Not reached:** `Not updated` in `flag` over the last copy, or `Try again when you have signal.`
  with none.
- **A workout the device still holds** is shown from its rows when a list page is available;
  see `03` §6 for the offline cache rule.

### Strength (`/progress/strength`, issue #49)

Built 2026-10-14 to the prototype's Strength screen at 390px (`06`, same date). Every figure and
verdict is the API's (`07` §3); the screen groups the lifts by the status they came with.

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | as §8.1, 14px under its text | `Progress` over `13 LIFTS`: the lifts with a workout in the span. Right: the data-state slot |
| Tabs, then sections | 44px each | As above; `Strength` is current |
| Span | `05` §4.8, three segments, `14px 16px 0`, 44px, mono | `4 WEEKS`, `12 WEEKS`, `1 YEAR`; a radio group. It opens on 12 weeks |
| Headline | screen 2's (§2), `18px 16px 0` | `ALL LIFTS · TREND OVER 12 WEEKS` (`a year` for the year); the average at 42px, `+2.7`, with `%` at 14px. Right: `STRONGER`, `HOLDING` or `WEAKER`, 13px mono/500, `done` for stronger and `text/tertiary` otherwise, over `13 LIFTS AVERAGED` |
| Tally | `05` §4.23, `16px 16px 0` | `GAINING` `6` in `done`; `HOLDING` `6`; `LOSING` `1` in `flag` |
| Group | `05` §4.3's label as an `h2`, `18px 16px 8px`, `text/tertiary` | `GAINING · 6`, then `HOLDING`, `LOSING`, `TOO FEW WORKOUTS IN THIS SPAN`, `NO TREND YET IN THIS SPAN` and `NO WEIGHT LOGGED IN THIS SPAN`. A group with no lift is not drawn |
| Lift row | `05` §4.23 | The name; `E1RM 106.7 KG`, its latest in the span; the sparkline; `+4.6%` over `+4.7 kg`. The whole row is a link to that lift's chart (§2) on the same span |
| Footnote | `05` §4.15, 22px under the last list | `Trend of each lift's e1RM across the span` and `gaining ≥ +2% · losing ≤ −2%` |

- **The span is in the address** (`?span=4w`, none for 12 weeks), so a reload, and Back from a
  lift's chart, open the same one. While another span loads the last one stays, set back.
- **Order.** Within a group the largest change first, as the API sends them.
- **Too few workouts:** a lift with fewer than three working workouts and a positive e1RM in the span sits in that group. Its
  second line is `2 WORKOUTS` in place of the e1RM, its change an em dash, and it has a sparkline
  from two positive points up. The count includes workouts logged at 0 kg. It is not averaged
  and not tallied.
- **No calculable trend:** three or more working workouts whose percentage cannot be calculated
  sit under `NO TREND YET IN THIS SPAN`, with their workout count and `Can’t work out a trend yet`
  in place of a verdict. They are not averaged or tallied.
- **Not colour alone.** The status is the group's heading and the figure's sign; `done` and
  `flag` only repeat them (WCAG 1.4.1). A screen reader hears `Up 4.6 percent`.
- **Nothing in the span:** the headline reads an em dash over `0 LIFTS AVERAGED`, the tallies 0,
  and under them `No lifts in this span` over `A lift is listed here once a workout in the span
  has a working set of it.`
- **Not reached**, and **no profile yet:** as screen 2 (§2).
- **Pounds.** The latest e1RM and the change in weight are in the profile's unit, `LB` and `lb`.
  The percentage is the same in either.
- **A lift never loaded**, logged at 0 kg throughout, is listed with its workout count and
  `No weight logged · no trend` in place of a verdict. It is not averaged (`07` §3). A bodyweight
  lift with a weigh-in is not that: it counts the lifter's weight (#69, `06` 2026-10-17) and has an
  e1RM, a trend and a verdict like any other.
- **A bodyweight lift names its weigh-in.** Under the e1RM line, `Counted at 82 kg · your weigh-in
  of 10 Sep` (`that day’s weigh-in`, `your first weigh-in, 12 Nov`, or `No weigh-in · counted as
  logged`), 10px mono in `text/quaternary`, for the lift's latest workout in the span.

### Balance (`/progress/balance`, issue #50)

Built 2026-10-14 to the prototype's Balance screen at 390px (`06`, same date), its first step
only: the view, not the suggestions that change a routine. Every figure and status is the API's
(`07` §3), except that this week also counts the sets still on the device (below).

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | as §8.1, 14px under its text | `Progress` over the view's dates: `17 SEP – 14 OCT` for four weeks, `MON 12 OCT – TODAY` for this week. Right: the data-state slot |
| Tabs, then sections | 44px each | As above; `Balance` is current |
| View | `05` §4.8, two segments, `14px 16px 0`, 44px | `4-WEEK AVERAGE` and `THIS WEEK`; a radio group. It opens on the four-week average (Q14) |
| Range line | `14px 16px 0`, wraps, `8px 10px` gap | `Working sets a week, per muscle group. Range:` in 11px/1.5 `text/secondary`, then the evidence tag `10–20 SETS · MODERATE` (`05` §4.12), which opens the sources sheet |
| Tally | `05` §4.23, `16px 16px 0` | `IN RANGE` in `done`, counting `HIGH` too; `LOW` and `NOT TRAINED` in `flag` |
| Groups | `05` §4.24, 12px under the tally | All eleven, chest to core, each with its figure, its status and its meter |
| Scale and legend | `05` §4.24 | `0 · 10 · 20`; `Sets on the muscle`, `Half sets, trained indirectly`, `10–20 a week` |

- **The view is in the address** (`?view=week`, none for four weeks), so a reload opens the same
  one. While the other loads the last one stays, set back.
- **A row opens** on where its sets came from, oldest first: `Barbell Bench Press (half) 4 · Cable
  Triceps Pushdown 8`. One untrained reads `No exercise in the last four weeks trains it.`, or
  `No exercise this week trains it.` in the week's view (`06`, 2026-10-14). One row is open at a
  time, and it stays open across the views.
- **This week counts a set as soon as it is logged**, as the prototype's does. The set store's
  rows are laid over the API's week, as History lays them over its list: a set the server has not
  stored is added, one deleted here and not yet uploaded is taken away, and one the server holds
  counts once. Each counts as the API counts it: whole for its exercise's group, half for each
  group it also trains, warm-ups not at all, on the local date its workout started. The four-week
  average is the API's alone (`06`, 2026-10-14).
- **Figures** are to the tenth with no `.0`: `12.3`, `10`, `0`.
- **Not colour alone.** The status word carries every verdict; the meter repeats the figure and is
  hidden from a screen reader, which hears `Triceps, 18 sets a week, In range`.
- **The sources sheet** (§7.1, `05` §4.16) holds the claim, what Moderate means here, and the three
  papers the prototype lists, each opening its DOI.
- **Not reached**, and **no profile yet:** as Strength, with `A week is counted in your time zone.`
- **Not built here** (`#50` step 2, and Today's screen): the suggestions under the prototype's
  `SECOND STEP` mark, its tap hint written as a note, and Today's balance line under
  `How it is going`.

### A workout (`/workouts/{id}`)

Reached from History, from Today's `Last workout`, from an exercise's past sets (§2), and by
finishing a workout. Back returns to whichever it came from, and to History otherwise.

| Block | Geometry | Content |
| --- | --- | --- |
| App bar | screen 2's, with the back chevron | The workout's name over `FRI 9 OCT · 18:30 · 54 MIN` (`IN PROGRESS` in place of the minutes for one not ended). Right: the data-state slot |
| Said once | `05` §4.21, `12px 16px 0` | After Finish: `Workout finished. It is in History from now on.` After a save or a delete, see below |
| Stat strip | `16px 16px 0`, 3 × 1fr, 8px gap | Screen 2's stat cards at `10px 11px`: `WORKING SETS` `13`; `VOLUME` `9,420` `kg`; `TIME` `54` `min` for a finished workout. An in-progress workout has no `TIME` card |
| Exercise | 20px above each | The name, 13px/600/`0.04em` uppercase `text/primary`, in a 44px row with a forward chevron in `text/tertiary`: a link to that exercise's chart and past sets (§2) |
| Column heads | grid `30px 1fr 56px 44px 44px`, 6px gap, 6px above a `line/hairline` | `SET · KG · REPS · RIR`, 9px `0.1em` `text/quaternary`; the fifth column unlabelled |
| Set row | the same grid, 44px, `line/row` under | Set no. 13px mono `text/tertiary`; kg and reps 17px mono/500 `text/primary`; RIR 13px mono `text/tertiary`, `—` with none; `EDIT` 10px `0.08em` `text/tertiary`, right-aligned. A warm-up is numbered `W` and its figures drop to 13px `text/tertiary`. The whole row is the button that opens its editor, and reads `CLOSE` while open |
| Set editor | `05` §4.20, `2px 16px 12px` under its row | Weight, reps and RIR over `Cancel` and `Save set`, then `Delete set` |

- **Every set as logged**, in order, warm-ups included; an exercise that logged none is not drawn.
  Volume is weight × reps over the working sets, in the profile's unit.
- **One editor at a time.** Opening a set closes the other and clears the line said once.
- **Save** refuses a figure the server would refuse, in the editor, as the active card does (§1).
  Saved: the editor closes, focus returns to the row, and the line reads `Set saved. Charts, last
  time and the target use the new figures.`
- **Delete** asks in place, the delete pattern of §8.1: `Delete set 2? It leaves this workout, your
  charts and last time.` over `Keep` and `Delete` (`the warm-up set` for a warm-up). Deleted: `Set
  deleted. Charts, last time and the target no longer count it.` Deleting the workout's last set
  deletes the workout and opens History, which says so.
- **Not offered** (`06`, 2026-10-11): adding a set, moving one, changing the date, and any mark
  that a set was edited.
- **Offline** every control works on a workout the device has loaded; the change is counted as
  pending in the data-state slot until it uploads (`09` F3a). One never loaded says `Not loaded`.
- **In progress elsewhere:** a workout not ended that this device does not hold is read-only. Its
  set rows are not buttons and carry no `EDIT`; nothing else changes (`09` F3a).
- **Unknown:** a workout that is not the caller's, or was deleted, reads `This workout is not in
  your history.` under a bar titled `Workout`.
- **Pounds.** Every weight is shown and typed in the profile's unit; the column head reads `LB`.
