# Project status

**Project:** A weight-training progress tracker combining lift logging, meal planning, Apple Watch/iPhone health data, and bodyweight/diet coaching.
**Phase:** 2 — Design exploration (complete)
**Updated:** 2026-09-16

## Done
- Phase 1 — Brief + PRD: `docs/01-project-brief.md`, `docs/02-product-requirements.md`, `docs/06-decision-log.md`.
- 2026-09-16: meal planning added (S12–S18a), milestones reordered to M1 Training log → M2 Meal plan + weight → M3 Health + coaching.
- 2026-09-16: Phase 2 run **inside** Claude Code via the `design` skill rather than Claude Design outside it — it produces `.dc.html`, which is what Phase 3 extracts from. Static mockups, not a clickable prototype.
- 2026-09-16: three directions explored (Instrument / Heavy / Quiet). **Instrument picked.** Reasoning and both rejections in `docs/06-decision-log.md`.
- 2026-09-16: all six v1 screens built in Instrument and published — https://claude.ai/artifact/TcWjBX3Ha6ktRDmwYvAk3e
  Page 1 "Screens": live session, exercise progress, today's meal plan, end-of-day check, prep + grocery, weight + maintenance.
  Page 2 "Directions (rejected)": Heavy and Quiet, kept as the record.

## Next
**Phase 3 — Extract.** Write `docs/05-design-system.md` and `docs/10-screen-specifications.md` from the artboards. Real hex codes and pixel values, extracted from the files, not invented.

Working files in `design/`: `Main.dc.html` (screen 1), `Progress.dc.html`, `MealPlan.dc.html`, `EndOfDay.dc.html`, `PrepList.dc.html`, `WeightTrend.dc.html`, plus `Heavy.dc.html` / `Quiet.dc.html` (rejected), `canvas.json`. The seeded `overload.html` is generated and gitignored — reseed it rather than expecting it in a fresh clone.

The token list is already written out in the "THE SYSTEM" sticky note on page 1 of the canvas and is the starting point for `docs/05`.

To change the canvas: edit the `.dc.html` files, re-run `design/seed-canvas.mjs` from the design skill's base directory, republish `design/overload.html` with `contract: "0.1.31"`, favicon 🏋️, and **no** `capabilities`. If a publish is refused as stale, extract the live version first and merge — it happened once this phase.

## Blocked
_(nothing)_

## Carrying
- **Four things left undesigned on purpose** (also in the "STILL OPEN" note on the canvas): (1) the evidence-tag component — screen 3 shows `CARBS ↑ · MODERATE`, and S23's plateau protocols need the same component with strong/moderate/contested plus a route to the source; spec it once. (2) Warm-up sets are collapsed to a summary row on screen 1 to buy vertical space; expanding them is undesigned. (3) Screens 3, 5 and 6 scroll in reality but each artboard is one viewport; scroll behaviour and sticky headers are undesigned. (4) The offline pending count appears only on screen 1.
- Design risk on record: if the real failure mode turns out to be not logging at all because the app reads as a spreadsheet, Quiet was the better bet. Revisit after M1 is in daily use.
- Auth is decided at product level: Better Auth with Google, invite-only. Verify Better Auth allowlist support in Phase 4.
- Health Auto Export: which tier includes REST automations, and its price, are unverified. Resolve in Phase 4.
- Food database (must support search and barcode) and photo/text estimation provider: unresearched. Phase 4.
- Weekday routine times are set in the app, not fixed in the docs.
- Yuta uses no tracking app today. Import from Hevy/MacroFactor is LATER, for invitees.
- `START-HERE.md` remains as research input (sources for the nutrition evidence).

## Skipped
_(nothing)_
