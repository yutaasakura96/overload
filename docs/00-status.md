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
- [x] 2. `05` design system + `10` screens — 2026-09-22, nine findings: contrast, `error`, `series/*`
  overlays, `workout` wording, data-state slot priority, screen 6 vs S18a, four deviations,
  evidence tag, warm-up/sticky placement (`06` entries of that date)
- [ ] 2b. **Next: one scoped design pass** (agreed 2026-09-22 — group 2 is now ticked). The scope is to bring the six `.dc.html` files up to the new tokens and to draw the states
  `10` says need a design pass: the refused state, the data-state slot, the three evidence-tag strengths and the sources sheet,
  the warm-up expand, the four overlays with their end labels (placement and collisions), and
  screen 6's four new states (`10` §6). This is not a new direction and not the §8 screens. Re-extract the deltas into `05`/`10`.
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
- `10` §7.3 scroll and sticky for screens 3–6: left open for each screen's M2 `/grill-with-docs` (2026-09-22).

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

### Raised by Phase 3 — all resolved in review 2026-09-22
Contrast, error colour, overlay colours and the four extraction deviations. See `06` for 2026-09-22.

### The four deliberate Phase 2 gaps — decided in review 2026-09-22
Evidence tag, data-state slot and warm-up expand are decided in `10` §7 and drawn in 2b. Scroll and
sticky are kept open for M2 (see *Reviewed, kept*).

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
