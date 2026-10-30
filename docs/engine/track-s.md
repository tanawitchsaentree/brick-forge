# Track S: the sculptor (program v2), results log

Baseline: PARITY_v2 0.2525 on the 19 gate models (core8 0.348, levels 0.183). Gate: paired, at least 12 wins out of 19, no level down more than 0.02.

| item | flag | result | status |
|---|---|---|---|
| S1: long plain parts in keep() | `KEEP_LONG` | +0.014 core8 / +0.005 levels (v2, ∞ against ∞); pieces unchanged; long parts already placed as the designer places them | **measured, no help** (docs/engine/phase2.md) |
| merge pass | `MERGE_PASS` | 19 models: PARITY_v2 0.2525 → 0.254. Only 0.8 % of our 1×1s are plain, on the grid, and still mergeable | **correct, small target** (docs/engine/phase2.md) |
| S7: capStuds with the use prior | `CAP_PRIOR` | 19 of 19 ties, PARITY_v2 0.2525, pieces ×1.62 / ×2.48 unchanged; corner round tiles (25269) down to 181 on the 19 | **measured, no help.** Likely why (not measured): corner tiles are about as frequent in the corpus as plain ones, so the prior doesn't flip the choice |
| S3: shell target | `SHELL` (`src/engine/shell.ts`) | bench targets are designers' builds: 33.6 % of units full, **1.2 % inside** (Master models 0.2–1.7 %). Smoke test on 31009 / 10243: pieces 546 → 605 / 4,356 → 4,373, time unchanged | **no target on the bench.** Measured on the studio's Master targets instead (below) |

## S4, the sliver rule: measured, no help

`MIN_FILL` 0.5 and 0.75: 19 of 19 ties. The existing gate `cover − 3·air > 0` already means `cover / (cover + air) > 0.75`, so no part filling under 75 % of itself with target cells was ever placed. Our 1×1s aren't slivers; they're a partition choice.

Above 0.75 (19 gate models, then the tuning and validation sets):

| MIN_FILL | gate PARITY_v2 / wins | tuning set (23) | validation set (23, disjoint) |
|---|---|---|---|
| off | 0.2525 | 0.2599 | 0.2189 |
| 0.85 | 0.2795 / 11 | 0.2663 / 14 wins | 0.2052 / 10 wins |
| 0.88 | — | **0.2789 / 17 wins** | 0.2078 / 10 wins |
| 0.90 | 0.2600 / 12, Creator −0.027 | 0.2760 / 12 | 0.1883 / 8 |

The tuning set's choice (0.88) loses on validation, and so does every value. Held falls each time. Gate results near passing were luck. **Not merged.**

## S8, no unheld part resting on a stud-less part: PASSED, merged

Two forms, both checked on the tuning set and on the disjoint validation set before the gate was run once:

| | tuning (23) | validation (23) |
|---|---|---|
| defaults | 0.2599, IoU 0.753, made 7.3 | 0.2189, IoU 0.729, made 11.6 |
| `NO_FLOAT: true` (no unheld, ungrounded part at all) | 0.2971, 20 wins, IoU 0.699 | 0.2197, 16 wins, **IoU 0.608**: holes where overhangs would be held from above later |
| **`NO_FLOAT: "onSmooth"`** (only if it rests on parts with no stud into it) | **0.2970, 22 wins**, IoU 0.751, made 13.3 | **0.2271, 15 wins**, IoU 0.718, made 14.7 |

Gate (19 models), `onSmooth`:

| | baseline | S8 |
|---|---|---|
| PARITY_v2 | 0.2525 | **0.2807**: 14 wins, 5 losses; creator +0.054, junior +0.018, expert +0.012, advanced +0.011 |
| PARITY v1 | 0.2922 | 0.3314: 15 wins |
| pieces × human (core8 / levels) | 1.62 / 2.48 | 1.41 / 2.25 |
| held | 0.797 / 0.677 | 0.806 / 0.701 |
| IoU | 0.768 / 0.692 | 0.761 / 0.686 |
| unconnected per model | 20.3 / 122.6 | 13.4 / 86.5 |
| made parts per model | 1.6 / 7.1 | 2.6 / 9.6 |
| local frame < 10 % (12) | 0.312 | 0.351, 10 wins |

Losses: 31027 kart (0.339 → 0.206), 4917 (0.120 → 0.059), 21318, 6743, 6581.

**Pictures** (`scripts/render-compare.mjs`, made parts drawn, real GPU): `/tmp/prev/s8-compare2.png`.
- 31009: a clean roof where the baseline's was scattered red; 546 → 439 pieces. Better.
- 30190: a cleaner nose; the rear wing on its pillar. Slightly better.
- 10243: about the same, 4,356 → 3,776 pieces.
- 31027 kart: worse; the grey seat is gone, a red tile instead. Both are far from the designer's.

**Merged:** `sculptWorker.ts` sets `NO_FLOAT: "onSmooth"` for every level but Technic (not gated). The bench baseline stays frozen, without it.

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
