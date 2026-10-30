# Best-of-K selection (from Blox-Net)

Idea (docs/research/papers-2026-10.md §1): build each target in K different ways and keep the best build. The selector may use only what is known at build time: the target and our own build. It never looks at the designer's model.

```
score = IoU(ours, target) · held · (1 − repeats) · (fewest pieces among the K / our pieces)^1
pieces = parts + 2 × made-to-measure parts
```

Pool (`src/engine/select/bestOfK.ts` VARIANTS): default S8 (`NO_FLOAT:"onSmooth"`), `{}` (the pre-S8 base), `MIN_FILL:0.85`, `SHELL`.

## Results (PARITY_v2; `scripts/c5-bestofk.mjs`, offline over bench runs)

| set | base (S8) | best-of-4, our selector | oracle (picks by true PARITY_v2) | W/L vs base |
|---|---|---|---|---|
| gate 19 (core8+levels) | 0.2807 | 0.3293 | 0.3301 | 9 / 0 |
| held-out 23 (grid-s8-val list, disjoint from the gate and from tuning) | 0.2446 | **0.2731** | 0.2760 | 8 / 0 |

- On the gate set, ECON ½ and 1 tie (0.3293). On held-out, ½ gives 0.2580 (5/2) and 1 gives 0.2731 (8/0). I took 1, so the held-out set was looked at once to choose ECON. Every ECON value still gains over base on held-out.
- All 18 configs in bench/results as the pool (gate only): selector 0.3346 (12/4), oracle 0.3583. A bigger pool raises the ceiling, but the selector makes losing picks. Not validated.
- Gate rule in docs/engine.md: "≥12 wins of 19". Best-of-4 gives 9 wins, 0 losses and 10 ties, because whenever the default is already the best build it gets picked again. The rule was written for single changes; a selector that never loses deserves a decision on its own terms.
- Cost: K builds. About 7 s per model at mid tiers (K=4 ≈ 28 s in one worker). Master is 90–130 s per build, so K=4 is too slow there unless the builds run on parallel workers.

Runs: bench/results/c5-val-{s8b,base,mf85,shell}.json (git f68d513, clean).

## Picture check (`scripts/render-compare.mjs`, 4 held-out models where the selector moved the score most)

- **10190 (minfill):** clearly better. The floating yellow plate is gone and the walls are complete; 804 → 351 pieces.
- **4954 (minfill):** mixed. 4031 → 2680 pieces and the house looks the same, but the ground and front yard have holes and loose parts.
- **8194 (shell):** a little better. The roof curve and spoiler are closer, but a side part sticks out.
- **8125 (shell):** mixed. The tall blue lump at the front is gone, but the roof is lower than the designer's.

So the score went up on all 4, and the picture shows 1 clearly better, 1 slightly better, 2 even. None looks clearly worse.

## In the app

`sculptWorker.ts` builds one variant per request: `BuildRequest.variant` (default 0 = the app's build, same as before). The reply carries fit, held, repeats and pieces, and the page calls `pickBest` on all of them. Candidates go in VARIANTS order, so a tie keeps the default.
- The shell variant with donor parts kept replies `skipped: true`.
- Technic ignores variant options.

Agreed with af (src/scene/engine.ts, UI), progressive: each tile shows the default as soon as it's ready, the other 3 run after the batch, and the tile switches if pickBest finds a better build. Junior/Creator/Advanced only.
Difference from the measurement: the worker prunes (`necessity.prune`) before scoring and the bench did not, so the app's picks can differ slightly.

## Next

1. Run the variants in parallel across workers, so the UI waits about as long as one build.
2. A larger pool with a better selector: learn the score weights on the tuning set, validate on held-out.
3. Add a bench option `BEST_OF` so the measurement is end to end, not offline.

## In the app's setting (af's test + scripts/c5-studio-bestofk.mjs)

- **Junior–Advanced with donor parts kept** (Studio longer/shorter/wider): in the real app the default won 6/6 (af, Playwright). The variants only fill small gaps between donor parts, so they hardly differ. No gain, so it stays off.
- **Expert, core8 ×1.5, no donors** (bench/results/c5-studio-expert.json):
  - The selector picked a non-default variant 2 of 8 times (75870 → minfill85, 4917 → shell).
  - Time: about 3.0 s per default build and about 11.6 s for all 4 (31009 takes about 10 s per variant).
  - Pictures (`render-compare`): 75870 a little fuller with fewer holes; 4917 a fuller torso but more pieces (205 → 238). Neither looks worse. The other 6 are identical to the default. The gain is small; the bigger problem is the build quality underneath (noisy compared with the designer), which best-of-K doesn't fix.
