# The M2 prototype

A clickable prototype of every M2 screen (issue `#75`; `docs/06`, 2026-10-16, Q6 and Q7), reviewed
by the owner in one sitting on 2026-10-16 and approved with five tabs, every other question kept as
drawn (`docs/06`, same date). It is the reference for how the M2 screens look, read and behave:
layout, wording, order and sizes. It is built the way the reviewed `#47` to `#51` prototype one folder
up was. It is not product code and nothing imports it.

- `overload-m2-prototype.html`: the whole prototype in one file. Open it in a browser. The phone on
  the left is 390pt wide and clickable. The panel on the right switches the theme and the clock, maps
  each screen to the M2 slice issue that builds it, and lists the nineteen product questions (Q1 to
  Q19) with the answer given to each.
- `src/`: what the file is built from. `proto.css` holds the page around the phone and the M2 parts;
  the rest is the app's own stylesheet (`apps/web/src/styles.css`), inlined at build time. Rebuild with
  `node docs/prototype/m2/src/build.mjs` from the repository root, after `pnpm install`.
- `screens/`: screenshots of the approved screens at 390pt, dark (`.png`) and light (`-light.png`).

All of it runs on generated sample data (owner, 2026-10-16: "The data itself doesn't have to be
real"). A screen built from it uses the design-system tokens the prototype uses (`docs/05`) and still
clears the polish gate.
