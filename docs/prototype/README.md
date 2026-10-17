# The reviewed prototype

A clickable prototype of issues `#47` to `#51` (and `#41`), reviewed and approved with no changes on
2026-10-10 (`docs/06`, same date). It is the reference for how those screens look, read and behave:
layout, wording, order and sizes. It is not product code and nothing imports it.

- `overload-prototype.html`: the whole prototype in one file. Open it in a browser. The phone on the
  left is 390pt wide and clickable; the panel on the right maps the twelve screens to their issues
  and lists the sixteen product questions (Q1 to Q16), each with the answer already applied.
- `src/`: what the file was built from. `proto.css` holds the page around the phone and the new parts; the rest
  is the app's own stylesheet as it was that day.
- `screens/`: screenshots of the screens as reviewed.
- `m2/`: the prototype of every M2 screen, approved on 2026-10-16. It has its own README.

All of it runs on generated sample data. A screen built from it uses the design-system tokens the
prototype uses (`docs/05`) and still clears the polish gate.
