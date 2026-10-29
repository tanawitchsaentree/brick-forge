# Whose cells our 1×1 parts fill (F5, counted)

`scripts/one-owner.mjs`, on the bench builds of core8 + levels (19 models, MERGE_PASS run, saved with BENCH_OUT). For each 1×1 part, the designer part that owns most of the target cells it fills. That designer part is classed as in the vocabulary breakdown, leave-one-set-out per model.

| our 1×1 | n | owner covered (form among the 1,500 tried) | owner needs a local frame (tilted + yaw) | owner excluded by policy | (a) past rank 1,500 | axis-aligned pose not generated | no target cells |
|---|---|---|---|---|---|---|---|
| greedy, off grid | 3,160 | **1,124 (35.6 %)** | 771 (24.4 %) | 557 (17.6 %) | 371 (11.7 %) | 337 (10.7 %): sideways 224, height 62, half stud 39, other 12 | 0 |
| greedy, on grid | 883 | **474 (53.7 %)** | 139 (15.7 %) | 153 (17.3 %) | 77 (8.7 %) | 40 (4.5 %) | 0 |
| capStuds, off grid | 1,829 | 333 (18.2 %) | 208 (11.4 %) | 326 (17.8 %) | 55 (3.0 %) | 49 (2.7 %) | **858 (46.9 %)** |
| capStuds, on grid | 310 | 90 (29.0 %) | 60 (19.4 %) | 43 (13.9 %) | 29 (9.4 %) | 12 (3.9 %) | 77 (24.8 %) |
| finishTops, off / on grid | 557 / 26 | 142 / 16 | 167 / 6 | 151 / 2 | 63 / 2 | 34 / 0 | 0 |

## Verdict on F5

The hypothesis was that greedy's off-grid 1×1s chase cells of designer parts the sculptor has no pose for. **Refuted as the main cause.**
- Owners that need a local frame or an axis-aligned pose not generated: 1,108 of 3,160 (35.1 %).
- Owners whose form *was* among those tried: 1,124 (35.6 %). There the greedy chose 1×1s where one designer part would do. That's partition, the original diagnosis: the sliver rule (S4) and region tiling have a measured target of about 36 % of greedy's off-grid 1×1s and 54 % of its on-grid ones.
- 17.6 % fill cells of parts excluded by policy (minifigs, plants, baseplates, printed parts): cells no part can match. Evidence for metric v3 and for the shell target (S3).
- capStuds: 47 % of its off-grid tiles sit outside the target entirely. Expected: a cap sits on the surface.

So S4 is ordered on evidence now, after S7 and S3, as planned. S6 doesn't need to come first.
