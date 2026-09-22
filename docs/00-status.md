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
- [x] 2b. Scoped design pass — 2026-09-22. Six artboards on the new tokens, seven state artboards
  (refused set, warm-ups, four overlays, sources sheet, evidence tags, screen 6 countdown and low logging),
  `05`/`10` re-extracted, canvas republished (v5). Three decisions: warm-ups in place, slot owns the app bar's
  right side, end labels in a right gutter (`06` entry of that date)
- [x] 3. `03` technical design — 2026-09-22, five findings: sync tombstones, the set store holds the
  open workout, HAE every 3 hours (Neon CU-hours break first), expenditure as a rate between two trend
  points, four wording fixes (`06` entries of that date). Also edited `04`, `07`, `08`, `09`, `10` §8,
  `11`, `12`, `CONTEXT.md` to match; their groups re-check those edits
- [x] 4. `04` schema + `CONTEXT.md` — 2026-09-22, four findings: deferred exercise FKs (account
  deletion failed, tested on PG 18), `set.position` replaces `set_number`, sync state gains `body_mass`
  and `workouts` and moves to M2, eight wording fixes (`06` entries of that date). Also edited `02`,
  `03` §9, `07` §3.3–3.4 and `11` §2
- [x] 5. `07` API + `08` auth — 2026-09-22, nine findings: referenced ids resolved as the caller's
  (plus a cross-user test), maintenance-check contract rewritten to S18a, missing error codes and
  `setup_incomplete`, Better Auth's `/api/auth/*` as the one non-RFC 9457 exception plus its
  `rateLimit` table, Hono `csrf()` on our routes, restore leaves ingest tokens revoked, export
  completeness test, sync-state wording, four wording fixes (`06` entries of that date). Also edited
  `09` F6 and `11` §2 (their groups re-check them) and `CLAUDE.md`. `04` gained one line, Better
  Auth's `rateLimit` table, reviewed here; group 4 stays ticked
- [x] 6. `09` user flows — 2026-09-22, five findings: end-of-day check is screen 4 behind two cards,
  "leave incomplete" remembered on the device; one model-call cap (`model_cap_reached`) covers label
  reads and meal estimates; the server does not derive an ended workout; F13 gains `needs_weigh_in`;
  five wording fixes (`06` entries of that date). Also edited `03` §6 and §10, `07` §1.3 and §5,
  `08` §7, `10` §4, `13` §9 and `CONTEXT.md` to match. Groups 2, 3 and 5 stay ticked: each edit applies
  a decision made here and was checked against its section
- [ ] 7. **Next:** `11` testing + `12` deploy + `13` security. `13` §9's cap item was widened in group 6

Findings Yuta leaves as they are go under **Reviewed, kept** below, one line each.

**Then Phase 7 — Build, M1 first.** Run `/setup-matt-pocock-skills` once (tracker: GitHub Issues or
local files; the repo is public), then `/grill-with-docs` for the first feature. Each UI feature
clears the polish gate in `CLAUDE.md`.

### Carried to a later group
- Group 7 (`11`): no test yet for the model-call cap counting label reads and meal estimates together,
  or for the end-of-day cards not re-asking a day left incomplete.

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

`design/` now also holds the seven state artboards listed in `10` (page *States (review 2b)* in `canvas.json`).

To change the canvas: edit the `.dc.html` files and `canvas.json`. Then `Artifact read` the live canvas.
Check that its `appifact-doc` files match `git HEAD` (so no canvas-side edits are lost). Replace that JSON
block's `content.files` with every artboard plus `canvas.json`, `<` escaped as `\u003c`. Strip the
service's outer wrapper from the saved copy, write it to `design/overload.html`, and republish to the
same URL with `contract: "0.1.31"`, no `icon` and no `capabilities` (the stored `downloads`/`self` carry
forward). There is no `seed-canvas.mjs`: the canvas is the Artifact **Design** type, not a skill on
disk. If a publish is refused as stale, extract the live version first and merge.

## Skipped
_(nothing)_
