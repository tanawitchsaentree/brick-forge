# Phase 5: local frames, modules (design only; not started)

## The ceiling this phase has to unlock

**27.7 % of kept designer parts need a local frame.** That is 22.8 % tilted (no axis onto an axis) plus 4.9 % upright but turned by a non-quarter angle. No form on the world grid can place them (`docs/engine/phase2.md`, breakdown over 115,012 kept parts of 343 models, `scripts/vocab-breakdown.mjs`).

The evidence that frames, not forms, are the fix: **40.4 % of the tilted parts are axis-aligned again in a frame shared with at least half of their sub-model.** Designers build those sub-assemblies on the grid, then place them whole at an angle (hoods, roofs on hinges, wings). That is a lower bound: a sub-model can hold nested sub-models with frames of their own.

### Angles (`scripts/corpus-poses.mjs` → `bench/results/local-frame.json`, all non-Technic corpus models)

Upright, turned off the quarter (16,340 parts), to the nearest 0.5°:

| yaw | 45° | 30° | 37° | 60° | 85° | 5° | 21° | 53° | 12.5° | 4° |
|---|---|---|---|---|---|---|---|---|---|---|
| share | 20.0 % | 11.8 % | 5.4 % | 5.0 % | 3.8 % | 3.6 % | 2.8 % | 2.3 % | 2.0 % | 2.0 % |

Clustered: 45°, 30° and 60° are 37 % of them.

Tilted (41,752 parts), the angle of the part's axis nearest to vertical, from the vertical:

| tilt | 0° | 16.5° | 11° | 2.5° | 45° | 20.5° | 30° | 15° | 9° | 5° | 10° | 12° | 22.5° | 35° | 34.5° |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| share | 12.7 % | 8.8 % | 6.4 % | 4.5 % | 4.1 % | 3.7 % | 3.4 % | 3.1 % | 3.1 % | 3.0 % | 2.8 % | 2.5 % | 2.4 % | 2.4 % | 2.0 % |

Not clustered: the top 15 angles cover about 65 %. "0°" means sideways or upside down, then turned by a non-quarter angle about the part's own axis.

So the yaws would mostly be covered by a handful of standard turns (45°, 30°, 60°). The tilts would not: they follow the model's shape (hinge angles set to fit), so a frame has to be fitted per sub-assembly, not picked from a short list.

### Per model

- Share of a model's parts that need a local frame: median 7.8 %; 204 of 377 non-Technic models are under 10 %.
- On the 19 gate models (core8 + levels), 12 are under 10 %.
- The two worst models in Phase 0 are the ones that need frames most: 30035-1 at 100 % (the whole model is placed at an angle) and 6581-1-1 at 64 %.
- The gate reports both groups apart (`scripts/bench-gate.mjs`).

## Design (to be written after Phase 3 is merged)

Shape decomposition, labelled parts, a module library from validated OMR sub-models, and hierarchical assembly with the sculptor filling seams, as in the program spec. The frame of each module comes from the designer's sub-model (its own axes), so a module is built on its grid and placed at its angle.
