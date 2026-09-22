# 11 — Testing Plan

_Written 2026-09-21. Collects the tests other docs already require rather than restating their
reasoning; each row names its source. Decisions are in `06` (2026-09-21, testing plan)._

## 1. Tools

| Layer | Tool | Runs against |
| --- | --- | --- |
| Domain (`apps/api/src/domain/`) | Vitest | Nothing. Pure functions |
| API, auth, ingest | Vitest, calling the Hono app in process (`app.request`) | Postgres 18 in Docker: `docker compose` locally, a service container in GitHub Actions. Migrations applied once per run; each test runs in a transaction that is rolled back |
| Offline and sync | Playwright, Chromium **and** WebKit, `browserContext.setOffline` | The built web app, the API and the same Postgres |
| Contract | `oasdiff/oasdiff-action/breaking` | `packages/api-contract/openapi.json` on the PR vs `main`. Supports OpenAPI 3.1 (checked 2026-09-21) |

- **Third parties are stubbed at the HTTP boundary**: Google, Open Food Facts, Anthropic. The ingest
  tests post recorded Health Auto Export payloads.
- **Rejected:** a Neon branch per CI run (network-dependent, Free-tier limits, slower) and PGlite (not
  Postgres 18, so no `uuidv7()`; the auth tests need a real Postgres).
- Playwright's WebKit is not iOS Safari. It catches engine differences early; it does not replace §3.

## 2. Must be automated

| Area | Tests | Source |
| --- | --- | --- |
| **Set upload (S1)** | In airplane mode: log → kill the tab → reopen → reconnect, and every set arrives once. The same set sent twice is stored once. One set refused (`validation_failed`) inside a 200 batch leaves the rest applied and that set refused. Two tabs open upload without duplicates. An offline edit and delete in the same batch apply, and the newer `client_updated_at` wins. A stale copy arriving after a delete does not bring the row back | `03` §8.1, `07` §3.4 |
| **Auth** | Every item in `08` §10: cross-user read, update and delete on every resource including child rows → 404 with A's rows unchanged; the gate's three refusals; after revoke, cookie, bearer and ingest token each 401; member on `/api/admin/*` → 404; token and cookie swapped between routes → 401; cron secret missing or wrong → 401; stale-session delete refused and no row left after deletion, including for an account whose custom exercise is used in a routine and in a logged workout; expired session keeps pending sets, which upload after re-sign-in | `08` §10, `03` §10 |
| **Domain** | Planner: ±5% calories, ±5 g protein, 5 g rounding, whole pieces, protein 0.4–0.55 g/kg per meal, carbohydrate around training, determinism, and a food list that cannot meet a target returns the closest plan with `shortfalls`, never nothing. Progression rule (S3). Epley e1RM with warm-ups excluded (S6, S7). Trend EWMA including gaps via `Δd` and the fewer-than-3-days case. Expenditure: the ≥5/7 apply rule, the ±150 kcal clamp, the first estimate of a phase, a window ending on an unweighed day, a first weigh-in inside the window, and no estimate with fewer than 3 weigh-ins or none in the newest 7 days | `03` §8.2–8.3, PRD |
| **Ingest** | A repeated or late sample replaces the earlier copy and is never added twice. An unknown metric or bad point is skipped and counted, never a 4xx. Workout matching picks the greatest overlap | `03` §9, `07` §6.1 |
| **Contract** | A breaking change to `openapi.json` fails CI unless the PR carries the breaking-change label | `07` §1.6 |
| **Flows** | A workout idle for 3 h ends at its last set's `performed_at`. Finishing with zero ticked sets deletes the workout. Confirming a plan day more than 7 days old returns 409 `day_locked`. A hand-set target newer than the applied estimate is the one in force, and the next estimate clamps ±150 kcal from it | `09` F3, F11, F13 |

The planner's tolerance tests are written before the planner, so the solver choice in `03` §8.2 can be
swapped behind them.

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
Playwright and oasdiff. All five must pass to merge.
