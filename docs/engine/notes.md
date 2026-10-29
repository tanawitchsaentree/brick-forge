# Engine program: hard-coded parts register (rule 2)

Rule 2 says no part ID may be hard-coded in `assembly/*.ts`. This register also
lists the ones elsewhere in the engine that break the rule's intent: a fixed
choice of part where the learned path should choose. Each entry says why the
learned path doesn't make the choice yet. That reason is the bug to fix.

Recorded 2026-10-29, branch `engine-program`, from commit 181c31a.

## In the sculptor (`src/engine/sculpt.ts`)

| where | IDs | what it does | why the learned path doesn't do it | to be replaced by |
|---|---|---|---|---|
| `bridge()` defaults, line 631 | 3023, 3710, 3022, 3020, 3623 | after the greedy pass, ties each loose group to the main model with the smallest of these plates that locks into both | the gain has no term for "this placement connects two components"; greedy can't undo a placement that left a group loose | Phase 3 repair loop (refill a hotspot under the stability constraint). If it can't replace `bridge`, phase3.md says why. |
| `finishTops()` table, lines 643–644 | 3024→3070b, 3023b/3023→3069b, 3623→63864, 3710→2431, 3666→6636, 3460→4162, 3022→3068b, 3021→26603, 3020→87079, 3795→69729, 4073/6141→98138 | swaps a plate whose studs all show on a smooth surface for the tile of the same size | finish isn't weighted by what can be seen, and the plate wins on HOLD before a tile is ever considered | Phase 2 visibility-weighted finish plus learned weights; then measure the table off. |
| `capStuds()` | (picks tiles from the forms by category, no IDs) | caps studs left on smooth surfaces with tiles | a hand rule after the search, but chosen from learned forms | Phase 3 repair loop; measure it off. |

## In the rigs (`src/engine/assembly/`)

- `f1.ts`: 17 part ID literals (axle-and-wheels composite, driver, jumper, arch, wings, curved slopes, cheese, slopes, round plate, side-stud brick, tiles, plain bricks). Phase 4 removes all of them except the hard constraints: the wheel/axle composite and the driver (the cockpit's size follows from the minifigure).
- `dino.ts`: 23 part ID literals (teeth, claws, eyes, ball joints, curved slopes, side-stud bricks, tiles…). Out of scope for this program until Phase 4 has shown the target-only route works; listed so it isn't forgotten.
