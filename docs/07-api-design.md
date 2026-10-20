# 07 — API design

The HTTP contract that both clients build on. Vocabulary is in `CONTEXT.md`. Who may call what is in
`docs/08`, and tables are in `docs/04`. The generated `packages/api-contract/openapi.json` is the
machine-readable form of this document. **Where the two disagree once code exists, the spec wins and
this file is corrected.**

Written 2026-09-21. Decisions and the options rejected are in `docs/06` (2026-09-21, API design).

---

## 1. Conventions

### 1.1 Shape

- **Base path** `/api`, on the web origin (the Vercel rewrite, `03` §5). No version segment; see
  §1.6.
- **JSON** request and response bodies, `application/json`. Photo uploads are
  `multipart/form-data` (§1.5).
- **Field names are camelCase** (`weightKg`, `performedAt`). The db layer maps to the tables'
  snake_case in one place.
- **Ids** are UUIDv7 strings.
- **Instants** are ISO 8601 in UTC with `Z`: `"2026-11-04T09:02:11.000Z"`.
- **Local dates** are `YYYY-MM-DD`, and **local times** are `HH:MM`, both read in the user's
  `timezone`.
- **Weights** are kilograms and **amounts** grams, as JSON numbers. There are no units in field
  values; the unit is in the field name (`weightKg`, `plannedGrams`, `energyKcal`).
- **Absent and null differ.** In a PATCH an omitted field is unchanged and `null` clears it. In a
  response every field is present, and `null` means no value.
- Every response carries `Cache-Control: private, no-store` and `X-Request-Id`.
- Every response to a signed-in caller carries `Overload-User`, the id of the user whose session
  answered, and every member route's success response declares it in the contract. A client keeps
  a per-user body only for the account it names (`08` §5).

### 1.2 Methods and retries

Native-ready rule 4 (`03` §1) says every write is safe to retry. This is how each method meets it:

| Method | Used for | Retry behaviour |
| --- | --- | --- |
| `GET` | Reads. Never changes data | — |
| `POST` to a collection | Create. **The client sends the new row's `id`** (UUIDv7) | `ON CONFLICT (id) DO NOTHING`. 201 with the row the first time, 200 with the same stored row on a repeat |
| `POST` to `…/{action}` | A named action (`revoke`, `confirm`, `generate`) | Each action is written to be idempotent, and each section says how |
| `PATCH` | Partial update | Setting the same values twice leaves the same row |
| `PUT` | Replace a whole child list (routine slots, meal slots) or an upsert keyed by path | Same body, same result |
| `DELETE` | Delete | **204 whenever the caller has no row with that id afterwards**, including when there never was one. This does not reveal whether another user's id exists |

- Last write wins. There are no `ETag` or `If-Match` checks: each user edits only their own rows,
  usually from one device.
- **The workout tree does not use these.** Workouts, workout exercises and sets are written only
  through the sync batch (§3.4), because they are made and edited offline.

### 1.3 Errors

Every error is an RFC 9457 problem detail, `Content-Type: application/problem+json`, **except on
Better Auth's own `/api/auth/*` routes**, which answer in Better Auth's `{ "code": "…", "message": "…" }`
(Better Auth docs v1.6.23, checked 2026-09-22). Rewriting its bodies was rejected: its client expects
that shape. Its rate limiter's 429 and our `beforeDelete` refusal arrive in that format too.

```json
{
  "type": "urn:overload:problem:validation_failed",
  "title": "Request body failed validation",
  "status": 422,
  "detail": "reps must be greater than 0",
  "code": "validation_failed",
  "requestId": "req_0192f7c1a4e8",
  "errors": [{ "path": "sets[2].reps", "message": "Number must be greater than 0" }]
}
```

- `code` is the stable, machine-readable field. Clients switch on `code`, never on `title` or
  `detail`.
- `errors[]` is present only for `validation_failed`.
- `type` is `urn:overload:problem:<code>`. It is an identifier, not a link: there is no domain to host documentation on.
- **An id in a body that is not the caller's** (another user's food, exercise, routine…) is
  refused as if it did not exist: 422 `validation_failed` on that field, or `parent_missing` in a
  sync batch (`08` §4). A synced workout's `routineId` is the one exception: it is stored as null
  (§3.4).
- The detail never contains a food, weight or health value (`03` §7). It names the field, not what
  was in it.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | Malformed JSON, or a query parameter of the wrong type |
| 401 | `unauthenticated` | No session, an expired session, or a bad ingest or cron token |
| 403 | `cross_origin` | Hono's `csrf()` refused a form-type POST from another origin (`08` §2). Its error is mapped to a problem detail in the app's error handler |
| 404 | `not_found` | No such route, or no row with that id **belonging to the caller** |
| 404 | `not_found` | A member calling `/api/admin/*` (`08` §4) |
| 409 | `id_conflict` | A create reused an id that exists with different content |
| 409 | `exercise_has_history` | Deleting a custom exercise that has sets. Hide it instead |
| 409 | `exercise_in_routine` | Deleting an exercise used by a routine. The body lists `routines: [{id, name}]` |
| 409 | `phase_already_open` | Opening a goal phase with `endPrevious: false` while one is open |
| 409 | `admin_account` | Revoking the invite of `ADMIN_EMAIL`. On account deletion the same refusal is a Better Auth `APIError` thrown in `beforeDelete`, in Better Auth's format |
| 409 | `invite_exists` | Inviting an email that already has a row. Restore it instead |
| 409 | `managed_by_apple_health` | Deleting a weigh-in that came from Apple Health |
| 409 | `food_exists` | Adding a food, or renaming one, that the list already has: the same barcode or MEXT code, or the same name, brand and state, archived foods not counted. The body carries `existingFoodId`, so the screen opens that food. *Added 2026-10-17* (`06`) |
| 409 | `weigh_in_exists` | Typing a weigh-in at the same instant as another typed one (`UNIQUE (user_id, source, measured_at)`) |
| 409 | `day_locked` | Confirming a plan meal or day more than 7 days after its date (§4) |
| 409 | `already_answered` | Answering a protocol suggestion that already has a different response |
| 413 | `payload_too_large` | Over our own photo limit (§1.5), titled `Request too large`. Vercel's own 4.5 MB cap answers with its own 413 before our code runs |
| 422 | `validation_failed` | The Zod schema refused the body |
| 422 | `setup_incomplete` | A prerequisite is missing. The body lists `missing: ["profile" \| "foods" \| "day_routine" \| "goal_phase"]`, so the screen links to that step |
| 422 | `unreadable_label` | The label photo had no nutrition table the model could read |
| 429 | `rate_limited` | Open Food Facts' 15 reads a minute passed through. Better Auth's limiter answers `/api/auth/*` in its own format |
| 429 | `model_cap_reached` | The per-user daily cap on model calls, label reads and meal estimates counted together (`03` §10; set before the first invitee). *Renamed 2026-09-22* from `label_cap_reached` |
| 502 | `upstream_failed` | Open Food Facts or Anthropic returned an error, or no label reader is set up (no `ANTHROPIC_API_KEY`) |
| 503 | `database_unavailable` | Neon still unreachable after the one retry (`03` §4) |
| 500 | `internal` | Anything else. Logged with a stack trace and sent to Sentry |

Refusals inside a sync batch or an ingest payload do not fail the request. They appear per item in
a 200 (§3.4, §6.1). A sync row also has `parent_missing`: its parent was refused, is unknown, or is
not the caller's.

### 1.4 Lists, filtering and sorting

- **Ordinary reads of small, bounded lists are returned whole**, with no pagination: exercises,
  routines, foods, rotation groups, phases, day routines, invites, ingest tokens and sync state. Each
  is tens of rows for one user. Export pages its sections separately (§2).
- **Growing lists use cursor pagination:** workouts, weigh-ins, expenditure estimates and meal
  estimates.
  - Request: `?limit=` (default 30, maximum 100) and `?cursor=`, taken from the previous page.
  - Response: `{ "items": [...], "nextCursor": "…" | null }`.
  - The cursor is opaque. It encodes the sort key and the id, so a row inserted during paging is not
    shown twice.
- **Ranges are named query parameters**, `from` and `to`, as local dates and both inclusive:
  `GET /api/weigh-ins?from=2026-10-01&to=2026-10-31`.
- **Filtering is by named parameters only**: `?includeHidden=true`, `?status=offered`,
  `?metric=step_count`. There is no general filter language.
- **Sort order is fixed per endpoint** and stated. Time-ordered lists are newest first.

### 1.5 Photos

- `multipart/form-data` with one `image` part. `image/jpeg`, `image/png` and `image/webp` are
  accepted; anything else, HEIC included, is 422 `validation_failed` on `image`. *Changed
  2026-10-17* (`06`): Anthropic's vision input takes no HEIC, and the client's resize already
  re-encodes every photo as JPEG.
- **The client resizes before upload**, to at most 1568 px on the long edge as JPEG. The API refuses
  anything over 4 MB with `payload_too_large`. That keeps well under Vercel's 4.5 MB request cap
  (Vercel functions limits, checked 2026-09-21).
- The image goes to Anthropic in memory and is never written anywhere (`03` §10). The limit is
  Hono's `bodyLimit` on `/api/label-reads`, so an oversized body is refused before it is parsed.

### 1.6 Compatibility

- There is no `/v1`. The contract grows by adding things: new routes, new optional request fields,
  new response fields. Clients ignore response fields they do not know.
- **A breaking change is a new route**, and the old one is kept until the native app's installed
  versions have moved off it. With only the web app there is no one to keep it for, and it can
  change together with the web app.
- CI diffs the committed `openapi.json` against `main` and fails on a breaking change unless the
  pull request is labelled for it. The tool is picked in `docs/11`.

### 1.7 Auth, per endpoint

The columns in the tables below use `08`'s callers: **M** member (any signed-in user), **A**
admin, **I** ingest token, **C** cron. Every **M** endpoint reads and writes the caller's own rows
only.

---

## 2. Account and admin

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| `*` | `/api/auth/*` | — | Better Auth: Google sign-in, callback, `get-session`, `sign-out`, `list-sessions`, `revoke-other-sessions`, `revoke-sessions` (sign out everywhere, `08` §7), `delete-user` | Better Auth's | Better Auth's |
| GET | `/api/me` | M | The signed-in user, their profile, and `isAdmin` | 200 | 401 |
| PATCH | `/api/me/profile` | M | Timezone, weight unit, height, sex, birth date, training weekdays. Omitted fields are unchanged; the first save creates the profile. Changed training weekdays move the open goal phase's calories, while they are still the formula's, in the same transaction (S14). An unknown IANA zone is a 422 on `timezone` | 200 profile | 401, 422 |
| GET | `/api/me/export` | M | One section of the export (S10), paged | 200 | 400, 401 |
| GET | `/api/admin/invites` | A | Every invite, newest first | 200 | 401, 404 |
| POST | `/api/admin/invites` | A | Invite an email. A repeat of the same create returns the stored invite | 201 / 200 | 401, 404, 409 `invite_exists`, 409 `id_conflict`, 422 |
| POST | `/api/admin/invites/{id}/revoke` | A | Revoke (`08` §8). Idempotent: revoking a revoked invite returns it unchanged | 200 | 401, 404, 409 `admin_account` |
| POST | `/api/admin/invites/{id}/restore` | A | Clear `revoked_at`. Ingest tokens stay revoked; the member makes a new one (`08` §8) | 200 | 401, 404 |

**Account deletion** is Better Auth's `POST /api/auth/delete-user`, behind its fresh-session check,
with our `beforeDelete` (`08` §6). There is no route of our own for it.

### `GET /api/me`

```json
{
  "user": { "id": "0192u001-7c1e-7a33-9c2d-4b6f1e0a9d11", "name": "Yuta Asakura", "email": "yuta.asakura.se@gmail.com", "image": null },
  "isAdmin": true,
  "profile": {
    "timezone": "Asia/Tokyo",
    "heightCm": 172.0,
    "sex": "male",
    "birthDate": "1994-05-02",
    "trainingWeekdays": [1, 3, 5],
    "weightUnit": "kg"
  }
}
```

`profile` is `null` until the first `PATCH /api/me/profile`. `weightUnit` is `kg` or `lb`: how lift
weights are shown and typed. Every weight in every request and response stays kg (`06`, 2026-09-23).

`trainingWeekdays` uses ISO weekday numbers, 1 = Monday. It is what makes a calendar day a
training day for the planner (S15).

### `GET /api/me/export` and `GET /api/me/export/planning`

**Why sectioned:** Vercel caps a response body at 4.5 MB, and a few years of one person's sets,
plans and health samples can pass that. The client fetches every section page by page and builds
the file in the browser as `overload-export-2026-11-04.json`.

- `?section=` on `/api/me/export` is one of `profile`, `exercises`, `routines`, `workouts`,
  `weighIns`, `foods` or `rotationGroups`. `/api/me/export/planning` takes `phases`,
  `dayRoutines` or `planDays`. Later slices add `batches`, `healthSamples`, `appleWorkouts`,
  `expenditureEstimates`, `mealEstimates`, `protocolSuggestions` and `ingestTokens` (labels and
  dates only, never hashes).
- Paged as in §1.4. Each item is the row as the API's normal read returns it, with its children
  nested (a workout carries its exercises and sets).
- **As built in slice 7** (`06`, 2026-10-15): M1's four sections, `profile`, `exercises`,
  `routines` and `workouts`. M2 slice 1 adds `weighIns`, newest `measuredAt` then id first, each as
  `GET /api/weigh-ins` lists it. M2 slice 3 adds `foods`, archived ones included, and
  `rotationGroups` with their `foodIds`, each paged by id and shaped as its list returns it;
  `model_call_count` is bookkeeping and in neither (`06`, 2026-10-17). M2 slice 4 adds the
  `/api/me/export/planning` route for `phases`
  (newest `startedOn` then id first, as `GET /api/goal-phases` lists them), `dayRoutines` (by day
  type, each with its meals, as `GET /api/day-routines`) and `planDays` (newest date first, each as
  `GET /api/plan-days` returns a day, meals and items nested) (`06`, 2026-10-18). `profile` is one item, `{ user, profile }`, as `/api/me` without
  `isAdmin`. `exercises` pages by name then id; `routines` pages by position then id; `workouts`
  pages newest `startedAt` then id first, a workout in progress included, each as
  `GET /api/workouts/{id}` returns it.
  A section not built yet, a `limit` outside 1 to 100, or a cursor that does not decode to this
  section's sort key and id is a 400. `profile` accepts no cursor. The cursor is opaque and
  unsigned; each query remains scoped to the caller's user id.
- `exercises` returns what `GET /api/exercises?includeHidden=true` returns: hidden ones included,
  each with the caller's settings and `overrides`.
- **Every table that holds a user's rows is in some section**, directly or nested. The exceptions
  are listed in the code beside the section map: Better Auth's tables, `invite`, `audit_event`,
  `sync_tombstone` and `health_sync_state`, which are access or bookkeeping, not the user's data. A
  test reads every table with a `user_id` column from `information_schema` and fails if one is in
  neither the map nor the exceptions, so a new table cannot be left out of S10 quietly. *Added
  2026-09-22.*

```http
GET /api/me/export?section=workouts&limit=100
```
```json
{ "section": "workouts", "items": [{ "id": "0192a001-7c1e-7a33-9c2d-4b6f1e0a9d11", "name": "Push A", "startedAt": "2026-11-04T09:02:11.000Z", "exercises": [ … ] }], "nextCursor": "eyJzZWN0aW9uIjoid29ya291dHMiLCJzdGFydGVkQXQiOiIyMDI2LTExLTA0VDA5OjAyOjExLjAwMFoiLCJpZCI6IjAxOTJhMDAxLTdjMWUtN2EzMy05YzJkLTRiNmYxZTBhOWQxMSJ9" }
```

### `POST /api/admin/invites`

```http
POST /api/admin/invites
{ "id": "0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71", "email": "Kenji.Tanaka@example.com", "note": "gym friend" }
```
```json
201
{ "id": "0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71", "email": "kenji.tanaka@example.com", "note": "gym friend", "invitedAt": "2026-10-01T03:00:00.000Z", "revokedAt": null }
```

The email is lowercased before storing. The response never says whether that person has signed in
yet or what they have logged (`08` §4).

---

## 3. Training (M1)

### Exercises

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/exercises` | M | Seeded plus custom, each with the caller's effective settings. Hidden ones only with `?includeHidden=true`. Sorted by name | 200 | 401 |
| POST | `/api/exercises` | M | Create a custom exercise | 201 / 200 | 401, 409 `id_conflict`, 422 (duplicate name or inverted rep range included) |
| PATCH | `/api/exercises/{id}` | M | Edit a custom exercise's name, equipment, muscle group or defaults. Seeded ones return 404 | 200 | 401, 404, 422 |
| DELETE | `/api/exercises/{id}` | M | Delete a custom exercise with no sets | 204 | 401, 409 `exercise_has_history`, 409 `exercise_in_routine` |
| PUT | `/api/exercises/{id}/setting` | M | The caller's increment, rest, rep range and `hidden` for any exercise. `null` restores the default | 200 | 401, 404, 422 |

```json
GET /api/exercises  →  200
{ "items": [
  { "id": "0192a001-…", "name": "Barbell Bench Press", "equipment": "barbell",
    "muscleGroup": "chest", "secondaryMuscleGroups": ["shoulders", "triceps"],
    "aliases": ["Flat Bench"], "custom": false, "hidden": false,
    "incrementKg": 2.5, "restSeconds": 180, "repLow": 6, "repHigh": 10,
    "overrides": { "incrementKg": false, "restSeconds": true, "repLow": false, "repHigh": false } }
] }
```

`overrides` tells the settings screen which values are the user's own and which are defaults.
`muscleGroup` is where the library files the exercise and `aliases` are the other names search
matches. The client groups, filters and searches; the API returns one flat list. A custom exercise has
`"aliases": []`, and `"muscleGroup": null` until the user files it: create and edit take an optional
`muscleGroup`, where `null` files it under no group.
`secondaryMuscleGroups` are the groups it also trains, where a working set counts half in the
balance view (issue `#50`). Every seeded exercise has a reviewed list, empty for one that trains a
single group; a custom one has `[]` until given some. Create and edit take an optional list. The
API keeps each group once, in the order of `MuscleGroup`, and drops the group the exercise is filed
under, also when an edit files it under one of them; left out of an edit, the list stays. A repeat
create with the same groups in another order is the same create.

- **Create.** `id`, `name` and `equipment` are required. An omitted `incrementKg` takes the equipment
  class's increment (`04` `exercise`), `restSeconds` 120 and the rep range 6–10. A missing rep end
  takes its default, and a range that comes out inverted is a 422 on `repLow`. A name one of the
  caller's own exercises already has, in any case, is a 422 on `name`, for create and edit alike.
- **Delete.** `exercise_has_history` is checked first, then `exercise_in_routine` (since slice 3,
  with the `set` table). A seeded exercise is nobody's to delete: 204, and nothing changes.
- **Setting.** The body is the whole setting. The effective rep range, the user's values over the
  defaults, must be in order, or 422 on `repLow`. A setting that is all `null` and not hidden removes
  the row, so the exercise is back to its defaults. Hiding keeps the first `hidden_at`.

### Routines

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/routines` | M | Every routine with its slots, in `position` order | 200 | 401 |
| POST | `/api/routines` | M | Create, optionally with `exercises[]` | 201 / 200 | 401, 409, 422 |
| PATCH | `/api/routines/{id}` | M | Rename, or move in the list | 200 | 401, 404, 422 |
| PUT | `/api/routines/{id}/exercises` | M | Replace the whole slot list. Order is array order, so a reorder is one call | 200 | 401, 404, 409 `id_conflict`, 422 (unknown exercise, or a hidden one the routine does not already hold) |
| DELETE | `/api/routines/{id}` | M | Delete. Past workouts keep their name (`04`) | 204 | 401 |

```http
PUT /api/routines/0192r001-…/exercises
{ "exercises": [
  { "id": "0192r101-…", "exerciseId": "0192a001-…", "targetSets": 4, "repLow": 6, "repHigh": 10 },
  { "id": "0192r102-…", "exerciseId": "0192a1f4-…", "targetSets": 3, "repLow": 12, "repHigh": 15 }
] }
```

- **Slots.** Up to 40, each slot `id` once. `targetSets` defaults to 3. A slot's rep range is both
  ends or neither: neither follows the exercise (setting, then default), and one alone is a 422 on the
  missing end. An unknown exercise or another user's is a 422 on that slot's `exerciseId`. So is one
  hidden by the caller, unless the routine already holds it: hiding an exercise never blocks saving
  a routine that keeps it, but it cannot be added anew.
- **Slot ids** are made on the device like any row's. A PUT keeps a slot's id when it keeps the slot,
  and one already belonging to another routine is a 409 `id_conflict`.
- **Create** puts the routine last in the list. A repeat with the same name and slots is a 200; the
  same id with other content is a 409 `id_conflict`.
- **`PATCH` `position`** moves the routine to that place, 0 first, and past the end means last. The
  others close up around it, so the positions are always 0…n−1.

### Last time and suggestions, for offline use

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/training/last-time` | M | For **every exercise the caller has logged**: last time per working set, and today's suggestion | 200 | 401, 422 `setup_incomplete` (`missing: ["profile"]`) |

**Why one call for everything:** the gym screen must show last time and the suggestion with no
signal (S2, S3). The client fetches this once when online, TanStack Query persists it, and it is
refetched after every acknowledged sync batch. It is one row group per exercise, which is small.
The suggestion is computed on the server (native-ready rule 2), so an offline workout shows the
suggestion as of the last sync.

```json
GET /api/training/last-time  →  200
{ "asOf": "2026-11-04T10:15:02.000Z",
  "exercises": [
    { "exerciseId": "0192a001-…", "workoutId": "0192w001-…", "performedOn": "2026-11-04",
      "sets": [ { "workingSet": 1, "weightKg": 80, "countedWeightKg": 80, "reps": 10, "rir": 2 }, { "workingSet": 2, "weightKg": 80, "countedWeightKg": 80, "reps": 10, "rir": 2 }, { "workingSet": 3, "weightKg": 80, "countedWeightKg": 80, "reps": 10, "rir": null } ],
      "bodyweight": null,
      "suggestion": { "weightKg": 82.5, "rule": "top_of_range_hit", "reason": "hit 10 on every set last time" },
      "slots": [] }
  ] }
```

`sets` holds working sets only; `workingSet` is derived, 1…n in `position` order (`04`). Each set has `weightKg` as logged and `countedWeightKg` for display. Each exercise and slot has `bodyweight`, the counted weigh-in basis or `null` for other equipment. `rir` is `null` where the set recorded none. `suggestion.rule` is `top_of_range_hit` or `repeat`. An exercise never logged is absent from a successful response; the workout's first-time and unknown-history states are specified in `10` §1.

- **Which workout is last time:** the caller's most recent workout, by `started_at`, with at least
  one working set of the exercise. A workout where it only had warm-ups is passed over.
  `?exclude=<workout id>` leaves that workout out: the open workout asks with its own id, so a
  weigh-in typed mid-workout recounts the workout before it, not its own synced sets.
- **The suggestion** takes that workout's heaviest working weight, the `rep_high` copied into its
  `workout_exercise`, and the exercise's increment and equipment as they are today, so a changed
  increment applies at once. The weight is rounded up to one the equipment can make (S3).
- **`slots`** is last time per routine slot. For each slot of the caller's routines that still
  exists, the most recent workout holding a `workout_exercise` started from that slot
  (`routineExerciseId`) with a working set answers
  `{ routineExerciseId, workoutId, performedOn, sets, suggestion }`, judged on that row's sets
  against that row's `rep_high`. At start the device gives a slot the entry with its id and falls
  back to the exercise's own answer when there is none: a slot never logged, or rows that carry no
  slot id. A routine holding one exercise in two slots therefore progresses each on its own, and
  reordering the slots changes nothing.
- **`routineExerciseId` may be left out of a synced `workoutExercises` row** and is then stored as
  null: a row made on a device before the field existed still uploads.
- **`performedOn`** is the workout's `started_at` as a date in the profile's time zone: the day
  boundary. `?timezone=<IANA zone>` reads it, and the daily weights behind `bodyweight`, in that
  zone instead: the open workout asks in the zone it started in, so a profile change while it is
  open moves no date (`#60`). Without a profile there is still `setup_incomplete`.

### 3.4 Sync — the only write path for workouts, workout exercises and sets

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/workouts/sync` | M | Apply the device's queued rows | 200 with a result per row | 401 (nothing applied; every row stays pending), 413 over the row limit, 422 |

**Built (slices 3 and 4):** the happy path, the clock guard, ownership and the limit; and, since
2026-10-08, deleting any of the three rows, tombstones, and a row refused on its own inside a 200
(`06`, 2026-10-08).

**Request.** Three arrays, each row the **whole current row** as the phone holds it, plus
`clientUpdatedAt`, the phone's clock at the last edit. A row the phone deleted is sent as
`{ id, deletedAt }` in its array, and nothing else.

**Any object with an id is taken.** The body is a 422 only when it is not three arrays of objects
that each carry a uuid `id`. A row that fits neither shape above is not applied: its result is
`refused` with `validation_failed`, and the rest of the batch is applied. Otherwise one row an
older build wrote would fail the whole batch, and every set behind it would wait for good.

```http
POST /api/workouts/sync
{
  "workouts": [
    { "id": "0192w003-5b1a-7e20-a4c9-2f8d6e1b7c30", "routineId": "0192r001-…", "name": "Push A",
      "startedAt": "2026-11-11T09:01:40.000Z", "endedAt": null, "note": null,
      "clientUpdatedAt": "2026-11-11T09:01:40.000Z" }
  ],
  "workoutExercises": [
    { "id": "0192x010-…", "workoutId": "0192w003-…", "exerciseId": "0192a001-…",
      "routineExerciseId": "0192q001-…", "position": 0,
      "targetSets": 4, "repLow": 6, "repHigh": 10, "incrementKg": 2.5,
      "clientUpdatedAt": "2026-11-11T09:01:40.000Z" }
  ],
  "sets": [
    { "id": "0192s020-…", "workoutExerciseId": "0192x010-…", "position": 0, "weightKg": 82.5, "reps": 10,
      "rir": 2, "rpe": null, "isWarmup": false, "performedAt": "2026-11-11T09:09:12.000Z",
      "clientUpdatedAt": "2026-11-11T09:09:12.000Z" },
    { "id": "0192s021-…", "workoutExerciseId": "0192x010-…", "position": 1, "weightKg": 82.5, "reps": 8,
      "rir": null, "rpe": null, "isWarmup": false, "performedAt": "2026-11-11T09:12:40.000Z",
      "clientUpdatedAt": "2026-11-11T09:12:40.000Z" }
  ]
}
```

**Server rules.**
- Parents are applied before children: workouts, then workout exercises, then sets.
- **Each row is its own unit.** One refused row does not roll back the others. A child whose parent
  was refused, or is unknown to the server, is refused with `parent_missing`.
- **Insert or update, guarded by the phone's clock:**

  ```sql
  INSERT … ON CONFLICT (id) DO UPDATE SET …
  WHERE set.client_updated_at < EXCLUDED.client_updated_at
  ```

  A retry of the same payload changes nothing. So does a stale copy arriving after a newer edit.
  This replaces `03` §8.1's `DO NOTHING`, and `docs/04` gains `client_updated_at` on the three
  tables.
- **A deletion** removes the row if the stored `client_updated_at` is older than `deletedAt`, and
  counts as `deleted` if the row is already gone or was never there. A stored copy that is newer
  wins: the row stays and is answered `unchanged`. Deleting a workout or a workout exercise
  cascades (`04`).
- **A deleted row stays deleted.** Each deletion writes a `sync_tombstone` (`04`) for the row and
  every row it cascades to, in its transaction. A row whose id, or whose parent's id, has a
  tombstone is not inserted, whatever its `clientUpdatedAt`, and neither is a child of a row
  reported `deleted` earlier in the same batch. All of these are reported `deleted`. Without this,
  a stale copy from a second tab or a late request would bring a deleted set back. Two requests on
  the same id take turns (`03` §8.1). *Added 2026-09-22, built 2026-10-08.*
- **Ownership:** a row whose id exists under another user is refused as `not_found`, like any
  other cross-user access. A row whose `workoutId`, `workoutExerciseId` or `exerciseId` is not the
  caller's is refused as `parent_missing` (`08` §4). A workout whose `routineId` is not the
  caller's, or names a routine deleted since the workout started, is stored with `routineId` null:
  a workout outlives its routine (`04`), so its finish is never refused over it. *Changed
  2026-10-03.*
- **Limit:** 500 rows a request. The uploader splits larger queues.

**Response.** A valid batch returns 200 with one entry for every id sent:

```json
{
  "results": [
    { "table": "workouts", "id": "0192w003-…", "status": "stored", "row": { … } },
    { "table": "workoutExercises", "id": "0192x010-…", "status": "stored", "row": { … } },
    { "table": "sets", "id": "0192s020-…", "status": "stored", "row": { … } },
    { "table": "sets", "id": "0192s021-…", "status": "stored", "row": { … } }
  ]
}
```

| `status` | Meaning | What the phone does |
| --- | --- | --- |
| `stored` | Inserted or updated | Mark **acknowledged**; keep an open workout's rows on the device until it ends (`03` §6) |
| `unchanged` | The server already had this version or a newer one. `row` is the server's copy | Mark acknowledged; keep an open workout's rows until it ends. A workout the phone ended whose `row` is still open stays pending (`08` §7). If a deleted row's server copy survived, restore it from `row`. Keep a deleted workout's exercises while its deletion is pending; if the server keeps the workout, restore it with those exercises so it can be resumed |
| `deleted` | Gone, now or before, or never stored because it or its parent was deleted | Delete the local record, and those of the rows under it |
| `refused` | Refused, with `problem` | Keep the record and mark it **refused** (`03` §7, kind 3), with the problem's code and fields. A refused deletion is of a row that is not the caller's: the record is deleted |

A refused row's `problem` is `{ code, status }`, with `errors` when the row did not match its
schema: the fields at fault as `{ path, message }`, as in a 422 (§1.3), never a value.

```json
{ "table": "sets", "id": "0192s021-…", "status": "refused",
  "problem": { "code": "validation_failed", "status": 422,
               "errors": [{ "path": "reps", "message": "Too big: expected number to be <=100" }] } }
```

- **A 401 applies nothing** and refuses nothing. Every row stays pending until sign-in (`08` §5).
- A network failure or a 5xx leaves every row pending, and the whole batch is resent. The guard
  makes that harmless.

### Reading workouts

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/workouts` | M | History: finished workouts, newest `startedAt` first, paged. Each item is a summary: name, times, working-set count, and each exercise's name and top set | 200 | 400, 401 |
| GET | `/api/workouts/last-done` | M | When each routine was last done: its newest finished workout. A routine never done, or deleted, is absent | 200 | 401 |
| GET | `/api/workouts/{id}` | M | One workout with its exercises and every set. The linked Apple workout joins it in M3 | 200 | 400, 401, 404 |
| GET | `/api/exercises/{id}/progress` | M | The S7 chart, with S20 overlays when asked | 200 | 400, 401, 404, 422 |
| GET | `/api/training/strength` | M | The strength overview: every lift's points, trend and status over a span, and their average | 200 | 400, 401, 422 |
| GET | `/api/training/balance` | M | Muscle balance: every muscle group's working sets a week over four weeks or this week, its status and its sources | 200 | 400, 401, 422 |

```http
GET /api/exercises/0192a001-…/progress?span=12w&overlays=intake,trend,sleep,hrv
```
```json
{
  "span": "12w", "from": "2026-08-19", "to": "2026-11-10",
  "points": [ { "workoutId": "0192w001-…", "workoutName": "Push A", "date": "2026-11-04", "e1rmKg": 106.7, "topSetKg": 80, "topSetReps": 10, "volumeKg": 2400,
                "sets": [ { "weightKg": 80, "reps": 10 }, { "weightKg": 80, "reps": 10 }, { "weightKg": 80, "reps": 10 } ] } ],
  "stats": { "bestE1rmKg": 106.7, "changeKg": 5.367, "topSetKg": 82.5, "topSetReps": 8, "volumeKg": 28800 },
  "overlays": {
    "intake": [ { "date": "2026-11-04", "energyKcal": 2380, "complete": true } ],
    "trend":  [ { "date": "2026-11-04", "trendKg": 71.84 } ],
    "sleep":  [ { "date": "2026-11-04", "hours": 6.9 } ],
    "hrv":    [ { "date": "2026-11-04", "ms": 48 } ]
  }
}
```

- `span` is one of `4w`, `12w`, `6m`, `1y`, `all`, and `12w` when omitted. Any other value is a
  400 (§1.3). A span ends today and includes it, in the caller's time zone: `from` is its first
  local date. For `all` it is the first point's date, and `null` without one.
- A point is one workout with a working set of the exercise, oldest first: `e1rmKg` to the tenth,
  the heaviest working set as `topSetKg` with `topSetReps`, the most reps done at that weight,
  and `volumeKg`, weight × reps summed over its working sets. `sets` is those working sets as
  logged, in order, and `workoutName` the workout's name: the exercise's past sets, which the
  screen lists under the chart (`06`, 2026-10-11).
- `stats` covers the span: the best e1RM, the heaviest top set with its reps, and the volume of
  every workout together. The best e1RM and the top set are `null` without a workout. `changeKg`
  is the last point's e1RM less the first's, taken from the estimates before they are rounded and
  carried to the thousandth, and `null` with fewer than 2 points. The client converts it to the
  user's unit, rounds it once to the tenth, and never works it out itself.
- With fewer than 2 workouts, `points` has 0 or 1 items and the client shows "Not enough data yet".
  It shows the same on any span whose points all fall on one local date: a chart needs two days.
- The 404 is an exercise that is not the caller's to see. The 422 is `setup_incomplete` with
  `missing: ["profile"]`: local dates need the time zone.
- `overlays` omitted gives no overlay keys. The M3 series return empty arrays before M3 data exists.
  **As built in slice 5** (`06`, 2026-10-10) the parameter is not read and the key is never
  sent: the overlays arrive with their data, in M2 and M3.
- Warm-ups are excluded from every number here (S6).

**History, as built 2026-10-11** (`06`). Its routes read what the sync batch wrote and change
nothing.

```http
GET /api/workouts?limit=30&cursor=WyIyMDI2LTEw…
```
```json
{
  "items": [
    { "id": "0192w001-…", "name": "Push A", "routineId": "0192r001-…",
      "startedAt": "2026-10-09T09:30:00.000Z", "endedAt": "2026-10-09T10:24:00.000Z",
      "workingSets": 13,
      "exercises": [ { "name": "Barbell Bench Press", "topSetKg": 80, "topSetReps": 10 } ] }
  ],
  "nextCursor": "WyIyMDI2LTA5…",
  "total": 194
}
```

- **Only finished workouts are listed.** One in progress (`endedAt: null`) is not history yet, and
  is not counted. `total` is every finished workout the caller has, on every page, for the
  screen's `194 WORKOUTS`.
- The order is `startedAt` then `id`, both descending, and the cursor is the last item's pair
  (§1.4). A `limit` outside 1 to 100, or a cursor that does not decode to a start time and valid
  id, is a 400.
- `exercises` holds each exercise that logged a working set, in the workout's order, with its top
  set (`CONTEXT.md`): the heaviest working set and the most reps done at that weight.
  `workingSets` counts them. Warm-ups are in neither (S6).
- `routineId` is the routine the workout was started from, or `null` when it came from none or the
  routine was deleted since. A workout finished on the device is laid over Today's last-done line
  by it.

```json
{
  "id": "0192w001-…", "routineId": "0192r001-…", "name": "Push A",
  "startedAt": "2026-10-09T09:30:00.000Z", "endedAt": "2026-10-09T10:24:00.000Z",
  "note": null, "clientUpdatedAt": "2026-10-09T10:24:00.000Z",
  "exercises": [
    { "id": "0192e001-…", "workoutId": "0192w001-…", "exerciseId": "0192a001-…", "name": "Barbell Bench Press",
      "position": 0, "…": "the rest of the workout-exercise row, as §3.4 sends it",
      "sets": [ { "id": "0192s001-…", "workoutExerciseId": "0192e001-…", "position": 0,
                  "weightKg": 80, "reps": 10, "rir": 2, "rpe": null, "isWarmup": false,
                  "performedAt": "2026-10-09T09:41:00.000Z", "clientUpdatedAt": "2026-10-09T09:41:00.000Z" } ] }
  ]
}
```

- **Every row is the one the sync batch holds**, field for field, with the exercise's `name`
  beside its row. So the phone can put a past workout back in its set store and send a set back
  edited, or deleted, through `/api/workouts/sync` (§3.4): there is no other write path, and no
  `PATCH` on a set.
- Exercises are in `position` order, and one that logged no set is still listed; sets are in
  `position` order, warm-ups included. A workout in progress is answered too.
- The 404 is a workout that does not exist or is not the caller's, the same answer for both. The
  400 is an id that is not a UUID.

**Last done, as built 2026-10-14** (`06`; issue `#61`). Today's line under each routine, in one
call, so Today never pages through the list to find a routine.

```http
GET /api/workouts/last-done
```
```json
{
  "items": [
    { "routineId": "0192r001-…", "workoutId": "0192w001-…", "startedAt": "2026-10-09T09:30:00.000Z" }
  ]
}
```

- One item per routine the caller has finished a workout from: its newest by `startedAt`, then
  `id`. A routine never done is absent, and so is a deleted one, whose workouts no longer name it.
  A workout in progress does not count.
- `workoutId` lets the device tell when it has deleted that workout and the answer is out of date.

**The strength overview, as built 2026-10-14** (`06`; issue `#49`). It reads the sets the chart
reads, every exercise at once, and changes nothing.

```http
GET /api/training/strength?span=12w
```
```json
{
  "span": "12w", "from": "2026-07-23", "to": "2026-10-14",
  "overall": { "lifts": 1, "changePct": 6, "status": "gaining" },
  "lifts": [
    { "exerciseId": "0192a001-…", "name": "Barbell Bench Press",
      "points": [ { "date": "2026-09-28", "e1rmKg": 100 }, { "date": "2026-10-05", "e1rmKg": 103 }, { "date": "2026-10-12", "e1rmKg": 106 } ],
      "workoutCount": 3, "status": "gaining", "trend": { "changeKg": 6, "changePct": 6 } },
    { "exerciseId": "0192a002-…", "name": "Cable Face Pull",
      "points": [ { "date": "2026-10-08", "e1rmKg": 28 } ],
      "workoutCount": 1, "status": "too_few", "trend": null }
  ]
}
```

- `span` is `4w`, `12w` or `1y`, `12w` when omitted. Any other value is a 400. `from` and `to`
  are local dates, ending today in the caller's time zone. `from` is the span start even when
  no lift was logged.
- **A lift** is an exercise with at least one working set in the span; one with none is not listed. A
  point is a workout's e1RM from its best working set, to the tenth, as the chart plots it, a
  workout in progress included. Warm-ups are left out (S6). So is a workout whose working sets
  carry no weight: its e1RM is 0, which a percentage cannot be taken of. `workoutCount` counts
  all workouts with a working set, including those at zero weight.
- **The trend** is the least-squares line through the lift's e1RM by local date, fitted to the
  estimates before they are rounded. `changeKg` is the line's end less its start, to the
  thousandth; `changePct` is that as a share of the start, to the tenth, halves away from zero.
  The client converts `changeKg` to the user's unit and rounds it once, and never works out
  either itself.
- **The status** reads the unrounded percentage: `gaining` at 2% or more, `losing` at −2% or
  less, `holding` between. A displayed `+2.0%` can therefore be holding.
- **A bodyweight lift** (`equipment = bodyweight`) counts the caller's weight plus the kg logged on
  each set (`06`, 2026-10-17; `04` `body_measurement`): its points and trend are of that load, and
  the lift carries `bodyweight`, the weigh-in its latest workout in the span was counted at:
  `{ "basis": "earlier_day", "weightKg": 82.4, "weighedOn": "2026-10-10" }`. `basis` is
  `same_day`, `earlier_day`, `later_day` (a workout older than the first weigh-in) or `none`
  (no weigh-in at all: the sets stay as logged, so a lift logged at 0 kg is `no_weight`). Null on
  any other lift. The chart (`GET /api/exercises/{id}/progress`) says the same on every point, and
  its `topSetKg`, `volumeKg` and `sets` are of the counted load.
- **`too_few`** with `trend: null`: fewer than three workouts with a working set in the span,
  where at least one has a positive e1RM. A lift with none is `no_weight` instead.
  Its displayed count includes zero-weight workouts.
- **`no_trend`** with `trend: null`: three or more working workouts but no calculable
  percentage. This includes positive points all on one local date, a fitted line starting at or
  below zero, and fewer than three positive points after zero-weight workouts are excluded.
  The lift keeps its workout count and sits outside the average.
- **`no_weight`** with `trend: null` and no points: the lift has working sets but no positive
  e1RM. Its workout count is shown; it does not enter the overall average.
- **`overall`** is the plain average of every verdict's unrounded percentage, judged before
  rounding and displayed to the tenth. Each lift counts once whatever it weighs. `lifts` is how
  many were averaged.
  With none, `changePct` and `status` are `null`.
- `lifts` come with a verdict first, the largest `changePct` first and by name between equals,
  then those without, by name. The screen groups them by `status` and keeps the order.
- The 422 is `setup_incomplete` with `missing: ["profile"]`: local dates need the time zone.

**Muscle balance, as built 2026-10-14** (`06`; issue `#50`, Q13 and Q14). It reads the same sets
again, by muscle group, and changes nothing. The sum is `domain/balance.ts`, pure.

```http
GET /api/training/balance?view=4w
```
```json
{
  "view": "4w", "from": "2026-09-17", "to": "2026-10-14", "weeks": 4,
  "range": { "low": 10, "high": 20 },
  "groups": [
    { "muscleGroup": "chest", "sets": 14, "directSets": 14, "status": "in_range",
      "sources": [ { "exerciseId": "0192a001-…", "name": "Barbell Bench Press", "indirect": false, "sets": 8 },
                   { "exerciseId": "0192a003-…", "name": "Incline Dumbbell Bench Press", "indirect": false, "sets": 6 } ] },
    { "muscleGroup": "triceps", "sets": 18, "directSets": 8, "status": "in_range",
      "sources": [ { "exerciseId": "0192a001-…", "name": "Barbell Bench Press", "indirect": true, "sets": 4 },
                   { "exerciseId": "0192a004-…", "name": "Cable Triceps Pushdown", "indirect": false, "sets": 8 } ] },
    { "muscleGroup": "forearms", "sets": 0, "directSets": 0, "status": "none", "sources": [] }
  ]
}
```

- `view` is `4w`, the default, or `week`. Any other value is a 400. `4w` is the 28 local days to
  today, its sets divided by four; `week` is Monday to today, not divided, so a week in progress
  reads low (Q14). `from` and `to` are local dates in the caller's time zone.
- **A set** is a working set of an exercise in a workout that started in the view, a workout in
  progress included. Warm-ups count nowhere (S6). It counts whole for the group its exercise is
  filed under and half for each of its `secondaryMuscleGroups` (Q13). An exercise filed under no
  group counts only for those.
- **`groups`** are all eleven, in the order of `MuscleGroup`, trained or not. `sets` is whole and
  half together and `directSets` the whole alone, each a week to the tenth, halves rounded up.
- **The status** reads `sets` after rounding, so it always agrees with the printed figure: `none` at
  0, `low` under 10, `in_range` from 10 to 20 inclusive, `high` over 20. The range is the same for
  every group, and is answered as `range`.
- **`sources`** are the exercises a group's sets came from, a week to the tenth, by when each first
  came up in the view. `indirect: true` marks the half count, already halved.
- The 422 is `setup_incomplete` with `missing: ["profile"]`: local dates need the time zone.

### Apple workout links (S19)

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/workouts/{id}/apple-workout-candidates` | M | The caller's Apple workouts on that workout's local date | 200 | 401, 404 |
| PUT | `/api/workouts/{id}/apple-workout` | M | `{ "appleWorkoutId": "…" }` to link, `{ "appleWorkoutId": null }` to unlink. Both set `linkSource = manual` | 200 | 401, 404, 422 |

---

## 4. Meals (M2)

### Food list and its sources

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/foods` | M | The food list, by name (case-folded) then id. Archived ones only with `?includeArchived=true` | 200 | 401 |
| POST | `/api/foods` | M | Add a confirmed food. The body carries the values **and the basis they were read in**; the API converts to per 100 g | 201 / 200 | 401, 409 `id_conflict` \| `food_exists`, 422 |
| PATCH | `/api/foods/{id}` | M | Edit name, brand, state, values per 100 g, piece weight, keeping days or rotation group. Past plan days keep their snapshot | 200 | 400, 401, 404, 409 `food_exists`, 422 |
| DELETE | `/api/foods/{id}` | M | Archive (`archivedAt` set, once). The server does not touch plans: the client then calls `POST /api/plan-days/generate` for the week from today, which makes every unconfirmed day again without it (`06`, 2026-10-18) | 204 | 400, 401 |
| GET | `/api/reference-foods?q=` | M | Search the MEXT table (八訂 増補2023). 1 to 80 characters; every word must appear in the English or the Japanese name. 20 results: a name starting with the words first, then raw, then the shorter name. Each carries `existingFoodId` if that code is on the list | 200 | 400, 401 |
| GET | `/api/barcodes/{code}` | M | Look up Open Food Facts (8 to 14 digits). Returns a **candidate**, not a saved food. A barcode already on the list returns `{ candidate: null, per100g: null, existingFoodId }` and looks nothing up | 200, 404 `not_found` | 400, 401, 429, 502 |
| POST | `/api/label-reads` | M | Photo of a 栄養成分表示 → candidate values and their basis (multipart) | 200 | 401, 413, 422 `validation_failed` \| `unreadable_label`, 429 `model_cap_reached`, 502 |

**As built, 2026-10-17** (`06`): the values a create takes are at most 100,000 on their basis, and
at most 900 kcal and 100 g of each nutrient once converted to 100 g; above that, or a basis other
than per 100 g without its grams, is 422. `fiberG: null` is saved as 0. A food with an id the caller
already has, with the same content, is the stored food (200). Open Food Facts is asked with
`User-Agent: Overload/1 (<web origin>)`, an 8 s timeout, and its values per serving when it gives
them per serving with the serving's weight. A barcode record measured per 100 ml returns
`per_100ml` with `grams: null`; a serving measured in ml returns `per_serving` with `grams: null`.
Both need the weight of the stated amount before conversion. A label read takes one of the day's
model calls before the model is asked (`04` `model_call_count`) and is read by `claude-haiku-4-5`.

The three lookups never save. The user confirms the candidate on the confirmation screen and the
client then calls `POST /api/foods`. That is S12's "shown for confirmation before saving".

```http
POST /api/label-reads
Content-Type: multipart/form-data; boundary=…
(image: label.jpg, 412 KB)
```
```json
200
{ "candidate": {
    "name": "サラダチキン プレーン", "brand": null, "state": "cooked",
    "basis": { "kind": "per_package", "grams": 110 },
    "energyKcal": 121, "proteinG": 26.4, "carbG": 0.3, "fatG": 1.5, "fiberG": null },
  "per100g": { "energyKcal": 110, "proteinG": 24, "carbG": 0.27, "fatG": 1.36, "fiberG": null },
  "model": "claude-haiku-4-5" }
```

`basis.kind` is `per_100g`, `per_100ml`, `per_piece`, `per_serving` or `per_package`, with its grams when
known. A label read per 100 ml has the same basis and missing weight as a barcode per 100 ml.
`per100g` is the server's conversion, or null while the basis has no grams. A field
the label does not print is `null`, never a guess.

```http
POST /api/foods
{ "id": "0192f010-…", "name": "サラダチキン プレーン", "state": "cooked",
  "basis": { "kind": "per_package", "grams": 110 },
  "energyKcal": 121, "proteinG": 26.4, "carbG": 0.3, "fatG": 1.5, "fiberG": 0,
  "pieceWeightG": null, "source": "label_photo", "sourceRef": "4901234567894", "rotationGroupId": null }
```
```json
201
{ "id": "0192f010-…", "name": "サラダチキン プレーン", "brand": null, "state": "cooked",
  "energyKcal": 110, "proteinG": 24, "carbG": 0.27, "fatG": 1.36, "fiberG": 0,
  "pieceWeightG": null, "keepsDays": null, "source": "label_photo", "sourceRef": "4901234567894",
  "rotationGroupId": null, "archivedAt": null }
```

A stored food is always per 100 g. The response has no `basis`.

### Rotation groups and batches

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/rotation-groups` | M | Groups by name, each with its unarchived foods' ids by name | 200 | 401 |
| POST | `/api/rotation-groups` | M | Create `{ id, name, foodIds[] }`. A food in another group moves to this one | 201 / 200 | 401, 409, 422 |
| PATCH | `/api/rotation-groups/{id}` | M | Rename, or replace `foodIds`. A food not on the caller's list is 422 on `foodIds.N` | 200 | 400, 401, 404, 422 |
| DELETE | `/api/rotation-groups/{id}` | M | Delete. Its foods stay, ungrouped | 204 | 400, 401 |
| GET | `/api/foods/{id}/batches` | M | Batches of one food, newest `cookedOn` first, each with its derived `yield` | 200 | 401, 404 |
| POST | `/api/batches` | M | Record a batch `{ id, foodId, rawWeightG, cookedWeightG, cookedOn, note }` | 201 / 200 | 401, 409, 422 |
| DELETE | `/api/batches/{id}` | M | Delete. Plan items that used it keep their macro snapshot | 204 | 401 |

### Phase, routine and targets

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/goal-phases` | M | Every phase, newest first; the open one has `endedOn: null` | 200 | 401 |
| POST | `/api/goal-phases` | M | Open a phase. `endPrevious: true` closes the open one on the day before, in the same transaction; the new start must be after the open phase's start | 201 / 200 | 401, 409 `phase_already_open` \| `id_conflict`, 422 `validation_failed` for an equal or earlier start |
| PATCH | `/api/goal-phases/{id}` | M | Edit targets, or apply the maintenance check by hand (`calorieTargetKcal` plus `calorieBasis: "measured"`) | 200 | 400, 401, 404, 422 |
| GET | `/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=` | M | The defaults with their sources (S14): rate, protein, fat, provisional calories. The rate is the type's default unless given | 200 | 400, 401, 422 `setup_incomplete` |
| GET | `/api/day-routines` | M | The day types set so far, training first, with their meals | 200 | 401 |
| PUT | `/api/day-routines/{dayType}` | M | Replace one day type's routine and its meals. `slots` (1 to 8) are the meals in order; their count is the meal count | 200 | 400, 401, 422 |
| GET | `/api/day-routines/{dayType}/recommendation?wakeTime=&bedTime=&trainingTime=&mealCount=` | M | The recommended meal count and times for the day as given, with the explanation and sources (S15). `mealCount` asks for times at another count | 200 | 400, 401, 422 `setup_incomplete` |
| GET | `/api/targets/current` | M | The targets in force today, and where they came from | 200 | 401, 422 `setup_incomplete` |

**As built, 2026-10-18** (`#79`, `06`). `setup_incomplete` carries `missing`, in the order
`profile`, `foods`, `goal_phase`, `day_routine`; `profile` means height, sex, birth date and a
weigh-in. The defaults' rate is 0.5 %/week on a cut (0.5–1, Helms 2014) and 0.25 on a bulk
(0.25–0.5, Iraki 2019), none on maintenance; protein 2.2 g/kg on a cut and 1.6 otherwise; fat 25 % of
calories (15–30). The provisional calories are Mifflin–St Jeor resting energy × an activity level
of 1.45 + 0.05 per training day, plus or minus the rate's kcal (7,700 per kg), to the nearest 10
(`03` §8.2). Each default carries `value`, `range` and its `sourceKey`, which the client resolves to
the claim and sources. The recommendation carries `recommendedCount`, `roomFor`, the `slots` with
`isPreTraining` and `isPostTraining`, and protein per meal against 0.4–0.55 g/kg (`perMeal` is
`inside`, `above` or `below`).

`GET /api/targets/current` returns `{ date, goalPhaseId, energyKcal, proteinG, carbG, fatG,
bodyweightKg, source: { kind } }` from the open phase and the trend weight. **The expenditure
estimate is M3** (slice 7, `#82`): until it exists `kind` is only `goal_phase` or
`provisional_formula`, and the inline fallback below is not built.

`GET /api/targets/current` is the **inline fallback** of the daily job (`03` §8.4). If the caller's
local Monday has begun and that week has no expenditure estimate, it computes one before answering.

```json
GET /api/targets/current  →  200
{ "date": "2026-11-10", "goalPhaseId": "0192p001-…",
  "energyKcal": 2380, "proteinG": 150.0, "carbG": 267.0, "fatG": 79.0,
  "source": { "kind": "expenditure_estimate", "id": "0192e002-…", "weekStart": "2026-11-09" } }
```

`source.kind` is `expenditure_estimate`, `goal_phase` or `provisional_formula`. The last one is what
puts the "provisional" label on screen (S14).

### Plan days (S16, S18)

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/plan-days?from=&to=` | M | Plan days in a range (at most 31), meals and items included. **Read-only**: dates with no plan are listed in `missing` | 200 | 400, 401 |
| POST | `/api/plan-days/generate` | M | Generate `{ from, to }`. Days that have no confirmed meal are generated, or regenerated from current inputs; days with any confirmed meal, and past days that already have a plan, are left alone | 200 with the days | 401, 422 `setup_incomplete` \| `validation_failed` |
| POST | `/api/plan-meals/{id}/confirm` | M | Confirm one meal (below). Repeating it replaces the earlier confirmation, never adds to it | 200 with the meal | 401, 404, 409 `day_locked`, 422 |
| POST | `/api/plan-days/{date}/confirm-all` | M | The end-of-day check: every `planned` meal on that day becomes `as_planned` | 200 with the day | 401, 404, 409 `day_locked` |
| GET | `/api/prep-plan?weekStart=` | M | Prep plan and grocery list for the week (S17), derived | 200 | 401, 422 |

- **Why generation is explicit:** a GET that writes rows cannot be prefetched or cached safely. The
  plan screen calls `generate` when `missing` is not empty, and the client calls it after the food
  list, routine or phase changes. The daily job also calls it for the new week.
- **Generation never returns nothing** (`03` §8.2). When a target cannot be met, the day carries
  `shortfalls`, stored with it (`04` `plan_day.shortfalls`).
- **As built, 2026-10-18** (`#79`): `from` after `to`, or more than 31 days, is a 400 on the read
  and a 422 `validation_failed` on `generate`. One generation at a time per user: it reads its inputs
  and writes its days under one lock, so a waiting one never writes from an older food list. The
  client generates today through today + 6 when `missing` is not empty, and again after a food or a rotation group changes, or a
  save on About you, Goal phase or Your day. The daily job is not built. Confirming (below) and the
  prep plan are slices 5 and 6 (`#80`, `#81`); `batchId` and `estimateId` are not in the item yet,
  and `cooked` is.

```json
GET /api/plan-days?from=2026-11-11&to=2026-11-11  →  200
{ "missing": [],
  "days": [ {
    "id": "0192d011-…", "date": "2026-11-11", "dayType": "training", "complete": false,
    "targets": { "energyKcal": 2380, "proteinG": 150.0, "carbG": 267.0, "fatG": 79.0 },
    "planned":   { "energyKcal": 2402, "proteinG": 151.5, "carbG": 268.8, "fatG": 80.1 },
    "confirmed": { "energyKcal": 1210, "proteinG": 78.0,  "carbG": 138.6, "fatG": 38.2 },
    "shortfalls": [],
    "meals": [ {
      "id": "0192m031-…", "position": 3, "plannedTime": "15:30", "label": "post-training",
      "isPreTraining": false, "isPostTraining": true, "status": "planned", "confirmedAt": null,
      "evidence": [ { "claim": "carbohydrate around training", "strength": "moderate", "sourceKey": "carb_timing_training" } ],
      "items": [
        { "id": "0192i071-…", "foodId": "0192f001-…", "name": "鶏むね肉（皮なし、加熱後）", "plannedGrams": 180, "actualGrams": null,
          "pieceCount": null, "cooked": true, "batchId": "0192b004-…", "approximate": false, "estimateId": null,
          "per100g": { "energyKcal": 140.0, "proteinG": 31.1, "carbG": 0, "fatG": 2.0, "fiberG": 0 } },
        { "id": "0192i072-…", "foodId": "0192f003-…", "name": "白米（炊飯後）", "plannedGrams": 250, "actualGrams": null,
          "pieceCount": null, "cooked": true, "batchId": null, "approximate": false, "estimateId": null,
          "per100g": { "energyKcal": 156.0, "proteinG": 2.5, "carbG": 37.1, "fatG": 0.3, "fiberG": 1.5 } }
      ] } ]
  } ] }
```

- `complete` is derived (`CONTEXT.md`). `approximate: true` marks a cooked portion with no batch
  yield recorded (PRD empty state).
- `shortfalls` entries are `{ "target": "protein", "missingG": 22, "suggestion": "add_protein_source" }`
  or `{ "target": "energy", "missingKcal": 140, "cause": "portion_cap", "suggestion": null }`. `cause`
  is `portion_cap` when a portion reached its cap (400 g or 800 kcal) and `foods` when the list has
  nothing more to give, with `suggestion: "add_food"`. Protein is never padded; a protein shortfall
  still fills the calories from carbohydrate and fat.
- `approximate: true` is set, in M2 slice 4, on a raw batch-cooked food planned at the cooked
  weight of its MEXT cooked counterpart (`06`, 2026-10-18), until slice 6's batch yield. With no
  counterpart the item is `cooked: false`, by the food's raw values, with `noCookedMatch: true`.

**Confirming a meal.** The body depends on `status`:

```http
POST /api/plan-meals/0192m031-…/confirm
{ "status": "adjusted",
  "items": [
    { "id": "0192i071-…", "actualGrams": 200 },
    { "id": "0192i072-…", "actualGrams": 200 }
  ] }
```

| `status` | `items` |
| --- | --- |
| `as_planned` | Omitted |
| `skipped` | Omitted |
| `adjusted` | Existing item ids with `actualGrams` or `pieceCount`, plus optional new items from the food list `{ id, foodId, actualGrams }` to swap one in. An existing item left out keeps its planned amount |
| `replaced` | Every item eaten instead: `{ id, foodId, actualGrams }` from the list, or `{ id, name, actualGrams, per100g }` by hand. Planned items are kept with `actualGrams: 0`, so the plan stays readable |

The response is the meal as `GET` returns it, with the day's new `confirmed` totals.

A plan day is confirmable until 7 days after its date in `user_profile.timezone`; after that both
confirm endpoints return 409 `day_locked` (`docs/09` F11). A `PATCH /api/goal-phases/{id}` that changes
`calorieTargetKcal` sets `calorieTargetSetAt` (`docs/09` F13).

---

## 5. Weight and coaching (M2, M3)

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/weigh-ins?from=&to=` | M | Weigh-ins in a range, plus the derived daily weights and trend (S11) | 200 | 400, 401, 422 `setup_incomplete` |
| POST | `/api/weigh-ins` | M | Weigh-in by hand `{ id, measuredAt, weightKg, bodyFatPct }` (`leanMassKg` joins with its M3 column) | 201 / 200 | 401, 409 `id_conflict`, 409 `weigh_in_exists`, 422 |
| DELETE | `/api/weigh-ins/{id}` | M | Delete a hand-typed weigh-in | 204 | 401, 409 `managed_by_apple_health` |
| GET | `/api/maintenance-check` | M | S18a over the trailing 14 calendar days, complete days only (`03` §8.3) | 200 | 401 |
| GET | `/api/expenditure-estimates` | M | Weekly estimates, newest `weekStart` first, paged (S21) | 200 | 401 |
| GET | `/api/protocol-suggestions?status=offered` | M | Suggestions, newest first, with the catalogue entry and sources (S23) | 200 | 401 |
| POST | `/api/protocol-suggestions/{id}/respond` | M | `{ "response": "accepted" \| "dismissed" }`. Idempotent for the same response | 200 | 401, 404, 409 `already_answered`, 422 |
| POST | `/api/meal-estimates` | M | S22: a photo (multipart, with a `planMealId` part) or text (JSON `{ id, planMealId, text }`) → an unsaved estimate | 201 | 401, 404, 413, 422, 429 `model_cap_reached`, 502 |
| POST | `/api/meal-estimates/{id}/confirm` | M | Save it, edited or not: writes the plan item and marks the meal `replaced` | 200 with the meal | 401, 404, 422 |
| GET | `/api/meal-estimates` | M | Past estimates with raw and saved values, paged. For judging provider accuracy (`04`) | 200 | 401 |

- `DELETE` of an Apple Health weigh-in is refused because the next export would re-send it
  within 7 days. The user deletes it in Apple Health instead.
- `POST /api/meal-estimates` stores the row with `confirmedAt: null`, so an estimate shown and then
  abandoned is still counted when judging the provider.

```json
GET /api/weigh-ins?from=2026-11-01&to=2026-11-05  →  200
{ "weighIns": [
    { "id": "0192h101-…", "measuredAt": "2026-11-04T22:41:00.000Z", "weightKg": 71.6, "bodyFatPct": null, "source": "apple_health" } ],
  "days": [
    { "date": "2026-11-05", "weighInId": "0192h101-…", "weightKg": 71.6, "morning": true, "trendKg": 71.84 },
    { "date": "2026-11-03", "weighInId": "0192h0f7-…", "weightKg": 72.2, "morning": false, "trendKg": 71.90 } ],
  "trendAvailable": true,
  "weekChangeKg": -0.29 }
```

*As built in M2 slice 1* (`06`, 2026-10-16):

- `from` and `to` are optional local dates, both included: `from` defaults to the first weigh-in
  and `to` to today, in the profile's time zone. A malformed date, or `from` after `to`, is 400.
  Without a profile it is 422 `setup_incomplete` with `missing: ["profile"]`. The read is not paged:
  a range bounds it, and the export's `weighIns` section pages them all.
- `weighIns` is every reading in the range, newest first. `days` holds only weighed days, newest
  first; each names the reading that stands for it (`weighInId`), so the day's other readings are
  stored but not in the trend. The trend is computed over every day up to `to`, from the first
  reading ever, so a short range starts from where the weight was.
- `trendAvailable` is false with fewer than 3 weighed days up to `to`, and every `trendKg` is then
  `null` (PRD empty state). `weekChangeKg` is the latest trend less the trend at the latest weighed
  day on or before a week before today, to the hundredth; null without a trend or such a day, or
  when the latest weighed day is itself on or before that week boundary.
- A typed weight is 20 to 300 kg to the hundredth, body fat 1 to 75% to the tenth. A repeat of the
  same create returns the stored row (200); the same id with other content, or another user's id,
  is 409 `id_conflict`.

```json
GET /api/maintenance-check  →  200
{ "status": "ready",
  "from": "2026-10-27", "to": "2026-11-09",
  "completeDaysTotal": 31, "remaining": 0,
  "completeDaysInWindow": 12, "lowRecentLogging": false,
  "meanIntakeKcal": 2450, "trendChangeKgPerWeek": -0.10, "maintenanceKcal": 2560,
  "method": "weight_trend_balance_v1" }
```

The window is the trailing 14 calendar days, the same one S21 uses. Only complete
days in it feed the mean. `status` is one of three:

| `status` | When | Filled | `null` |
| --- | --- | --- | --- |
| `collecting` | Fewer than 14 complete days in total | `completeDaysTotal`, `remaining` | Everything else |
| `needs_weigh_in` | Fewer than 3 weigh-ins in the window, or none in its newest 7 days. Screen 6 shows `Weigh in to see this` | Window, counts, `lowRecentLogging` | The three figures |
| `ready` | Otherwise | Everything | — |

- `completeDaysInWindow` is the header's count (`LAST 14 DAYS · 12 COMPLETE`, `10` §6).
  `completeDaysTotal` is the gate.
- `lowRecentLogging` is true when fewer than 5 of the window's newest 7 days are complete. The figure
  is then labelled as resting on too little recent logging (S18a).

*Rewritten 2026-09-22* from "the newest 14 complete days", which contradicted S18a and `03` §8.3.

---

## 6. Health (M3; ingest, tokens and sync state in M2 if Health Auto Export carries weight)

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/ingest/health-auto-export` | I | Health Auto Export upload (below) | 200 with counts | 400, 401, 413 |
| GET | `/api/health/sync-state` | M | Every metric's last sync, plus the ingest tokens' `lastUsedAt` (S19) | 200 | 401 |
| GET | `/api/health/summary` | M | S24: 7- and 30-day trends for sleep, resting heart rate, HRV, steps and weight | 200 | 401 |
| GET | `/api/health/samples?metric=&from=&to=` | M | One metric over a range, oldest first, at most 366 days | 200 | 401, 422 |
| GET | `/api/ingest-tokens` | M | The caller's tokens: label, created, last used, revoked. Never the token or its hash | 200 | 401 |
| POST | `/api/ingest-tokens` | M | Create `{ id, label }`. **The only response that contains the token** | 201 | 401, 422 |
| POST | `/api/ingest-tokens/{id}/revoke` | M | Revoke. Idempotent | 200 | 401, 404 |

- `POST /api/ingest-tokens` is the one create that is **not** retry-safe by repeat: a repeat with the
  same `id` returns 200 with the row and **no token**, because the token was never stored. The setup
  screen tells the user to revoke and create again if the token was lost before it was copied.
- `GET /api/health/sync-state` lists every metric in the vocabulary plus the two reserved series,
  `body_mass` (the weight automation) and `workouts` (`04`, `health_sync_state`). A series with no
  row is returned with `lastSyncedAt: null`, which is "never synced".

### 6.1 `POST /api/ingest/health-auto-export`

- **Request:** Health Auto Export's own JSON, which we do not design. `{ "data": { "metrics": [...],
  "workouts": [...] } }`, where each automation sends only its part.
- **Auth:** `Authorization: Bearer <ingest token>` (`08` §9).
- **Validated** with a Zod schema of the parts we read. Unknown metric names are ignored and counted,
  and an unreadable data point is skipped and counted. **Neither fails the request**, because a 4xx
  makes HAE discard the whole batch, and the good points in it should land.
- **400** only when the body is not the HAE shape at all (no `data`).
- **Writes** as in `03` §9: upserts keyed `(user_id, metric, started_at)`, `(user_id, external_id)`
  and `(user_id, source, measured_at)`, then one sync-state upsert per metric present, then the
  Apple workout matching.

```json
200
{ "metrics": { "received": 7, "stored": 7, "ignoredUnknown": 0 },
  "points": { "received": 49, "upserted": 49, "skipped": 0 },
  "weighIns": { "received": 3, "upserted": 3 },
  "workouts": { "received": 2, "upserted": 2, "linked": 1 },
  "syncState": { "upserted": 9 } }
```

**Unverified:** that HAE's Batch Requests keep each request under Vercel's 4.5 MB. At daily
grouping, a week of seven metrics is a few hundred points, which is kilobytes. Watch the first real
payload sizes.

---

## 7. Jobs

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/cron/daily` | C | The daily job (`03` §8.4): each user's weekly estimate once their local Monday has begun, plan regeneration for the new week, and the plateau check. Idempotent by table keys | 200 `{ usersChecked, estimatesWritten, estimatesApplied, suggestionsWritten }` | 401 |

- Vercel Cron calls with GET, so this is the one GET that writes. It is safe because it is
  idempotent, is not reachable from a browser without the secret, and is never cached (`no-store`).
- It is configured on the **API** project's `vercel.json`, and Vercel calls the API's own URL, not
  the web origin.

---

## 8. What this document changed elsewhere

- **`docs/04`:**
  - `client_updated_at timestamptz NOT NULL` on `workout`, `workout_exercise` and `set`, the sync
    guard in §3.4.
  - `user_profile.training_weekdays smallint[]`. The schema had no record of which calendar days
    are training days.
  - A `reference_food` table for the MEXT catalogue, which `seed/` imports and
    `GET /api/reference-foods` searches. The schema had nowhere to keep it.
- **`docs/03` §8.1:** set upload is an update guarded by `client_updated_at`, not `DO NOTHING`.
  Edits and deletes travel through the same batch.
- **`docs/03` §11:** Vercel's request body limit is 4.5 MB (verified 2026-09-21). What remains
  unverified is HAE's batch size against it.

## Unverified, to check when built

- ~~How `@hono/zod-openapi` describes a `multipart/form-data` body with a file part.~~ Settled
  2026-10-17: `z.instanceof(File)` under `multipart/form-data`, a binary string in the OpenAPI.
- Whether iOS Safari's camera capture hands the page HEIC that the canvas resize can decode. The
  resize re-encodes as JPEG, and the API no longer takes HEIC (§1.5). Check on the phone.
- Which OpenAPI breaking-change checker to run in CI. Picked in `docs/11`.
- That an `APIError` thrown in `beforeDelete` carries our own `code` (`admin_account`) to the
  client. Better Auth's source builds errors as `APIError.from(status, { message, code })`, so it
  looks supported; confirm on the pinned version.
