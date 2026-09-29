# 02 — Product Requirements

_Updated 2026-09-22. No technology decisions here; those are in `03`._

## User types

| Type | Can do |
| --- | --- |
| **Admin** (Yuta) | Everything a member can, plus invite and revoke access by Google email address. |
| **Member** (invitee) | Signs in with Google once invited. Has the full app for their own data only and cannot see any other user's data. |
| **Uninvited visitor** | Sees the sign-in page. Signing in with a Google account that has no invite is refused. |

## Milestones

M1 Training log → M2 Meal plan + weight → M3 Health + coaching. Each milestone's MUSTs ship before the next milestone starts.

## User stories

### M1 — Training log

**S1. Log a set offline — MUST**
As a lifter, I want to log a set the moment I finish it, even without signal, so that no set is ever lost.
- A ticked set is saved on the phone immediately and shows as saved with no network.
- Once the connection returns, unsynced sets upload with no action from the user, and a visible indicator shows how many are still pending.
- Closing the tab or locking the phone with sets pending does not lose them.

**S2. See last time — MUST**
As a lifter, I want last workout's weight and reps shown next to each set, so that I never guess.
- When an exercise starts, each set row shows that exercise's most recent workout's weight × reps for the same working set (the nth working set against the nth; warm-ups are not counted).
- New set rows are pre-filled with those values and can be edited.

**S3. Get a suggested weight — MUST**
As a lifter, I want the app to suggest today's weight, so that I progress on purpose.
- Each exercise has a rep range (default 6–10) and a load increment (e.g. 2.5 kg barbell, 2 kg dumbbell).
- If every working set last workout reached the top of the range, the suggestion is last weight + increment. Otherwise it is the same weight.
- The suggestion appears next to last time's numbers and never overwrites a value the user entered.

**S4. Routines — MUST**
As a lifter, I want saved routines like "Push A", so that starting a workout is one tap.
- A routine is an ordered list of exercises with a target set count and rep range for each.
- Starting a routine creates a workout with those exercises, with last time's numbers and suggestions filled in.
- Exercises can be added, removed or reordered within a live workout without changing the routine.

**S5. Rest timer — MUST**
As a lifter, I want a rest timer that starts on its own, so that my rest is consistent.
- Ticking a set done starts a countdown using that exercise's default rest, or 120 s if none is set.
- The timer can be skipped or extended, and it is visible without leaving the workout screen.

**S6. Effort and warm-ups — MUST**
As a lifter, I want to record RIR/RPE and mark warm-up sets, so that stats reflect real working sets.
- Each set has an optional RIR or RPE value and a warm-up flag.
- Warm-up sets are stored and displayed but left out of e1RM, volume and the S3 progression rule.

**S7. Progress chart — MUST**
As a lifter, I want to see how an exercise has progressed over a chosen time span, so that I know whether I am overloading.
- The chart plots estimated 1RM per workout from the best working set, using Epley: weight × (1 + reps / 30).
- Time spans: 4 weeks, 12 weeks, 6 months, 1 year, all.
- Top-set weight and workout volume load (sets × reps × weight) appear as secondary stats for the selected span.

**S8. Exercise library — MUST**
As a lifter, I want a ready list of common exercises plus my own, so that setup is quick.
- About 50 seeded barbell, dumbbell, machine and cable exercises are available to every user.
- Users can create custom exercises visible only to themselves. All weights are in kg.

**S9. Invite-only access — MUST**
As the admin, I want only people I invite to be able to sign in, so that the app stays private.
- Sign-in is Google only.
- The admin adds or revokes a Google email. Revoking ends that user's sessions.
- Every read and write is scoped to the signed-in user.

**S10. Export and delete — MUST**
As a user, I want to download all my data and be able to delete my account, so that I own my data.
- Export produces a file containing every record the user owns.
- Delete asks for confirmation, then removes all of the user's data from the app and their access.
- Two things outlast the account, and the delete screen says so: access records (ids, times, IP address and browser, no content) are kept for one year, and backups containing the data expire within 30 days.

### M2 — Meal plan + weight

**S11. Weight trend — MUST**
As a user, I want my morning weight to arrive by itself and show as a smoothed trend, so that daily fluctuation does not mislead me.
- The morning weight arrives from the Eufy scale without manual entry. The route is decided by the two hardware tests in `06` (2026-09-19) before M2 starts.
- The daily weight is the first reading before 10:00 local time. If there is none, the day's first reading is used and marked as not a morning weigh-in.
- A smoothed trend line is drawn over the raw daily points. Weight can also be entered by hand.

**S12. Food list — MUST**
As a user who eats from a short list of foods, I want to add each food once and never type its macros again, so that planning and logging use exact data.
- A food is added by searching a nutrition database or scanning a barcode. If a barcode isn't found, a photo of the nutrition label (栄養成分表示) is read automatically. The extracted values, including the basis (per 100 g, per piece or per serving), are shown for confirmation before saving. Manual entry remains the last fallback.
- Each food stores calories, protein, carbohydrate, fat and fiber per 100 g, with a state: raw or cooked.
- The list is personal. Each food can be marked as a rotation alternative to another (e.g. okra ↔ broccoli, rice ↔ potato).

**S13. Batch cooking yields — MUST**
As a user who cooks in batches and weighs cooked portions, I want to record a batch's raw and cooked weight, so that cooked portions convert to exact macros.
- A batch records the food, raw weight and cooked weight (e.g. chicken breast, 1,400 g raw → 1,050 g cooked).
- A cooked portion's macros are calculated from the raw nutrition using that batch's yield.
- The current batch is used by default until a new one is recorded.

**S14. Goal phase and macro targets — MUST**
As a user, I want a cut, bulk or maintenance phase to set my daily targets, so that dieting is planned rather than guessed.
- A phase has a type, start date and target rate (cut default: 0.5–1% bodyweight per week, Helms 2014).
- Protein is set in g/kg of bodyweight (range 1.6–2.2 g/kg, Morton 2018). On a cut the default is the top of the range, 2.2 g/kg, because needs rise in a deficit (2.3–3.1 g/kg of lean mass, Helms 2014). The user can raise it. Fat is a % of calories. Carbohydrate is the remainder.
- Until M3's measured expenditure exists, calories come from a formula estimate labelled provisional.
- Every default shows its source.

**S15. Routine and meal count — MUST**
As a user with a fixed weekday routine, I want the app to recommend how many meals to eat and when, so that my plan fits my day.
- The user sets a routine: wake time, work hours, training days and training time, bedtime. Training days and rest days are separate day types.
- The app recommends a meal count and times, spreading protein at 0.4–0.55 g/kg per meal across at least 4 meals where the schedule allows (Schoenfeld & Aragon 2018). It explains the recommendation and its source.
- The app states that meal count does not change fat loss at equal calories (Schoenfeld 2015) and is recommended for protein distribution only.
- The user can change the count and times.

**S16. Daily meal plan — MUST**
As a user, I want each day's targets split into meals with grams of each food from my list, so that I know exactly what to eat.
- Each meal lists foods from the user's list with gram amounts, in cooked weight for batch-cooked foods.
- Summed over the day, the plan is within ±5% of the calorie target and within ±5 g of the protein target.
- Gram amounts round to 5 g. Foods counted in units (e.g. eggs) stay whole.
- On training days, more of the day's carbohydrate is placed in the meals before and after training. This recommendation carries an evidence tag.
- Days rotate between the marked alternatives so the week isn't identical. The plan for a day type stays stable otherwise.

**S17. Prep plan and grocery list — MUST**
As a user who batch-cooks, I want a weekly prep list and shopping list worked out from the plan, so that the plan actually gets cooked.
- The prep plan lists raw amounts to cook per food for the coming week, using the last recorded yield.
- The grocery list sums the week's raw quantities per food.

**S18. The plan is the log — MUST**
As a user who won't type what I eat, I want to confirm planned meals instead of logging them, so that intake is recorded with almost no input.
- Each planned meal offers: eaten as planned (one tap), adjust (change grams or swap a food from the list), or replaced (log different foods from the list, or by hand).
- An end-of-day check lists any unconfirmed meals, and they can all be confirmed with one tap.
- A meal that is never confirmed does not count as eaten. The day is marked incomplete and left out of expenditure estimates.
- Off-plan meals in M2 are logged as "replaced" from the food list or by hand. Photo and text estimates arrive in M3 (S22).

**S18a. Maintenance check — MUST**
As a user whose weight isn't moving, I want to see my real intake next to my weight trend, so that I know my actual maintenance calories instead of guessing.
- Once 14 complete days have been logged, the app shows average confirmed daily intake next to the weight-trend change, with an implied maintenance estimate (e.g. "averaged 2,450 kcal, trend −0.1 kg/week → maintenance ≈ 2,500 kcal").
- It always reads the trailing 14 calendar days, using complete days only — the same window S21 uses, so the two never disagree about the same fortnight. If fewer than 5 of the newest 7 days are complete, the estimate is labelled as based on too little recent logging.
- The estimate is read-only and never changes targets automatically. The user can apply it to the phase's targets by hand.
- With fewer than 14 complete days, it shows how many complete days remain.

### M3 — Health + coaching

**S19. Health data arrives automatically — MUST**
As a user, I want my Apple Watch and iPhone data in the app without manual entry, so that the dashboard stays current.
- Metrics: sleep (duration and stages), resting heart rate, HRV, steps, active energy, workout heart rate and duration, body fat %, lean body mass.
- The dashboard shows when each metric last synced.

**S20. Overlays on lift charts — MUST**
As a lifter, I want to lay intake, weight trend, sleep and HRV over an exercise's e1RM chart, so that I can see what changed when a lift stalled.
- Each overlay can be switched on and off independently and shares the chart's date axis.

**S21. Adaptive expenditure — MUST**
As a user, I want my energy expenditure estimated from my weight trend and confirmed intake, and my targets adjusted weekly, so that coaching follows my real metabolism.
- Once a week the app recalculates estimated expenditure from complete days only and updates calorie and macro targets. The meal plan regenerates to match.
- Targets change only when at least 5 of the newest 7 days are complete. Otherwise the estimate is shown and the previous targets stay.
- The calorie target moves at most ±150 kcal per week, whatever the estimate says.
- A target the user set by hand stays in force until the next weekly update, and that update moves from it.
- The user sees the estimate, the change from last week and the new targets. The maths is in `03` §8.3.

**S22. Photo and text meal estimates — MUST**
As a user having an off-plan meal, I want to log it from a photo or a short description, so that I still log it.
- A photo or description returns estimated calories, protein, carbohydrate, fat and fiber.
- The user confirms or edits the estimate before it is saved, and it is labelled as an estimate.
- Available as a "replaced" option on any planned meal.

**S23. Plateau protocols with evidence tags — MUST**
As a user whose weight trend has stalled, I want suggestions ranked by how well supported they are, so that I don't follow folklore.
- When the trend misses the phase's target rate for a set number of weeks, the app offers protocols such as a diet break or a refeed.
- Each recommendation carries an evidence tag (strong / moderate / contested) and its sources.

**S24. Health dashboard — SHOULD**
As a user, I want one screen showing recent trends for the ingested metrics, so that I actually look at my watch data.
- It shows 7-day and 30-day trends for sleep, resting heart rate, HRV, steps and weight.

### LATER

- Import from Hevy, MacroFactor and other apps.
- Automatic stall explainer.
- Pound units and a per-user unit setting.
- Recipe generation.
- watchOS app, native iOS app, social features.

## Empty states

| Where | With no data |
| --- | --- |
| Workout start | No routines yet: offer to create one or start an empty workout. |
| Set row, first time doing an exercise | No "last time" or suggestion; the row shows "first workout". |
| Progress chart, fewer than 2 workouts | "Not enough data yet"; no chart is drawn. |
| Weight trend, fewer than 3 days | Raw points only, no trend line. |
| Food list empty | The meal plan can't be built. Prompt to add foods, starting with a protein source. |
| No routine set | The plan can't place meals. Prompt for wake time, work hours, training days and bedtime. |
| No batch yield recorded | Cooked portions use the database's cooked values, marked approximate, with a prompt to weigh the batch. |
| Diet targets, no measured expenditure yet | Formula estimate, labelled provisional. |
| Health dashboard before first sync | Setup steps for connecting Apple Health data, plus "never synced". |
| Admin invite list | "Only you have access." |

## Edge cases

- **Duplicate set submission** (double tap, two tabs, retry after a timeout): each set carries an id generated on the client and is stored once.
- **Offline for a whole workout:** every set, the workout and the timer work offline, and it all syncs later without duplicates.
- **Food list can't hit protein:** the plan shows the shortfall in grams and suggests adding a protein source. It never pads other foods to hide it.
- **Food list can't fit the calories without extreme portions** (e.g. 900 g of rice): single portions are capped at a sensible maximum, and the plan flags the gap instead of breaking the cap.
- **Meal confirmed, then edited later that day:** the edit replaces the confirmed record; it is never counted twice.
- **Day left unconfirmed:** after the end-of-day check the day stays incomplete, and weekly expenditure uses complete days only.
- **Several weigh-ins in one day:** the first reading before 10:00 counts. Others are stored but not used for the trend.
- **Health data arriving late or twice:** a repeated reading replaces the earlier copy and is never added a second time.
- **Exercise deleted with history:** past workouts keep their data. The exercise leaves the picker but stays visible in history.
- **Revoked user with pending offline sets:** the upload is refused and the user is told that access was revoked.
- **Photo estimate badly wrong:** estimates are editable before saving, and adaptive expenditure absorbs logging error through the weight trend.

## Deliberately not in v1

See the brief's Out of scope list and the LATER section above.
