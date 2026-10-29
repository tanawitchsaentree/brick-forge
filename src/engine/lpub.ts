import type { Instructions } from "./instructions";
import { partLines, withMadeParts } from "./ldraw";

// The instruction plan as an LPub3D book (trevorsandy/lpub3d). LPub3D lays out
// pages but leaves the structure to the author: where a step ends, what is a
// sub-assembly. The planner has already decided all of that, so it's written
// out in LPub3D's own meta commands (checked against its source, mainApp/meta.cpp
// and builds/check/build_checks.mpd):
//
//   0 STEP                               one step, as planned (same parts, same order)
//   0 FILE section-n.ldr … 0 NOFILE      a section built in the hand (a tail, a leg)
//   0 !LPUB CALLOUT BEGIN / END          …shown as a callout at the step it goes on
//   0 !LPUB FADE_STEPS / HIGHLIGHT_STEP  earlier steps faded, new parts highlighted
//   0 !LPUB INSERT MODEL / BOM           the finished model and the parts list at the end
//
// Parts keep their exact placements (posed sections included), so the book
// shows the same model the app built. Nothing of LPub3D's code is used, only
// its file format.

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model";

export function toLPub(plan: Instructions, title: string): string {
  const name = slug(title);
  const main: string[] = [
    `0 FILE ${name}.ldr`,
    `0 ${title}`,
    `0 Name: ${name}.ldr`,
    "0 Author: Brick Forge",
    "0 !LPUB FADE_STEPS ENABLED GLOBAL TRUE",
    "0 !LPUB HIGHLIGHT_STEP ENABLED GLOBAL TRUE",
    "0 !LPUB SUBMODEL_DISPLAY SHOW GLOBAL TRUE",
  ];

  // Which steps build which section (seg > 0 is a posed section, built in the hand).
  const segOf = (i: number) => plan.bricks[i].seg ?? 0;
  const sections = new Map<number, string[]>(); // seg → its file's lines
  const lastStepOf = new Map<number, number>(); // seg → the step its last parts go in
  plan.steps.forEach((st, k) => st.parts.forEach((p) => segOf(p.index) > 0 && lastStepOf.set(segOf(p.index), k)));

  let chapter = "";
  plan.steps.forEach((st, k) => {
    if (st.chapter !== chapter) {
      chapter = st.chapter;
      main.push(`0 // ${chapter}`);
    }
    const here: string[] = [];
    const bySeg = new Map<number, string[]>();
    for (const p of st.parts) {
      const seg = segOf(p.index);
      const lines = partLines(plan.bricks[p.index]);
      if (seg > 0) bySeg.set(seg, [...(bySeg.get(seg) ?? []), ...lines]);
      else here.push(...lines);
    }
    // A section's own steps go in its file.
    for (const [seg, lines] of bySeg) {
      const file = sections.get(seg) ?? [];
      file.push(...lines, "0 STEP");
      sections.set(seg, file);
    }
    // The step a section is finished in, it joins the model: a callout of the whole section.
    const done = [...bySeg.keys()].filter((seg) => lastStepOf.get(seg) === k);
    for (const seg of done) {
      main.push(
        "0 !LPUB CALLOUT BEGIN",
        `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${name}-section-${seg}.ldr`, // placed by its parts (world coordinates)
        "0 !LPUB CALLOUT END",
      );
    }
    if (here.length || done.length) main.push(...here, "0 STEP");
  });

  main.push("0 !LPUB INSERT MODEL", "0 !LPUB INSERT PAGE", "0 STEP", "0 !LPUB INSERT BOM", "0 !LPUB INSERT PAGE", "0 STEP");

  const lines = [...main];
  for (const [seg, file] of sections) {
    const sub = `${name}-section-${seg}.ldr`;
    lines.push("0 NOFILE", `0 FILE ${sub}`, `0 ${title}, section ${seg}`, `0 Name: ${sub}`, "0 Author: Brick Forge", ...file);
  }
  lines.push("0 NOFILE");
  return withMadeParts(lines, plan.bricks, name);
}
