# The DNA experiment: attachment rules around feature parts

The question (the user's): build a subject from its DNA. A bus has windows, so start with the windows. Find what they attach to and sit on, grow the side from them, then the roof, the back, the front; no part the DNA doesn't call for. Is that better than filling a shape? Textbook names: example-based model synthesis (Merrell 2007; WaveFunctionCollapse, Gumin 2016) for the local rules, shape grammars for the DNA that keeps the whole coherent.

## Step 1: part roles (`src/engine/roles.ts`)

A closed vocabulary from LDraw names and categories (program v2 T1, source S1):
- features: window, windscreen, door, wheel, tyre, light, grille, eye, tooth, claw, horn, antenna, plant, figure;
- connectors: hinge, clip, bar, pin, axle, ball, socket, bracket-snot, jumper, turntable;
- surface: tile, slope, curved, wedge, arch, inverted;
- structure: brick, plate, round.

A part can have several roles.

## Step 2: rules mined (`scripts/mine-rules.mjs` → `data/rules/adjacency.json`)

Every connection (engine/connect.ts) of every window, windscreen, door, wheel, light and grille in 377 non-Technic corpus models. Each rule records: the neighbour part, its position in the feature part's frame (half studs, half plates), its turn, and the side it's on. Counted per set, so a test leaves its own set out.

**26,525 links, 12,388 distinct rules, 264 feature parts, 4 s.**

Feature parts come in fixed units, not alone:

| feature part | uses (sets) | what comes with it |
|---|---|---|
| Window 1×2×2 without Sill | 277 (22) | its glass behind it in **95 %** of uses. Stacked on another window 17–20 %. Under it: Plate 1×4 9 %, other windows 30 %. Over it: Plate 1×4 7 %, Tile 1×4 6 % |
| Wheel rim 6.4×8 | 177 (31) | a tyre on it in **97 %** (Tyre 6/50×8 51 %). Held by Plate 2×2 with 2 wheel pins about 60 %, a car base 10 % |
| Wheel rim 12×11 | 128 (26) | a tyre 100 %, on a wheel-pin plate about 99 % |
| Windscreen 2×4×2 | 37 (25) | under it: car doors left and right 28 %, a steering stand 11 %. Over it: car roof hinge 4×4 42 %, roof holder 10 % |
| Door 1×4×6 frame | 155 (26) | a door in front 33 % (the door's side: frame 64 %); glass 13 %. Under it: hinge plates 1×4 16 % |
| Brick 1×1 with headlight | 1,836 (123) | a SNOT part: a tile 1×2 on its side stud 20 %, round plate 10 % |
| Tile 1×2 grille | 1,487 (140) | on plates 1×6 / 1×2 / 2×4, on a headlight brick 5 % |

**What it says about the engine.** The sculptor places one part at a time, and its motifs pair two. It doesn't know that a window takes its glass, that a windscreen comes with doors and a roof hinge, or that a rim takes a tyre on a wheel-pin plate. These units are the smallest modules (T3) and the first place the DNA idea can be tested.

## Next

1. Units: feature part plus partners that come with it in at least 50 % of uses, as one placeable unit.
2. A wall generator from DNA: window units at the DNA's slots, their learned supports under and over them, the rest of the wall in bonded bricks.
3. Measured against held-out house walls and vehicle sides, against the sculptor: feature recall (the windows there, with glass), pieces, PARITY_v2 of the region, and pictures.

## Step 3: features first (oracle DNA), measured

The designer's feature parts (windows with their glass, windscreens, doors, wheel rims) held where the designer put them, and the sculptor fills the rest. That's the DNA at its best: positions known exactly. `units` adds the partners the mined rules call for (rule share ≥ 50 %, this set left out).

| | 19 models | the 14 with feature parts | gate |
|---|---|---|---|
| baseline | 0.2525 | 0.263 | — |
| features first (oracle) | 0.2665 | **0.282**: 10 wins, 4 losses (the other 5 have no features: ties) | fail, 10 of 19 |
| + rule partners | 0.2647 | 0.280; +1.1 parts per model | fail |

- By level (oracle): creator +0.025, expert +0.019, advanced +0.009, junior −0.001.
- Local frame ≥ 10 %: 0.151 → 0.219. Under 10 %: 0.312 → 0.294.
- The rule partners add almost nothing: glass counts as a window role, so the oracle already has it. That leaves tyres and hinges.

Pictures (`/tmp/prev/feat-compare.png`): with features first, the cottage has its white window frames and yellow door where the designer put them, and 10243's facade windows read clearly. The roofs are still the sculptor's, and still messy.

**Verdict so far.** Features first helps, and visibly so (identity reads), but modestly even with perfect positions: +0.019 on the models that have features. The parts the sculptor fills (roofs especially) are where builds look worst. The DNA idea's main claim, growing the rest from rules instead of filling it, isn't tested yet.

Next:
1. Roofs from rules, on the corpus's 34 houses.
2. A DNA that proposes window and door slots itself (spacing, height over the floor, what they sit on), so the oracle can go.
