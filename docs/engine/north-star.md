# Brick Forge program v2 (2026-10-29)

This document replaces the earlier phase roadmap (Phases 2–5 of the first program). Everything measured so far stays valid. What changes is the architecture the work serves. Where it contradicts an earlier instruction, this document wins.

Amended on 2026-10-29, after the first reading:
- F4 and S1 are "measured, no help".
- F5 and F7 are hypotheses.
- S3 now comes before S4, and its gate includes Master runtime.
- The owl golden set comes from the Rebrickable inventory plus a hand-placed LDraw file; a corpus Junior animal stands in until then.

## What we learned (premises: build on them, don't re-derive)

- **F1. The baseline is frozen.** `{MAX_FORMS 1500, MOTIFS 4}`: core8 PARITY 0.381, levels 0.228, Technic 0.001 (reported apart). Determinism holds: 8/8 hashes, and 19/19 across Node 24.15 → 24.22. PARITY_v2 (smooth floored on small models, symmetric stud penalty) is frozen for the duration: core8 0.348, levels 0.183, the 19 gate models 0.2525.
- **F2. Imitation learning on designer states can't price consequences.** Agreement rose from 18 % to 60 % while PARITY fell to 0.04. Learned weights from imitation are dead for this decoder. Any future term is fitted by outcome: decoded PARITY_v2 on a stratified tuning set, with a separate validation set.
- **F3. The vocabulary is a ceiling.** Of 115,012 kept designer parts:
  - 51.5 % are among the 1,500 forms tried;
  - 8.7 % exist as forms but rank below 1,500 (median rank 4,374);
  - 12.1 % are axis-aligned poses the generator never emits: sideways SNOT 7.5, upside down 0.8, half-stud offset 1.7, plate-height offset 1.7, other 0.4;
  - 22.8 % are tilted;
  - 4.9 % are upright but turned off the quarter;
  - 0.06 % aren't in the catalog.

  At least 40.4 % of the tilted parts are axis-aligned inside a frame shared with half their sub-model: designers build on the grid and turn whole assemblies through joints.
- **F4. Measured, no help.** `keep()` cut plain plates, bricks and tiles longer than 8 studs. Letting them in (KEEP_LONG) changed PARITY_v2 by +0.014 (core8) and +0.005 (levels), against the reference with MAX_FORMS unbounded on both sides. Pieces didn't move. Long parts are already placed as often as the designer places them (21318: designer 57, ours 53; 10243: 44 and 87). The volume `keep()` excludes (Junior 19.5 %, Creator 27.4 %, Expert 33.3 %) is mostly baseplates and platforms, which are "not structure" and belong to metric v3. The prediction that long parts drove the piece overrun went beyond the data.
- **F5. Hypothesis until counted.** 1×1 parts on the bench: 6,765 against the designer's 1,868, 90 % of the extra pieces. By source: greedy 59.8 % (4,043), capStuds 31.6 % (2,139), finishTops 8.6 % (583, swaps only). 78 % of greedy's 1×1s are off the grid (3,160 of 4,043). *Hypothesis:* they chase target cells left by designer parts the sculptor has no pose for. Being counted in `scripts/one-owner.mjs` (docs/engine/one-owner.md). capStuds uses 207 corner tiles where designers use 12, because it picks from the catalog without the use prior (measured).
- **F6. Stability flags designers' own builds.** 2.1 to 7.2 joints over the limit per model; 206 on 10179. The stability model must be calibrated on designer builds before it is a constraint anywhere.
- **F7. Unconnected parts, measured; the cause is a hypothesis.** 20 per model on core8, 123 on levels, 590 on Expert, against 0 to 0.6 for designers. *Hypothesis:* many sit inside the shape and touch neighbours only sideways, a candidate-generation problem (bottom anchor only), not a bridge-pass problem. Not counted yet.
- **F8. The app's dinosaurs and F1 come from path A**, hand recipes in `assembly/*.ts`. Nothing in the sculptor work touches them until they go through the new architecture.
- **F9. Master runtime is engine work.** In the app, a Master design from the learned engine takes 90 to 130 s (worker; the page no longer freezes since `266f3cc`). The sculptor's cost, not the UI's.

## North star

The engine today asks "which form fills this voxel". The engine we are building asks, in order:
1. What is this thing made of?
2. How do designers build each of its parts at this level?
3. Which parts carry its identity?
4. How do the parts attach and pose?

Voxel filling becomes the last resort inside one node, never the plan.

**Goal.** Given a subject (any theme), a level (Junior to Master) and a piece budget, produce a buildable model with step-by-step instructions. Its piece mix, structure, joints and identifying parts should be indistinguishable in kind from a LEGO designer's work at that level, measured (see metrics). Visual parity with the best real sets is the direction, not the gate.

**Why not end to end.** Image and video generators learn from billions of examples; we have 545 sets. So the architecture is knowledge with structure, filled from data. Learning is used only where the corpus is dense enough to fit a few parameters. This is a design decision, not a temporary limitation.

**Evidence case: 30714, owl** (Creator 3-in-1 polybag, about 55 parts, age 6+). See `docs/engine/dna-owl.md`. It shows five things the engine lacks:
1. **The core is 8 parts, and hollow:** two inverted curved slopes as a keel, a 2×2 brick, a plate deck.
2. **Sockets go in before what plugs into them:** steps 5, 8, 9, 10 install Technic holes, clips and pins; wings, feet, tail and head come later. The body is an interface.
3. **Every appendage is a 1-DOF joint:** wings on pins, feet on clips, tail on a clip, ears as rounded plates gripped edge-on by clips. Nothing is built at an angle.
4. **Five feature parts carry most of the identity** (2 printed eye tiles, a beak, 2 claws), and they go in last.
5. **Convex surfaces are single curved slopes** in the right orientation; visible tops are tiled.

Piece roles in the owl: about 17 connectors, 5 feature parts, about 15 surface parts, under 10 pure-volume parts. The engine's F1 is the inverse.

## Non-negotiables

- **R1.** Every change ships behind a flag and is measured against the frozen baseline with the paired gate. No metric is edited during a phase; metric fixes are queued for the next version.
- **R2.** No part IDs in archetype data or in `assembly/*.ts`. Archetypes name roles, surfaces, interfaces and proportions; parts are resolved through the part-semantics table at build time. The only exceptions are hard physical constraints (wheels, axles, a minifig seat), declared in the archetype with the reason.
- **R3.** Leave-one-out stays strict for every table learned from the corpus: forms, priors, modules, level profiles, the context labels in part semantics.
- **R4.** Determinism: same inputs and seed, same output. At most 4 workers for sculpting, plus 1 quick worker for rig builds and target scaling.
- **R5.** Every claim of the form "mostly X" or "the main cause is X" carries the count it rests on, the first time it is written.
- **R6.** No learned weights for the sculptor from imitation. Outcome fitting only, with a validation set disjoint from the tuning set and from every bench set.
- **R7.** The hand rules that remain (finishTops, bridge, capStuds, the rig plan code) are listed in `docs/engine/notes.md` with why they still exist and what would retire them.

## Data model: four tables (they are the product)

### T1 part semantics (`data/parts/semantics.json`)

Every part the engine may use knows what it is for, how it connects, and how it looks.

Record:
- `part_id`
- `roles[]`: from the closed vocabulary below
- `connectors`: counts and orientations of stud, anti-stud, pin hole, pin, bar, clip, ball, socket, axle hole, hinge finger, plate edge (able to grip)
- `geometry`: curvature class, exposed face normals per orientation, stud faces, size, volume
- `size_class`: tiny (1×1) / small / medium / large / long (> 8 studs)
- `level_availability`: counts per level
- `print`
- `sources`: per role, with confidence

Role vocabulary:
- **structure:** core, frame, filler
- **surface:** skin-flat, skin-curved, skin-corner, cap-tile
- **connector:** joint-pin, joint-clip, joint-ball, joint-hinge, bracket-snot, socket-only
- **feature:** eye, beak, tooth, claw, horn, ear, tail-tip, wheel, tyre, window, door, light, grille, exhaust, propeller, wing-tip, fin, antenna, hand, foot

Extend the vocabulary only with evidence from corpus context, and record each addition.

Sources:
- **S1** LDraw names, a regex table.
- **S2** Geometry, from `shapes.json` and the catalog, never from names.
- **S3** Corpus context: named sub-models, relative position in the parent's PCA frame, level.

Acceptance:
- Role coverage by category.
- Feature recall of at least 80 % on 20 hand-labelled held-out animal models (`data/parts/feature-truth.json`, frozen).

### T2 archetypes (`data/archetypes/*.json`)

The DNA of a subject class.

- **`nodes[]`:** id, kind (core | appendage | feature-slot), parent, count (1 / 2 mirrored / n), plus:
  - parametric proportions;
  - importance, 0..1;
  - surface intent per face class;
  - joint (fixed | pin | clip | ball | hinge | clip-edge-grip, with dof and default pose);
  - feature slots (role, count, placement, order: last).
- **`interfaces[]`:** socket role on the parent, plug role on the child, count, region. Sockets are installed with the parent core.
- **`presets`, `level_overrides`, `hard_constraints`.** Hard constraints are the only place a part family may be named, with the reason.

Acceptance:
- No part ID outside `hard_constraints`.
- The dino and F1 rigs can be expressed as biped-dino and car-open-wheel with no loss of their numeric plan.
- The owl can be expressed as bird-upright at Junior, with the interface list of `dna-owl.md`.

### T3 module library (`data/modules/`)

How designers build each node at each level, as sub-assemblies with their attachment interface. From the 9,358 OMR sub-models plus step-grouped clusters from the 44,466 STEP records.

Record: module_id, source set, level, node label (with confidence and how it was assigned), archetype hint, pieces and mix, plug (and the socket the parent needs), shape (voxels and SDF in its own frame, axes, symmetry), techniques, features, quality, frequency.

Labelling, all four votes kept:
- **L1** OMR file and step-group names;
- **L2** position in the parent's PCA frame;
- **L3** geometric statistics;
- **L4** feature parts present.

Quality filter, measured first:
- one connected component;
- attached in one step;
- at most 4 attachment points.

Report the share of real sub-assemblies, and modules per node label per level.

### T4 level profiles (`data/levels.json`)

Per level: pieces per step (median, p90), sub-assembly depth, minimum part size, connector types, techniques, piece budget per archetype, colour scheme, 1×1 share (a cap), tile and curved share (targets). From STEP records and part statistics, leave-one-out.

## Assembler

### Pipeline
1. Parse the request (subject, level, budget, style words) into an archetype and preset. With no match, the mesh fallback.
2. Instantiate the archetype: proportions, level overrides, hard constraints.
3. Allocate the budget across nodes: maximise Σ importance × quality(budget_i), with each node's budget inside the module library's observed range and the T4 caps. Greedy marginal gain first; an exact solver only if the greedy one is measurably worse on the golden tests.
4. Build the core first, and install every socket the interfaces need before any appendage.
5. For each node, in importance order: a module from T3 that fits label, level, plug and budget. If none fits, sculpt the node in its own frame, with a shell target, its feature slots pre-placed as fixed parts from T1, and its plug sockets pre-placed.
6. Attach through the interface, apply the joint's default pose, mirror paired nodes.
7. Place the feature parts last.
8. Run connect, calibrated stability, then instructions in pipeline order: core, sockets, appendages as callouts, features last.
9. Score, and emit the Why per module and per feature part.

### Mesh fallback

Design only, implemented after D5. Text-to-3D or an upload is voxelised, decomposed (medial axis or approximate convex decomposition), and labelled by the nearest archetype node. It then enters at step 3 with a synthetic archetype.

### The sculptor's role: node-level filler

Track S, in this order, each measured alone with the paired gate:

- **S1.** keep() long plain parts. **Measured, no help (F4); removed from the order.**
- **S2.** Form order per level (F3, 8.7 %). Alone, then with what lands before it.
- **S3. Shell target, moved ahead of S4.** Cells deeper than one plate from the surface get fit weight 0. The sculptor fills interiors with the largest bricks, or leaves them hollow, and spends vocabulary on the skin.
  - Why first: with long parts ruled out (F4), the piece overrun has two suspects left, the 1×1s and filling solid where designers build a shell. S3 is the only item in Track S that also cuts Master sculpt time (F9), because interior cells stop being tried form by form.
  - **Pass needs both:** the paired gate on PARITY_v2, and nightly Master runtime (5 models) lower than the baseline's 34.8 s mean sculpt time per model, reported with it.
- **S4.** Sliver rule: a candidate must fill at least about 75 % of its own volume with target cells, or it isn't placed (sweep the threshold). Ordered only after F5 is counted.
- **S5.** Global frame: PCA on the ground plane. If the whole target is turned by one yaw, rotate it into the grid and back (30035-1).
- **S6.** Sideways SNOT with side anchors, only where the target normal is horizontal (F3 7.5 %; F7). Runtime measured every run. Ordered only after F7 is counted.
- **S7.** capStuds through the use prior (207 against 12 corner tiles). One line.
- **Last, and only with headroom:** upside down and half-stud offsets (under 3 %).
- **Surface terms** (normal and curvature agreement, visibility-weighted finish) are fitted by outcome (R6), after S6.

## Metrics

**Frozen:**
- PARITY v1 (history) and PARITY_v2 (the gate), with their terms;
- IoU, smooth, vsmooth, held, pieces × human, repeats;
- category mix L1 and 1×1 Δ;
- unconnected, over-limit joints (reported, not optimised until calibrated), worst joint;
- sculpt and wall time.

**New:**
- `feature_recall`
- `joint_parity`
- `interface_validity`
- `module_reuse`
- `level_conformance` (against T4)
- `identity_score` (golden tests only: a hand-labelled checklist per subject)

## Gates

- **Paired gate:** core8 + levels (19 models). A change needs at least 12 wins out of 19 on PARITY_v2, and no level's mean may fall by more than 0.02. Technic is reported apart and never gates.
- **Golden tests:**
  - **G1, owl 30714 at Junior, from bird-upright:**
    - at most 1.3× the set's pieces;
    - all 5 feature roles placed;
    - pin, clip, clip-edge-grip and studs joints present;
    - visible-stud density within 2× of the set;
    - at most 35 steps, at most 4 parts per step.

    Reference: the Rebrickable inventory of all three builds plus an LDraw file placed by hand from the PDF. Until that file exists, a Junior animal already in the corpus stands in (chosen and recorded in A0).
  - **G2, T-rex 31058 at Creator, from biped-dino:**
    - at most 1.5× the pieces;
    - eye, tooth and claw roles placed;
    - legs, head and tail posed through joints;
    - no part ID in the archetype.
  - **G3, F1 77244 at Advanced, from car-open-wheel:**
    - category mix L1 under 0.4 against the Rebrickable inventory;
    - 0 over-limit joints after calibration;
    - wings and sidepods as modules or sculpted shells;
    - no part ID outside wheels and axles.

  Golden sets are removed from every learned table when their test runs.
- **Program gate:** D5 is accepted when G1 and G2 pass, and the app's dinosaurs and F1 render from archetypes with path A deleted.

## Work plan

Two tracks, one person-equivalent each; don't interleave within a day.

- **A0 (D, first).**
  - Write this file and `dna-owl.md`.
  - Golden sets: 30714 from the Rebrickable inventory (three builds), then a hand-placed LDraw from the PDF; 31058 likewise if it isn't in OMR. Pick the corpus stand-in.
  - Answer Q1–Q4, and the owl's head attachment (studs only, or a pin from step 17), from the inventory.
- **D1. Part semantics:** the S1 regex first, then geometry, then corpus context. Deliver semantics.json, feature-truth.json, coverage and recall, and the 30 most used parts with no role.
- **D2. Archetypes:** bird-upright, biped-dino, car-open-wheel, then quadruped and house-small. The numeric plans move out of dino.ts and f1.ts; the rig code becomes a reader.
- **D3. Module library**, after D1: the quality filter first, then labels; the modules-per-node-per-level table.
- **D4. Level profiles**, after A0: levels.json, and the level_conformance baseline of our current builds.
- **D5. Assembler v1**, after D2–D4, on bird-upright and biped-dino. Run G1 and G2, then route F1 (G3) and delete path A.
- **S. Track S** in the order above. Stability calibration on designer builds (F6) before any search work; target: designer builds at about 0 over-limit joints.
- **P3. Search**, after S and calibration:
  - beam search per layer (B = 1, 4, 8, 16; B = 1 must equal greedy);
  - incremental stability as a constraint;
  - a repair loop on hotspots;
  - then try retiring finishTops, bridge and capStuds one at a time.

## Reporting

One file per task in `docs/engine/<task>.md`, numbers first:
- what changed;
- the metric table against the baseline, per level;
- the three worst models and why;
- runtime and open problems;
- for D tasks, the acceptance tables.

Counts beside every "mostly" (R5). When a task can't move its metric, the diagnosis comes before the next idea.

## Open questions (answered in the A0 report)

- **Q1.** How many of the 9,358 sub-models have an informative name?
- **Q2.** Which connector geometries does the catalog already encode (clips, bars, pins, balls, plate-edge grip), and what does T1 still need?
- **Q3.** For the tilted parts, the distribution of joint parts within 2 studs of the sub-model's attachment point.
- **Q4.** How many Junior and Creator sets are animals or vehicles with named appendage sub-models?

## Tone

Report like an engineer who will be audited: numbers, counts, hashes, and the sentence that says what didn't work. When you disagree with the plan, say so, with the measurement that would settle it.
