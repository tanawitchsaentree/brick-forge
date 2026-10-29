# The learned engine

How Brick Forge designs: what a part *is* is measured from its geometry, how parts
are *used* is learned from real LEGO designs, and every change to the engine is
judged by a benchmark against those designs.

## 1. What a part answers: measured, not labelled

- **Shape** (`src/scene/shapeScan.ts` → `public/shapes.json`, `npm run shapes`):
  each part's real LDraw geometry scanned into solid cells of ¼ stud × ½ plate.
  "Inside" is the outer hull seen from above and from both sides along x and z, so
  slopes, curves, inverted slopes, arches and round bricks come out as what they
  fill. 2,239 parts.
- **Connectors** (`scripts/build-catalog.mjs`, field `k`): every stud of every
  part, in any direction, so sideways (SNOT) studs count.
- **Purpose** (`isStructure` in `src/engine/sculpt.ts`): structure (bricks,
  plates, tiles, slopes, brackets, wheels…) builds shapes. Detail (flowers,
  minifigure accessories, signs, pins) is never used to fill gaps.

## 1b. Levels: what kind of LEGO a model is (`src/engine/style.ts`)

Every design gets a style vector measured from its parts: pieces, SNOT share
(parts not upright), off-grid share, Technic share, plain bricks and plates,
tiles, slopes, variety (part types per piece), and mean part size. The level
follows by definition:

| level | rule |
|---|---|
| Technic | ≥ 35 % Technic parts (beams, pins, axles, gears) |
| Junior | < 120 pieces, < 8 % SNOT, big parts (≥ 6 stud·stud·plate on average) |
| Creator | < 700 pieces, < 25 % SNOT |
| Advanced | < 1,500 pieces (SNOT and off-grid detail) |
| Expert | 1,500–4,000 pieces |
| Master | ≥ 4,000 pieces |

Each level builds differently:

- **Forms:** each level learns from designs at the levels it draws on (`npm run forms` writes `public/forms/<level>.json`). Junior stays upright.
- **Scale:** Junior snaps the shape to whole units for plain bricks. Expert builds it 1.5× larger and Master 2.5× larger, smoothed, so there's room for detail.
- **Weights:** Junior pays most per piece. Master pays least per piece and most for wrong finish.

## 1c. Every part has a reason (`Why` in `src/engine/grid.ts`)

Each placement keeps every term of its score:

- cells it fills, and air it fills
- finish
- studs engaged with parts already placed
- designer prior
- repetition
- the technique (motif) it belongs to
- the runner-up, and the margin it won by

Instructions show these as a line per part. Parts stacked exactly on an identical
copy of themselves are penalised (REPEAT), so walls bond like a builder's instead
of stacking seam on seam.

## 2. How parts connect (`src/engine/connect.ts`)

A stud is plugged into the part whose body it sits inside. Real parts can't
share solid space, so this holds in any orientation. A part whose interior
reaches into another's box is fitted (pin in a hole, tyre on a rim), and joint
parts (hinges, clips, bars) link when they touch. On the 143 corpus designs this
puts **97.8 %** of parts into one connected model. The rest are mostly separate
objects in the same set.

## 3. How designers use parts: forms (`learnForms`, `public/forms.json`)

Measured on the corpus: only **49 %** of a real car's parts sit upright on the stud
grid (robots 24 %, rockets 12 %). The rest are SNOT, half-stud offsets and wheels.
A grid-only engine is capped at about 0.6 shape match for cars, which is why the
old generator looked blocky.

So the vocabulary is **forms**: a part in one orientation at one offset within a
stud × plate unit, exactly as designers placed it, counted. 2,737 learned forms
plus upright grid turns make 3,519 forms over 264 parts (`npm run forms`, after
the corpus and shapes).

## 4. The objective (`src/engine/sculpt.ts`)

Space is cut into units of 1 stud × 1 stud × 1 plate, each unit a 32-bit mask of
its cells, so testing a form anywhere is a few popcounts.

```
fit    = target cells it fills − AIR · cells it fills that should be empty
finish = Σ studs left showing: +STUD_OK where the target shows studs, −STUD_BAD on smooth surface
gain   = fit + finish − PIECE + HOLD · min(4, studs engaged) − FLOAT · [held by nothing]
         + PRIOR · log(1 + how often designers use this form)
rank   = gain / (target cells covered)^GAMMA          (set-cover greedy)
```

It builds layer by layer, best placement first. Parts never overlap. Target cells
no real part can fill, in compact gaps at least half a unit thick, become
**made-to-measure parts** (`src/engine/madeParts.ts`): exact LDraw geometry,
3D-printable, exported inside the .ldr.

## 5. New designs (`src/engine/morph.ts`, `src/scene/engine.ts`)

A target shape is varied from a real design and the sculptor builds it:

- **longer / shorter:** whole-stud slices repeated or removed at the most uniform
  cross-section (a car's doors, not its cockpit or wheel arches).
- **cross:** two designs of a kind, one fitted into the other's box, with their
  smoothed solids mixed.

In the app: Ideas → Builds → **Engine** (worker: `src/engine/sculptWorker.ts`).

## 6. The benchmark: are we as good as a designer?

Rebuild real designs from their shape alone, leaving the design's whole set out
of what the engine learns from. Eight designs: Corvette 75870, Small Cottage 31009,
Mini Robot 4917, Dinosaur 7219, Police Car 7611, Street Speeder 6743, Ferrari
150° 30190, Shuttle 31066.

```
SCORE = mean( IoU · (½ + ½·finish) · held · min(1, human pieces / ours)^½ )
```

Made parts count as 3 pieces. The human designer scores 1.0 on every term, by
construction.

| step | change | IoU | held | pieces ÷ human | score |
|---|---|---|---|---|---|
| 1 | grid parts only, must stand on studs | 0.49 | 0.93 | 0.49 | — |
| 2 | parts may hang from what's built on them | 0.68 | 0.91 | 1.62 | — |
| 3 | best placement first per layer | 0.70 | 0.89 | 1.64 | — |
| 4 | learned forms (SNOT, offsets, wheels) | 0.76 | 0.92 | 2.64 | — |
| 5 | rank per cell covered; structural parts only; ≥ ¼ unit | 0.80 | 0.74 | 1.37 | — |
| 6 | stronger hold / float terms (tuned) | 0.77 | 0.87 | 1.60 | 0.544* |
| 7 | made-to-measure parts, compact gaps only | 0.78 | 0.87 | 1.60 | — |
| 8 | finish term and finish metric | 0.78 | 0.87 | 1.60 | 0.314 |

\* Before finish was added to the score. Step 8 scores the same builds more
strictly.

Rejected: made parts in any gap (IoU 0.90, but they wrapped models in a skin);
dropping rarely used forms (faster, but held fell to 0.65–0.72).

**Where it stands:** about 0.78 of a designer's shape match, with 1.6× the pieces,
87 % held together, and a poor finish (0.14). It is not yet at human level.

## 6b. Parity: as good as the designer, not identical (from 2026-10-28)

Matching the designer's exact stud positions (the copy score) rewards copying.
There are many equally good ways to build a shape. The benchmark now ranks by
**parity** (`scripts/bench-engine.mjs`):

```
PARITY = mean( IoU · smooth · held ÷ designer's held · min(1, designer pieces / ours)^½ · (1 − repeats) )
```

`smooth` is the share of our visible studs that sit where the designer also
shows studs (within a unit). A smooth surface is never wrong. The designer
scores 1.0. The copy score is still reported alongside.

The corpus grew to 525 designs in 6 measured levels: Junior 33, Creator 147,
Advanced 153, Technic 168, Expert 19, Master 5 (up to the 9,060-piece Colosseum).

| step | change | IoU | smooth | held÷human | pieces×human | copy | parity |
|---|---|---|---|---|---|---|---|
| 9 | 525-design corpus, repetition penalty, bridge repair | 0.77 | 0.36 | 0.81 | 1.51 | 0.30 | 0.19 |
| 10 | tiles as grid forms (they were missing) + plate→tile finish | 0.77 | 0.39 | 0.84 | 1.52 | 0.31 | 0.22 |
| 11 | techniques (two-part motifs: tile on plate, bracket + tile) | 0.77 | 0.44 | 0.84 | 1.47 | 0.34 | 0.25 |
| 12 | cap every stud left on a smooth surface with a tile | 0.76 | 0.72 | 0.85 | 1.73 | 0.33 | 0.36 |
| 13 | (merge pass off: converting exact parts to the grid lost precision) | 0.78 | 0.71 | 0.93 | 1.91 | 0.39 | **0.38** |

Rejected: large-neighbourhood search as built (about 30 regions per 5 s, under 15 %
kept, no gain; it needs a faster refill); weight sweeps beyond these (parity
plateaued around 0.30 before the vocabulary fixes).

Where it stands at step 13: 0.38 of the designer on parity. The biggest
remaining gaps are pieces (about 1.9× the designer's: too many 1×1s and casual
half-stud offsets), held together (0.93), shape (0.78) and finish (0.71).
Technic builds solid volumes from Technic parts, but real Technic is a frame
of beams and pins, so it needs its own method.

## 6c. Articulation and necessity (2026-10-28)

- **Segments** (`src/engine/segment.ts`):
  - PCA per segment: Jacobi eigen-decomposition, checked against the exact eigenvalues of a test matrix.
  - Recursive cuts at waists of the cross-section area profile and at bends of the centre line.
  - A segment gets its own frame only if its box along its PCA axes is under 75 % of the world-aligned box (minimum-volume box), so houses and cars stay on the world grid.
- **Articulated sculpting** (`src/engine/articulate.ts`): each turned segment is resampled into its frame (p_local = Rᵀ·p_world), sculpted straight, and turned back (part_world = R·part_local).
  - The frame is refined by grid crispness: the rotation within ±15° that makes stud × plate units most nearly all-full or all-empty, i.e. minimising the grid's entropy.
  - A ball joint and socket go at the contact centre.
- **Necessity** (`src/engine/necessity.ts`): a part stays if it fills target cells no other part does, is an articulation point of the connection graph (Tarjan), or covers a stud on a smooth surface.

Results on the animal set (parrot, chameleon, anglerfish, squid, pelican, Apatosaurus, Mini Robot, Dinosaur):

| variant | IoU | smooth | held÷human | parity |
|---|---|---|---|---|
| world grid only | 0.725 | 0.60 | 0.71 | **0.253** |
| articulated, PCA frames + joints | 0.722 | 0.59 | 0.71 | 0.246 |
| articulated, crispness-aligned frames + joints | 0.722 | 0.55 | 0.72 | 0.232 |
| articulated, aligned frames, no joint parts | 0.726 | 0.57 | 0.72 | 0.245 |

Articulation is neutral so far. Turned segments are a small share of the volume (1 of 15 on the parrot, 8 of 29 on the squid). The joint parts as placed leave studs showing, and they aren't yet collision-checked against the parts around them. Necessity pruning removed 8 of about 1,800 parts (0.4 %) on the main set: the sculptor already places almost no unnecessary parts.

## 6d. New designs: edit the designer's build, don't rebuild it (2026-10-28)

Re-sculpting a whole stretched model threw away the designer's work, and the
studio results came out messier than the originals. Now a variation is an
edit, the way a designer lengthens a model:

- Parts ahead of the cut stay.
- Parts behind it move back by the stretch.
- The gap is filled with copies of the parts in the section just before the cut (the most uniform slice).
- Parts across the cut stay if they still fit.
- Shortening removes a section and closes up.
- "Wider" does the same across the model.

Only the seams are sculpted. Blended crosses are off: a blend is a shape no
designer made, so few original parts fit and it came out messy and slow.
Speed came from a worker pool (up to 4) and from trying only the 1,500 most
used forms per spot:

| | before | after |
|---|---|---|
| a 375-piece house, worker time | 11–17 s | 1.9–2.4 s |
| studio batch of 6 houses / rockets / cars | 39 s / 8 s / 2 s | 6–7 s / 2.1 s / 0.7 s |
| parts kept from the designer (Small Cottage, 3 studs longer) | ~10 % (only special parts) | 243 of 312 |

On the benchmark, MAX_FORMS 1,500 scored parity 0.382 against 0.365 with all
forms, at 7× less time. 800 forms fell to 0.28, and 3,000 also scored lower
(0.27), probably partly noise in the smooth metric.

## 7. What to do next, by expected gain

1. **Finish.** Measure studs per unit, not per exact cell (the current metric
   punishes a one-cell offset). Add a tile/slope preference on exposed tops,
   learned from how often designers cover exposed surfaces.
2. **Pieces.** Bigger parts inside the body. Bond across seams below (the solid
   box test stacks 2×8 bricks seam on seam).
3. **Held.** A repair pass: for each loose group, try alternative forms that
   engage it, or add a bracket or plate.
4. **Search, not greedy:** beam search or local re-sculpting of the worst regions.
5. **Modules:** MPD sub-models are designer-made modules (wings, wheel sets,
   cockpits). Recombine them across designs and let the sculptor fill the seams.
6. **Speed:** houses take 9–20 s each. Index forms by bottom mask and prune early.
