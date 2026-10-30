# DNA: the Mandalorian's N-1 Starfighter (75325)

Reverse-engineered from the user's product photo, towards a build close to the real one: what each source gave, what the model is built around, and the DNA the engine should read.

## The set

75325-1, 2022: 412 pieces, 400 of them without spares or minifigs, in 164 lots. The inventory is in `data/golden/75325-inventory.json`.

## Methods, and what each gave

| # | method | gave | limits |
|---|---|---|---|
| M1 | **Read the photo** | silhouette and proportions: a long hull with a spike nose, two pods on arms, two bubbles | two misreadings. The "Z" wing is a flat wing seen at a bank. The pram and the fuel pump in the picture aren't in this set's booklet. |
| M2 | **Rebrickable CSV dumps** (`inventories` / `inventory_parts` / `parts` / `colors`) | the exact parts and colours | no positions. The set page is blocked (Cloudflare 403); the dump files work. |
| M3 | **The official instructions** (`lego.com/cdn/product-assets/product.bi.core.pdf/6607925.pdf`, 100 pages, 149 steps, read page by page) | order, sub-assemblies, joints, mirrored pairs | 2D views. Hidden joints are inferred, for example the wing pressing onto the rear stud block. |
| M4 | **The corpus, by signature parts** | 41531 appears in 3 models (10240, 70814, 75144); 29115 and 60219 in none | weak: no close analogue in the corpus |
| M5 | **Coarse rebuild in LDraw** from M3 + part bounding boxes (`scripts/rebuild-n1.mjs` → `docs/engine/n1/n1-coarse.ldr`, rendered with `scripts/render-ldr.mjs`) | 78 parts, the silhouette right in 3 iterations (`n1/n1-coarse.png`) | the hull is thinner than the real one; no interior, greebles or play features |
| M6 | (next) full rebuild, step by step from the M3 log | a ground-truth `.mpd` for the corpus and the bench | about 330 parts placed by hand |

The LDraw OMR has no 75325. 393 of the 400 parts have an LDraw file. The exceptions are 64567 (the LDraw file is 577b), the sticker sheet and the BD-72 droid.

## Parts by role

Sorted by name with a rough regex, so the counts are approximate:

| role | pieces |
|---|---|
| connectors (Technic, clips, bars, brackets, jumpers) | 138 |
| surface (curved, round, cones, domes) | 92 |
| volume (plates, bricks) | 73 |
| belly (inverted slopes) | 34 |
| features and details | 27 |
| wedge plates and wedged bricks (angles in plan) | 23 |
| tiles | 8 |

About a third are connectors. Only 73 pieces are plain volume.

## The core

1. **The keel**, steps 1–14. A hollow box:
   - an inverted-slope belly: 41764/41765 ×3 pairs, 42023 ×4, 3660 ×6, plus 29115 and 60219 (34 inverted parts in the set);
   - two white 1×8 rails, tied by tan 1×10s;
   - the spine: two dark-grey 2×12 plates, side by side, with 12×3 wedges for the swept deck edges.

   Everything else is mounted on this.
2. **One wing piece**, steps 51–63. A single span, built flat:
   - an 8×8 rounded plate in the middle, 2×12s and pairs of 6×4 / 12×3 wedges;
   - two Technic 73109 bricks at each tip, pin holes facing out.

   It presses onto the keel's raised rear stud block (step 64). It has no hinge; its sweep comes from the wedge plates.
3. **Axial pods**, steps 97–148, ×2. Each nacelle is threaded on a 16L axle, front to back:
   - a cone with a spear tip, a pulley, a Technic wheel;
   - then the body: round 4×4 plates, a half cylinder, two white bars sleeved with 1×1 round bricks;
   - the rear half: two Technic cylinders, a dome with a turbine tile.

   Each pod hangs on its wingtip by **2 Technic pins**. The front halves are identical; the rear halves differ in greebles.

| socket | on | joint | plug |
|---|---|---|---|
| front deck studs | keel | studs | nose (bar plates, spear), step 31 |
| raised rear stud block | keel | studs | wing span, step 64 |
| wingtip pin holes ×2 per side | wing | Technic pin ×2 | nacelle, steps 121 and 148 |
| clip plates ×2 | keel, front | clip–bar hinge | Grogu's half-sphere canopy 18990 |
| clip block | keel, behind cockpit | clip–bar hinge | Mando's windscreen 92279 |
| red axle pins ×2 | wing, top rear | axle | twin rear cannons (×2, identical) |
| studs, belly | keel | studs | ventral pod; the spring shooter is inside |

**The principle:** a ship is a keel, one flat wing piece and two pods built along an axle. All its angles come from wedge plates in plan and from inverted and curved slopes in section; none come from hinges. The only moving joints are the canopy clips. Sub-assemblies are joined by studs, or by pins at the tips.

## The DNA, as the engine should read it

```
archetype: starfighter, level: advanced (412 pcs, 149 steps)
core: keel = inverted-slope belly + 2 rails + 2×(2×12) spine; wedges for the deck's sweep
interfaces on core: studs-front (nose), studs-rear-raised (wing), clip ×2 + clip block (canopies), studs-belly (pod)
modules:
  nose ×1           plug: studs              body: 2×14 + 4×9 wedge + 2 bar plates 1×12 + spear
  wing ×1 (span)    plug: studs onto keel    body: 8×8 + 2×12 + mirrored wedge pairs; 2 pin-hole bricks per tip
    nacelle ×2      plug: 2 Technic pins     body: AXIAL on a 16L axle — cone, wheel, round plates, cylinders, dome
  canopy ×2         plug: clip–bar hinge     body: 1 transparent dome / windscreen each
  rear cannon ×2    plug: axle pin           body: axle with stud + rings + hilt
surface rule: underside = inverted slopes; sides = curved 3×1; plan angles = wedge plates
symmetry: everything mirrored left/right (4 wedge pairs), pods identical at the front, varied at the back
```

## What it tells the engine

- **The pods are built along an axle, not in layers.** The sculptor stacks layers bottom-up, so it can't build a cylinder lying sideways the way designers do. Pods, engines and barrels need a lathe-like generator: round parts threaded on an axis.
- **The wing is one flat module on studs, not a voxel slab.** It is the same "module on a socket" pattern as the owl's appendages (`dna-owl.md`), here with studs and pins instead of clips.
- **Angles in plan are wedge plates.** Whether the sculptor uses them at all is still to check.

Next:
1. M6, the full rebuild, as a ground truth for the corpus.
2. A lathe generator for pods.
3. Sculpt the N-1 from M6's voxels and compare it with the designer's build.
