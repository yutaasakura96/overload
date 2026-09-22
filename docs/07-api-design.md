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

Every error is an RFC 9457 problem detail, `Content-Type: application/problem+json`:

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
- The detail never contains a food, weight or health value (`03` §7). It names the field, not what
  was in it.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | Malformed JSON, or a query parameter of the wrong type |
| 401 | `unauthenticated` | No session, an expired session, or a bad ingest or cron token |
| 404 | `not_found` | No such route, or no row with that id **belonging to the caller** |
| 404 | `not_found` | A member calling `/api/admin/*` (`08` §4) |
| 409 | `id_conflict` | A create reused an id that exists with different content |
| 409 | `exercise_has_history` | Deleting a custom exercise that has sets. Hide it instead |
| 409 | `exercise_in_routine` | Deleting an exercise used by a routine. The body lists `routines: [{id, name}]` |
| 409 | `phase_already_open` | Opening a goal phase with `endPrevious: false` while one is open |
| 409 | `admin_account` | Revoking, or deleting the account of, `ADMIN_EMAIL` |
| 409 | `invite_exists` | Inviting an email that already has a row. Restore it instead |
| 409 | `managed_by_apple_health` | Deleting a weigh-in that came from Apple Health |
| 413 | `payload_too_large` | Over our own photo limit (§1.5). Vercel's own 4.5 MB cap answers with its own 413 before our code runs |
| 422 | `validation_failed` | The Zod schema refused the body |
| 422 | `unreadable_label` | The label photo had no nutrition table the model could read |
| 429 | `rate_limited` | Better Auth's limiter, or Open Food Facts' 15 reads a minute passed through |
| 429 | `label_cap_reached` | The per-user daily label-read cap (`03` §10; set before the first invitee) |
| 502 | `upstream_failed` | Open Food Facts or Anthropic returned an error |
| 503 | `database_unavailable` | Neon still unreachable after the one retry (`03` §4) |
| 500 | `internal` | Anything else. Logged with a stack trace and sent to Sentry |

Refusals inside a sync batch or an ingest payload do not fail the request. They appear per item in
a 200 (§3.4, §6.1).

### 1.4 Lists, filtering and sorting

- **Small, bounded lists are returned whole**, with no pagination: exercises, routines, foods,
  rotation groups, phases, day routines, invites, ingest tokens and sync state. Each is tens of rows
  for one user.
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

- `multipart/form-data` with one `image` part. `image/jpeg`, `image/png`, `image/webp` and
  `image/heic` are accepted.
- **The client resizes before upload**, to at most 1568 px on the long edge as JPEG. The API refuses
  anything over 4 MB with `payload_too_large`. That keeps well under Vercel's 4.5 MB request cap
  (Vercel functions limits, checked 2026-09-21).
- The image goes to Anthropic in memory and is never written anywhere (`03` §10).

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
| `*` | `/api/auth/*` | — | Better Auth: Google sign-in, callback, `get-session`, `sign-out`, `list-sessions`, `revoke-other-sessions`, `delete-user` | Better Auth's | Better Auth's |
| GET | `/api/me` | M | The signed-in user, their profile, and `isAdmin` | 200 | 401 |
| PATCH | `/api/me/profile` | M | Timezone, height, sex, birth date, training weekdays | 200 profile | 401, 422 |
| GET | `/api/me/export` | M | One section of the export (S10), paged | 200 | 401, 422 |
| GET | `/api/admin/invites` | A | Every invite, newest first | 200 | 401, 404 |
| POST | `/api/admin/invites` | A | Invite an email | 201 | 401, 404, 409 `invite_exists`, 422 |
| POST | `/api/admin/invites/{id}/revoke` | A | Revoke (`08` §8). Idempotent: revoking a revoked invite returns it unchanged | 200 | 401, 404, 409 `admin_account` |
| POST | `/api/admin/invites/{id}/restore` | A | Clear `revoked_at` | 200 | 401, 404 |

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
    "trainingWeekdays": [1, 3, 5]
  }
}
```

`trainingWeekdays` uses ISO weekday numbers, 1 = Monday. It is what makes a calendar day a
training day for the planner (S15).

### `GET /api/me/export`

**Why sectioned:** Vercel caps a response body at 4.5 MB, and a few years of one person's sets,
plans and health samples can pass that. The client fetches every section page by page and builds
the file in the browser as `overload-export-2026-11-04.json`.

- `?section=` one of `profile`, `exercises`, `routines`, `workouts`, `foods`, `batches`, `phases`,
  `dayRoutines`, `planDays`, `weighIns`, `healthSamples`, `appleWorkouts`, `expenditureEstimates`,
  `mealEstimates`, `protocolSuggestions`, `ingestTokens` (labels and dates only, never hashes).
- Paged as in §1.4. Each item is the row as the API's normal read returns it, with its children
  nested (a workout carries its exercises and sets).

```http
GET /api/me/export?section=workouts&limit=100
```
```json
{ "section": "workouts", "items": [{ "id": "0192w001-…", "name": "Push A", "startedAt": "2026-11-04T09:02:11.000Z", "exercises": [ … ] }], "nextCursor": "eyJ0IjoiMjAyNi0xMC0yOCIsImlkIjoiMDE5MnYwMDEifQ" }
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
| POST | `/api/exercises` | M | Create a custom exercise | 201 / 200 | 401, 409 `id_conflict`, 422 (duplicate name included) |
| PATCH | `/api/exercises/{id}` | M | Edit a custom exercise's name, equipment or defaults. Seeded ones return 404 | 200 | 401, 404, 422 |
| DELETE | `/api/exercises/{id}` | M | Delete a custom exercise with no sets | 204 | 401, 409 `exercise_has_history`, 409 `exercise_in_routine` |
| PUT | `/api/exercises/{id}/setting` | M | The caller's increment, rest, rep range and `hidden` for any exercise. `null` restores the default | 200 | 401, 404, 422 |

```json
GET /api/exercises  →  200
{ "items": [
  { "id": "0192a001-…", "name": "Barbell Bench Press", "equipment": "barbell", "custom": false, "hidden": false,
    "incrementKg": 2.5, "restSeconds": 180, "repLow": 6, "repHigh": 10,
    "overrides": { "incrementKg": false, "restSeconds": true, "repLow": false, "repHigh": false } }
] }
```

`overrides` tells the settings screen which values are the user's own and which are defaults.

### Routines

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/routines` | M | Every routine with its slots, in `position` order | 200 | 401 |
| POST | `/api/routines` | M | Create, optionally with `exercises[]` | 201 / 200 | 401, 409, 422 |
| PATCH | `/api/routines/{id}` | M | Rename, or move in the list | 200 | 401, 404, 422 |
| PUT | `/api/routines/{id}/exercises` | M | Replace the whole slot list. Order is array order, so a reorder is one call | 200 | 401, 404, 422 (unknown or hidden exercise) |
| DELETE | `/api/routines/{id}` | M | Delete. Past workouts keep their name (`04`) | 204 | 401 |

```http
PUT /api/routines/0192r001-…/exercises
{ "exercises": [
  { "id": "0192r101-…", "exerciseId": "0192a001-…", "targetSets": 4, "repLow": 6, "repHigh": 10 },
  { "id": "0192r102-…", "exerciseId": "0192a1f4-…", "targetSets": 3, "repLow": 12, "repHigh": 15 }
] }
```

### Last time and suggestions, for offline use

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/training/last-time` | M | For **every exercise the caller has logged**: last time per set number, and today's suggestion | 200 | 401 |

**Why one call for everything:** the gym screen must show last time and the suggestion with no
signal (S2, S3), including for an exercise added mid-workout. The client fetches this once when
online, TanStack Query persists it, and it is refetched after every acknowledged sync batch. It is
one row group per exercise, which is small. The suggestion is computed on the server (native-ready
rule 2), so an offline workout shows the suggestion as of the last sync.

```json
GET /api/training/last-time  →  200
{ "asOf": "2026-11-04T10:15:02.000Z",
  "exercises": [
    { "exerciseId": "0192a001-…", "workoutId": "0192w001-…", "performedOn": "2026-11-04",
      "sets": [ { "setNumber": 1, "weightKg": 80, "reps": 10 }, { "setNumber": 2, "weightKg": 80, "reps": 10 }, { "setNumber": 3, "weightKg": 80, "reps": 10 } ],
      "suggestion": { "weightKg": 82.5, "rule": "top_of_range_hit", "reason": "hit 10 on every set last time" } }
  ] }
```

`suggestion.rule` is `top_of_range_hit` or `repeat`. An exercise never logged is absent, and the
screen shows "first session".

### 3.4 Sync — the only write path for workouts, workout exercises and sets

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/workouts/sync` | M | Apply the device's queued rows | 200 with a result per row | 401 (nothing applied; every row stays pending), 400, 413 |

**Request.** Three arrays, each row the **whole current row** as the phone holds it, plus
`clientUpdatedAt`, the phone's clock at the last edit. A deletion is `{ id, deletedAt }`.

```http
POST /api/workouts/sync
{
  "workouts": [
    { "id": "0192w003-5b1a-7e20-a4c9-2f8d6e1b7c30", "routineId": "0192r001-…", "name": "Push A",
      "startedAt": "2026-11-11T09:01:40.000Z", "endedAt": null, "note": null,
      "clientUpdatedAt": "2026-11-11T09:01:40.000Z" }
  ],
  "workoutExercises": [
    { "id": "0192x010-…", "workoutId": "0192w003-…", "exerciseId": "0192a001-…", "position": 0,
      "targetSets": 4, "repLow": 6, "repHigh": 10, "incrementKg": 2.5,
      "clientUpdatedAt": "2026-11-11T09:01:40.000Z" }
  ],
  "sets": [
    { "id": "0192s020-…", "workoutExerciseId": "0192x010-…", "setNumber": 1, "weightKg": 82.5, "reps": 10,
      "rir": 2, "rpe": null, "isWarmup": false, "performedAt": "2026-11-11T09:09:12.000Z",
      "clientUpdatedAt": "2026-11-11T09:09:12.000Z" },
    { "id": "0192s021-…", "workoutExerciseId": "0192x010-…", "setNumber": 2, "weightKg": 82.5, "reps": 0,
      "rir": null, "rpe": null, "isWarmup": false, "performedAt": "2026-11-11T09:12:40.000Z",
      "clientUpdatedAt": "2026-11-11T09:12:40.000Z" },
    { "id": "0192s019-…", "deletedAt": "2026-11-11T09:10:03.000Z" }
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
  counts as `deleted` if the row is already gone. Deleting a workout cascades (`04`).
- **A deleted row stays deleted.** Each deletion writes a `sync_tombstone` (`04`) for the row and
  every row it cascades to. A row whose id, or whose parent's id, has a tombstone is not inserted,
  and neither is a child of a row reported `deleted` earlier in the same batch. All of these are
  reported `deleted`. Without this, a stale copy from a second tab or a late request would bring a
  deleted set back. *Added 2026-09-22.*
- **Ownership:** a row whose id exists under another user is refused as `not_found`, like any
  other cross-user access.
- **Limit:** 500 rows a request. The uploader splits larger queues.

**Response.** Always 200 when authenticated, with one entry for every id sent:

```json
{
  "results": [
    { "table": "workouts", "id": "0192w003-…", "status": "stored", "row": { … } },
    { "table": "workoutExercises", "id": "0192x010-…", "status": "stored", "row": { … } },
    { "table": "sets", "id": "0192s020-…", "status": "stored", "row": { … } },
    { "table": "sets", "id": "0192s021-…", "status": "refused",
      "problem": { "code": "validation_failed", "status": 422, "errors": [{ "path": "reps", "message": "Number must be greater than 0" }] } },
    { "table": "sets", "id": "0192s019-…", "status": "deleted" }
  ]
}
```

| `status` | Meaning | What the phone does |
| --- | --- | --- |
| `stored` | Inserted or updated | Delete the local record: **acknowledged** |
| `unchanged` | The server already had this version or a newer one. `row` is the server's copy | Delete the local record |
| `deleted` | Gone, now or before | Delete the local record |
| `refused` | Refused, with `problem` | Keep the record and mark it **refused** (`03` §7, kind 3) |

- **A 401 applies nothing** and refuses nothing. Every row stays pending until sign-in (`08` §5).
- A network failure or a 5xx leaves every row pending, and the whole batch is resent. The guard
  makes that harmless.

### Reading workouts

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/workouts` | M | History, newest `startedAt` first, paged. Each item is a summary: name, times, exercise names, working-set count | 200 | 401 |
| GET | `/api/workouts/{id}` | M | One workout with exercises, sets and the linked Apple workout | 200 | 401, 404 |
| GET | `/api/exercises/{id}/progress` | M | The S7 chart, with S20 overlays when asked | 200 | 401, 404, 422 |

```http
GET /api/exercises/0192a001-…/progress?span=12w&overlays=intake,trend,sleep,hrv
```
```json
{
  "span": "12w", "from": "2026-08-19", "to": "2026-11-10",
  "points": [ { "workoutId": "0192w001-…", "date": "2026-11-04", "e1rmKg": 106.7, "topSetKg": 80, "volumeKg": 2400 } ],
  "stats": { "bestE1rmKg": 106.7, "topSetKg": 82.5, "volumeKg": 28800 },
  "overlays": {
    "intake": [ { "date": "2026-11-04", "energyKcal": 2380, "complete": true } ],
    "trend":  [ { "date": "2026-11-04", "trendKg": 71.84 } ],
    "sleep":  [ { "date": "2026-11-04", "hours": 6.9 } ],
    "hrv":    [ { "date": "2026-11-04", "ms": 48 } ]
  }
}
```

- `span` is one of `4w`, `12w`, `6m`, `1y`, `all`.
- With fewer than 2 workouts, `points` has 0 or 1 items and the client shows "Not enough data yet".
- `overlays` omitted gives no overlay keys. The M3 series return empty arrays before M3 data exists.
- Warm-ups are excluded from every number here (S6).

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
| GET | `/api/foods` | M | The food list, by name. Archived ones only with `?includeArchived=true` | 200 | 401 |
| POST | `/api/foods` | M | Add a confirmed food. The body carries the values **and the basis they were read in**; the API converts to per 100 g | 201 / 200 | 401, 409, 422 |
| PATCH | `/api/foods/{id}` | M | Edit values, piece weight or rotation group. Past plan days keep their snapshot | 200 | 401, 404, 422 |
| DELETE | `/api/foods/{id}` | M | Archive (`archivedAt` set). Unconfirmed future plan days are regenerated without it | 204 | 401 |
| GET | `/api/reference-foods?q=` | M | Search the MEXT table (八訂 増補2023). At least 1 character, 20 results, best match first | 200 | 401, 422 |
| GET | `/api/barcodes/{code}` | M | Look up Open Food Facts. Returns a **candidate**, not a saved food, plus `existingFoodId` if the list already has that barcode | 200, 404 `not_found` | 401, 429, 502 |
| POST | `/api/label-reads` | M | Photo of a 栄養成分表示 → candidate values and their basis (multipart) | 200 | 401, 413, 422 `unreadable_label`, 429 `label_cap_reached`, 502 |

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
    "energyKcal": 121, "proteinG": 26.4, "carbG": 0.3, "fatG": 1.5, "fiberG": null, "sodiumMg": null },
  "per100g": { "energyKcal": 110.0, "proteinG": 24.0, "carbG": 0.27, "fatG": 1.36, "fiberG": 0 },
  "model": "claude-haiku-4-5-20251001" }
```

`basis.kind` is `per_100g`, `per_piece`, `per_serving` or `per_package`, with its grams when
printed. `per100g` is the server's conversion, shown so the user sees what will be saved. A field
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
  "energyKcal": 110.0, "proteinG": 24.0, "carbG": 0.27, "fatG": 1.36, "fiberG": 0,
  "pieceWeightG": null, "source": "label_photo", "sourceRef": "4901234567894",
  "rotationGroupId": null, "archivedAt": null }
```

A stored food is always per 100 g. The response has no `basis`.

### Rotation groups and batches

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/rotation-groups` | M | Groups with their member food ids | 200 | 401 |
| POST | `/api/rotation-groups` | M | Create `{ id, name, foodIds[] }` | 201 / 200 | 401, 409, 422 |
| PATCH | `/api/rotation-groups/{id}` | M | Rename, or replace `foodIds` | 200 | 401, 404, 422 |
| DELETE | `/api/rotation-groups/{id}` | M | Delete. Its foods stay, ungrouped | 204 | 401 |
| GET | `/api/foods/{id}/batches` | M | Batches of one food, newest `cookedOn` first, each with its derived `yield` | 200 | 401, 404 |
| POST | `/api/batches` | M | Record a batch `{ id, foodId, rawWeightG, cookedWeightG, cookedOn, note }` | 201 / 200 | 401, 409, 422 |
| DELETE | `/api/batches/{id}` | M | Delete. Plan items that used it keep their macro snapshot | 204 | 401 |

### Phase, routine and targets

| Method | Path | Auth | Purpose | Success | Failures |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/goal-phases` | M | Every phase, newest first; the open one has `endedOn: null` | 200 | 401 |
| POST | `/api/goal-phases` | M | Open a phase. `endPrevious: true` closes the open one on the day before, in the same transaction | 201 / 200 | 401, 409 `phase_already_open`, 422 |
| PATCH | `/api/goal-phases/{id}` | M | Edit targets, or apply the maintenance check by hand (`calorieTargetKcal` plus `calorieBasis: "measured"`) | 200 | 401, 404, 422 |
| GET | `/api/goal-phases/defaults?type=cut` | M | The defaults with their sources (S14): rate, protein, fat, provisional calories | 200 | 401, 422 (profile incomplete) |
| GET | `/api/day-routines` | M | Both day types with their meal slots | 200 | 401 |
| PUT | `/api/day-routines/{dayType}` | M | Replace one day type's routine and its meal slots | 200 | 401, 422 |
| GET | `/api/day-routines/{dayType}/recommendation` | M | The recommended meal count and times, with the explanation and sources (S15) | 200 | 401, 422 (routine or phase missing) |
| GET | `/api/targets/current` | M | The targets in force today, and where they came from | 200 | 401 |

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
| GET | `/api/plan-days?from=&to=` | M | Plan days in a range (at most 31), meals and items included. **Read-only**: dates with no plan are listed in `missing` | 200 | 401, 422 |
| POST | `/api/plan-days/generate` | M | Generate `{ from, to }`. Days that have no confirmed meal are generated, or regenerated from current inputs; days with any confirmed meal are left alone | 200 with the days | 401, 422 (no foods, no routine, no phase) |
| POST | `/api/plan-meals/{id}/confirm` | M | Confirm one meal (below). Repeating it replaces the earlier confirmation, never adds to it | 200 with the meal | 401, 404, 409 `day_locked`, 422 |
| POST | `/api/plan-days/{date}/confirm-all` | M | The end-of-day check: every `planned` meal on that day becomes `as_planned` | 200 with the day | 401, 404, 409 `day_locked` |
| GET | `/api/prep-plan?weekStart=` | M | Prep plan and grocery list for the week (S17), derived | 200 | 401, 422 |

- **Why generation is explicit:** a GET that writes rows cannot be prefetched or cached safely. The
  plan screen calls `generate` when `missing` is not empty, and the client calls it after the food
  list, routine or phase changes. The daily job also calls it for the new week.
- **Generation never returns nothing** (`03` §8.2). When a target cannot be met, the day carries
  `shortfalls`.

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
          "pieceCount": null, "batchId": "0192b004-…", "approximate": false, "estimateId": null,
          "per100g": { "energyKcal": 140.0, "proteinG": 31.1, "carbG": 0, "fatG": 2.0, "fiberG": 0 } },
        { "id": "0192i072-…", "foodId": "0192f003-…", "name": "白米（炊飯後）", "plannedGrams": 250, "actualGrams": null,
          "pieceCount": null, "batchId": null, "approximate": false, "estimateId": null,
          "per100g": { "energyKcal": 156.0, "proteinG": 2.5, "carbG": 37.1, "fatG": 0.3, "fiberG": 1.5 } }
      ] } ]
  } ] }
```

- `complete` is derived (`CONTEXT.md`). `approximate: true` marks a cooked portion with no batch
  yield recorded (PRD empty state).
- `shortfalls` entries look like `{ "target": "protein", "missingG": 22, "suggestion": "add_protein_source" }`.

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
| GET | `/api/weigh-ins?from=&to=` | M | Weigh-ins in a range, plus the derived daily weights and trend (S11) | 200 | 401, 422 |
| POST | `/api/weigh-ins` | M | Weigh-in by hand `{ id, measuredAt, weightKg, bodyFatPct, leanMassKg }` | 201 / 200 | 401, 409, 422 |
| DELETE | `/api/weigh-ins/{id}` | M | Delete a hand-typed weigh-in | 204 | 401, 409 `managed_by_apple_health` |
| GET | `/api/maintenance-check` | M | S18a over the newest 14 complete days | 200 | 401 |
| GET | `/api/expenditure-estimates` | M | Weekly estimates, newest `weekStart` first, paged (S21) | 200 | 401 |
| GET | `/api/protocol-suggestions?status=offered` | M | Suggestions, newest first, with the catalogue entry and sources (S23) | 200 | 401 |
| POST | `/api/protocol-suggestions/{id}/respond` | M | `{ "response": "accepted" \| "dismissed" }`. Idempotent for the same response | 200 | 401, 404, 409 (already answered differently), 422 |
| POST | `/api/meal-estimates` | M | S22: a photo (multipart, with a `planMealId` part) or text (JSON `{ id, planMealId, text }`) → an unsaved estimate | 201 | 401, 404, 413, 422, 429, 502 |
| POST | `/api/meal-estimates/{id}/confirm` | M | Save it, edited or not: writes the plan item and marks the meal `replaced` | 200 with the meal | 401, 404, 422 |
| GET | `/api/meal-estimates` | M | Past estimates with raw and saved values, paged. For judging provider accuracy (`04`) | 200 | 401 |

- `DELETE` of an Apple Health weigh-in is refused because the next export would re-send it
  within 7 days. The user deletes it in Apple Health instead.
- `POST /api/meal-estimates` stores the row with `confirmedAt: null`, so an estimate shown and then
  abandoned is still counted when judging the provider.

```json
GET /api/weigh-ins?from=2026-11-01&to=2026-11-05  →  200
{ "weighIns": [
    { "id": "0192h101-…", "measuredAt": "2026-11-04T22:41:00.000Z", "weightKg": 71.6, "bodyFatPct": null, "leanMassKg": null, "source": "apple_health" } ],
  "days": [
    { "date": "2026-11-05", "weightKg": 71.6, "morning": true, "trendKg": 71.84 },
    { "date": "2026-11-03", "weightKg": 72.2, "morning": false, "trendKg": 71.90 } ],
  "trendAvailable": true }
```

`days` holds only weighed days, newest first. `trendAvailable` is false with fewer than 3 weighed
days, and every `trendKg` is then `null` (PRD empty state).

```json
GET /api/maintenance-check  →  200
{ "ready": true, "completeDays": 14, "remaining": 0,
  "from": "2026-10-21", "to": "2026-11-09",
  "meanIntakeKcal": 2450, "trendChangeKgPerWeek": -0.10, "maintenanceKcal": 2560,
  "method": "weight_trend_balance_v1" }
```

With fewer than 14 complete days: `{ "ready": false, "completeDays": 9, "remaining": 5 }`, with the
rest `null`.

---

## 6. Health (M3)

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
- `GET /api/health/sync-state` lists every metric in the vocabulary. A metric with no row is
  returned with `lastSyncedAt: null`, which is "never synced" (`04`).

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
  "workouts": { "received": 2, "upserted": 2, "linked": 1 } }
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

- How `@hono/zod-openapi` describes a `multipart/form-data` body with a file part, for
  `label-reads` and `meal-estimates`. `06` names this as its revisit condition.
- Whether iOS Safari's camera capture hands the page HEIC, and whether the client-side resize
  converts it. The API accepts HEIC as a fallback either way.
- Which OpenAPI breaking-change checker to run in CI. Picked in `docs/11`.
