# 04 — Database schema

Postgres 18 on Neon. Decisions behind this file are in `docs/06-decision-log.md`
(2026-09-19 stack and hosting; 2026-09-20 ids, tables, deletion rules).

**Status:** M1 (training log) and M2 (meal plan + weight) are complete below. M3 (health +
coaching) is not written yet.

## Conventions

- `snake_case`, singular table names.
- Primary key `id uuid`, holding a **UUIDv7**. Rows created at the gym get their id on the phone
  (`uuid` npm, `v7()`); rows created online default to Postgres 18's `uuidv7()`.
- `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT
  now()` on every table. `updated_at` is maintained by the API, not a trigger.
- All instants are `timestamptz`, stored UTC.
- Weights are kilograms, `numeric(6,2)`. No pounds anywhere (S8).
- Foreign keys are named `<table>_id` and every one declares a delete behaviour.
- The schema changes only through versioned SQL migrations in `migrations/`.

## Tables owned by Better Auth

`user`, `session`, `account`, `verification` (core schema, checked 2026-09-19). We do not design
them. `advanced.database.generateId: "uuid"` makes `user.id` a `uuid` column, which every
`user_id` below references. Deleting a `user` row cascades through everything here.

---

## invite

One Google email allowed to sign in. A gate, not a feature — nothing references this table, and
removing invite-only means dropping it and deleting the `validateUserInfo` allowlist check.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `email` | text | no | — | Stored lowercased; the allowlist is matched on this |
| `invited_by_user_id` | uuid | yes | — | → `user.id`, `ON DELETE SET NULL` |
| `note` | text | yes | — | "Kenji, gym friend" |
| `revoked_at` | timestamptz | yes | — | Set on revoke; the row stays |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (email)`.
- Revoking also deletes that user's rows in Better Auth's `session` table, signing them out
  everywhere. Their data is untouched.

| id | email | note | revoked_at |
| --- | --- | --- | --- |
| `0192f3a1-…` | `yuta.asakura.se@gmail.com` | admin | `null` |
| `0192f3b7-…` | `kenji.tanaka@example.com` | gym friend | `2026-11-02 04:12:00+00` |

---

## exercise

One exercise. Either **seeded** (`owner_user_id IS NULL`, visible to everyone, ~50 rows) or
**custom** (owned by one user, visible only to them).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `owner_user_id` | uuid | yes | — | → `user.id`, `ON DELETE CASCADE`. `NULL` = seeded |
| `name` | text | no | — | "Barbell Bench Press" |
| `equipment` | text | no | — | `barbell` \| `dumbbell` \| `machine` \| `cable` \| `bodyweight` \| `other`, enforced by `CHECK` |
| `default_increment_kg` | numeric(5,2) | no | `2.50` | Fallback when the user has no setting row |
| `default_rest_seconds` | integer | no | `120` | Fallback. S5's 120 s default lives here |
| `default_rep_low` | smallint | no | `6` | Fallback rep range (S3) |
| `default_rep_high` | smallint | no | `10` | |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

- `CHECK (default_rep_low <= default_rep_high)`.
- `UNIQUE NULLS NOT DISTINCT (owner_user_id, lower(name))` — one user cannot have two exercises of
  the same name, and seeded names are unique among themselves.
- `INDEX (owner_user_id)` — the picker reads "seeded plus mine".
- Deleting a custom exercise that has sets logged is refused by the API; it is hidden instead (see
  `exercise_setting.hidden_at`). With no sets logged it is deleted outright.

| id | owner_user_id | name | equipment | default_increment_kg |
| --- | --- | --- | --- | --- |
| `0192a001-…` | `null` | Barbell Bench Press | barbell | 2.50 |
| `0192a1f4-…` | `0192u001-…` | Cable Y-Raise | cable | 1.00 |

---

## exercise_setting

One user's own settings for one exercise. Written only when the user changes something — absent
means "use the `exercise` defaults".

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `exercise_id` | uuid | no | — | → `exercise.id`, `ON DELETE CASCADE` |
| `increment_kg` | numeric(5,2) | yes | — | Overrides the exercise default |
| `rest_seconds` | integer | yes | — | Overrides |
| `rep_low` | smallint | yes | — | Overrides |
| `rep_high` | smallint | yes | — | Overrides |
| `hidden_at` | timestamptz | yes | — | Hidden from pickers and search. History still names it |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

- `PRIMARY KEY (user_id, exercise_id)`.
- `CHECK (rep_low IS NULL OR rep_high IS NULL OR rep_low <= rep_high)`.
- `hidden_at` covers both cases from the deletion rules: hiding a seeded exercise, and archiving a
  custom one that has history. One column, one meaning: *do not offer this to me any more*.

| user_id | exercise_id | increment_kg | rest_seconds | hidden_at |
| --- | --- | --- | --- | --- |
| `0192u001-…` | `0192a001-…` | 2.50 | 180 | `null` |
| `0192u001-…` | `0192a0c3-…` | `null` | `null` | `2026-10-04 11:20:00+00` |

---

## routine

One saved workout, like "Push A" (S4).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `name` | text | no | — | "Push A" |
| `position` | integer | no | `0` | Order in the routine list |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

- `INDEX (user_id, position)`.
- Hard delete. Past workouts survive — see `workout.routine_id`.

---

## routine_exercise

One exercise slot in a routine.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `routine_id` | uuid | no | — | → `routine.id`, `ON DELETE CASCADE` |
| `exercise_id` | uuid | no | — | → `exercise.id`, `ON DELETE RESTRICT` |
| `position` | integer | no | — | Order within the routine |
| `target_sets` | smallint | no | `3` | |
| `rep_low` | smallint | yes | — | Slot override; falls back to setting, then exercise |
| `rep_high` | smallint | yes | — | |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

- `INDEX (routine_id, position)`. **Not unique** — reordering would otherwise collide mid-update.
  Ties break on `id`, which is time-ordered.
- `ON DELETE RESTRICT` on `exercise_id`: an exercise still used by a routine cannot be deleted. The
  API tells the user which routines use it.

| id | routine_id | exercise_id | position | target_sets | rep_low | rep_high |
| --- | --- | --- | --- | --- | --- | --- |
| `0192r101-…` | `0192r001-…` | `0192a001-…` | 0 | 4 | 6 | 10 |
| `0192r102-…` | `0192r001-…` | `0192a1f4-…` | 1 | 3 | 12 | 15 |

---

## workout

One visit to the gym. The PRD calls this a "session"; that word means a login in Better Auth, so
the schema, API and code say **workout**.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | — | PK. **Generated on the phone** (UUIDv7) |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `routine_id` | uuid | yes | — | → `routine.id`, `ON DELETE SET NULL` |
| `name` | text | no | — | Copied from the routine at start, or typed. History keeps reading "Push A" after the routine is deleted or renamed |
| `started_at` | timestamptz | no | — | From the phone |
| `ended_at` | timestamptz | yes | — | `NULL` while in progress |
| `note` | text | yes | — | |
| `created_at` | timestamptz | no | `now()` | Server clock — when the row reached the server |
| `updated_at` | timestamptz | no | `now()` | |

- `INDEX (user_id, started_at DESC)` — the history list, the charts (S7) and "last time" (S2) all
  read most-recent-first per user.
- `started_at` comes from the phone and can be wrong if the phone's clock is wrong. `created_at`
  is the server's own record and is never used for display.

| id | user_id | routine_id | name | started_at | ended_at |
| --- | --- | --- | --- | --- | --- |
| `0192w001-…` | `0192u001-…` | `0192r001-…` | Push A | `2026-11-04 09:02:11+00` | `2026-11-04 10:14:50+00` |
| `0192w002-…` | `0192u001-…` | `null` | Quick arms | `2026-11-06 12:31:00+00` | `null` |

---

## workout_exercise

One exercise inside one workout, in the order it was actually done. Adding, removing or reordering
here does not touch the routine (S4).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | — | PK, from the phone |
| `workout_id` | uuid | no | — | → `workout.id`, `ON DELETE CASCADE` |
| `exercise_id` | uuid | no | — | → `exercise.id`, `ON DELETE RESTRICT` |
| `position` | integer | no | — | Order within the workout |
| `target_sets` | smallint | yes | — | Copied from the routine slot at start |
| `rep_low` | smallint | no | — | **Resolved and copied at start**: routine slot → user setting → exercise default |
| `rep_high` | smallint | no | — | Same |
| `increment_kg` | numeric(5,2) | no | — | Copied at start, same order |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

- `INDEX (workout_id, position)`, `INDEX (exercise_id)` — the second serves "last time" (S2) and
  the per-exercise chart (S7).
- The copied rep range and increment are what make a past workout honest: changing your settings
  today does not rewrite what you were aiming for in June, and the S3 progression rule reads the
  numbers the workout was actually run with.

---

## set

One logged set. The row the whole offline path exists to protect (S1).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | — | PK, **generated on the phone**. `INSERT … ON CONFLICT (id) DO NOTHING` is what makes upload exactly-once |
| `workout_exercise_id` | uuid | no | — | → `workout_exercise.id`, `ON DELETE CASCADE` |
| `set_number` | smallint | no | — | 1-based, within the exercise |
| `weight_kg` | numeric(6,2) | no | — | |
| `reps` | smallint | no | — | `CHECK (reps > 0)` |
| `rir` | smallint | yes | — | 0–10 |
| `rpe` | numeric(3,1) | yes | — | 1.0–10.0 |
| `is_warmup` | boolean | no | `false` | Warm-ups are stored and shown, but excluded from e1RM, volume and the S3 rule (S6) |
| `performed_at` | timestamptz | no | — | From the phone. The rest timer counts from the last set's value |
| `created_at` | timestamptz | no | `now()` | Server clock — when it actually arrived |
| `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (workout_exercise_id, set_number)`.
- `INDEX (workout_exercise_id, set_number)` is that constraint's index; it serves every read of a
  workout.
- `CHECK (rir IS NULL OR rpe IS NULL)` — a set records effort one way or the other, never both
  (S6).
- `created_at − performed_at` is how long a set sat in the phone's queue. Worth watching while the
  offline path is new.

| id | workout_exercise_id | set_number | weight_kg | reps | rir | is_warmup |
| --- | --- | --- | --- | --- | --- | --- |
| `0192s001-…` | `0192x001-…` | 1 | 60.00 | 10 | `null` | true |
| `0192s002-…` | `0192x001-…` | 2 | 100.00 | 8 | 2 | false |

---

## Queries the indexes are for

| Query | Path |
| --- | --- |
| **Last time** (S2): last session's weight × reps per set number | `workout (user_id, started_at DESC)` → `workout_exercise (exercise_id)` → `set (workout_exercise_id, set_number)` |
| **Suggestion** (S3): did every working set hit the top of the range last time | Same rows, plus `workout_exercise.rep_high` copied at start |
| **Chart** (S7): best working set per workout over a span, Epley `weight × (1 + reps / 30)` | `workout (user_id, started_at DESC)` filtered by span → the same join, `is_warmup = false` |
| **Upload a set** (S1) | `INSERT … ON CONFLICT (id) DO NOTHING` on the PK |
| **Exercise picker** (S8) | `exercise (owner_user_id)`, left joined to `exercise_setting` to drop `hidden_at` rows |
| **Export** (S10) | Every table by `user_id`, or by join for the child tables |

# M2 — meal plan + weight

Eleven tables. Three things M2 needs are **not** tables, because they are worked out from rows that
already exist: the prep plan and grocery list (S17), the daily weight used for the trend (S11), and
whether a day counts as complete (S18). Storing them would mean keeping two answers in step.

---

## user_profile

One row per user: the facts the maths needs and the clock the rules are read against.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `user_id` | uuid | no | — | PK, → `user.id`, `ON DELETE CASCADE` |
| `timezone` | text | no | `'Asia/Tokyo'` | IANA name. S11's "before 10:00 local" is read against this |
| `height_cm` | numeric(5,1) | yes | — | For the provisional formula estimate (S14) |
| `sex` | text | yes | — | `male` \| `female`, `CHECK`. Formula input only |
| `birth_date` | date | yes | — | Formula input only |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

---

## body_measurement

One reading from the scale, or one typed by hand (S11).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `measured_at` | timestamptz | no | — | When the reading was taken, not when it arrived |
| `weight_kg` | numeric(5,2) | no | — | |
| `body_fat_pct` | numeric(4,1) | yes | — | The Eufy scale sends it; hand entry usually will not |
| `source` | text | no | — | `apple_health` \| `manual`, `CHECK` |
| `external_id` | text | yes | — | The id the health export gave this sample |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id, source, external_id)` — the same Apple Health sample can arrive twice and only
  lands once. Same idea as the set upload, different key.
- `INDEX (user_id, measured_at DESC)`.
- **The day's weight is derived, not stored:** the first reading before 10:00 in the user's
  timezone; failing that, the day's first reading, flagged as not a morning weigh-in (S11, and the
  "several weigh-ins in one day" edge case). The smoothed trend line is computed in `domain/`, never
  written back.

---

## food

One food on the user's personal list (S12). Macros are stored **per 100 g of the state named**, so
everything downstream does one kind of arithmetic.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE`. The list is personal |
| `name` | text | no | — | 鶏むね肉（皮なし） |
| `brand` | text | yes | — | |
| `state` | text | no | `'raw'` | `raw` \| `cooked`, `CHECK` |
| `energy_kcal` | numeric(7,2) | no | — | Per 100 g |
| `protein_g` | numeric(6,2) | no | — | Per 100 g |
| `carb_g` | numeric(6,2) | no | — | Per 100 g |
| `fat_g` | numeric(6,2) | no | — | Per 100 g |
| `fiber_g` | numeric(6,2) | no | `0` | Per 100 g |
| `piece_weight_g` | numeric(6,2) | yes | — | Set for foods counted in units. One egg = 55 g. `NULL` means grams only |
| `source` | text | no | — | `mext` \| `open_food_facts` \| `label_photo` \| `manual`, `CHECK` |
| `source_ref` | text | yes | — | MEXT food code, or the barcode |
| `rotation_group_id` | uuid | yes | — | → `rotation_group.id`, `ON DELETE SET NULL` |
| `archived_at` | timestamptz | yes | — | Off the list, but past plans still name it |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `INDEX (user_id) WHERE archived_at IS NULL`.
- `INDEX (user_id, source_ref)` — barcode lookup checks "do I already have this?" first.
- Whatever basis the label or database gave (per piece, per serving), the API converts to per 100 g
  before saving. The confirmation screen shows the original basis; the table only ever holds one.

| id | name | state | energy_kcal | protein_g | piece_weight_g | source |
| --- | --- | --- | --- | --- | --- | --- |
| `0192f001-…` | 鶏むね肉（皮なし） | raw | 105.00 | 23.30 | `null` | mext |
| `0192f002-…` | 卵 M | raw | 142.00 | 12.20 | 55.00 | mext |

---

## rotation_group

A set of foods that stand in for each other (S12: okra ↔ broccoli, rice ↔ potato).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `name` | text | no | — | "green vegetable", "starch" |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- A group rather than pairs: "okra ↔ broccoli ↔ green beans" is one row plus three memberships, and
  the planner picks from a set instead of walking a chain of pairs.

---

## batch

One cook-up: how much went in raw, how much came out cooked (S13).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `food_id` | uuid | no | — | → `food.id`, `ON DELETE CASCADE` |
| `raw_weight_g` | numeric(8,2) | no | — | 1400.00 |
| `cooked_weight_g` | numeric(8,2) | no | — | 1050.00 |
| `cooked_on` | date | no | — | |
| `note` | text | yes | — | |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `CHECK (raw_weight_g > 0 AND cooked_weight_g > 0)`.
- `INDEX (user_id, food_id, cooked_on DESC)` — "the current batch" is the newest row for that food.
- The yield (`cooked ÷ raw`) is computed, not stored. Two stored numbers that must agree is one too
  many.

| food_id | raw_weight_g | cooked_weight_g | cooked_on |
| --- | --- | --- | --- |
| `0192f001-…` | 1400.00 | 1050.00 | 2026-11-03 |

---

## goal_phase

One cut, bulk or maintenance block (S14). Phases are kept, not overwritten — the history is how you
see what a previous cut actually did.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `type` | text | no | — | `cut` \| `bulk` \| `maintain`, `CHECK` |
| `started_on` | date | no | — | |
| `ended_on` | date | yes | — | `NULL` = current |
| `target_rate_pct_per_week` | numeric(4,2) | yes | — | 0.50–1.00 on a cut (Helms 2014) |
| `protein_g_per_kg` | numeric(4,2) | no | — | Default 1.6–2.2 (Morton 2018) |
| `fat_pct_calories` | numeric(4,1) | no | — | Carbohydrate is the remainder |
| `calorie_target_kcal` | integer | no | — | |
| `calorie_basis` | text | no | — | `provisional_formula` \| `measured` \| `manual`, `CHECK`. Drives the "provisional" label (S14) |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id) WHERE ended_on IS NULL` — one open phase at a time.
- The maintenance estimate (S18a) never writes here. Applying it is a user action that writes a new
  `calorie_target_kcal` with `calorie_basis = 'measured'`.

---

## day_routine

The user's weekday shape, one row per day type (S15).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `day_type` | text | no | — | `training` \| `rest`, `CHECK` |
| `wake_time` | time | no | — | Local to `user_profile.timezone` |
| `work_start` / `work_end` | time | yes | — | |
| `training_time` | time | yes | — | `NULL` on rest days |
| `bed_time` | time | no | — | |
| `meal_count` | smallint | no | `4` | Recommended, then editable (S15) |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `PRIMARY KEY (user_id, day_type)`.
- Which calendar days are training days comes from the routine the user sets, not from whether a
  workout happened. A missed session does not retroactively rewrite the plan.

---

## meal_slot

One meal in the day's shape — "meal 3, 15:30, post-training" (S15).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `day_type` | text | no | — | `training` \| `rest` |
| `position` | smallint | no | — | 1-based |
| `target_time` | time | no | — | |
| `label` | text | yes | — | "post-training" |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `FOREIGN KEY (user_id, day_type)` → `day_routine`, `ON DELETE CASCADE`.
- `INDEX (user_id, day_type, position)`, not unique — same reordering reason as `routine_exercise`.

---

## plan_day

One calendar day's plan (S16). Written when the plan is generated, then confirmed against through
the day (S18).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `plan_date` | date | no | — | Local date |
| `day_type` | text | no | — | `training` \| `rest` |
| `goal_phase_id` | uuid | yes | — | → `goal_phase.id`, `ON DELETE SET NULL` |
| `target_kcal` | integer | no | — | **Copied from the phase when the day was generated** |
| `target_protein_g` | numeric(6,1) | no | — | Copied |
| `target_carb_g` | numeric(6,1) | no | — | Copied |
| `target_fat_g` | numeric(6,1) | no | — | Copied |
| `generated_at` | timestamptz | no | `now()` | |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id, plan_date)`.
- Targets are copied for the same reason a workout copies its rep range: changing your phase today
  must not rewrite what last Tuesday was aiming for.
- **A day is complete** when every `plan_meal` on it has a status other than `planned` (S18). That
  is a query, not a column — the condition is only ever read, never set by hand.

---

## plan_meal

One meal in one day's plan, and what became of it (S18).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `plan_day_id` | uuid | no | — | → `plan_day.id`, `ON DELETE CASCADE` |
| `position` | smallint | no | — | |
| `planned_time` | time | no | — | |
| `label` | text | yes | — | |
| `status` | text | no | `'planned'` | `planned` \| `as_planned` \| `adjusted` \| `replaced` \| `skipped`, `CHECK` |
| `confirmed_at` | timestamptz | yes | — | `NULL` while `planned` |
| `is_pre_training` / `is_post_training` | boolean | no | `false` | Why this meal got more carbohydrate (S16) |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `INDEX (plan_day_id, position)`.
- `skipped` is an explicit "I did not eat this"; `planned` past the end of the day means unconfirmed,
  which is what the end-of-day check lists and what makes the day incomplete.

---

## plan_meal_item

One food in one meal, planned and as eaten (S16, S18).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `plan_meal_id` | uuid | no | — | → `plan_meal.id`, `ON DELETE CASCADE` |
| `food_id` | uuid | yes | — | → `food.id`, `ON DELETE SET NULL`. `NULL` for a hand-entered off-plan item |
| `name` | text | no | — | Copied from the food, or typed |
| `planned_grams` | numeric(7,2) | yes | — | Cooked weight for batch-cooked foods. `NULL` on an item that was only ever eaten, never planned |
| `actual_grams` | numeric(7,2) | yes | — | Set when adjusted or replaced |
| `piece_count` | numeric(5,2) | yes | — | For unit foods; grams follow from `food.piece_weight_g` |
| `batch_id` | uuid | yes | — | → `batch.id`, `ON DELETE SET NULL`. The yield used to convert cooked → raw macros |
| `energy_kcal_per_100g` | numeric(7,2) | no | — | **Snapshot** of the food's macros at plan time |
| `protein_g_per_100g` | numeric(6,2) | no | — | Snapshot |
| `carb_g_per_100g` | numeric(6,2) | no | — | Snapshot |
| `fat_g_per_100g` | numeric(6,2) | no | — | Snapshot |
| `fiber_g_per_100g` | numeric(6,2) | no | `0` | Snapshot |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `INDEX (plan_meal_id)`.
- **Why the snapshot.** Correcting a food's protein next March must not silently change what
  February's intake says you ate — and S18a's maintenance estimate is read straight off these rows.
  Same rule as `workout_exercise`: the numbers a day was actually run with stay with that day.
- Gram amounts are rounded to 5 g by the planner before they are written (S16); the column does not
  enforce it, because an adjusted amount is whatever the user weighed.

| plan_meal_id | name | planned_grams | actual_grams | protein_g_per_100g |
| --- | --- | --- | --- | --- |
| `0192m001-…` | 鶏むね肉（皮なし、加熱後） | 180.00 | `null` | 31.10 |
| `0192m001-…` | 白米（炊飯後） | 250.00 | 200.00 | 2.50 |

---

## What M2 derives instead of storing

| Wanted | Read from |
| --- | --- |
| Daily weight and the smoothed trend (S11) | `body_measurement`, by the before-10:00 rule in `user_profile.timezone` |
| A cooked portion's macros (S13) | `food` per-100 g raw values × the newest `batch` yield |
| Prep plan: raw grams to cook this week (S17) | The week's `plan_meal_item` cooked grams ÷ the newest yield per food |
| Grocery list (S17) | The prep plan, summed per food |
| Is this day complete (S18) | No `plan_meal` on it left at `planned` |
| Average intake over 14 complete days (S18a) | `plan_meal_item` snapshots on complete days only |

## Open

- Whether the chart query needs a materialised per-workout best-set row. Not until it is slow;
  one user's year of training is a few thousand rows.
- M3 tables (health samples, overlays, expenditure, photo estimates, plateau protocols).
- The smoothing method for the weight trend is picked before M2 starts (2026-09-19 decision, `06`).
