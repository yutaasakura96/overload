# Overload

A weight-training, meal-plan and health tracker in which the app enters the data and the user
confirms it. This file is the shared vocabulary: specs, tickets, code, tables and API paths use these
words and not the ones under _Avoid_. Where a term has a table, the table name is given; the full
columns are in `docs/04`.

## Access

**Admin**:
The one user who can invite and revoke members. Yuta. Has no access to any member's data.
_Avoid_: owner, superuser

**Member**:
An invited user with the full app over their own data only.
_Avoid_: invitee (outside the invite flow itself), customer, account

**Invite**:
One Google email address the admin has allowed to sign in (`invite`). A gate, not a feature: nothing
else references it.
_Avoid_: allowlist entry, whitelist

**Revoke**:
Ending a member's access: the invite gets `revoked_at`, every login session and ingest token of theirs
ends, and their data stays.
_Avoid_: ban, remove, delete (deletion is a separate, destructive act)

**Session**:
A login, as Better Auth means it (`session`). Never a gym visit.
_Avoid_: using it for a workout

**Ingest token**:
A per-user secret that Health Auto Export sends as a bearer token, authorising exactly one route
(`ingest_token`). Shown once, stored hashed, never expires on its own.
_Avoid_: API key, access token, HAE password

**Audit event**:
One row in `audit_event`: who did what to access or an account (sign-in, invite, revoke, token,
deletion). Append-only, kept a year, never holds health or food values.
_Avoid_: log, activity, history

**Before the first invitee**:
The gate between Yuta as the only user and a friend signing in. Model-call cap, compliance and the
Anthropic key split wait for it (`docs/13` §9). Nothing on that list blocks M1.
_Avoid_: launch, go-live, production (production exists from M1)

## Training

**Workout**:
One visit to the gym, logged in the app (`workout`). The UI may say "session"; nothing else does.
_Avoid_: session, training session, gym session

**Apple workout**:
An exercise session recorded by the watch and imported from Apple Health (`health_workout`). May be
linked to a workout, or not.
_Avoid_: calling it a workout unqualified

**Link**:
The association between an Apple workout and a workout, made automatically by time overlap or
chosen by the user. A manual link, or a manual unlink, is never overwritten.
_Avoid_: match (for the stored result), merge

**Routine**:
A saved, ordered list of exercises with target sets and rep ranges, like "Push A" (`routine`).
_Avoid_: template, program, plan (plan belongs to meals); using "routine" for the weekday shape

**Exercise**:
A movement in the library, either **seeded** (shared, about 50) or **custom** (one user's own).
A **hidden** exercise is off the user's pickers but still named in history.
_Avoid_: lift, movement (in code)

**Set**:
One logged effort of an exercise within a workout, with weight, reps and optional RIR or RPE (`set`).
Its id is made on the phone.

**Working set**:
A set that is not a warm-up. Only working sets count towards e1RM, volume and the suggestion.
_Avoid_: work set, top set (top set is the heaviest working set, a narrower thing)

**Warm-up set**:
A set flagged `is_warmup`. Stored and shown, excluded from every calculation.

**Last time**:
The weight × reps of the same working set (nth against nth, warm-ups not counted) in the most recent
workout containing that exercise.
_Avoid_: previous, history

**Suggestion**:
Today's proposed weight for an exercise: last weight plus the increment if every working set last
time reached the top of the rep range, otherwise the same weight. Never overwrites a typed value.
_Avoid_: recommendation, target weight, prescription

**Increment**:
The step a suggestion adds, per exercise (2.5 kg barbell, 2 kg dumbbell by default).
_Avoid_: jump, step size

**e1RM**:
Estimated one-rep max of the best working set in a workout, by Epley: `weight × (1 + reps / 30)`.
_Avoid_: 1RM, max (it is an estimate)

## Offline

**Set store**:
The device's own IndexedDB store holding one record per set, and per `workout` and `workout_exercise`
row, until the server acknowledges it. The open workout's rows stay until the workout ends, so the
workout can be rebuilt after iOS closes the app.
_Avoid_: queue (in code), cache, outbox

**Tombstone**:
The id of a workout, workout exercise or set deleted through sync, kept 30 days so a stale copy is not
inserted again (`sync_tombstone`). An id and a time, no content.
_Avoid_: soft delete, deleted flag

**Pending set**:
A set in the set store that the server has not yet acknowledged. The count of pending sets is what the
data-state slot shows.
_Avoid_: unsynced, offline set, draft

**Acknowledged**:
The server has stored the set and returned it. Only then is the local record deleted, or, while its
workout is open, marked acknowledged and deleted when the workout ends.
_Avoid_: synced (for a single set)

**Refused set**:
A pending set the server rejected (validation failed, access revoked). It stays in the set store,
shown in the error colour, to be edited or discarded. Never dropped silently.
_Avoid_: failed set, error set, rejected

**Data-state slot**:
The single place in the app bar that shows whichever data condition is true: pending count, refused
count, last sync time, or the age of cached data.
_Avoid_: sync badge, pending chip (the chip is its screen-1 form), status bar

## Meals

**Food**:
One item on the user's personal food list, with macros per 100 g of its named state, raw or cooked
(`food`).
_Avoid_: ingredient, product, item

**Food list**:
The user's own foods, which are the only thing the planner plans from.
_Avoid_: pantry, library, database (the MEXT table and Open Food Facts are *sources*, not the list)

**Rotation group**:
A set of foods that stand in for each other, like okra, broccoli and green beans (`rotation_group`).
The planner varies the week by picking within a group.
_Avoid_: alternative pair, swap list, substitute

**Batch**:
One cook-up of one food, recorded as raw weight in and cooked weight out (`batch`). The **current
batch** is the newest one for that food.
_Avoid_: cook, prep (prep is the plan to cook)

**Batch yield**:
Cooked weight ÷ raw weight for a batch. Derived, never stored. Converts a cooked portion to raw macros.
_Avoid_: yield factor, cook loss, conversion rate

**Day type**:
Training or rest. A calendar day's type comes from the day routine, not from whether a workout
happened.

**Day routine**:
The user's weekday shape for one day type: wake, work, training time, bed and meal count
(`day_routine`), with its **meal slots**.
_Avoid_: bare "routine" (that is a saved workout), schedule

**Plan day**:
One calendar day's generated meal plan, carrying its own copied targets (`plan_day`).
_Avoid_: meal plan (for one day), diary day

**Plan meal**:
One meal in a plan day, and its status (`plan_meal`).
_Avoid_: meal log, entry

**Confirm**:
Recording what happened to a plan meal: **as planned**, **adjusted**, **replaced** or **skipped**. The
plan is the log; confirming is how intake is recorded.
_Avoid_: log, track, check off

**Unconfirmed**:
A plan meal still at `planned`. Not counted as eaten.
_Avoid_: pending (pending belongs to sets), missed

**Complete day**:
A plan day on which no plan meal is still unconfirmed. Derived, never stored. Only complete days feed
the maintenance check and the expenditure estimate.
_Avoid_: logged day, full day, valid day

**Incomplete day**:
A plan day left with at least one unconfirmed meal after the end-of-day check. Leaving a day
incomplete is a real choice, not a failure.

**End-of-day check**:
The screen that lists the day's unconfirmed meals and lets them all be confirmed at once.
_Avoid_: daily review, close-out

**Prep plan**:
The raw grams to cook per food for the coming week, worked out from the plan and the current batch
yield. Derived.
_Avoid_: prep list (the screen title may use it), cooking plan

**Grocery list**:
The prep plan summed per food, to buy. Derived.
_Avoid_: shopping list

**Snapshot**:
Numbers copied onto a row when it was made (a plan day's targets, a plan meal item's macros, a
workout exercise's rep range, a protocol's evidence tag) so later edits never rewrite the past.
_Avoid_: denormalised copy, cache

**Meal estimate**:
Macros for an off-plan meal read from a photo or a short description by the model, confirmed or
edited by the user before it is saved (`meal_estimate`). Always replaces a plan meal.
_Avoid_: AI log, photo log, guess

## Weight and coaching

**Weigh-in**:
One scale reading or hand-typed weight (`body_measurement`).
_Avoid_: measurement (in prose), weight entry

**Daily weight**:
The day's first weigh-in before 10:00 local time, or failing that the day's first weigh-in, flagged
as not a morning weigh-in. Derived.
_Avoid_: morning weight (for the fallback case), today's weight

**Trend**:
The smoothed weight line: a time-aware EWMA of the daily weights at 10% per day. Derived at read
time, never stored.
_Avoid_: average weight, moving average (in the UI), smoothed weight

**Goal phase**:
One cut, bulk or maintain block with its own target rate, protein rule and starting calorie target
(`goal_phase`). One open at a time; old ones are kept.
_Avoid_: goal, diet, program

**Targets**:
A day's calorie, protein, carbohydrate and fat goals. A plan day copies them from the newest applied
estimate of its phase, or from the phase itself when there is none.
_Avoid_: macros (for the goals), budget

**Provisional**:
A calorie target from the formula estimate, before any measured expenditure exists. Always labelled.

**Maintenance check**:
The M2, read-only comparison of mean intake on complete days against the trend's change over the
trailing 14 days (the same window as the expenditure estimate), giving an implied maintenance
figure. It appears once the user has 14 complete days in total, and shows a figure only with at least
3 weigh-ins in the window and one in its newest 7 days. It never changes targets unless the user
applies it.
_Avoid_: TDEE check, metabolism test

**Expenditure estimate**:
The M3 weekly recalculation of energy expenditure from the trailing 14 days, with the targets it
produces (`expenditure_estimate`). Written every week whether or not it is applied.
_Avoid_: TDEE (except for the number itself), metabolic rate, weekly check-in

**Applied estimate**:
An expenditure estimate whose targets are in force (`applied_at` set). Applied only when the newest
7 days hold at least 5 complete days; the new calorie target moves at most ±150 kcal from the
previous applied one.
_Avoid_: active estimate, accepted estimate

**Plateau**:
The trend missing the phase's target rate for a protocol's set number of weeks.
_Avoid_: stall (a stall is a lift not progressing), stuck

**Protocol**:
A named plateau response in the code catalogue: diet break, refeed, reduce deficit, deload.
_Avoid_: intervention, strategy

**Protocol suggestion**:
One protocol offered to one user on one day, and whether they accepted or dismissed it
(`protocol_suggestion`). A dismissed protocol is not offered again in the same phase.

**Evidence tag**:
The strong, moderate or contested label on a recommendation, with a route to its sources.
_Avoid_: confidence, rating, badge

## Health data

**Health sample**:
One value of one metric for one day or night, as Apple Health currently reports it
(`health_sample`). A repeat replaces the earlier copy.
_Avoid_: reading, data point, record

**Metric**:
A named health series from the fixed vocabulary in `docs/04` (`resting_heart_rate`,
`sleep_deep_hours`, …).
_Avoid_: type, field, stat

**Automation**:
One of the three Health Auto Export REST exports set up on the phone: `overload-weight`,
`overload-daily`, `overload-workouts`. Fixed at setup.
_Avoid_: sync job, webhook, integration

**Sync state**:
When a series last arrived, and its newest sample (`health_sync_state`): each metric, plus `body_mass`
for weight and `workouts` for Apple workouts. What tells a dead sync from a quiet week.
_Avoid_: last updated, freshness (in code)

**Overlay**:
A series (intake, trend, sleep, HRV) drawn on an exercise's e1RM chart against the same date axis.
_Avoid_: layer, comparison

## Jobs

**Daily job**:
The once-a-day cron that writes each user's weekly expenditure estimate once their local Monday has
begun and regenerates the week's unconfirmed plan days. Re-running it is harmless, and the first
request that needs current targets runs it inline if the cron was missed. It also purges audit
events older than a year and tombstones older than 30 days.
_Avoid_: weekly cron, batch job

**Nightly backup**:
The GitHub Actions `pg_dump` of production to S3, encrypted before upload. Separate from Neon's
restore history, which reaches back only 6 hours.
_Avoid_: snapshot (a Neon snapshot is the manual one before a destructive migration)
