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

## Phase 2 plan (vocabulary first)

1. **Generated poses.** For every structure part in the table, its sideways turns (studs to ±x, ±z: 4 turns × 4 yaws, distinct ones), upside down, and half-stud offsets, voxelised from its scanned shape like `gridForms` does. Prior: use 0, or the use of the same part's learned forms, spread over its poses (to be decided by measurement).
2. **Side anchors.** The generator anchors forms only from their bottom unit. A sideways form also anchors from a side unit when the target's surface normal there is horizontal. This is also the cause behind Phase 0's unconnected pieces: parts inside the shape that touch neighbours only sideways (20 per model on core8, up to 590 on Expert). The goal is to raise held without touching HOLD or FLOAT.
3. **Ordering.** Forms tried per level, or per region, instead of the global top 1,500.
4. Then the surface terms (normal, curvature, visibility-weighted finish). Fitted only by outcome (the tuner), never by imitation.

## Measurement changes made first

- **PARITY_v2** (`src/engine/parity.ts`, every bench row has `scoreV2`, aggregates have `parityV2`). The frozen PARITY is reported next to it.
  - smooth shrunk toward 1 by α = 3 stud units: one stray stud of one gives 0.75, not 0 (30190-1 went 0.504 → 0 on one stud in Phase 1's tuning);
  - symmetric: the harmonic mean of the old precision and its recall, the designer's stud units where we show a stud too. Tiling over studs the designer meant to show now costs.
  - The designer still scores 1.
- **The gate** (`scripts/bench-gate.mjs`): paired comparison over core8 + levels (19 models, not Technic). Pass needs at least 12 wins out of 19 (by more than 0.001), and no level's mean down by more than 0.02. Metric: PARITY_v2.
- **The tuner** (`scripts/tune-weights.mjs`) optimizes PARITY_v2 by default (`OBJECTIVE`).
- **Over-limit joints** are in no objective until the stability model is calibrated, which is the first task of Phase 3.

## Open

- A baseline rerun with PARITY_v2 is needed before the first gate. The builds must keep their hashes.
- If tuning resumes: random search or CMA-ES over all 9 constants, with a validation set separate from both the tuning set and every bench set. The same goes for the lookahead and surface terms.
