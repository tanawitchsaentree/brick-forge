# DNA: the owl of 30714 (golden test G1)

## The set

- **Rebrickable:** 30714-1 is "Orange Cat" (2026), 79 parts, a Creator 3-in-1 polybag. The owl is build 02, the alternate (`~/Downloads/30714_02_BI_Build_Alt.pdf`, 17 pages, 26 steps). It uses a subset of the 79: about 55 by the user's count, not yet counted part by part.
- **Inventory:** from the public Rebrickable CSV dumps (`cdn.rebrickable.com/media/downloads`). The set page, the API (it needs a key), Brickset and BrickLink all refused scripted access. Extracted to `/tmp/rb30714/inventories.json`, together with 31058-1 (174 parts) and 77244-1 (267 parts). That file goes into `data/golden/` in the next step.
- **The 79 parts, by role** (owl and the other two builds together):

| role | parts in the inventory |
|---|---|
| connectors | Technic brick 1×1 with pin hole ×4 (6541); Technic pin ×4 (61332); plate 1×2 with pin hole on top ×4 (11458); plate 1×1 with vertical clip ×4 (60897); plate 1×2 top clip ×2 (44861); plate 1×2 with horizontal clips ×1 (60470b); plate 2×2 with T-bar underneath ×1 (5066); round 4×4 with pin hole ×1 (60474); round 2×2 with axle hole ×1 (3941); T-piece bar ×1 (4697b); bracket 1×2–1×2 ×1 (99781); jumper ×2 (15573) |
| features | eye tile round 2×2, printed ×2 (14769pr1116); claw ×2 (10187); tooth plate 1×1 ×4 (15070) |
| surface | inverted curved 4×1 ×4 (13547); inverted curved 2×2 ×1 (32803); curved 2×2 ×1 (15068); 1×1 double curved ×4 (49307); tile 1×2 ×4 (3069b); quarter-round tile ×6 (25269); half-circle tile ×3 (24246); round corner plates (79491 ×2, 85080 ×4); arch 1×3 curved (5843) |
| volume and plates | brick 2×2 ×1 (3003); plates 2×4 ×2, 2×3 ×1, 2×2 ×2; rounded plate 1×2 with 2 open studs ×4 (35480); wedge plate 2×2 cut corner (26601); round 4×4 with 2×2 hole (11833); round 1×1 with open stud ×3 (85861) |

  Of the 79: about 30 connectors, 11 features, about 30 surface parts, and 3 bricks of pure volume (the 2×2 brick and the two 2×4 plates count as the core).
- **Building order** (pages 4–16, read from the booklet images). Body, steps 1–13:
  - the keel and core (inverted curved slopes, a 2×2 brick, a deck plate);
  - step 5: Technic 1×1 bricks with pin holes;
  - step 6: vertical clips;
  - step 8: the plate with horizontal clips, at the top and back;
  - step 9: top-clip plates, at the front and bottom;
  - step 10: Technic pins into a second pair of pin-hole bricks, at the sides;
  - step 13: claws onto the front-bottom clips.

  Wing and tail sub-assemblies: steps 12 and 15. The head as its own sub-assembly: steps 16–24 (a white 2×4 base; tan rounded plates; at step 17 the 2×2 plate with the T-bar underneath; vertical clips for the ears at step 18; corner tiles; the eye tiles at step 23; half-circle tiles at step 24). At step 25 the head goes onto the body.

## The interfaces (the body is a socket board)

| socket on the body | step | part | plug | module |
|---|---|---|---|---|
| pin-lateral ×2 | 5, 10 | Technic brick 1×1 with pin hole + Technic pin | pin hole | wings (mirrored pair) |
| clip-front-bottom ×2 | 9 | plate 1×2 top clip | bar (claw) | feet: one claw each, feature parts |
| clip-horizontal-top ×1 | 8 | plate 1×2 with horizontal clips | **T-bar under the head** (plate 2×2 with T-bar, step 17) | head |
| vertical clips (on the head) ×2 | 18 | plate 1×1 with vertical clip | plate edge (clip-edge grip) | ears |
| (to check) | 12, 15 | bracket 1×2–1×2, curved slopes | — | tail and wings, side-on |

**The question about the head, answered.** The head isn't held by studs alone, and not by the pin from step 17. Step 17's part is the tan plate 2×2 with a T-bar underneath; its bar shows past the plate's edge in the parts call-out. The only part on the body that takes a bar from above is the plate with horizontal clips from step 8, which shows at the top back in steps 8–10. So the head is a **clip-bar joint, 1 DOF, a nod**, like the other appendages.
- Confidence: medium to high. It rests on the parts call-outs and the inventory: 5066 is the only tan 2×2 plate in it. The booklet's 2D views don't show the bar seated in the clip.
- The user's interface list ("studs-top for the head") is corrected to "clip-horizontal-top ×1 ↔ bar".

## The DNA, as the engine should read it

```
archetype: bird-upright, level: junior
core: keel (2 inverted curved slopes) + 1 brick + deck plate
interfaces on core: pin-lateral ×2, clip-front-bottom ×2, clip-horizontal-top ×1
modules:
  wing ×2 (mirror)  plug: pin-hole        body: curved slope + tile + accent tip
  foot ×2           plug: bar into clip   body: 1 feature part (claw)
  tail ×1           plug: clip / bracket  body: curved slope + bracket + accent tiles   (attachment to be confirmed, steps 12 and 15)
  head ×1           plug: bar (T-bar plate) into clip-horizontal-top   body: own plate frame, carries features
    ear ×2          plug: plate edge gripped by vertical clip   body: rounded plate + cap
    eye ×2          feature, printed round tile, placed late (step 23)
    beak ×1         feature, placed late (step 24)
surface rule: convex faces = curved slopes, visible tops = tiles
pose: every appendage on a 1-DOF joint, nothing built at an angle
level rules seen: 26 steps, 1–4 parts per step, sub-assembly depth ≤ 3, repeats in pairs (2×), 3 colour roles (main orange, face white, accent tan / pink)
```

## Still open

- The owl's own part list (its subset of the 79) and its count. Read from the booklet, then hand-place it in LDraw (`data/golden/30714-owl.ldr`) as the reference for G1.
- How the tail attaches (steps 12 and 15): bracket, or curved slopes on a clip.
- Until the hand-placed file exists, the G1 stand-in is a Junior animal from the corpus, chosen in the A0 report.
