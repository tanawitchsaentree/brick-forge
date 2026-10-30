# DNA: the two alternate builds of 31058 Mighty Dinosaurs

Same set as the T-rex (docs/engine/dna-31058.md), same inventory: `data/golden/rebrickable-inventories.json` → "31058-1".
Each model was read step by step from its official booklet, rendered to JPEG with PDFKit (2.5× pages, 5× crops).

Grid: stud 20 LDU, plate 8. Frame: −Y up, head toward −X, the model's left side toward +Z.
INF marks an inference where the drawings don't show it.

| model | booklet | steps | parts (booklet callouts) | reference | script |
|---|---|---|---|---|---|
| Triceratops | 6437438 (28 pages) | 1–47 | 110 | data/golden/31058-trike.ldr | scripts/rebuild-31058-trike.mjs |
| Pterodactyl | 6437440 (24 pages) | 1–30 | 101 | data/golden/31058-ptero.ldr | scripts/rebuild-31058-ptero.mjs |

The booklets have no parts list, so the count is the sum of the per-step callouts.

## Triceratops (6437438)

### Modules, in the booklet's order

| module | steps | parts | size (studs L × W, plates H) | core | joint to its neighbour |
|---|---|---|---|---|---|
| body | 1–13 | 34 | 7 × 4 (6 at the round deck), about 13 plates | tan 3020 2×4 belly; inverted slopes widen it: green 3660 forward, tan 3660 ×2 back to back sideways, tan 3747b 3×2 backward (green 3022 + dark green 3023 on it); green 30357 3×3 ×2 = 6-wide deck rounded at the rear corners; tan 3001 spine; dark green 3010 ×2; green 43712 curved 6×4 shell (2×2 studs at the front); green 3040b ×2 and 54200 ×2 at the shoulders; green 15068 over the neck | offers: DBG 14417 forward under a dark green 3023 (neck); DBG 85943 ×2 with black 53585 on red 32062 between the beams (shoulders); DBG 17114 two 10.2 mm balls (hips); DBG 14417 rear top (tail) |
| tail 1 | 14–18 | 9 | 4 × 2 × 5 | green 3020 base, dark green 3023 ×3, green 3022, green 11153 ×2 on top | LBG 14704 side socket on the body's tail ball (3 DOF); offers DBG 14417 at its rear |
| tail 2 (tip) | 19 | 3 | 2 × 1 | green 3024, green 11477 | LBG 14418 end socket on tail 1's ball (3 DOF) |
| rear leg ×2 | 21, 22 (mirrored) | 4 + 4 | slab 3 × 2, 5 plates thick, hung vertical, studs out | tan 3021, green 3004, dark green 43722 / 43723 wedge 3×2 | dark green 92013 socket on a 17114 ball (3 DOF) |
| front leg ×2 | 23, 24 (mirrored) | 4 + 4 | slab 4 × 2, 5 plates thick, hung vertical, studs out | green 41769 ×2 (left) / 41770 ×2 (right) wedge 4×2, green 3003 | dark green 92013 socket on a 53585 ball (3 DOF + spin) |
| head | 25–39 | 33 | 6 × 2 (3 at the brow), about 8 plates | green 3020 with tan 3710 ×2 under it (one stud proud at the snout) and white 15208 teeth at the back; dark green 60478 ×2; green 3003; tan 60897 ×2; DBG 11458 ×2 outboard (pin holes forward) with LBG 4274 + trans-orange 58176 eyes; tan 26604 ×2 snout bricks; dark red 3023 ×2; trans-orange 6141 ×2; green 54200 ×2 cheeks (SNOT); dark green 47755 wheel-arch brow from the snout bricks (low end) to the hinge plates (high end); beak: green 3023 ×2 + 15068 on the snout's front studs (SNOT); dark green 4032 + white 87747 nose horn; green 15068 | neck: LBG 14704 side socket at the rear top on the body's front 14417 (3 DOF); offers DBG 30383 ×2 (single finger on top) for the frill |
| frill | 40–45 | 15 | 6 × 2 core, 12 wide with the wings, 3–4 deep | tan 3795 2×6; tan 60897 ×2 (horn clips); green 41770 / 41769 side wings; green 30357 ×2 on top (rounded rim); white 15208 ×4 spikes (2 on the rim, 1 under each wing); white 40379 ×2 brow horns in the clips | DBG 44302 ×2 (two fingers on end) round the head's 30383 fingers: locking click hinge (pitch) |

### The DNA

```
archetype: ceratopsian quadruped, level: creator (110 pcs, 47 steps)
core: body = tan belly 2×4 + inverted slopes all round (forward, both sides, back) + 6-wide round deck + tan spine + curved 6×4 shell
interfaces on core: ball forward-low (head), technic ball ×2 front sides (front legs), 10.2 mm balls ×2 at the back (rear legs), ball rear-top (tail)
modules:
  head  plug: side socket on the neck ball   body: plate stack, SNOT snout + beak, eyes on half pins, wheel-arch brow, nose horn
    frill plug: locking click hinge (2-finger plates on the head's 1-finger plates)   body: 2×6 + round corners + wedge wings, rim spikes, 2 horns in clips
  front leg ×2 (mirror)  plug: 92013 socket on the 53585 ball   body: wedge / 2×2 brick / wedge slab, studs out
  rear leg ×2 (mirror)   plug: 92013 socket on the 17114 ball   body: 2×3 plate / 1×2 brick / wedge slab, studs out
  tail ×2 (chain)        plug: side socket / end socket          body: plates + curved 4×1 ×2, then a 1×1 + curved 2×1 tip
pose (P in the script): head about level (Rz −6°); frill leaning back 45° from the head so the horns rise; tail lifted 14° then 10°;
      front legs straight down (3°), rear legs raked back 15°
colours: green top, legs, frill · dark green stripes, brow arch, sockets, rear-leg wedges · tan belly, spine, snout, frill core ·
         DBG balls, hinges, eye plates · LBG sockets, half pins · white horns and spikes · dark red mouth roof · trans-orange eyes and studs · red axles
```

### Build order (booklet)

1–3 belly plate and its inverted slopes · 4–5 round deck, dark green 1×2 at the front · 6 tan spine, front slope ·
7–8 hip brick, side slopes, tail ball · 9 shoulder balls · 10–11 shoulder plates, cheese slopes, 1×4 spine bricks ·
12–13 neck ball, curved shell, curved 2×2 · 14–18 tail 1 · 19–20 tail tip, tail on · 21–22 rear legs · 23–24 front legs ·
25–39 head (base upside down first: teeth, tan 1×4s; then upright) · 40–45 frill (spikes added upside down) · 46 frill on the head · 47 head on the body.

### Still approximate

- Body step 13: the curved 2×2 over the neck ball sits on a single 1×2 (INF from the drawing; it hangs one stud forward).
- Tail 1: the two curved 4×1s hold only on the front socket plate; the drawing shows them flat over the lower plates behind (INF).
- Head: the second green 1×2 of step 36 is stacked on the first on the snout front (the callout says 2×, the drawing shows one plate).
- Frill wings: wedge handedness (41769 / 41770) and which edge is cut follow the step 42 picture loosely.
- The pose angles are read off the final step picture, not measured.

## Pterodactyl (6437440)

Script: scripts/rebuild-31058-ptero.mjs → data/golden/31058-ptero.ldr. 101 parts, the same as the booklet's callouts added up step by step (the booklet has no parts list). Frame: −X is the head, +Z is the left wing. INF marks something inferred from the drawings.

| module | steps | size (studs L × W, plates H) | core | joint to its neighbour |
|---|---|---|---|---|
| body | 1–12 | 9 × 6 (belly) / 4 (back) × 11 | tan 3795 2×6 laid across; tan 3660 overhanging back; green 3003 + 2× 3004; green 3020 across; dark green 43722/43723 wedge pair (a triangle pointing back); tan 3020 forward under the 3003's overhang; tan 3747b chest; 2× dark green 3010; green 3023, dark green 4032; 2× dark red 3023 saddle; green 15068; green 43712 back shell | offers: DBG 14417 tail ball (on the 3660 overhang, pointing back); DBG 14417 neck ball (on the 3747b overhang, pointing forward); DBG 17114, two 10.2 mm balls across (wings); 2× DBG 85943 with red 32062 + black 53585 balls between the beams, rear row (feet) |
| head | 20–29 | 9 × 1 × 8 | tan 3710 ×2 (jaw, beak); dark green 3023 ×2; dark tan 52107 skull brick: trans-orange 6141 eyes + green 54200 cheeks on its side studs; green 3023 ×3, 3024; green 11153 beak top; green 11153 crest + 11477 crest end | LBG 14418 end socket on the neck ball (3 DOF) |
| tail | 13 | 4 × 1 | green 3024, green 11153 (high end at the body) | LBG 14418 end socket on the tail ball (3 DOF) |
| wing root ×2 | 16 | 3 out × 6 along the body × 5 | tan 3021; dark green 3023 ×2 around LBG 14704; 2× green 30357 forming a half-disc rounded at the outer end; tan 2431 stripe | dark green 92013 socket on a 17114 ball (3 DOF); offers the 14704 side socket at its outer end |
| mid wing ×2 | 17 | 4 out × 4 × 3 | green 3020; 2× white 15208 teeth under the edges; green 41769 + 41770 back to back (a triangle pointing out) | DBG 14417 ball in the root's 14704 (3 DOF); offers an LBG 11476 clip at the outer end |
| wing tip ×2 | 18, 19 | 4 × 2 | green 41769 (left) / 41770 (right) on dark green 60478 | the 60478 handle in the mid wing's 11476 clip (1 DOF) |
| foot ×2 | 14, 15 (mirrored) | 2 × 2 × 6 | green 3022, dark green 3023, dark green 92013, tan 11477 heel; 2× black 4081b rings, each with a black 87747 long claw forward and a black 53451 short claw back (INF: which side each short claw goes in) | 92013 socket on the 85943's 53585 ball (3 DOF) |

Build order (booklet): body 1–12 → tail 13 → feet 14, 15 → wing roots 16 (×2, onto the hub balls) → mid wings 17 (×2) → tips 18, 19 → head 20–29 → head onto the neck ball (step 30).

Pose (`P` in the script, the booklet's final step 30): head level; tail lifted 12°; wings spread nearly flat, root dihedral 10° up, mid wing swept back 15° and 8° up, tips swept back 25°; feet hanging back and down 55°. The box photo shows the wings raised further into a V for flight; that pose is a matter of joint angles only.

Colours: Green 2, Dark Green 288, Tan 19, Dark Tan 28 (52107), DBG 72, LBG 71 (14418 ×2, 14704 ×2, 11476 ×2), Black 0 (claws, 4081b, 53585), White 15 (15208), Dark Red 320, Trans-Orange 57 (6141 eyes), Red 4 (32062).

Approximate (INF): the 11153s are curved bricks seated on one stud each and float a plate or two over the lower steps behind them, the same as in the drawings. Wedge handedness on the 43722/43723 pair and on the mid wings was chosen to give the triangles in the drawings. The teeth of the two 15208s per mid wing point to the leading and trailing edges. Each foot's 4081b rings point outward. The joint angles were read by eye from the step-30 page.
