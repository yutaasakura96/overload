# Project status

**Project:** A weight-training progress tracker combining lift logging, meal planning, Apple Watch/iPhone health data, and bodyweight/diet coaching.
**Phase:** 4 — Tech docs (in progress)
**Updated:** 2026-09-21

## Done
- Phase 1 — Brief + PRD: `docs/01-project-brief.md`, `docs/02-product-requirements.md`, `docs/06-decision-log.md`.
- 2026-09-16: meal planning added (S12–S18a), milestones reordered to M1 Training log → M2 Meal plan + weight → M3 Health + coaching.
- 2026-09-16: Phase 2 run **inside** Claude Code via the `design` skill — it produces `.dc.html`, which is what Phase 3 extracted from. Static mockups, not a clickable prototype.
- 2026-09-16: three directions explored (Instrument / Heavy / Quiet). **Instrument picked.** Reasoning and both rejections in `docs/06-decision-log.md`.
- 2026-09-16: all six v1 screens built in Instrument and published — https://claude.ai/artifact/TcWjBX3Ha6ktRDmwYvAk3e
- 2026-09-16: Phase 3 — `docs/05-design-system.md` and `docs/10-screen-specifications.md` written from the six `.dc.html` files. Every hex code, size, tracking value and grid measurement lifted from source; contrast ratios computed, not estimated. The canvas's "THE SYSTEM" sticky note was found inaccurate and is superseded by `docs/05`.

## Next
**Phase 4 — Tech docs, continued: the last Tier 2 doc.** Done so far: `03`, `04`, `CONTEXT.md`, `07`, `08`, `09`, `11`, `12`. Still to write:
- `13-infrastructure-security` (real health data, several services). Reference `03` §3, §4, §10 and `12` rather than restating them. Carry in from `12`: Anthropic spend (console limit unverified, per-user label cap), key rotation steps for the incident plan, and the untested Neon restore.

Phase 4 is done when `13` exists. Then Phase 5.

### Phase 4 so far (2026-09-19, recorded in `06`)
- **Two apps, one backend.** Native iOS (SwiftUI) later for the daily loop; web app first for everything through M2, phone-first. Brief updated: native iOS moved from Out of scope to LATER.
- **Offline scope:** online app with an offline gym session — set upload queue in IndexedDB, client ids, home-screen install + persistent storage. Not local-first; PowerSync set aside.
- **Native-ready rules:** REST + OpenAPI, heavy logic on the server, bearer tokens, retry-safe writes.
- **Better Auth verified** (native Google ID token, bearer plugin, `validateUserInfo` allowlist).
- **Stack decided:** TypeScript throughout; React + Vite client-only web app (no SSR); separate Hono API with `@hono/zod-openapi`, and its OpenAPI spec is the contract for both clients. Next.js, Nuxt, SvelteKit, Go and Spring Boot rejected. Database: Postgres. Hosting: Vercel Hobby + Neon Free, both Singapore; later AWS Tokyo on Yuta's own platform (portability rules in `06`). Food data: MEXT seed + Open Food Facts barcode + Haiku label photo (moved into M2) + manual. Weight source parked. Error handling decided (3 failure kinds, RFC 9457, Sentry). Security baseline decided. Folder structure decided. State management decided. Bank 03 complete. Next: bank 04 (schema), triggered Tier 2 docs, and CONTEXT.md. **Nothing written to 03/04 yet**; all decisions so far live in `06`.
- **3 hardest problems decided 2026-09-19** (see `06`): meal planner, exactly-once set sync, maintenance/expenditure maths. Bank 03 is complete.
- **Repo layout and client state decided 2026-09-19** (see `06`): pnpm monorepo, web and API as two Vercel projects with `/api/*` rewritten through the web origin (Safari cookie fix); TanStack Query + one Zustand store for the gym session + own IndexedDB set store with strict durability.
- **Security baseline decided** (see `06`). Add the per-user label cap before the first invitee.
- **Schema written 2026-09-20:** `docs/04` holds M1 (8 tables) and M2 (11 tables) in full — columns, types, keys, delete behaviour, indexes, example rows. M3 not written. Rules recorded in `06`: UUIDv7 ids generated wherever the row is created, no blanket soft delete, past days keep snapshotted numbers, prep list / grocery list / daily weight / day completeness / batch yield are derived not stored.
- **M3 schema written 2026-09-21:** `docs/04` is complete — M3 adds six tables (`health_sample`, `health_workout`, `health_sync_state`, `expenditure_estimate`, `meal_estimate`, `protocol_suggestion`) plus `body_measurement.lean_mass_kg` and `plan_meal_item.estimate_id`. Rules in `06`: health data is one long table keyed on `(user_id, metric, started_at)` with `ON CONFLICT DO UPDATE`; per-metric sync state is stored on purpose; the weekly estimate carries its own targets and `plan_day` reads the newest applied one; meal estimates convert to per 100 g on the way in and keep the raw model output beside it; the protocol catalogue is code, only suggestions are rows; no daily rollup.
- **Correction found by verification 2026-09-21:** Health Auto Export's metric payload has **no per-sample id** — only workouts do. The draft had copied `body_measurement`'s `external_id` key; metrics now use a natural key. Full sources in `06`.
- **`03` written 2026-09-21**, with `docs/diagrams/architecture.drawio.svg`. New decisions in `06`:
  - the trend and expenditure method `weight_trend_balance_v1`: EWMA 10%/day, trailing 14 days, applied at ≥5/7 complete days, ±150 kcal/week cap
  - the Health Auto Export setup: 3 automations, daily grouping, a per-user `ingest_token`
  - workout matching by overlap, correctable
  - the weekly job on a daily Hobby cron with an inline fallback
  - the cost model; Neon AES-256 at rest verified
- **`04` corrected 2026-09-21:**
  - `body_measurement` de-duplicates on `(user_id, source, measured_at)`; HAE sends no id, so the old key would never have matched
  - HAE body fat and lean mass go to `health_sample`
  - HRV is daily
  - new columns `health_workout.link_source` and `expenditure_estimate.window_days` / `week_complete_day_count`
  - new table `ingest_token`
- **`CONTEXT.md`, `07` and `08` written 2026-09-21.** Decisions in `06` (two entries, each with a "decided by default, not asked" list for Yuta to overrule):
  - 30-day sliding sessions
  - admin = `ADMIN_EMAIL` env var
  - sign-out with pending sets warns, then discards
  - revoked = no access, and re-invite restores
  - one sync batch carries creates, edits and deletes, guarded by `client_updated_at` (replaces `DO NOTHING`)
  - camelCase JSON
- **`04` changed by `07` (2026-09-21):**
  - `client_updated_at` on `workout`, `workout_exercise` and `set`
  - `user_profile.training_weekdays` (the training weekdays were recorded nowhere)
  - a new `reference_food` table for the MEXT catalogue (it had no table)
- **`09` written 2026-09-21** — 16 flows (F1–F16). Decisions in `06`: 3 h idle ends a workout; one open workout per user; zero-set workouts are deleted; end-of-day check 60 min before bed plus a "Yesterday" card; plan days lock after 7 days (`day_locked`); each setup step saves alone; a hand-set target wins until next Monday via new `goal_phase.calorie_target_set_at` (fixed a gap where M3 would have ignored every hand edit). `04`, `07` and `03` §8.3 updated.
- **`11` written 2026-09-21:** Vitest + Postgres 18 in Docker, Playwright on Chromium and WebKit, oasdiff, a 7-item iPhone checklist, and an explicit untested list. CI on every PR, all required (by default).
- **`12` written 2026-09-21** (see `06`): staging = `develop` → Vercel preview → Neon `staging`; one Google client and one Anthropic key for now; the web rewrite moves to `vercel.ts` reading `API_ORIGIN` (`03` §5 updated); dbmate migrations inside the API build on `main`/`develop` only; the **add-first** migration rule; Sentry uptime (`/api/health` must not touch the DB) + cron monitor, production only.
- **Parked for M2 (decide before M2 starts):** morning weight source. Two hardware tests are defined in `06` (2026-09-19 entry); run them, then apply the decision rule there.

## Blocked
_(nothing)_

## Carrying

### Decide before or during build — raised by Phase 3, not resolved
- **Contrast.** Four text tones and the secondary-control border fail WCAG AA at the sizes used: `#5A6673` (3.32:1, used at 10–11px for real content), `#4A5560` (2.56:1, all column heads), `#3C464F` (2.02:1, chart axes), `#8A7340` (4.27:1, evidence tag), `#2A3440` (1.54:1, control boundaries). Raising them softens Instrument toward Quiet, which the decision log forbids doing quietly. **This is Yuta's call.** `docs/05` §1.5 and §7.6 hold the measured numbers and the three options.
- **No error colour exists.** Six screens, none of which can fail visibly. Revoked access, refused sync and failed save are all PRD edge cases with nowhere to go. A red must be added and contrast-checked. `docs/05` §7.5.
- **Three overlay series have no colours.** Only weight trend is assigned. Intake, sleep and HRV need colours that stay distinguishable from `accent` and each other when several are on. `docs/10` §2.
- Four smaller extraction deviations (two amber fills, inconsistent active-segment weight, the 30px back chevron, the unused `#6FCDE3`) are listed in `docs/05` §7.

### The four deliberate Phase 2 gaps — now specified as far as extraction allows, in `docs/10` §7
1. **Evidence tag** — anatomy and a strong/moderate/contested colour scheme are proposed in §7.1. Three decisions remain: the contested colour (a neutral `text/tertiary` on `line/field` is recommended over a new token), the route to the source, and the failing 8px label.
2. **Expanded warm-up sets** — §7.2. Screen 1's ~66px of slack depends on the collapse; two expanded rows cost ~126px.
3. **Scroll and sticky behaviour** for screens 3–6 — §7.3, with a per-screen table of what should plausibly stick.
4. **Offline pending count** on screens 2–6 — §7.4. Recommended direction: one shared "data state" slot in the app bar, of which screen 6's `SYNCED 06:41` is the existing relative. Needs one design pass.

### Check when built — raised by Phase 4
`docs/03` §11 lists the unverified items. The ones that bite first:
- Web Locks in Safari, for one uploading tab.
- Whether Workouts v2 without workout metrics still carries average and max heart rate.
- The exact names in HAE's body fat and lean mass payloads.
- `pg_trgm` on Neon Free, for `reference_food` search (`04`).
- How `@hono/zod-openapi` describes a multipart file part (`07`).
- `dbmate` running inside Vercel's build image, and the exact `vercel.ts` rewrite syntax (`12` §6).

### Standing
- Design risk on record: if the real failure mode turns out to be not logging at all because the app reads as a spreadsheet, Quiet was the better bet. Revisit after M1 is in daily use. Phase 3 did not soften Instrument — the contrast cost is recorded as a measured deviation and left for Yuta.
- `docs/10` §8 lists everything the PRD requires that no artboard covers — session start, exercise library, food list management, target setup, the grocery list proper, invite admin, health setup, photo estimation, plateau protocols, and every error state.
- Auth: Better Auth with Google, invite-only — allowlist support verified 2026-09-17.
- M3 photo/text meal-estimate provider: not yet chosen. Haiku 4.5 already reads labels in M2, so it is the default candidate. Phase 4.
- Weekday routine times are set in the app, not fixed in the docs.
- Yuta uses no tracking app today. Import from Hevy/MacroFactor is LATER, for invitees.
- `START-HERE.md` remains as research input (sources for the nutrition evidence).

### Design files
`design/` holds `Main.dc.html` (1), `Progress.dc.html` (2), `MealPlan.dc.html` (3), `EndOfDay.dc.html` (4), `PrepList.dc.html` (5), `WeightTrend.dc.html` (6), plus `Heavy.dc.html` / `Quiet.dc.html` (rejected) and `canvas.json`. The seeded `overload.html` is generated and gitignored — reseed it rather than expecting it in a fresh clone.

To change the canvas: edit the `.dc.html` files, re-run `seed-canvas.mjs` from the design skill's base directory, republish `design/overload.html` with `contract: "0.1.31"`, favicon 🏋️, and **no** `capabilities`. If a publish is refused as stale, extract the live version first and merge — it happened once in Phase 2.

## Skipped
_(nothing)_
