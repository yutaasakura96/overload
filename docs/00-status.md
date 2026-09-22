# Project status

**Project:** A weight-training progress tracker combining lift logging, meal planning, Apple Watch/iPhone health data, and bodyweight/diet coaching.
**Phase:** 6 — Review
**Updated:** 2026-09-22

## Done
- Phase 1 — Brief + PRD: `docs/01-project-brief.md`, `docs/02-product-requirements.md`, `docs/06-decision-log.md`.
- 2026-09-16: meal planning added (S12–S18a), milestones reordered to M1 Training log → M2 Meal plan + weight → M3 Health + coaching.
- 2026-09-16: Phase 2 run **inside** Claude Code via the `design` skill — it produces `.dc.html`, which is what Phase 3 extracted from. Static mockups, not a clickable prototype.
- 2026-09-16: three directions explored (Instrument / Heavy / Quiet). **Instrument picked.** Reasoning and both rejections in `docs/06-decision-log.md`.
- 2026-09-16: all six v1 screens built in Instrument and published — https://claude.ai/artifact/TcWjBX3Ha6ktRDmwYvAk3e
- 2026-09-16: Phase 3 — `docs/05-design-system.md` and `docs/10-screen-specifications.md` written from the six `.dc.html` files. Every hex code, size, tracking value and grid measurement lifted from source; contrast ratios computed, not estimated. The canvas's "THE SYSTEM" sticky note was found inaccurate and is superseded by `docs/05`.

## Next
**Phase 6 — Review.** One group per session, in this order. Tick each group when it is done; untick
one if a later fix changes it. `06` is the reference for every group, not a group of its own.

- [x] 1. `01` brief + `02` PRD — 2026-09-22, six fixes (`06` entry of that date)
- [ ] 2. `05` design system + `10` screens — **in progress.** Finding 1 (contrast) done and logged
  2026-09-22. Resume at finding 2. Remaining queue, most consequential first:
  2. **Error colour** — proposed `error` `#F2555A` (5.77:1), `surface/error` `#170B0C`,
     `line/error` `#501C1E`. CVD-checked against `flag` and `done`. Never colour alone (word + info icon).
     Red means a server refusal only; no signal = pending, service down = `flag`. **Awaiting Yuta's answer.**
  3. **Overlay colours** for intake, sleep and HRV (S20, M3). Also: weight trend uses `flag`, which means
     "needs attention", so its semantics are overloaded.
  4. **Vocabulary** — `10` says "session" 7× (the PRD says "first workout", not "first session"). §1 also says
     the suggestion appears "only when data supports it", but `CONTEXT.md` says a suggestion always exists
     (+increment or the same weight).
  5. **Data-state slot** — `03` §7 and `CONTEXT.md` treat it as decided; `10` §7.4 still calls it a
     proposal needing a design pass.
  6. **Screen 6 vs the updated S18a** — `10` §6 says the card is hidden below 14 days and uses
     "provisional". The PRD now says: show the days remaining, use the trailing-14 window, add the
     too-little-recent-logging label. The `14 COMPLETE DAYS` header is ambiguous. The fallback daily
     weight marking is also missing.
  7. **Four small deviations** (`05` §7.1–7.4): two amber fills, 700 vs 600, the 30px chevron, unused hover.
  8. **Evidence tag** (`10` §7.1): the contested colour and the route to source (the 8px label is already fixed).
  9. **Warm-up expand and scroll/sticky** (`10` §7.2–7.3): probably defer to the feature grill; record as kept.
- [ ] 3. `03` technical design
- [ ] 4. `04` schema + `CONTEXT.md`
- [ ] 5. `07` API + `08` auth
- [ ] 6. `09` user flows
- [ ] 7. `11` testing + `12` deploy + `13` security

Findings Yuta leaves as they are go under **Reviewed, kept** below, one line each.

**Then Phase 7 — Build, M1 first.** Run `/setup-matt-pocock-skills` once (tracker: GitHub Issues or
local files; the repo is public), then `/grill-with-docs` for the first feature. Each UI feature
clears the polish gate in `CLAUDE.md`.

### Reviewed, kept
_(nothing yet)_

### Phase 5 — done 2026-09-21
Written: `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/{pre-edit-branch-guard,stop-branch-drift}.sh`,
`.gitignore` entry. No `.mcp.json` (Neon and Sentry come from claude.ai connectors). Decision in `06`.
The pnpm entries in the allowlist are provisional until `package.json` exists.

### Phase 4 — done 2026-09-21
Written: `03`, `04`, `CONTEXT.md`, `07`, `08`, `09`, `11`, `12`, `13`, and
`docs/diagrams/architecture.drawio.svg`. Every decision, with what was rejected, is in `06`
(2026-09-19 to 2026-09-21). The last entry, infrastructure and security:
- nightly encrypted `pg_dump` to S3 Tokyo via GitHub OIDC
- three Postgres roles
- `audit_event` (added to `04`)
- a $10/month Anthropic workspace
- no custom domain (the AWS move will cost every user a Health Auto Export reconfiguration)
- **compliance deferred to "before the first invitee"** (`13` §9 holds the checklist and findings)

- **Parked for M2 (decide before M2 starts):** morning weight source. Two hardware tests are defined
  in `06` (2026-09-19 entry); run them, then apply the decision rule there.

## Blocked
_(nothing)_

## Carrying

### Decide before or during build — raised by Phase 3, not resolved
- ~~**Contrast.**~~ **Resolved 2026-09-22** (`06`). Was: four text tones and the secondary-control border fail WCAG AA at the sizes used: `#5A6673` (3.32:1, used at 10–11px for real content), `#4A5560` (2.56:1, all column heads), `#3C464F` (2.02:1, chart axes), `#8A7340` (4.27:1, evidence tag), `#2A3440` (1.54:1, control boundaries). Raising them softens Instrument toward Quiet, which the decision log forbids doing quietly. **This is Yuta's call.** `docs/05` §1.5 and §7.6 hold the measured numbers and the three options.
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
- The client IP the API project sees on a rewritten request, for the WAF rule (`13` §10).

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
