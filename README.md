# Brick Forge

A 3D LEGO builder that designs models for you. Pick what to build — a dinosaur, a race car, a house — and the engine assembles real LDraw parts into a stable, articulated design, with step-by-step instructions, a parts list and a difficulty rating. It keeps learning offline, improving its own recipes and adapting to the designs you choose.

## What it does

- **Build** on a 32×32 baseplate with the full LDraw part library, 3D thumbnails, a ghost that follows the cursor, and shortcuts that work on any keyboard layout.
- **Create**: six designs per click from the Assembly Grammar — race cars, city cars, houses, robots, rockets, and nine dinosaur species (T. rex, Raptor, Spinosaurus, Dilophosaurus, Parasaurolophus, Triceratops, Stegosaurus, Ankylosaurus, Brachiosaurus) built like LEGO Creator sets: rigid sections on ball joints, legs solved by IK, curved-slope bodies.
- **Physics**: stud clutch, overhangs and ball-joint torque are checked; every generated design stands.
- **Instructions**: planned from the structure — sub-assemblies, chapters, where each part goes, progress saved, printable booklet.
- **My Library**: enter the pieces you own and generate from them, with a shopping list for what's missing.
- **Learn**: an evolutionary cookbook runs in a background worker, building and scoring new body plans and keeping the better ones. It works offline and remembers what it has learned.

## Setup

```sh
npm install
```

The LDraw library is not in the repo (it's 600 MB). Download the complete library from [ldraw.org](https://library.ldraw.org/updates?latest), unzip it into `public/ldraw` (so that `public/ldraw/parts` exists), then generate the catalog, thumbnails and geometry pack:

```sh
npm run setup:ldraw   # catalog + thumbnails (takes a while) + geometry pack
```

Without the library the app still runs with a small built-in set of parts.

## Run

```sh
npm run dev                         # development
npm run build && npm run preview    # production build (much faster to load)
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run catalog` | Builds `public/catalog.json` from the LDraw library (sizes, studs, semantic tags) |
| `npm run thumbs` | Pre-renders part thumbnails and the Create screen's previews |
| `npm run pack` | Bakes the parts the generators use into one geometry file |

## Code map

- `src/engine/assembly` — the Assembly Grammar (`objects.ts`) and the dinosaur rig (`dino.ts`)
- `src/engine/learn` — the self-improving cookbook and its worker
- `src/engine/stability.ts`, `instructions.ts`, `pose.ts` — physics, instruction planning, posed parts
- `src/engine/generate` — voxel generator (photos, 3D models, characters)
- `src/scene`, `src/ui` — rendering and screens

LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this project. Part geometry comes from the LDraw library (CC BY 4.0).
