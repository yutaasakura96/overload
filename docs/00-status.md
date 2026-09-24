# Project status

**Project:** A weight-training progress tracker combining lift logging, meal planning, Apple Watch/iPhone health data, and bodyweight/diet coaching.
**Phase:** 7 — Build (M1 first). Phase 6 — Review finished 2026-09-23.
**Updated:** 2026-09-24

## Done
- Phase 1 — Brief + PRD: `docs/01-project-brief.md`, `docs/02-product-requirements.md`, `docs/06-decision-log.md`.
- 2026-09-16: meal planning added (S12–S18a), milestones reordered to M1 Training log → M2 Meal plan + weight → M3 Health + coaching.
- 2026-09-16: Phase 2 run **inside** Claude Code via the `design` skill — it produces `.dc.html`, which is what Phase 3 extracted from. Static mockups, not a clickable prototype.
- 2026-09-16: three directions explored (Instrument / Heavy / Quiet). **Instrument picked.** Reasoning and both rejections in `docs/06-decision-log.md`.
- 2026-09-16: all six v1 screens built in Instrument and published — https://claude.ai/artifact/TcWjBX3Ha6ktRDmwYvAk3e
- 2026-09-16: Phase 3 — `docs/05-design-system.md` and `docs/10-screen-specifications.md` written from the six `.dc.html` files. Every hex code, size, tracking value and grid measurement lifted from source; contrast ratios computed, not estimated. The canvas's "THE SYSTEM" sticky note was found inaccurate and is superseded by `docs/05`.

## Next
**Phase 7 — Build, slice 1.** Two grills have run. `/grill-with-docs` on **2026-09-23** settled
fourteen questions and cut M1 into slices; `/grill-with-docs` on **2026-09-24** settled twelve more —
what slice 1 is made of, and the toolchain. Nine entries in `06`, dated those two days.

**Settled 2026-09-24, in one place:**

| | Decision |
| --- | --- |
| S8's scope | Slice 1 reads the library (`GET /api/exercises`, `/api/me`, `/api/health`). Create, edit, delete and the per-user setting move to slice 2, where S4's picker gives them a screen |
| Migrations | Slice-scoped, not all of `04` at once. `04` now carries a *when each table is created* table |
| Auth in slice 1 | Google + gate + admin bootstrap + **bearer**. `csrf()` mounted now, tested in slice 2. `11` §2 gains a per-slice schedule |
| Profile | `user_profile` created; the setup screen waits for the first reader of a profile field (slice 3) |
| Install | Manifest + shell-only service worker, so `11` §3 items 1 and 2 can run |
| How far | Through to `main` and production, after the staging checklist |
| Query layer | **Kysely**, over the same `pg` Pool Better Auth gets. Closes `12` §3's open choice |
| Lint / format | **oxlint + oxfmt**, exact-pinned. Not Vite+ until 1.0 (it is MIT and free now; the 2025 paid plan was dropped) |
| Language | **TypeScript 7**, config written 7-clean, with `openapi-typescript` on the TS6 alias |
| Runtime | Node 24 and pnpm pinned in repo and CI |
| Browser sign-in | Better Auth's `testUtils()` cookie helper. The real Google round trip is proven by hand on staging |
| Better Auth | snake_case columns, rate limits in the database |

M1 is cut into seven slices:

1. **Skeleton + auth + exercise library (S8)** — one vertical cut through every layer, deployed to
   staging before it merges. Real Better Auth, not a stub.
2. Routines (S4).
3. Screen 1 on the real write path — S1's happy path, S2, S3, S5, S6. Answers the two gaps under
   *Raised by the pain-point check*, and implements the kg/lb toggle.
4. The hard edges — Web Locks, tombstones for offline deletes, refused-set UI, resume after force-quit.
5. Progress chart (S7). 6. Invite administration (S9). 7. Export and delete (S10).

**Issues are open.** Milestone `M1`, one issue per slice, `#1`–`#7`, each chained to the one before
with GitHub's native dependencies. `#1` carries the full slice-1 specification and is labelled
`ready-for-agent`; `#3` carries the three questions its own `/grill-with-docs` must settle first.
Each UI feature clears the polish gate in `CLAUDE.md`.

**Still to do before slice 1 is written:** run `/wizard` for the provisioning walkthrough — Neon
project, `staging` branched **before** `bootstrap.sql` runs, both Vercel projects with Deployment
Protection None, every variable in `12` §2, the Google OAuth client with three redirect URIs. Yuta
runs it: the agent cannot reach those dashboards, and the role passwords must not enter the repo or
a transcript.

**Seed increments, researched 2026-09-23** against Anytime Fitness Japan's own store pages (all 1,848
crawled; `06` holds the evidence): barbell 2.5 · dumbbell 1.0 with the suggestion rounded to the rack
· `machine_plate` 2.5 · `machine_stack` 5.0 · cable 2.5 · bodyweight 0. The dumbbell figure is
high-confidence, the barbell medium-high, the stacks inferred.

**Yuta confirms at his own gym** — equipment is franchise-chosen and only 5 of 1,848 stores publish
denominations: does the branch stock **1.25 kg plates**, and do the **stacks have the small adder
pin**? Neither blocks slice 1; `exercise_setting` overrides per exercise either way.

`/setup-matt-pocock-skills` ran 2026-09-23: **GitHub Issues** on `yutaasakura96/overload` via `gh`,
the five canonical triage labels kept as-is (the four missing ones were created on the repo),
single-context domain docs. Written: `docs/agents/{issue-tracker,triage-labels,domain}.md` and an
`## Agent skills` block in `CLAUDE.md`. Not created: wayfinder's `wayfinder:map` and
`wayfinder:<type>` labels — make them by hand before the first `/wayfinder` run, since
`gh issue create --label <missing>` fails outright.

### Phase 6 — Review, done 2026-09-23
One group per session, in this order. `06` is the reference for every group, not a group of its own.

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
- [x] 7. `11` testing + `12` deploy + `13` security — 2026-09-23, five findings: the three database
  roles are bootstrapped, not migrated (dbmate connects as the owner, Neon needs a 60-bit password,
  child branches copy passwords); Deployment Protection off on both Vercel projects (it would break
  the rewrite, the ingest route and the installed-app checklist); deferred-FK and race tests opt out
  of rollback isolation; the idle-workout test moves to the client and the two carried tests land;
  three wording fixes including "build only", which the docs could not support (`06` entries of that
  date). Also edited `03` §10 and `04` (Security — Roles): both apply decisions made here and were
  checked against their sections, so groups 3 and 4 stay ticked

**Review complete.** Every group ticked; no open contradiction between docs.

Findings Yuta leaves as they are go under **Reviewed, kept** below, one line each.


### Carried to a later group
_(nothing — both group 6 items landed in `11` §2 on 2026-09-23.)_

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
- Web Locks **inside a standalone home-screen app**, and whether the lock is shared with Safari. The
  API itself is supported from Safari 15.4 — verified 2026-09-24.
- Whether Workouts v2 without workout metrics still carries average and max heart rate.
- The exact names in HAE's body fat and lean mass payloads.
- `pg_trgm` on Neon Free, for `reference_food` search (`04`).
- How `@hono/zod-openapi` describes a multipart file part (`07`).
- ~~`dbmate` inside Vercel's build image, and the `vercel.ts` rewrite syntax.~~ **Both verified
  2026-09-24** (`06`, `12` §1 and §3). What remains: whether pnpm's macOS-generated lockfile carries
  `@dbmate/linux-x64` into the Linux build, and whether `vercel.ts` is honoured alongside a framework
  preset.
- The client IP the API project sees on a rewritten request, for the WAF rule (`13` §10).
- Whether a Vercel variable can be withheld from the function runtime — if not, the API's runtime
  environment holds `DATABASE_URL_DIRECT` as well (`13` §10, raised 2026-09-23).
- ~~Whether an installed-to-home-screen PWA on iOS can announce the end of rest.~~ **Answered
  2026-09-24** (`03` §11, `06`): `navigator.vibrate` does not exist on iOS at all; Web Push works in
  an installed app from iOS 16.4 but needs a user gesture to ask; the Screen Wake Lock does not work
  in a standalone app until 18.4. So the screen-1 grill chooses between **push and sound**, with a
  wake lock as a progressive enhancement. The product half — should it alert at all — is still that
  grill's question.

### Waiting for the first build — raised by group 7
- `infra/db/bootstrap.sql` does not exist yet. It creates the three roles and is run before the
  first migration, once per environment (`13` §5). The first migration does the grants only.
- Deployment Protection must be set to None on both Vercel projects when they are created
  (`12` §1 and §6).

### Raised by the pain-point check — decide at each feature's grill (2026-09-23)
Yuta's four stated pain points read against the docs before the first build. Two are covered as
written (the short food list: S12, S16, S18; batch prep: S13, S17). Three gaps, full reasoning in
`06` (2026-09-23, "the four pain points checked against the docs"):
- **The target set count is stored and never shown.** `04` has `target_sets` and S4 promises it, but
  screen 1 draws only `SET 3`, so the screen answers "how many have I done" and not "how many are
  left". Candidate: `SET 3 OF 4` in the active card's label row — horizontal, so the 54px of slack in
  `10` §1 is untouched. **Screen-1 grill, M1.**
- **Nothing announces that rest has ended.** The timer starts by itself and survives a lock and a
  relaunch, but no notification, sound, vibration or wake lock exists in any doc. **Screen-1 grill,
  M1**, with the iOS feasibility half in *Check when built* above.
- **No shelf life, and a batch never runs out.** `04` `batch` is the newest row for a food, with no
  depleting portion count and no keeps-for-N-days, so the prep plan cannot say "cook the fish again
  on Wednesday" — the very reason those foods were chosen. Candidate: `keeps_days` on `food` plus a
  second cook day in S17. **S13/S17 grill, M2.**

### Standing
- Design risk on record: if the real failure mode turns out to be not logging at all because the app reads as a spreadsheet, Quiet was the better bet. Revisit after M1 is in daily use. Phase 3 did not soften Instrument — the contrast cost is recorded as a measured deviation and left for Yuta.
- `docs/10` §8 lists everything the PRD requires that no artboard covers — workout start, exercise library, food list management, target setup, the grocery list proper, invite admin, health setup, photo estimation, plateau protocols, and every error state.
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
