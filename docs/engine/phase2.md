# Phase 2: vocabulary first, then surface (in progress)

Branch `engine-program`. Phase 1 closed with no weights merged (docs/engine/phase1.md).
Weights get at most +0.05 on a tuning set and don't carry across sets. The ceilings
below are structural: no weight can fix them.

## Why designer parts can't be placed: the breakdown

`scripts/vocab-breakdown.mjs` → `docs/engine/vocab-breakdown.json`. It covers every part of
every corpus model (343 models, not Technic, not in any bench set), 138,125 parts. The
leave-one-out is the decision extractor's (5 folds by set; a model's forms come only from
the other folds). The sculptor's table and order: learned forms with use ≥ 2, the grid turns
of their parts, motifs (MIN_USE 4), sorted by use, the first 1,500 tried.

Phase 1 quoted "42 % not among the forms tried". That was over sampled decisions (at most
200 per model, so small models weigh more) and only parts that pass `keep()`. Over every
kept part it is 48.5 %; over all parts, 57.1 %, the gap being the policy exclusions.

| cause | % of all parts | % of kept parts |
|---|---|---|
| covered (form among the 1,500 tried) | 42.85 | 51.46 |
| **(a)** form in the table, ranked past 1,500 (median rank 4,374, p90 11,203) | 7.28 | 8.74 |
| **(b)** part in the catalog and kept, this form not in the table | 33.14 | 39.80 |
| **(c)** part not in the catalog, no scanned shape, or no cells | 0.06 | — |
| policy: not structure (minifigs, plants, signs, pins) | 11.83 | — |
| policy: larger than 8 × 8 × 9 | 4.11 | — |
| policy: printed | 0.73 | — |

(b) by pose. "Missing" means never seen in the other folds; "once" means seen once there,
dropped by MIN_USE 2; "part not in table" means no form of that part at all.

| pose | missing | once | part not in table | total, % of kept |
|---|---|---|---|---|
| on the grid | — | 0.06 | 0.32 | 0.38 |
| upright, half a stud off | 1.25 | 0.31 | 0.14 | 1.70 |
| upright, between plate heights | 1.31 | 0.20 | 0.18 | 1.69 |
| upright, turned by a non-quarter angle | 4.64 | 0.15 | 0.09 | 4.88 |
| sideways (studs horizontal, axis-aligned SNOT) | 6.34 | 0.95 | 0.22 | 7.51 |
| upside down | 0.71 | 0.04 | 0.06 | 0.81 |
| **tilted** (no axis onto an axis) | 22.11 | 0.21 | 0.52 | **22.84** |

The tilted parts aren't noise: deviation from the nearest axis has median 0.29 and p10 0.09, and only 0.1 % are under 0.01. They are mostly plain plates and tiles (Plate 1×2: 1,519; Plate 1×1 Round: 938; Plate 1×4: 903…). All are inside a sub-model, and 40.4 % are axis-aligned again in a frame shared with at least half of their sub-model. Those are sub-assemblies built on the grid and placed at an angle: hoods, roofs on hinges, wings. That's a lower bound, since a sub-model can hold nested sub-models with frames of their own.

### What each part of it needs

| share of kept parts | what | whose job |
|---|---|---|
| 7.51 + 0.81 + 1.70 + 1.69 + 0.38 = **12.1 %** | axis-aligned poses the generator doesn't make: sideways SNOT, upside down, half-stud and plate-height offsets, grid turns of parts never learned | **Phase 2: generate them from the catalog's geometry** |
| 8.7 % | forms in the table but ranked past 1,500 | order the forms per level or per region instead of one global list (Phase 2, second) |
| 22.8 % | tilted sub-assemblies | not forms: local frames. Phase 5 (modules) or articulated segments (`articulate.ts`) |
| 4.9 % | upright, turned by a non-quarter angle | the same: a local frame (turntables, angled jumpers) |
| 0.06 % | catalog | nothing to do |
| 16.7 % of all | policy exclusions | unchanged: not structure on purpose |

So Phase 2 can reach at most about 12 % of kept parts by generating poses, and about 9 % more by ordering. The other 28 % need frames, not forms. This is the scope.

## What keep() leaves out, by volume

`scripts/corpus-poses.mjs`, all non-Technic corpus models. The target is the designer's *whole* model, so the volume of parts the sculptor can never use has to be filled with others, small ones.

| level | oversize (> 8 × 8 × 9), parts / volume | not structure, parts / volume | total excluded volume |
|---|---|---|---|
| Junior | 2.1 % / **7.5 %** | 5.2 % / 11.6 % | 19.5 % |
| Creator | 3.8 % / **15.9 %** | 6.6 % / 11.0 % | 27.4 % |
| Advanced | 3.7 % / 15.8 % | 12.1 % / 12.4 % | 29.4 % |
| Expert | 4.8 % / **21.6 %** | 14.4 % / 11.5 % | 33.3 % |
| Master | 2.6 % / 13.1 % | 9.5 % / 15.4 % | 28.5 % |

What it is, by share of all volume:
- Junior: baseplates 8.0 % (24×32, 16×16, 8×16); plain plates longer than 8 studs 5.2 % (4×10, 6×12, 8×16, 6×10, 1×10); Brick 2×10 0.5 %; Wing 4×9 0.5 %.
- Creator: platforms and baseplates 4.9 %; plain plates and bricks longer than 8 about 7 % (16×16, 8×16, 6×10, 1×10, 2×10, 2×12, 6×12, 2×16).

The oversize cut takes out **plain plates and bricks just for being longer than 8**. Letting them in is a `keep()` change, the cheapest item here, and the one most likely to help where we overspend pieces worst. It goes first, measured alone.

Baseplates are a different matter. They're the ground the designer built on, yet the target includes them, so the sculptor has to tile a 24×32 baseplate's volume with plates. Fixing that changes what the benchmark asks, which makes it a metric change. **Recorded for PARITY v3, not done in Phase 2.**

## Phase 2 plan (vocabulary first)

In order of cost, each measured alone through the gate:

0. **keep(): plain plates, bricks and tiles longer than 8 studs.** Raise the size limit for plain parts only; everything else keeps its policy. Expected: fewer pieces, Junior first.
1. **Order forms per level** (a, 8.7 %): each level tries its own most used forms first, instead of the global top 1,500, where big parts sink below rank 1,500 because all levels are counted together. Almost free.
2. **Sideways poses (SNOT), with side anchors**, the largest part of (b1), 7.5 %:
   - generate the sideways turns of structure parts from their scanned shapes;
   - anchor them from a side unit, but only where the target's surface normal (from its SDF) is horizontal, not at every unit;
   - runtime measured every time;
   - pass criterion: unconnected pieces and held improve with HOLD and FLOAT untouched.
3. **Last, if at all:** upside down (0.8 %) and half-stud offsets (1.7 %). Half-stud offsets change the anchor unit for the whole system, which costs more than 1.7 % is worth.
4. Then the surface terms (normal, curvature, visibility-weighted finish). Fitted only by outcome (the tuner), never by imitation.

## Measurement changes made first

- **PARITY_v2** (`src/engine/parity.ts`, every bench row has `scoreV2`, aggregates have `parityV2`). The frozen PARITY is reported next to it.
  - smooth shrunk toward 1 by α = 3 stud units: one stray stud of one gives 0.75, not 0 (30190-1 went 0.504 → 0 on one stud in Phase 1's tuning);
  - symmetric: the harmonic mean of the old precision and its recall, the designer's stud units where we show a stud too. Tiling over studs the designer meant to show now costs.
  - The designer still scores 1.
- **The gate** (`scripts/bench-gate.mjs`): paired comparison over core8 + levels (19 models, not Technic). Pass needs at least 12 wins out of 19 (by more than 0.001), and no level's mean down by more than 0.02. Metric: PARITY_v2.
- **The tuner** (`scripts/tune-weights.mjs`) optimizes PARITY_v2 by default (`OBJECTIVE`).
- **Over-limit joints** are in no objective until the stability model is calibrated, which is the first task of Phase 3.

## Results so far

### Baseline v2 (frozen)

Node changed from 24.15.0 to 24.22.1. Every build has the same hash on both (core8 8 / 8, levels 11 / 11). **PARITY_v2 baseline: core8 0.348, levels 0.183, the 19 gate models 0.2525.** Runs: `v2-base-core8`, `v2-base-levels`. The formula is frozen from here until Phase 2 ends.

### Step 1, keep() long plain parts: no real gain, and nothing blocks them

| run | core8 v1 / v2 | levels v1 / v2 | pieces×human core8 / levels | sculpt ms core8 / levels |
|---|---|---|---|---|
| baseline | 0.381 / 0.348 | 0.228 / 0.183 | 1.62 / 2.48 | 917 / 2891 |
| KEEP_LONG, MAX_FORMS 1500 | 0.397 / 0.335 | 0.239 / 0.193 | 1.60 / 2.48 | 1909 / 5537 |
| baseline, MAX_FORMS ∞ | 0.227 / 0.263 | 0.241 / 0.210 | 1.84 / 2.52 | 13036 / 40682 |
| KEEP_LONG, MAX_FORMS ∞ | 0.233 / 0.277 | 0.242 / 0.215 | 1.86 / 2.50 | 22468 / 64426 |

Against its fair reference (∞ against ∞): +0.014 core8, +0.005 levels (v2). Pieces don't move.

Expected the opposite, so I looked for what keeps long parts out. Nothing does. They reach the table (best rank about 68) and are placed as much as the designer places them, or more:

| model | designer's long parts | ours, KEEP_LONG ∞ |
|---|---|---|
| 31009 (Creator) | 4 | 18 |
| 21318 (Expert) | 57 | 53 |
| 10243 (Expert) | 44 | 87 |

So the expectation was wrong. The excluded volume was mostly baseplates and platforms ("not structure"; the target includes them, see v3), not plates long enough to matter.

### Where the extra pieces actually are: 1×1 parts

Ours minus the designer's, summed over the gate models:

| | extra pieces | of them 1×1 | by category |
|---|---|---|---|
| core8 | 714 | 695 (**97 %**) | tile +477, plate +251, snot +95, brick +60, slope −57 |
| levels | 4,825 | 4,275 (**89 %**) | tile +3,089, plate +1,999, snot +314, slope +171 |

Which pass makes them: core8's 4 biggest models, 851 designer pieces against 1,480 of ours. Post-passes switched off one at a time.

| run | 1×1 tile | 1×1 plate | 1×1 brick |
|---|---|---|---|
| designer | 11 | 73 | 22 |
| ours | 357 | 240 | 91 |
| `capStuds` off | 145 | 240 | 91 |
| `capStuds` + `finishTops` off | 68 | 317 | 91 |

- `capStuds` adds 212 pieces, all 1×1 tiles on studs left showing: 34 % of the 629 extra.
- The greedy itself leaves 317 + 68 one-by-one plates and tiles against the designer's 84: +301, 48 %. Set-cover greedy takes the big parts first and fills what's left with 1×1s.
- `finishTops` only swaps 77 plates for tiles; it adds no pieces.

### `capStuds` off (CAP: false): fails

| | pieces×human | smooth_v2 | stud recall | PARITY_v2 (19) | wins |
|---|---|---|---|---|---|
| baseline | 1.62 / 2.48 | 0.712 / 0.539 | 0.650 / 0.452 | 0.2525 | — |
| CAP false | 1.40 / 1.93 | 0.559 / 0.455 | 0.672 / 0.532 | 0.2233 | 5 / 19 |

Fewer pieces, but smooth falls more: the studs it capped are on surfaces the designer keeps smooth. The caps solve a real problem the wrong way. The cause is the greedy leaving lone studs there, which is search's job (Phase 3), not a post-pass's.

### Last weights round (closed)

Tuner, 23 models stratified up to Expert, objective PARITY v1 (it loaded before v2 existed): 109 evaluations, 2 h 11 min, tuning set 0.266 → 0.343.
- Constants found: AIR 6, GAMMA 0.5, STUD_BAD 30, REPEAT 50, MIN_COVER 24, FLOAT 399; HOLD and PRIOR unchanged.
- Gate on the 19, PARITY_v2: 0.2525 → 0.2804, 11 wins out of 19, worst level Expert −0.009. **Fails by one win.**
- On v1: 12 wins, but Junior −0.025. Fails.
- By local frame: under 10 %, 0.312 → 0.328 (7 / 12 wins); the rest, 0.151 → 0.198 (4 / 7).

Recorded, not merged. Weights work stops here, as decided.

## Open

- A baseline rerun with PARITY_v2 is needed before the first gate. The builds must keep their hashes (Node changed from 24.15.0 to 24.22.1 on 2026-10-29: hashes to be checked on the new version). **PARITY_v2 is frozen from that run until Phase 2 ends;** metric faults found meanwhile are recorded for v3 (the baseplate in the target is the first).
- The gate also reports models with local-frame share < 10 % (12 of the 19) apart from the rest (7), so Phase 2 isn't judged on parts it can't reach (docs/engine/phase5.md).
- If tuning resumes: random search or CMA-ES over all 9 constants, with a validation set separate from both the tuning set and every bench set. The same goes for the lookahead and surface terms.
