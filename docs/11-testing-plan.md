# 11 — Testing Plan

_Written 2026-09-21. Collects the tests other docs already require rather than restating their
reasoning; each row names its source. Decisions are in `06` (2026-09-21, testing plan)._

## 1. Tools

| Layer | Tool | Runs against |
| --- | --- | --- |
| Domain (`apps/api/src/domain/`) | Vitest | Nothing. Pure functions |
| API, auth, ingest | Vitest, calling the Hono app in process (`app.request`) | Postgres 18 in Docker: `docker compose` locally, a service container in GitHub Actions. `infra/db/bootstrap.sql` then the migrations, once per run; each test runs in a transaction that is rolled back |
| Offline and sync | Playwright, Chromium **and** WebKit, `browserContext.setOffline` | The built web app, the API and the same Postgres |
| Browser sign-in | Better Auth's `testUtils()` plugin: `test.getCookies({ userId })` → `browserContext.addCookies()` | A **test-only** auth instance. The plugin exposes privileged helpers and stays out of the production config |
| Contract | `oasdiff/oasdiff-action/breaking` | `packages/api-contract/openapi.json` on the PR vs `main`. Supports OpenAPI 3.1 (checked 2026-09-21) |

### Isolation, and the two tests it cannot do

Rollback-per-test is the default. Two kinds of test opt out, or they pass without checking anything.
*Added 2026-09-23 (`06`).*

| Kind | Why rollback fails it | How it runs |
| --- | --- | --- |
| Anything asserting on a **deferred** foreign key — account deletion with a custom exercise used in a routine and in a logged workout (`04`, group 4) | `NO ACTION DEFERRABLE INITIALLY DEFERRED` is checked at **commit**. A transaction that is rolled back never reaches one, so a broken delete order still goes green | `SET CONSTRAINTS ALL IMMEDIATE` before the assertions, inside the transaction. The check fires there; the rollback still cleans up |
| **Race** tests — two tabs uploading, the same set sent twice | Two requests inside one test transaction share a connection and serialize. The unique-violation and `ON CONFLICT` paths are never exercised | **Committed**, against a database truncated between tests, in its own Vitest file so the two modes never interleave |

- **Third parties are stubbed at the HTTP boundary**: Open Food Facts, Anthropic. The ingest
  tests post recorded Health Auto Export payloads.
- **Google is not stubbed; it is skipped.** A real OAuth round trip cannot run in CI, and Better
  Auth's Google provider fixes its own token and userinfo endpoints, so only the authorization URL is
  overridable (verified 1.7.5, 2026-09-24). The browser tests therefore start from an injected
  session cookie, and **the Google round trip is proven by hand on staging** — §3 item 2, which is
  where it already lived. The invite gate's own logic is covered in the API tests, which are cheaper
  than a browser. *Decided 2026-09-24 (`06`); this changes where that assurance comes from, not
  whether it exists.* Rejected: the `genericOAuth` plugin pointed at a stub issuer — it would exercise
  the redirect and cookie path but not Google's own provider code.
- **Rejected:** a Neon branch per CI run (network-dependent, Free-tier limits, slower) and PGlite (not
  Postgres 18, so no `uuidv7()`; the auth tests need a real Postgres).
- Playwright's WebKit is not iOS Safari. It catches engine differences early; it does not replace §3.

## 2. Must be automated

| Area | Tests | Source |
| --- | --- | --- |
| **Set upload (S1)** | In airplane mode: log → kill the tab → reopen → reconnect, and every set arrives once. The same set sent twice is stored once. One set refused (`validation_failed`) inside a 200 batch leaves the rest applied and that set refused. Two tabs open upload without duplicates. An offline edit and delete in the same batch apply, and the newer `client_updated_at` wins. A stale copy arriving after a delete does not bring the row back. Reopening the app after 3 h with no new set writes `ended_at` = the last set's `performed_at` on the device and uploads it, offline or not (`09` F3) | `03` §8.1, `07` §3.4, `09` F3 |
| **Export** | Every table with a `user_id` column is in an export section or on the listed exceptions (`07` §2) | `07` §2, S10 |
| **Auth** | Every item in `08` §10: cross-user read, update and delete on every resource including child rows → 404 with A's rows unchanged; B writing a row that refers to A's id (exercise, routine, food, batch, Apple workout, plan meal, sync parent) → refused as not found; the gate's three refusals; after revoke, cookie, bearer and ingest token each 401; member on `/api/admin/*` → 404; token and cookie swapped between routes → 401; cron secret missing or wrong → 401; cross-origin multipart POST with a valid cookie → 403 from `csrf()`; stale-session delete refused and no row left after deletion, including for an account whose custom exercise is used in a routine and in a logged workout; expired session keeps pending sets, which upload after re-sign-in | `08` §10, `03` §10 |
| **Domain** | Planner: ±5% calories, ±5 g protein, 5 g rounding, whole pieces, protein 0.4–0.55 g/kg per meal, carbohydrate around training, determinism, and a food list that cannot meet a target returns the closest plan with `shortfalls`, never nothing. Progression rule (S3). Epley e1RM with warm-ups excluded (S6, S7). Trend EWMA including gaps via `Δd` and the fewer-than-3-days case. Expenditure: the ≥5/7 apply rule, the ±150 kcal clamp, the first estimate of a phase, a window ending on an unweighed day, a first weigh-in inside the window, and no estimate with fewer than 3 weigh-ins or none in the newest 7 days | `03` §8.2–8.3, PRD |
| **Ingest** | A repeated or late sample replaces the earlier copy and is never added twice. An unknown metric or bad point is skipped and counted, never a 4xx. Workout matching picks the greatest overlap | `03` §9, `07` §6.1 |
| **Contract** | A breaking change to `openapi.json` fails CI unless the PR carries the breaking-change label | `07` §1.6 |
| **Flows** | Until the phone writes it, a workout idle for 3 h still reads `endedAt: null` — the server derives nothing (the client half is in the offline row). Finishing with zero ticked sets deletes the workout. Confirming a plan day more than 7 days old returns 409 `day_locked`. A hand-set target newer than the applied estimate is the one in force, and the next estimate clamps ±150 kcal from it. A day left incomplete is not re-asked by the evening card or the "Yesterday" card; the flag is in IndexedDB only, so signing out and back in asks that day again | `09` F3, F11, F13 |
| **Model calls** | One per-user daily counter covers label reads and meal estimates together: calls of both kinds count against it, and the one past the cap returns `429 model_cap_reached`. Lands with the cap itself, which is set before the first invitee (`13` §9) | `09` F15, `07` §1.3 |

The planner's tolerance tests are written before the planner, so the solver choice in `03` §8.2 can be
swapped behind them.

### When each of these lands

A test arrives with the route it covers, not before it. *Added 2026-09-24 (`06`), replacing the
implication that the whole table is written at once.*

| Slice | Tests from the table above |
| --- | --- |
| **1** — skeleton, auth, exercise library | The gate's three refusals · the admin bootstrap on an empty database · cross-user read on `exercise` · cookie and bearer swapped between routes · 401 with no session · the sign-out wipe · one browser test: a signed-in user sees the seeded list |
| **2** — routines | Hono's `csrf()` against the first write route · cross-user write and delete on `exercise`, `exercise_setting` and `routine` · a routine referring to another user's exercise |
| **3** — screen 1 | The S1 happy path · progression, e1RM and the resolved-at-start defaults · the 3-hour rule (`09` F3) |
| **4** — the hard edges | Everything else under **Set upload (S1)** · two tabs · tombstones · the refused set |
| **5** — progress chart | Epley with warm-ups excluded, across spans |
| **6** — invite administration | Revoke → cookie, bearer and ingest token each 401 · member on `/api/admin/*` → 404 · restore leaves ingest tokens revoked |
| **7** — export and delete | Export completeness · stale-session delete · deletion with a custom exercise in a routine and a workout (the deferred-FK case) |
| **M2 / M3** | Planner, trend and expenditure · ingest · model-call cap · the remaining flows |

The cron-secret test lands with the daily job, and the contract check (oasdiff) runs from slice 1 —
a no-op against an absent baseline on the first PR, real from the second.

## 3. Manual checklist — real iPhone, installed app

Run **before each milestone ships** and **after any change to the service worker, the set store or the
uploader**. The result goes in the PR as pass/fail per item.

1. **Install and storage.** Add to home screen; `navigator.storage.persist()` returns true.
2. **Sign-in in the installed app.** The Google OAuth round-trip works in standalone mode, and the
   session cookie survives the `/api` rewrite (the Safari fix in `06`).
3. **Real offline workout.** Airplane mode, 10 sets, lock the phone mid-rest, force-quit, reopen: all 10
   sets present and the timer right. Reconnect: pending reaches 0 and history has no duplicates.
4. **Two tabs and Web Locks.** Whether Safari has `navigator.locks` (`03` §11). Uploads stay
   duplicate-free either way.
5. **Camera.** Barcode scan and label photo (M2).
6. **Health Auto Export end to end.** Token → automations → first data on the dashboard (weight in M2
   if that source is chosen, everything in M3).
7. **401 mid-workout.** "Sign out everywhere" on another device, keep logging on the phone: the prompt
   opens over the screen, and the sets upload after signing in again.

## 4. Deliberately untested in v1

| Untested | Why that is acceptable |
| --- | --- |
| UI component tests and snapshots | Screens change weekly until M1 is in daily use. The polish gate reviews the surface; Playwright covers the screen that must not break |
| Visual regression | Noise until the contrast decisions in `05` §1.5 settle |
| Load and performance | A handful of users. `03` §3 covers cost, and a rollup is added when a span measures slow (`06`) |
| Model output quality (label reads, meal estimates) | Not deterministic. Measured instead: `meal_estimate` keeps raw and saved values, and every read is confirmed by the user |
| Third parties live | Stubbed in automated tests; exercised for real by §3 |
| A coverage percentage | §2 is the bar |

## 5. CI

_Decided by default, not asked._ Every pull request to `develop` or `main` runs typecheck, lint, Vitest,
Playwright and oasdiff. All five must pass to merge. **All five stand up in slice 1**, not a subset
(`06`, 2026-09-23).

- **Lint is oxlint** with its type-aware mode, **format is oxfmt**, both pinned to exact versions:
  Oxc excludes type-aware rules from semver, so a patch release can change what fails
  (`06`, 2026-09-24).
- **Typecheck is `tsc --noEmit` on TypeScript 7**, with `--checkers` pinned so CI and a laptop agree —
  the compiler documents that varying it can surface order-dependent results.
- A sixth step regenerates `packages/api-contract` and fails if the working tree differs, so the
  committed `openapi.json` can never drift from the route schemas.
