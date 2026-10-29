# Phase 1: learn the scoring weights from designer decisions (not merged)

Branch `engine-program`. Baseline: core8 PARITY 0.381 (`bench/results/baseline-core8.json`, docs/engine/phase0.md).
**Result: no learned weights raised PARITY; nothing is merged into the app's scoring.** The tooling is in, behind flags, and changes no build (regression tests below).

## What changed

- `src/engine/sculpt.ts`:
  - The score is split into raw terms (`terms`) and a scorer (`score`).
  - `FEATURES`: cover, air, studOk, studBad, pieces, engaged, float, logUse, repeat, belowMinCover, fitNonPos, size, cat_* (7).
  - `WEIGHTS` option: a dot product over the features with γ; the gates optional.
  - `constantWeights()`: the hand-tuned score written as weights.
  - `REPLAY` mode replays a designer model through the sculptor's own state, in two scopes:
    - **anchor**: candidates at the designer's anchor;
    - **layer**: every open anchor of the layer against all the designer's remaining parts in it, the comparison the greedy decoder actually makes.
- `src/engine/category.ts`: piece categories, shared with the bench.
- `scripts/extract-decisions.mjs`:
  - Leave-one-out: 5 folds by set; forms, motifs and priors only from the other folds; every bench set and all Technic left out.
  - Negatives: top K by the current score plus R random.
  - A summary with coverage and gate rates.
- `scripts/learn-weights.mjs`:
  - Multinomial logistic (multi-positive for layer scope), linear in the features.
  - γ by grid search, 0.5–1.2.
  - 80/20 split by set, seeded.
  - Warm start from the constants.
  - Reports the constants' agreement on the same split.
- `scripts/bench-engine.mjs`: `WEIGHTS: "constants"` or a weights file.

## Regression tests (pass)

| test | core8 hashes vs baseline | sculpt ms (baseline 845) |
|---|---|---|
| (a) refactored default path | 8 / 8 identical | 850–883 |
| (b) `WEIGHTS: constantWeights()`, gates on | 8 / 8 identical | 924 |

The first refactor cost 45 % of the time: `terms()` no longer stopped at the gates before the stud loop. Fixed by restoring the early exit, and the hashes were checked again.

## Data

| | anchor scope (r0) | layer scope (r0) |
|---|---|---|
| models replayed (not Technic, not bench) | 343 | 343 |
| designer parts | 138,125 | 138,125 |
| decisions | 38,689 (≤ 200 per model) | 6,079 (≤ 30 per model) |
| designer form in the form table at all | 68.6 % | 67.5 % |
| … among the 1,500 forms tried | 58.4 % | 56.2 % |
| dropped by the old gates: fit ≤ 0 / cover < MIN_COVER | 0.2 % / 0.8 % | — |
| designer part shares voxelised cells with a placed neighbour | 15.3 % (counted, not rejected) | — |
| extraction time | 167 s | 705 s |

**Pruning is not the problem:** the gates drop 1 % of designer parts. **Vocabulary is a ceiling:** about 42 % of designer parts can't be produced by the forms the sculptor tries, 31 % by any learned form.

## Agreement with the designer

Validation: 20 % of sets, held out.

| weights | scope | γ | val top-1 | val top-5 |
|---|---|---|---|---|
| constants | anchor, all decisions | 0.7 | 38.8 % | 54.8 % |
| learned | anchor, all decisions | 1.1 | 50.7 % | 72.9 % |
| constants | anchor, known forms only | 0.7 | 20.5 % | 36.1 % |
| learned | anchor, known forms only | 1.0 | 41.6 % | 67.9 % |
| constants | layer | 0.7 | 18.2 % | 23.7 % |
| learned | layer | 0.9 | **60.3 %** | **75.7 %** |

By category (constants, anchor scope, all decisions): bricks 23.6 %, SNOT 24.2 %, plates 36.0 %, tiles 53.2 %, slopes 58.9 % top-1. Forms outside the table rank first 70.9 % of the time. That figure is inflated: the target is the designer's build, so the designer's part fits it exactly. Such forms can't be chosen at decode time, so the "known only" rows are the relevant ones.

## PARITY under learned weights (core8)

| weights | IoU | smooth | held÷human | pieces×human | repeats | PARITY |
|---|---|---|---|---|---|---|
| **baseline (constants)** | 0.768 | 0.792 | 0.797 | 1.62 | 0.010 | **0.381** |
| anchor, known only | 0.454 | 0.340 | 0.860 | 6.94 | 0.228 | 0.037 |
| anchor, all decisions | 0.563 | 0.366 | 0.839 | 3.91 | 0.095 | 0.075 |
| layer, gates off | 0.439 | 0.394 | 0.888 | 7.31 | 0.223 | 0.044 |
| layer, gates on | 0.619 | 0.515 | 0.751 | 4.34 | 0.207 | 0.082 |

Ablations of "anchor, known only", each row adding one more term held back at its constant:

| variant | pieces×human | repeats | IoU | PARITY |
|---|---|---|---|---|
| all learned | 6.94 | 0.228 | 0.454 | 0.037 |
| A: `repeat` constant | 6.65 | 0.040 | 0.465 | 0.061 |
| B: + `pieces`, γ constant | 4.60 | 0.034 | 0.562 | 0.088 |
| C: + gates on | 2.44 | 0.008 | 0.739 | 0.260 |
| D: + `logUse` constant | 1.63 | 0.013 | 0.768 | 0.346 |
| E: + category / gate / size weights 0 | 1.63 | 0.015 | 0.760 | 0.351 |

Learned weights, the same pattern in every run (layer scope shown): `repeat` +71 (constant −25), `logUse` 11.8 (3), `pieces` −29 (−60), `cat_plate` +18, `cat_snot` +20.

## Diagnosis

Better agreement with designers (layer top-1 18 % → 60 %) gave worse builds (PARITY 0.381 → 0.04–0.08). The cause is in the training signal, not the model's capacity:

1. **Replay never shows consequences.** The state is always the designer's partial build: the layers above are the designer's whatever the choice. Where the designer stacked a plate on a plate, and stacking identical parts is common and correct in real builds, a plate is a right answer. When decoding, choosing a plate at the bottom of a brick-tall region obliges two more plates above it. Hence repeats of 21–23 % and 4–7× the pieces. Imitating step by step can't price a choice by what it forces later.
2. **The prior is learned for the wrong comparison.** Designers' common forms are small plates, so `logUse` and `cat_plate` gain weight. Among candidates scored on a designer's state, that is a fair hint. Across a whole layer of the decoder's own state, it makes small plates win everywhere (ablation D: holding `logUse` at 3 recovers +0.09).
3. **The gates matter at decode time but not in imitation.** They drop 1 % of designer parts, but they keep slivers out of the decoder's build. Turning them into soft features lost 0.17 PARITY (ablation C).

The spec's condition for going to Phase 2 was top-5 < 60 %. It is met with the constants (anchor, known: 36 %; layer: 24 %) and not with learned weights (68 % / 76 %). But neither number predicts PARITY here, so it isn't the right gate.

## What to try next

In order. Each must be measured on PARITY, never on agreement.

1. **Decoder-state replay (DAgger).** Extract decisions from states the decoder builds with the current weights. The right answers are the designer's remaining parts that still fit those states. Retrain and repeat. This is the re-extraction round the spec asked for, but on the decoder's states rather than the designer's. It fixes the distribution (diagnosis 2), not the consequences (1).
2. **Price the consequences:** a lookahead feature in the score, for example "the cells of this target column still unfilled above the part, ÷ the part's height". It is cheap, and what Phase 3's beam needs anyway. It would let a brick-tall region prefer one brick. With it, retrain at layer scope.
3. **Outcome-tuned weights:** choose a few weights (the constants' terms, γ) by decoded PARITY on training models outside every bench set. That optimizes the objective directly, at the cost of decode time. It is a fallback if 1 and 2 don't move PARITY; it learns from the corpus's designs, but not from individual decisions.
4. **Vocabulary:** 42 % of designer parts are outside the forms tried. Raising MAX_FORMS to ∞ cost PARITY in Phase 0. A better order (by use per level, or per region) is a separate lever, and probably the bigger one.

## Runtime

- Extraction: anchor scope 167 s, layer scope 705 s, single thread.
- Training: about 25 s per γ (300 epochs, 38k decisions).
- Bench core8: 4 min per weights file.

## Open problems

- The weights file format allows `gates: false`; learned weights from this phase are not used anywhere.
- `worth()` (the LNS search, off) still uses the constants.
