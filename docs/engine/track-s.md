# Track S: the sculptor (program v2), results log

Baseline: PARITY_v2 0.2525 on the 19 gate models (core8 0.348, levels 0.183). Gate: paired, at least 12 wins out of 19, no level down more than 0.02.

| item | flag | result | status |
|---|---|---|---|
| S1: long plain parts in keep() | `KEEP_LONG` | +0.014 core8 / +0.005 levels (v2, ∞ against ∞); pieces unchanged; long parts already placed as the designer places them | **measured, no help** (docs/engine/phase2.md) |
| merge pass | `MERGE_PASS` | 19 models: PARITY_v2 0.2525 → 0.254. Only 0.8 % of our 1×1s are plain, on the grid, and still mergeable | **correct, small target** (docs/engine/phase2.md) |
| S7: capStuds with the use prior | `CAP_PRIOR` | 19 of 19 ties, PARITY_v2 0.2525, pieces ×1.62 / ×2.48 unchanged; corner round tiles (25269) down to 181 on the 19 | **measured, no help.** Likely why (not measured): corner tiles are about as frequent in the corpus as plain ones, so the prior doesn't flip the choice |
| S3: shell target | `SHELL` (`src/engine/shell.ts`) | bench targets are designers' builds: 33.6 % of units full, **1.2 % inside** (Master models 0.2–1.7 %). Smoke test on 31009 / 10243: pieces 546 → 605 / 4,356 → 4,373, time unchanged | **no target on the bench.** Measured on the studio's Master targets instead (below) |

## S3, where it applies: the studio's Master targets

The studio scales Master targets up and smooths them (`morph.ts` scaleUp ×2.5). Those targets are solid:

| model (×2.5) | units | full | **inside** | parts to fill the inside | time to fill it |
|---|---|---|---|---|---|
| 31009 | 43,308 | 65.8 % | **23.9 %** | 1,552 | 242 ms |
| 75870 | 15,640 | 66.5 % | **39.5 %** | 1,102 | 93 ms |
| 31066 | 33,460 | 56.6 % | **24.1 %** | 1,178 | 188 ms |
| 7611 | 2,752 | 54.0 % | **25.4 %** | 80 | 22 ms |

So S3's acceptance changes:
- the paired bench gate must not get worse (expected neutral);
- **`scripts/bench-studio-master.mjs`** (core8 as the studio makes them at Master, the app's Master weights, leave-one-out forms) must show lower sculpt time and fewer pieces, with held, unconnected parts and smoothness against the scaled target no worse.

The nightly Master runs use designer targets (shells), so they can't show this. Results: below, when the run ends.

## F7 counted: why unconnected parts are unconnected

`scripts/unconnected.mjs`, on the 19 gate builds: **1,513 unconnected of 12,420 parts (12.2 %).**

| what it touches | parts | % | by pass |
|---|---|---|---|
| **above or below, with no stud joining them** | **810** | **53.5** | greedy 561, finishTops 196, capStuds 53 |
| only sideways | 566 | 37.4 | greedy 364, finishTops 188, capStuds 14 |
| nothing | 137 | 9.1 | greedy 81, finishTops 56 |

Most common: Tile 1×1 (346), Tile 1×1 Round (261), Plate 1×1 (127), Tile 1×2 (119).

**Verdict on F7.** "Inside the shape, touching only sideways" holds for 37.4 %. That's S6's reach, with side anchors. The larger group, 53.5 %, sits on or under a part with no stud between them: mostly parts above tiles, or tiles over parts.

The greedy places whatever ranks first at an anchor even when its score is negative (`sculpt.ts` fill loop: `if (!top) break` takes the maximum, not a positive one). FLOAT −300 only demotes an unheld part; it never forbids it. A candidate experiment (S8): an unheld, ungrounded placement isn't made at all. It costs IoU where nothing can hold a part, and has to be measured.

## Order from here

1. Studio-master result for S3.
2. S4, the sliver rule (backed by F5: 35.6 % of greedy's off-grid 1×1s fill cells whose designer form was among those tried; 53.7 % of its on-grid ones).
3. S8, no unheld placements.
4. S5, the global frame (30035-1).
5. S2, per-level form order.
6. S6, sideways SNOT with side anchors (37.4 % of unconnected parts).
7. Stability calibration before P3.
