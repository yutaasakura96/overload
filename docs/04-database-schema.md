# 04 — Database schema

Postgres 18 on Neon. Decisions behind this file are in `docs/06-decision-log.md`
(2026-09-19 stack and hosting; 2026-09-20 ids, tables, deletion rules; 2026-09-21 M3 tables).

**Status:** complete for M1 (training log), M2 (meal plan + weight) and M3 (health + coaching),
plus the security roles and `audit_event` from `docs/13`, which ship with M1.

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
| `client_updated_at` | timestamptz | no | — | Phone's clock at the last edit. Sync applies a row only when this is newer than the stored value (`docs/07` §3.4) |
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
| `client_updated_at` | timestamptz | no | — | Same sync guard as `workout` |
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
| `id` | uuid | no | — | PK, **generated on the phone**. Sync upserts on it, guarded by `client_updated_at`, which is what makes upload exactly-once |
| `workout_exercise_id` | uuid | no | — | → `workout_exercise.id`, `ON DELETE CASCADE` |
| `set_number` | smallint | no | — | 1-based, within the exercise |
| `weight_kg` | numeric(6,2) | no | — | |
| `reps` | smallint | no | — | `CHECK (reps > 0)` |
| `rir` | smallint | yes | — | 0–10 |
| `rpe` | numeric(3,1) | yes | — | 1.0–10.0 |
| `is_warmup` | boolean | no | `false` | Warm-ups are stored and shown, but excluded from e1RM, volume and the S3 rule (S6) |
| `performed_at` | timestamptz | no | — | From the phone. The rest timer counts from the last set's value |
| `client_updated_at` | timestamptz | no | — | Same sync guard as `workout`. An edit made offline mid-workout travels in the same batch |
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
| **Upload a set** (S1) | `INSERT … ON CONFLICT (id) DO UPDATE … WHERE set.client_updated_at < EXCLUDED.client_updated_at` on the PK. *Changed 2026-09-21* from `DO NOTHING`, so offline edits and deletes use the same path (`docs/07` §3.4) |
| **Exercise picker** (S8) | `exercise (owner_user_id)`, left joined to `exercise_setting` to drop `hidden_at` rows |
| **Export** (S10) | Every table by `user_id`, or by join for the child tables |

# M2 — meal plan + weight

Eleven tables, plus the shared `reference_food` catalogue added 2026-09-21. Three things M2 needs are **not** tables, because they are worked out from rows that
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
| `training_weekdays` | smallint[] | no | `'{}'` | ISO weekdays, 1 = Monday. Which calendar days are training days (S15). *Added 2026-09-21*: the schema had no record of it |
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
| `external_id` | text | yes | — | HealthKit's sample UUID. **`NULL` for Health Auto Export rows**, whose metric payload carries no id; kept for a native HealthKit client |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id, source, measured_at)` — the same weigh-in arriving twice lands once. Ingest is
  `ON CONFLICT … DO UPDATE`, as for `health_sample`. *Corrected 2026-09-21:* this was
  `(user_id, source, external_id)`, but Health Auto Export sends no per-sample id, so that key would
  never have matched a repeat (`docs/03` §9).
- `body_fat_pct` and `lean_mass_kg` are filled by hand entry (and later a native client). Health
  Auto Export sends both as daily `health_sample` metrics instead (`docs/03` §9).
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

## reference_food

The MEXT 日本食品標準成分表（八訂）増補2023 catalogue, imported by `seed/`, searched when adding a
food (S12). **Shared, read-only, and not the food list**: choosing an entry copies its values into a
new `food` row with `source = 'mext'` and `source_ref = code`. *Added 2026-09-21*: `docs/07` needs
it, and the schema had nowhere to keep it.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `code` | text | no | — | PK. MEXT 食品番号, e.g. `11220` |
| `name` | text | no | — | As MEXT prints it |
| `food_group` | smallint | no | — | MEXT 食品群, 1–18 |
| `state` | text | no | — | `raw` \| `cooked`, `CHECK`. Derived from the MEXT name at import |
| `energy_kcal` / `protein_g` / `carb_g` / `fat_g` / `fiber_g` | numeric | no | — | Per 100 g, same types as `food` |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- The PK is MEXT's own code rather than a UUIDv7, the one exception to the id convention: the
  catalogue already has a stable key, and nothing references it.
- No `user_id` and no foreign keys in or out. A `food` copied from it keeps working if the seed is
  re-imported, because the values were copied, not referenced.
- `INDEX` on `name` with `pg_trgm` (`gin_trgm_ops`) for search. **Unverified:** that `pg_trgm` is
  available on Neon Free. Check it when M2 starts; `ILIKE` over ~2,500 rows is the fallback.
- Which MEXT column supplies `carb_g` (差引き法 or 利用可能炭水化物) is decided at import and recorded
  in `seed/`.

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
| `protein_g_per_kg` | numeric(4,2) | no | — | Per kg of bodyweight. Range 1.6–2.2 (Morton 2018); a cut defaults to 2.2 (S14) |
| `fat_pct_calories` | numeric(4,1) | no | — | Carbohydrate is the remainder |
| `calorie_target_kcal` | integer | no | — | |
| `calorie_basis` | text | no | — | `provisional_formula` \| `measured` \| `manual`, `CHECK`. Drives the "provisional" label (S14) |
| `calorie_target_set_at` | timestamptz | no | `now()` | When `calorie_target_kcal` was last set by the user. *Added 2026-09-21* (`docs/09` F13): current targets read the newer of this and the newest applied `expenditure_estimate` |
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

# M3 — health + coaching

Seven tables of our own (`ingest_token` added 2026-09-21), plus one column added to each of two M2 tables. Two things M3 needs are
**not** tables: the overlay series on a chart (S20) and the plateau protocol catalogue itself (S23).
Both are covered at the end.

**Health metric samples carry no per-sample id** — verified 2026-09-21 against Health Auto Export's JSON
format, where a metric data point is `{qty, date, source?}` and only a *workout* has an `id` field.
So metrics key on `(user_id, metric, started_at)` and workouts key on the id they are given.

---

## health_sample

One reading of one metric (S19). A long table: the metric is a value in a column, not a column of
its own, so adding sleeping wrist temperature later is a new string rather than a migration.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `metric` | text | no | — | From the vocabulary below |
| `value` | numeric(10,3) | no | — | |
| `unit` | text | no | — | `count` \| `kcal` \| `bpm` \| `ms` \| `hr` \| `pct` \| `kg`, `CHECK` |
| `started_at` | timestamptz | no | — | The sample's own start, from the export |
| `ended_at` | timestamptz | yes | — | `NULL` for a point reading |
| `source` | text | no | — | `apple_health` \| `manual`, `CHECK`. Same vocabulary as `body_measurement` |
| `device` | text | yes | — | What recorded it, when the export says. Omitted on iOS 27+ for cumulative and heart-rate data |
| `external_id` | text | yes | — | HealthKit's own sample UUID. **Always `NULL` today** — kept because a native client reading HealthKit directly would have it |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id, metric, started_at)`. This is the de-duplication key, and it is a natural key
  rather than an id because the payload gives us nothing else to key on.
- Ingest is `INSERT … ON CONFLICT (user_id, metric, started_at) DO UPDATE`. **Update, not nothing** —
  the PRD's edge case says a repeated reading *replaces* the earlier copy, which is the opposite of
  the set upload's `DO NOTHING`. A set is a fact the phone observed once; a health sample is Apple's
  current answer, and Apple revises it.
- `INDEX (user_id, metric, started_at DESC)` — the constraint's index, and the one every overlay
  (S20) and dashboard trend (S24) reads.
- `metric` is `text`, not an enum. The vocabulary is a typed union in `domain/` and validated at the
  API edge, so a typo cannot land, but widening it never needs a migration.
- **Export aggregation is fixed at setup.** Health Auto Export can send step count daily or hourly.
  Changing that setting changes what one row means and would collide against the same
  `started_at`, so it is chosen once and recorded — the setup path is specified in `docs/03`.

| user_id | metric | value | unit | started_at | ended_at |
| --- | --- | --- | --- | --- | --- |
| `0192u001-…` | `resting_heart_rate` | 52.000 | bpm | `2026-11-04 00:00:00+09` | `null` |
| `0192u001-…` | `sleep_deep_hours` | 1.500 | hr | `2026-11-03 23:00:00+09` | `2026-11-04 06:30:00+09` |

---

## The metric vocabulary

S19's list, mapped onto what the export actually sends. Names are the exporter's own `snake_case`
where one exists, so the import does as little renaming as possible.

| `metric` | `unit` | Comes from | One row per |
| --- | --- | --- | --- |
| `resting_heart_rate` | bpm | `resting_heart_rate.qty` | day |
| `heart_rate_variability` | ms | `heart_rate_variability.qty` | day (daily grouping averages the readings) |
| `step_count` | count | `step_count.qty` | day |
| `active_energy` | kcal | `active_energy.qty` | day |
| `sleep_total_hours` | hr | `sleep_analysis.totalSleep` | night |
| `sleep_core_hours` | hr | `sleep_analysis.core` | night |
| `sleep_deep_hours` | hr | `sleep_analysis.deep` | night |
| `sleep_rem_hours` | hr | `sleep_analysis.rem` | night |
| `sleep_in_bed_hours` | hr | `sleep_analysis.inBed` | night |
| `body_fat_percentage` | pct | `body_fat_percentage.qty` | day |
| `lean_body_mass` | kg | `lean_body_mass.qty` | day |

- **Sleep is ingested aggregated**, which is a setting in the exporting app. Aggregated mode gives
  one summary per night — `totalSleep`, `core`, `deep`, `rem`, `inBed` in hours, plus `sleepStart`
  and `sleepEnd` — which is exactly the shape S24's 7- and 30-day trends and S20's overlay want.
  Unaggregated mode gives raw segments and would have to be summed on every read.
- The stage names are the exporter's flattening of HealthKit's `asleepCore`, `asleepDeep` and
  `asleepREM`, which are the iOS 16 / watchOS 9 sleep-stage cases (Apple's
  `HKCategoryValueSleepAnalysis`, checked 2026-09-21). `asleepUnspecified` is what older data and
  non-Apple sources land in; it is carried inside `totalSleep` and not stored separately.
- The four sleep-duration rows share `started_at = sleepStart` and `ended_at = sleepEnd`.
  `sleep_in_bed_hours` uses `inBedStart` / `inBedEnd` instead, because it is a different interval.
- **Every metric here arrives in the daily automation** (Summarize ON, Time Grouping = Days;
  `docs/03` §9), so one row per metric per day or night. Weight is the exception and goes to
  `body_measurement`, from its own unaggregated automation.
- **Body fat and lean body mass are here**, not on `body_measurement`. *Changed 2026-09-21:* the
  export can only send individual points for a single-metric automation, so these two arrive as
  daily values in a different request from the weight, in no fixed order, and there may be no weight
  row yet to attach them to. The exporter's metric names were not checked letter by letter; confirm
  them against the first real payload.
- Plain `heart_rate` is deliberately not ingested. The export sends it as `Min`/`Avg`/`Max` over a
  period rather than one number, and S19 only asks for resting heart rate and workout heart rate.

---

## health_workout

One Apple workout — a watch-recorded exercise session (S19). Distinct from `workout`, which is a
gym visit *you* logged. The watch may record one where you logged none, and the other way round.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK, ours |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `workout_id` | uuid | yes | — | → `workout.id`, `ON DELETE SET NULL`. The gym visit this appears to be |
| `activity_type` | text | no | — | Apple's own name: "Traditional Strength Training" |
| `started_at` / `ended_at` | timestamptz | no | — | |
| `duration_seconds` | integer | no | — | The export gives this directly; it is not always `ended_at − started_at` |
| `avg_heart_rate` | smallint | yes | — | bpm |
| `max_heart_rate` | smallint | yes | — | bpm |
| `active_kcal` | numeric(7,2) | yes | — | |
| `is_indoor` | boolean | yes | — | |
| `source` | text | no | — | `apple_health` \| `manual`, `CHECK` |
| `external_id` | text | yes | — | The export's workout `id`, a UUID. Present for everything Apple sends |
| `link_source` | text | yes | — | `auto` \| `manual`, `CHECK`. `NULL` = never linked. `manual` with `workout_id` `NULL` = the user unlinked it |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id, external_id)` — workouts *do* carry an id, so this one keys the way
  `body_measurement` does. Same `DO UPDATE` rule as `health_sample`.
- `INDEX (user_id, started_at DESC)`, and `INDEX (workout_id) WHERE workout_id IS NOT NULL`.
- **The link to `workout` is a guess, not a fact.** Matched by overlap at ingest, correctable by the
  user (`docs/03` §9). The upsert leaves `workout_id` and `link_source` alone when
  `link_source = 'manual'`, so a re-import never undoes a correction. `ON DELETE SET NULL` means
  deleting a gym visit leaves the watch's record of it intact.

---

## health_sync_state

When each metric last synced (S19). **The one place M3 stores something it could almost derive**,
and the reason is worth stating: a sync that ran correctly and carried nothing leaves no sample
behind, so there is no row from which to derive that it happened. Without this table a dead sync
and a quiet week look identical, which is the exact distinction the dashboard exists to make.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `metric` | text | no | — | |
| `last_synced_at` | timestamptz | no | — | When a payload last covered this metric, new samples or not |
| `last_sample_at` | timestamptz | yes | — | Newest `started_at` seen |
| `sample_count` | integer | no | `0` | Running total, for "is this actually working" |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `PRIMARY KEY (user_id, metric)`. One upsert per metric per import.
- **No row means never synced**, which is the dashboard's empty state without a flag column.

| user_id | metric | last_synced_at | last_sample_at | sample_count |
| --- | --- | --- | --- | --- |
| `0192u001-…` | `heart_rate_variability` | `2026-11-04 07:02:00+00` | `2026-11-01 22:14:00+00` | 3186 |

---

## expenditure_estimate

One week's recalculation (S21). Written by the weekly job, never overwritten — "the change from
last week" is two rows, and a finished cut can be read back as the sequence of estimates it was
actually run on.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `goal_phase_id` | uuid | no | — | → `goal_phase.id`, `ON DELETE CASCADE` |
| `week_start` | date | no | — | Local Monday, per `user_profile.timezone` |
| `estimated_tdee_kcal` | integer | no | — | |
| `previous_tdee_kcal` | integer | yes | — | `NULL` on the first estimate of a phase |
| `window_days` | smallint | no | `14` | Span the estimate was computed over, ending the day before `week_start` |
| `trend_weight_delta_kg` | numeric(5,3) | no | — | Change in the *smoothed* trend across the window, not raw weights |
| `mean_intake_kcal` | integer | no | — | Over complete days in the window only |
| `complete_day_count` | smallint | no | — | Complete days in the whole window |
| `week_complete_day_count` | smallint | no | — | Complete days in the newest 7. `≥ 5` is the condition for applying (`docs/03` §8.3) |
| `method` | text | no | — | Which maths produced it, e.g. `weight_trend_balance_v1` |
| `target_kcal` | integer | no | — | The targets this estimate produced. Clamped to ±150 kcal of the previous applied target; the TDEE itself is not clamped |
| `target_protein_g` | numeric(6,1) | no | — | |
| `target_carb_g` | numeric(6,1) | no | — | |
| `target_fat_g` | numeric(6,1) | no | — | |
| `applied_at` | timestamptz | yes | — | `NULL` = computed but not in force |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id, week_start)`, `INDEX (user_id, week_start DESC)`.
- **`plan_day` copies from the newest *applied* estimate of the day's phase**, falling back to
  `goal_phase.calorie_target_kcal` when there is none. `goal_phase` keeps its meaning — what you
  decided, and the provisional formula figure you started from — and stops being rewritten by a job.
- `applied_at IS NULL` is how a thin week is handled: too few complete days and the estimate is
  still recorded, still visible, but the previous targets stay in force. The threshold (5 of the
  newest 7 days) and the smoothing method are in `docs/03` §8.3.
- `method` is there so an old row stays honest. When the maths is improved, past estimates keep
  saying which version produced them rather than being silently reinterpreted.

| week_start | estimated_tdee_kcal | previous_tdee_kcal | trend_weight_delta_kg | complete_day_count | week_complete_day_count | target_kcal | applied_at |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-09 | 2780 | 2840 | -0.824 | 12 | 6 | 2380 | `2026-11-08 15:05:00+00` |
| 2026-11-16 | 2765 | 2780 | -0.760 | 9 | 3 | 2380 | `null` |

---

## meal_estimate

One photo or text estimate (S22), and what the user did with it.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `plan_meal_id` | uuid | no | — | → `plan_meal.id`, `ON DELETE CASCADE`. An estimate always replaces a planned meal |
| `input_kind` | text | no | — | `photo` \| `text`, `CHECK` |
| `input_text` | text | yes | — | The description typed. `NULL` for a photo |
| `model` | text | no | — | `claude-haiku-4-5-20251001` |
| `raw_energy_kcal` | numeric(7,2) | no | — | **Exactly what came back**, before any edit |
| `raw_protein_g` | numeric(6,2) | no | — | |
| `raw_carb_g` | numeric(6,2) | no | — | |
| `raw_fat_g` | numeric(6,2) | no | — | |
| `raw_fiber_g` | numeric(6,2) | no | `0` | |
| `estimated_grams` | numeric(7,2) | no | — | The portion weight the model guessed — the divisor that turns totals into per-100 g |
| `edited` | boolean | no | `false` | True when the user changed a number before saving |
| `confirmed_at` | timestamptz | yes | — | `NULL` = shown but never saved |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `INDEX (user_id, created_at DESC)`.
- **There is no photo column.** The image goes to Anthropic, is read, and is discarded — the same
  rule M2 set for label photos (2026-09-19 security entry in `06`). A photo estimate therefore has
  no `input_text`; a text estimate has no image to discard.
- **Why `raw_*` is kept beside what was saved.** The saved numbers live in `plan_meal_item`; these
  are what the model said before the user corrected it. The gap between the two is the only way to
  find out whether the provider is accurate enough to keep paying for — the PRD already records
  photo macro error at 48–66%.
- The API divides the raw totals by `estimated_grams` to get per-100 g values and writes one
  `plan_meal_item` with `food_id` `NULL`, `estimate_id` set, and `actual_grams = estimated_grams`.
  Everything downstream — the day's totals, S21's intake average — does the one kind of arithmetic
  it already did.

---

## protocol_suggestion

One plateau protocol offered to one user on one day (S23), and what they did about it.

The protocol catalogue itself — name, what it is, the trigger, the evidence tag, the citations — is
**not a table**. It is a typed constant in `domain/`, so changing a claim about the literature goes
through code review like any other claim, and there is no seed-versus-code copy to drift.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `goal_phase_id` | uuid | no | — | → `goal_phase.id`, `ON DELETE CASCADE` |
| `protocol_key` | text | no | — | `diet_break` \| `refeed` \| `reduce_deficit` \| `deload` — a key in the `domain/` catalogue |
| `evidence_tag` | text | no | — | `strong` \| `moderate` \| `contested`, `CHECK`. **Snapshotted** |
| `suggested_on` | date | no | — | Local date |
| `trigger_weeks_missed` | smallint | no | — | Consecutive weeks off the phase's target rate |
| `trigger_actual_rate_pct` | numeric(4,2) | no | — | Measured weekly % change in the trend |
| `trigger_target_rate_pct` | numeric(4,2) | no | — | Copied from `goal_phase` |
| `status` | text | no | `'offered'` | `offered` \| `accepted` \| `dismissed`, `CHECK` |
| `responded_at` | timestamptz | yes | — | `NULL` while `offered` |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (user_id, protocol_key, suggested_on)`, `INDEX (user_id, suggested_on DESC)`.
- **Why `evidence_tag` is copied.** If the literature moves and a protocol's tag goes from moderate
  to contested, last March's suggestion must still read the way it read when it was made. Same rule
  as `workout_exercise`'s rep range and `plan_meal_item`'s macros.
- **The trigger numbers are stored, not recomputed.** "Offered because the trend missed 0.60%/week
  for three weeks running" has to keep saying that after the trend is revised by later weigh-ins.
- A `dismissed` protocol is not offered again while the same `goal_phase` is open. That rule is why
  the table exists at all: without it, the app suggests a diet break every week until you stop
  reading the suggestions.

| protocol_key | evidence_tag | suggested_on | trigger_weeks_missed | trigger_actual_rate_pct | status |
| --- | --- | --- | --- | --- | --- |
| `diet_break` | strong | 2026-11-16 | 3 | -0.08 | accepted |
| `refeed` | contested | 2026-12-07 | 2 | -0.11 | dismissed |

---

## ingest_token

A credential Health Auto Export sends on every upload (S19, `docs/03` §9). Separate from Better
Auth's `session` because it must work with no browser, never expire on its own, and authorise
exactly one route.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `user_id` | uuid | no | — | → `user.id`, `ON DELETE CASCADE` |
| `token_hash` | bytea | no | — | SHA-256 of the token. The token itself is shown once and never stored |
| `label` | text | no | `'Health Auto Export'` | So a user with a second phone can tell them apart |
| `last_used_at` | timestamptz | yes | — | Updated on each accepted upload |
| `revoked_at` | timestamptz | yes | — | Set by the user, or for every token of a user whose invite is revoked |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

- `UNIQUE (token_hash)` — the lookup on every ingest request. Tokens are 32 random bytes, so a plain
  hash is enough; there is nothing to brute-force.
- `INDEX (user_id)`.
- A revoked token stays as a row, for the same reason `invite` does: the setup screen can say
  "revoked on …" instead of the token silently vanishing.

| user_id | label | last_used_at | revoked_at |
| --- | --- | --- | --- |
| `0192u001-…` | Health Auto Export | `2026-11-04 07:02:00+00` | `null` |

---

## Two columns added to M2 tables

| Table | Column | Type | Null | Why |
| --- | --- | --- | --- | --- |
| `body_measurement` | `lean_mass_kg` | numeric(5,2) | yes | Hand entry, and later a native HealthKit client reading per sample. Health Auto Export's lean body mass goes to `health_sample` instead (see the metric vocabulary) |
| `plan_meal_item` | `estimate_id` | uuid | yes | → `meal_estimate.id`, `ON DELETE SET NULL`. Not `NULL` is what puts the "estimate" label on the row |

Both are additive — no M2 row has to change, and no M1 or M2 behaviour depends on either.

---

## What M3 derives instead of storing

| Wanted | Read from |
| --- | --- |
| Overlay series on a lift chart (S20) | `plan_meal_item` per day for intake, `body_measurement` for the trend, `health_sample` for sleep and HRV — all summed per day at read time |
| Which overlays are switched on (S20) | Client state. It is a view preference, not data |
| The plateau protocol catalogue (S23) | A typed constant in `domain/`, with its evidence tags and sources |
| "Change from last week" (S21) | Two `expenditure_estimate` rows |
| 7- and 30-day dashboard trends (S24) | `health_sample` and `body_measurement` over the span |
| Whether a protocol is still dismissed | Newest `protocol_suggestion` for that key in the open phase |

**No daily rollup table.** A year of one person's data is a few thousand rows per series, which
Postgres sums in single-digit milliseconds, and a stored copy of intake would have to be rebuilt
every time S18 lets you edit a confirmed meal later in the day. `06` already records the rollup as
the first thing to add if a long span ever measures slow — a measurement, not a guess.

## Queries the M3 indexes are for

| Query | Path |
| --- | --- |
| **Ingest a health payload** (S19) | `health_sample` upsert on `(user_id, metric, started_at)`; `health_workout` upsert on `(user_id, external_id)`; one `health_sync_state` upsert per metric |
| **Dashboard freshness** (S19, S24) | `health_sync_state (user_id, metric)`, whole table per user |
| **Overlay a span** (S20) | `health_sample (user_id, metric, started_at DESC)` filtered by span, one pass per series |
| **Weekly recalculation** (S21) | `plan_meal_item` via `plan_meal` → `plan_day` for complete days in the 14-day window, plus `body_measurement (user_id, measured_at DESC)` |
| **Ingest auth** (S19) | `ingest_token (token_hash)`, once per request |
| **Current targets** (S21) | Newest `expenditure_estimate (user_id, week_start DESC)` with `applied_at IS NOT NULL`, **unless** the open `goal_phase.calorie_target_set_at` is newer than its `applied_at`, in which case the phase's target. The next estimate clamps against whichever was in force. *Changed 2026-09-21* (`docs/09` F13) |
| **Plateau check** (S23) | `expenditure_estimate` over recent weeks, then `protocol_suggestion (user_id, suggested_on DESC)` to drop what was dismissed |

# Security — from M1

_Added 2026-09-21 by `docs/13`. Needed from the first migration, whatever the milestone._

## Roles

Created by the first migration, the same everywhere (`docs/13` §5): `overload_owner` (owns
everything, runs migrations), `overload_app` (DML on app tables, no DDL), `overload_backup`
(`SELECT` only). `ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner` grants each new table to the
other two.

## audit_event

Who did what to access and accounts (`docs/13` §7). Append-only.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `uuidv7()` | PK |
| `occurred_at` | timestamptz | no | `now()` | |
| `actor_user_id` | uuid | yes | — | **No FK**, so the row outlives a deleted account. Null only for a system actor |
| `action` | text | no | — | `CHECK` in the vocabulary of `docs/13` §7 |
| `target_type` | text | yes | — | e.g. `invite`, `user`, `ingest_token` |
| `target_id` | uuid | yes | — | No FK, same reason |
| `detail` | jsonb | yes | — | Small, non-sensitive facts only, e.g. `{"discardedSets": 3}` on sign-out. Never health, food, weight, token or email values |
| `ip` | inet | yes | — | |
| `user_agent` | text | yes | — | |

- No `created_at` / `updated_at`: `occurred_at` is the creation time and a row is never updated —
  the one exception to the conventions above.
- `INDEX (actor_user_id, occurred_at DESC)`, `INDEX (occurred_at)` for the purge.
- Grants: `overload_app` has `SELECT, INSERT` only. The first migration revokes `UPDATE, DELETE`
  after the default privileges apply.
- `purge_audit_events()`: `SECURITY DEFINER`, owned by `overload_owner`, deletes rows with
  `occurred_at < now() - interval '1 year'`. `overload_app` may `EXECUTE` it; the daily job calls it.

| occurred_at | actor_user_id | action | target_type | target_id | detail |
| --- | --- | --- | --- | --- | --- |
| `2026-11-04 12:10:00+00` | `0192u001-…` | `ingest_token_created` | `ingest_token` | `0192t001-…` | `null` |

---

## Open

- The M3 estimate provider is still nominally open, though Haiku 4.5 reads labels in M2 already and
  is the default candidate.
- Whether the chart query needs a materialised per-workout best-set row. Not until it is slow; one
  user's year of training is a few thousand rows.
