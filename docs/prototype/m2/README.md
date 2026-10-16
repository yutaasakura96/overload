# The M2 prototype

A clickable prototype of every M2 screen, to be reviewed by the owner in one sitting before any M2
screen is built (issue `#75`; `docs/06`, 2026-10-16, Q6 and Q7). It is built the way the reviewed
`#47` to `#51` prototype one folder up was. It is not product code and nothing imports it.

- `overload-m2-prototype.html`: the whole prototype in one file. Open it in a browser. The phone on
  the left is 390pt wide and clickable. The panel on the right switches the theme, the tab bar (five
  tabs or four) and the clock, maps each screen to the M2 slice issue that builds it, and lists the
  product questions the prototype raises.
- `src/`: what the file is built from. `proto.css` holds the page around the phone and the M2 parts;
  the rest is the app's own stylesheet (`apps/web/src/styles.css`), inlined at build time. Rebuild with
  `node docs/prototype/m2/src/build.mjs` from the repository root, after `pnpm install`.

All of it runs on generated sample data (owner, 2026-10-16: "The data itself doesn't have to be
real"). A screen built from it uses the design-system tokens the prototype uses (`docs/05`) and still
clears the polish gate.
