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

The generated data (catalog, corpus, geometry pack, thumbnails, learned forms; about 300 MB) isn't in git either. With Cloudflare access, `npm run data:pull` fetches the exact version `scripts/data.lock.json` names from R2 instead of rebuilding it. After rebuilding data, `npm run data:push` uploads what changed and updates the lock.

## CI / deploy

`.github/workflows/ci.yml` type-checks and builds every push and pull request. A push to `main` then pulls the data and deploys to [brick-forge.pages.dev](https://brick-forge.pages.dev) (`npm run deploy`, which also leaves local-only models out). It needs two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

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

## Credits

Brick Forge is a fan project. LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this project.

- **Parts:** geometry from the [LDraw Parts Library](https://library.ldraw.org) by the LDraw.org contributors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). `public/ldraw-pack` and `public/shapes.json` are converted from it.
- **Designs:** the corpus in `public/corpus` is LEGO sets modelled by LDraw.org members for the [LDraw Official Model Repository](https://library.ldraw.org/omr), [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). Each file keeps its `0 Author:` line, and `public/corpus/index.json` names the author of every design. `public/forms*.json` is learned from them. The site lists everyone on `/credits.html`.
- **Not in the repo:** LEGO instruction booklets and any model that isn't openly licensed (a MOC bought for study) stay in `booklets/`, which is gitignored, and are never deployed (see `scripts/build-corpus.mjs`).

## Licence

All rights reserved (see `LICENSE`). Third-party material keeps its own licence, listed there and under Credits.
