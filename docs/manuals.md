# Reading LEGO instruction PDFs

`scripts/read-manual.py` (PyMuPDF) reads a building-instructions PDF into
`<pdf>.manual.json`. The JSON holds the inventory with LDraw part ids and
colour codes, the steps with the parts each one adds, and a check.

```
python3 scripts/read-manual.py booklets/6566090.pdf --elements /tmp/rb/elements.csv
```

`elements.csv` and `colors.csv` are Rebrickable's public data tables
(`https://cdn.rebrickable.com/media/downloads/elements.csv.gz`, `colors.csv.gz`).
They map a LEGO element ID to a part and a colour.

## How it reads

- **Parts list (last pages):** the count ("4x") and the 6–8 digit element ID are
  real text. Pairs are made by position (the count sits above its ID), and the
  picture is the image just above the count.
- **Steps:** step numbers are large type (≥ 20 pt). A part in a callout is a
  picture with its "Nx" label (8 pt) right below it. A callout belongs to the
  nearest step number. Steps must run in sequence from 1, so a bag-intro page's
  "1x" isn't a step.
- **Which part a callout shows:** its picture against every parts-list picture.
  Both are composited on white with their transparency masks, shrunk to 24 × 24
  and compared by RGB distance, and the aspect ratios must agree.
- **Minifigure parts** that a booklet only shows as a finished figure are marked
  `figure` and counted separately.
- **Into LDraw terms:**
  - Parts: Rebrickable part number, else its renamed id, else the plain mould of a printed part (marked `printed`).
  - Colours: by normalised name, else the nearest RGB of the same transparency.

## Checks (77244 Mercedes F1 booklet, 108 pages)

| check | result |
|---|---|
| Parts list vs Rebrickable's inventory | 262 of 263 pieces agree; the only difference is the minifigure, one item there and head, torso and helmet here |
| Reconciliation: every step's parts summed vs the parts list | 259 of 265 pieces (97.7 %); of the parts the booklet draws, 99.6 %; none over-counted |
| Kinds exactly reconciled | 113 of 119 |
| Steps found | 92 |
| Mapped to LDraw parts / colours | 114 / 119 kinds, 119 / 119 colours |

## What a PDF can't give

Positions. Step pictures are 2D drawings, so placing parts in 3D from them
needs analysis by synthesis: render a candidate model from the page's view
and adjust it until the render matches the drawing. That's a research
problem, not a parse. A Studio `.io` or LDraw `.ldr` file gives positions
directly.

## Booklets without a parts list (alternate builds)

A 3-in-1's second and third booklets have no parts list, so there are no
element IDs to read. They use the set's own parts, though, so the candidates
are known: the set inventory from Rebrickable's `inventories.csv` and
`inventory_parts.csv`. The prototype is in `scripts/manual-alt/` (it works on
`/tmp/pdf30714`, not yet one command):

1. **Extract** each callout picture and its "Nx" count by position, as before.
   The callout box's tint (light blue, no transparency) is removed by distance
   from the corner colour.
2. **Render** every candidate part in its colour from 8 angles (`match.mjs`, in
   the app's own renderer).
3. **Score** each pair: (1 − silhouette IoU) + colour distance / 200 +
   0.3·|log aspect ratio| + 0.6·|log(page size ÷ (k · part size))|. Booklets
   draw callout parts to one scale, so k (points per stud) is estimated as the
   median over confident matches: 12.7 pt per stud here.
4. **Assign** (`assign.py`) as a transportation problem: each callout gets one
   part, the most confident pairs go first, and no part is used more often than
   the set has.

**30714 alternate build (17 pages):**

- All 26 steps found, 43 callouts, 62 of the set's 79 pieces.
- Every callout assigned, none over the set's counts.
- About 41 of 43 correct by eye (`check-sheet.mjs`). Still wrong: an orange
  curved slope (the set has one 15068, taken by another step) and thin grey
  strands. Before the size term, 4–5 were wrong (a 1 × 2 tile and a 2 × 4 plate
  look alike once shrunk to the same size).

