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

## Step 4: why roofs look worst (counted)

`scripts/roof-parts.mjs`: parts with open sky over them in the upper 40 % of a house.

| | designers (35 houses, 1,455 roof parts) | ours (31009, 112 roof parts) |
|---|---|---|
| slope / curve / wedge | **68.4 %** | 21.4 % |
| tile | 7.2 % | **48.2 %** |
| plate, studs up | 12.9 % | 20.5 % |
| most used | Slope 45 2×4 (246), 2×2 (205), 2×8 (118), 2×1 (86), Slope 33 3×4 (72); Slope 45 2×2 double convex (44, ridges) | Tile 1×1 corner round (23), Tile 1×1 (15), Tile 1×1 round (10) |
| placed by | — | greedy 63, **capStuds 39**, finishTops 8, bridge 2 |

It isn't the vocabulary: all 38 of 31009's roof slopes are among the 1,500 forms tried. Nor the score at the designer's spot: replayed there, the sculptor picks the designer's slope or a bigger part (17 of 38 outranked, all by parts covering 416–456 cells with no air against the slope's 208–304).

What happens: the greedy lays slopes but not the next row over each one's studded top strip, which is how designers stack a roof (rows stepping up, each covering the one below, double slopes on the ridge). The studs left showing are then capped by capStuds one at a time with 1×1 corner tiles, which is the scattered look.

A roof has a grammar: rows of slopes stepping up, a ridge, gable ends. A part-at-a-time fill doesn't know it. This is where the DNA idea applies most directly. Next: a roof generator from rules mined from these 35 houses, under the sculptor's walls, measured on held-out houses (roof slope share, pieces, PARITY_v2, pictures).

## Step 5: a roof from its grammar (`src/engine/roof.ts`, bench `ROOF`, houses only)

Method:
- **Eaves:** the widest layer across in the upper half. A roof is often a hollow shell, so area misleads; its width narrows steadily, and the eaves overhang the walls.
- **Ridge:** along the axis that shrinks least, from the eaves to halfway up (the very top is often a chimney).
- **Bands of 3 plates:** a side stepping in 1 stud gets 45° slopes, which are 2 deep, and the next band stands on their studded strip; a side stepping in 2 gets 33° slopes, 3 deep. Under the next band go plain bricks. A band 2 wide is the ridge, in double slopes.
- **Pose:** the slopes' low side faces out, read from each part's scanned cells.

Three bugs on the way, found by printing the cottage's layers:
1. "85 % of the widest layer" took the baseplate and garden as the widest.
2. Going down from the top, "where the footprint stops growing" found the chimney.
3. The ridge axis taken from the top layer was the chimney's.

31009 (cottage), sculpted with the bench's settings:

| | pieces | IoU | PARITY_v2 | roof slopes / tiles |
|---|---|---|---|---|
| baseline | 546 | 0.890 | 0.484 | 11.4 % / 38.6 % |
| features first | 520 | 0.911 | 0.546 | 19.1 % / 33.8 % |
| roof grammar | 510 | 0.895 | 0.506 | 25.7 % / 33.0 % |
| features + roof | **474** | 0.910 | **0.576** | 28.0 % / 32.3 % |
| designers (35 houses) | 260 | — | 1 | 68.4 % / 7.2 % |

Picture (`/tmp/prev/roof-compare.png`): the roof's long faces are rows of navy slopes, no longer scattered caps. Still wrong:
- the gable ends are stepped bricks (only the slopes across the ridge are laid);
- red parts on the roof: colour votes in units the roof shares with the walls;
- the designer's cross-gable dormer isn't in the grammar.

Next:
1. Hip and gable ends.
2. One roof colour, the roof's majority.
3. All corpus houses, leave-one-out: only one house has been tried, which proves nothing general.

## Step 6: the roof grammar on all 35 corpus houses

Leave-one-out, the bench's settings, baseline vs `ROOF` (one roof colour, hip ends; no oracle features):

| | mean PARITY_v2 | pieces (mean) |
|---|---|---|
| baseline | 0.316 | 1082 |
| roof grammar | **0.331** | 1055 |

- Results: 24 wins, 10 losses, 1 tie. The grammar placed 31 roof parts per house on average (0 to 119).
- Best: 31038-1 0.442 → 0.511, 31048-1 0.505 → 0.574, 31063-1 0.364 → 0.423.
- Worst: 6365-1 0.137 → 0.107, 4954-housewithtruck-1 0.142 → 0.113, 4954-school 0.133 → 0.117.

Picture (`/tmp/prev/houses-roof.png`):
- 31048: the roof reads as two clean red faces.
- 31038: still ragged at the gable.
- 6365: the house has two roofs at different heights (garage and house), but the grammar reads one eave and one ridge, so the lower roof's bands are cut wrong.

Next:
1. Find roofs per connected part above the eaves (several roofs per house).
2. Gable ends.
3. Window and door slots proposed by the DNA, to replace the oracle.
