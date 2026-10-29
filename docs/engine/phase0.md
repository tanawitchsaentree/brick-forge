# Phase 0: baseline frozen, metrics widened

Branch `engine-program`. Rollback point on main: `181c31a`. Tooling: `43f3b2b`, `8a0dde9`.
Runs: `bench/results/baseline-core8.json`, `baseline-core8-repeat.json`, `baseline-levels.json`,
`appconfig-core8.json`, `baseline-nightly.json`.

## What changed

- `scripts/bench-sets.json`: frozen sets, chosen once with seed 20261029, one model per set, no set shared with core8.
  - core8: the 8 historical models.
  - levels: Junior 3, Creator 3, Advanced 3, Expert 2.
  - technic: 2, reported apart and kept out of `all`.
  - nightly: all 5 Master models.
- `scripts/bench-engine.mjs`:
  - `@set` arguments.
  - `BENCH_RUN=name` writes a JSON run: git hash, dirty flag (tracked files only), opts, ids and their hash, per model, per level.
  - The baseline config is now the default.
  - Each build is hashed (`outHash`) for the regression tests.
  - The console line per model is unchanged.
- `src/engine/benchMetrics.ts`:
  - Piece-category mix (plate, brick, tile, slope, snot, technic, other; 1×1 as an overlapping share), ours minus the designer's, and the L1 sum.
  - Structure: unconnected pieces, joints over the clutch limit (`analyzeStability`), the worst joint, floating parts.
  - `vsmooth`: smoothness on what can be seen.
- `src/engine/visibility.ts`:
  - Exposed voxel faces, z-buffered from 10 orthographic views: the 6 axes, plus 4 three-quarter views at 30° up and azimuths 45° + k·90°.
  - Deterministic, no renderer, the same code in Node and the browser.
  - A stud counts if it is seen from at least one view. It is weighted by the projected area of the face it stands on, and it is right where the designer shows a visible stud within a unit at the same height.
  - Checked on a box: 80 of 80 exposed faces seen, the interior not seen, self-comparison 1.0.
- `docs/engine/notes.md`: register of hard-coded parts (rule 2).

## Which number is the baseline

The documented 0.382 (docs/engine.md, step 13) was not the bench's default config. Measured on core8 at the current code:

| config | IoU | smooth | held÷human | pieces×human | PARITY | wall, 8 models |
|---|---|---|---|---|---|---|
| bench defaults then (MAX_FORMS ∞, no motifs) | 0.754 | 0.455 | 0.868 | 1.86 | 0.220 | 115 s |
| MAX_FORMS 1500 | 0.756 | 0.518 | 0.765 | 1.70 | 0.226 | 62 s |
| MOTIFS 4, MAX_FORMS ∞ | 0.755 | 0.445 | 0.873 | 1.84 | 0.227 | 308 s |
| **MOTIFS 4, MAX_FORMS 1500** | **0.768** | **0.792** | **0.797** | **1.62** | **0.381** | 226 s |
| MOTIFS 6, MAX_FORMS 1500 (the app's `build-forms.mjs`) | identical builds (all 8 hashes equal) | | | | 0.381 | |

**Baseline = `{ MAX_FORMS: 1500, MOTIFS: 4 }`, core8 PARITY 0.381.** It reproduces the documented 0.382 within 0.001, and it is now the bench default.

Determinism: core8 run twice gives the same `outHash` on 8 of 8 models.

MOTIFS 6 and 4 build the same on core8. The motifs used 4–5 times fall below the 1,500 most used forms, so MAX_FORMS cuts them anyway.

## Baseline metrics

| set / level | n | PARITY | IoU | smooth | vsmooth | held÷human | pieces×human | mix L1 | 1×1 Δ | over-limit joints | unconnected | worst joint | sculpt ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| core8 all | 8 | 0.381 | 0.768 | 0.792 | 0.676 | 0.797 | 1.62 | 0.685 | +0.322 | 1.25 | 20.3 | 6.72 | 845 |
| core8 junior | 1 | 0.504 | 0.747 | 1.000 | 1.000 | 0.800 | 1.41 | 0.861 | +0.261 | 0 | 6 | 0.95 | 128 |
| core8 creator | 4 | 0.382 | 0.799 | 0.729 | 0.612 | 0.892 | 1.79 | 0.701 | +0.329 | 2.5 | 15 | 6.72 | 715 |
| core8 advanced | 3 | 0.339 | 0.733 | 0.807 | 0.653 | 0.669 | 1.45 | 0.605 | +0.332 | 0 | 32 | 0.75 | 1257 |
| levels all | 11 | 0.228 | 0.692 | 0.681 | 0.803 | 0.677 | 2.48 | 0.799 | +0.300 | 5.6 | 122.6 | 65.4 | 2734 |
| levels junior | 3 | 0.161 | 0.698 | 0.686 | 0.706 | 0.703 | 4.11 | 1.078 | +0.360 | 2.0 | 23.3 | 1.74 | 724 |
| levels creator | 3 | 0.181 | 0.598 | 0.594 | 0.750 | 0.635 | 2.37 | 0.845 | +0.369 | 2.7 | 21.0 | 2.23 | 362 |
| levels advanced | 3 | 0.331 | 0.749 | 0.707 | 0.903 | 0.748 | 1.45 | 0.667 | +0.197 | 1.0 | 9.3 | 4.48 | 235 |
| levels expert | 2 | 0.242 | 0.738 | 0.767 | 0.879 | 0.593 | 1.73 | 0.512 | +0.261 | 22.5 | 594 | 65.4 | 13054 |
| technic (apart) | 2 | 0.001 | 0.537 | 0.050 | 0.000 | 0.101 | 2.25 | 1.870 | +0.418 | 0.5 | 170.5 | 3.92 | 1372 |
| nightly master | 5 | 0.265 | 0.753 | 0.770 | 0.883 | 0.664 | 2.13 | 0.607 | +0.237 | 96 | 1349 | 589 | 34832 |

Category mix on core8, ours minus the designer's, as a share of pieces:

| plate | brick | tile | slope | snot | technic | other | 1×1 (any) |
|---|---|---|---|---|---|---|---|
| −0.018 | +0.012 | **+0.237** | −0.120 | +0.031 | −0.025 | −0.116 | **+0.321** |

The designer's own builds, for reference (same checks):

| | unconnected | over-limit joints | worst joint | visible studs / cm² |
|---|---|---|---|---|
| core8, designer | 0 | 2.13 | 13.8 | 0.09 |
| core8, ours | 20.3 | 1.25 | 6.7 | 0.05 |
| levels, designer | 0.55 | 7.18 | 33.9 | 0.14 |
| levels, ours | 122.6 | 5.64 | 65.4 | 0.04 |

Nightly per model (ran on `8a0dde9`, loaded clean; the run file says dirty because `src` was edited while it ran, now fixed: git state is taken at load):

| model | designer pieces | ours | PARITY | held÷human | over-limit, ours / designer's | sculpt s | wall s |
|---|---|---|---|---|---|---|---|
| 10179-1 | 5194 | 17386 | 0.245 | 0.775 | 51 / 206 | 43.6 | 85 |
| 10253-1 | 4162 | 4559 | 0.473 | 0.812 | 30 / 55 | 10.6 | 42 |
| 10256-1 | 5962 | 12701 | 0.273 | 0.704 | 73 / 171 | 35.0 | 72 |
| 10261-1 | 4203 | 8024 | 0.157 | 0.332 | 24 / 113 | 46.0 | 82 |
| 10276-1 | 9060 | 19614 | 0.178 | 0.698 | 302 / 324 | 38.9 | 82 |

On Masters the designers' own builds show more joints over the limit than ours (206 against 51 on 10179). The stability model, not the builds, is the problem there (open problem 1).

## The worst models (core8 + levels, not Technic)

1. **6581-1-1 (Creator), PARITY 0.02.** held÷human 0.125: most of our 248 pieces (the designer used 72) aren't in the main component. IoU 0.524. A small model at 3.4× the pieces, so it falls apart into groups the bridge pass doesn't reach.
2. **30035-1 (Junior), PARITY 0.115.** held 0.393 and vsmooth 0.52: twice the pieces, and they don't hold together.
3. **6363-1-1 (Junior), PARITY 0.157.** 5.8× the designer's pieces (538 against 93). Junior designs use big parts; the forms learned from all levels give small ones.
4. (core8) **4917-1-49171 (Advanced), PARITY 0.169.** smooth 0.5 and vsmooth 0.0: every stud we leave visible is where the designer has none.

## Runtime

- Sculpting takes 0.1–2 s on most models and 10–16 s on the Expert models (2,500–2,900 pieces).
- Wall time is about 27 s per model, almost all of it relearning forms and motifs leave-one-set-out per model. That is the cost of rule 3, not of the sculptor.

## Open problems found

1. **The stability check flags real designs.** Designers' own builds have 2.1 (core8) to 7.2 (levels) joints over the limit per model, worst 34×. Phase 3 wants stability as a hard constraint. Used as it is, it would reject builds like the designers'. It needs calibrating on the corpus first: designer builds should come out at about 0 over the limit. That calibration is the first task of Phase 3.
2. **Smoothness rewards over-tiling.** "A smooth surface is never wrong": our tile share is +0.24 over the designer's, and we show about half the designer's visible studs per cm². The mix metric now exposes this, and PARITY alone doesn't.
3. **1×1 parts are +0.32 of pieces over the designer's**, on every level. This is the biggest single gap in the mix.
4. **Unconnected pieces:** 20 per model on core8 and 123 on levels (590 on Expert), against 0–0.6 for the designers. Many of these sit inside the main shape but touch only sideways, with no stud. The `bridge` pass doesn't catch them.
5. **The app is not the benchmark.** The app runs `TIER_WEIGHTS` per level (for example Expert `PIECE 30, STUD_BAD 8`); the bench runs the defaults. Fine for measuring the engine, but app quality isn't measured directly.
6. **`worth()` (only used by `REFINE_MS` search) has its own copy of the constants.** Phase 1 has to route it through the same weights, or leave the search off (it is off).
