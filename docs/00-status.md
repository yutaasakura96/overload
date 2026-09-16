# Project status

**Project:** A weight-training progress tracker combining lift logging, meal planning, Apple Watch/iPhone health data, and bodyweight/diet coaching.
**Phase:** 2 — Design exploration
**Updated:** 2026-09-16

## Done
- Phase 1 — Brief + PRD: `docs/01-project-brief.md`, `docs/02-product-requirements.md`, `docs/06-decision-log.md`.
- 2026-09-16: meal planning added (S12–S18a), milestones reordered to M1 Training log → M2 Meal plan + weight → M3 Health + coaching. Reviewed with Yuta.

## Next
Phase 2 — Design exploration, in Claude Design (outside Claude Code).

**Phase 2 prompt to use:**
> Mobile-first web app for weight training and meal planning (iPhone, used one-handed). Design these screens: (1) live workout session: exercise list, set rows showing last time's weight × reps, a suggested weight, a tick-to-complete control, RIR field, warm-up flag, and a rest timer that stays visible; (2) exercise progress: e1RM line chart with 4w/12w/6m/1y/all spans and toggleable overlays for intake, weight trend, sleep and HRV; (3) today's meal plan: meals on a timeline around the workout, grams per food, and per-meal "eaten as planned / adjust / replaced" controls with daily macro totals vs targets; (4) end-of-day check: unconfirmed meals with confirm-all; (5) weekly prep plan and grocery list; (6) weight trend with the maintenance check (average intake vs trend change). Dark UI suited to a gym, large tap targets, legible at arm's length. Read `docs/02-product-requirements.md` for the stories.

**Bring back:** one picked direction, exported as HTML/CSS, saved to `design/` next to `docs/`. Then run `/project` for Phase 3 (Extract).

## Blocked
_(nothing)_

## Carrying
- Auth is decided at product level: Better Auth with Google, invite-only. Verify Better Auth allowlist support in Phase 4.
- Health Auto Export: which tier includes REST automations, and its price, are unverified. Resolve in Phase 4.
- Food database (must support search and barcode) and photo/text estimation provider: unresearched. Phase 4.
- Weekday routine times are set in the app, not fixed in the docs.
- Yuta uses no tracking app today. Import from Hevy/MacroFactor is LATER, for invitees.
- `START-HERE.md` remains as research input (sources for the nutrition evidence).

## Skipped
_(nothing)_
