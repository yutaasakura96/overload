# Project status

**Project:** A weight-training progress tracker combining lift logging, meal planning, Apple Watch/iPhone health data, and bodyweight/diet coaching.
**Phase:** 4 — Tech docs (in progress)
**Updated:** 2026-09-20

## Done
- Phase 1 — Brief + PRD: `docs/01-project-brief.md`, `docs/02-product-requirements.md`, `docs/06-decision-log.md`.
- 2026-09-16: meal planning added (S12–S18a), milestones reordered to M1 Training log → M2 Meal plan + weight → M3 Health + coaching.
- 2026-09-16: Phase 2 run **inside** Claude Code via the `design` skill — it produces `.dc.html`, which is what Phase 3 extracted from. Static mockups, not a clickable prototype.
- 2026-09-16: three directions explored (Instrument / Heavy / Quiet). **Instrument picked.** Reasoning and both rejections in `docs/06-decision-log.md`.
- 2026-09-16: all six v1 screens built in Instrument and published — https://claude.ai/artifact/TcWjBX3Ha6ktRDmwYvAk3e
- 2026-09-16: Phase 3 — `docs/05-design-system.md` and `docs/10-screen-specifications.md` written from the six `.dc.html` files. Every hex code, size, tracking value and grid measurement lifted from source; contrast ratios computed, not estimated. The canvas's "THE SYSTEM" sticky note was found inaccurate and is superseded by `docs/05`.

## Next
**Phase 4 — Tech docs, continued.** Banks 03 and 04 are answered for M1 and M2. `docs/04-database-schema.md` is written (M1 + M2). Remaining: **M3 tables**, then `docs/03-technical-design.md` written up from the decisions in `06`, the triggered Tier 2 docs, and **`CONTEXT.md`**.

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
