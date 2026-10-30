import { PARTS } from "./parts";
import { dims, gridOf, studsOf, type PlacedBrick } from "./grid";
import { worldCenter } from "./pose";
import { PLATE_H } from "./units";
import { analyzeStability } from "./stability";

// Building instructions, planned from the structure itself:
//
//  • Order: a part becomes placeable once it touches the baseplate or clicks
//    onto a part already placed (through studs, either way). So every
//    intermediate model is one connected piece — nothing to hold in the air.
//  • Steps: from the placeable set, start at the lowest part (nearest the last
//    step when tied) and add placeable parts on the same level within reach,
//    a few per step (more for bigger models), so each step is one area.
//  • Camera: each step looks at its new parts from the side they face
//    outward, blended with a default ¾ view so the model doesn't spin around.
//  • Checks: the partial model is load-tested after every step; a step that
//    leaves a weak overhang gets a "hold this" note until it's tied in.
//  • Sub-assemblies: composite parts (eye blocks, teeth, wheels, people) get
//    their own page listing what they're made of, before the step that uses them.
//  • Chapters: designs from the Assembly Grammar tag every part with its module
//    (Axles, Chassis, Cockpit…); steps follow the modules in order, deferring a
//    part only when it can't be attached yet.

export interface StepPart {
  index: number; // into bricks
  partId: string;
  color: number;
}

export interface SubAssembly {
  partId: string;
  color: number;
  count: number;
  components: { partId: string; color: number }[];
}

export interface Step {
  /** The module this step builds (chapter), when the design has modules. */
  chapter: string;
  parts: StepPart[];
  subassemblies: SubAssembly[];
  center: [number, number, number]; // studs (x, z), plates (y)
  azimuth: number; // radians, camera direction around the model
  layer: number; // plates above the baseplate
  warn?: string;
  /** How to put it on: "click the tail onto the body's ball joint". */
  tip?: string;
  seconds: number;
}

export interface Instructions {
  bricks: PlacedBrick[];
  steps: Step[];
  chapters: { name: string; first: number; steps: number }[];
  modelCenter: [number, number, number];
  radius: number;
}

const DEFAULT_AZIMUTH = Math.atan2(1, 0.75); // front-right, matches the editor's view
/** Most pieces a step adds (a few more only when they're the same part). */
const STEP_MAX = 4;

function componentsOf(partId: string, color: number) {
  const part = PARTS[partId];
  return (part?.components ?? []).map((line) => {
    const t = line.trim().split(/\s+/);
    const id = t.slice(14).join(" ").replace(/\.dat$/i, "");
    return { partId: id, color: t[1] === "16" ? color : Number(t[1]) };
  });
}

/** `groups`: the order to build in (brick indices a step), e.g. from the assembly planner (scene/planSteps.ts). */
export function planInstructions(bricks: PlacedBrick[], groups?: number[][]): Instructions {
  const n = bricks.length;
  const per = n < 40 ? 2 : n < 120 ? 3 : STEP_MAX;

  // Cells → part, then stud links (both directions) and ground contact.
  const geo = bricks.map((b) => ({ ...dims(b), studs: studsOf(b) }));
  // Cells are per grid: the baseplate's, or a posed segment's (a tilted tail).
  const cell = new Map<string, number>();
  bricks.forEach((b, i) => {
    const g = geo[i];
    for (let x = 0; x < g.w; x++) for (let z = 0; z < g.d; z++) for (let y = 0; y < g.h; y++) cell.set(`${gridOf(b)}|${b.x + x},${b.y + y},${b.z + z}`, i);
  });
  const links = bricks.map(() => new Set<number>());
  bricks.forEach((b, i) => {
    const g = geo[i];
    for (let x = 0; x < g.w; x++)
      for (let z = 0; z < g.d; z++) {
        if (!g.studs.has(`${x},${z}`)) continue;
        const above = cell.get(`${gridOf(b)}|${b.x + x},${b.y + g.h},${b.z + z}`);
        if (above !== undefined && above !== i) {
          links[i].add(above);
          links[above].add(i);
        }
      }
  });

  // A ball joint clicks its two halves together.
  const byJoint = new Map<string, number[]>();
  bricks.forEach((b, i) => b.joints?.forEach((j) => byJoint.set(j, [...(byJoint.get(j) ?? []), i])));
  for (const ends of byJoint.values()) for (const i of ends) for (const j of ends) if (i !== j) links[i].add(j);

  // Centres in world space (studs; y in plates), so posed parts count where they show.
  const mid = bricks.map((b, i): [number, number, number] => {
    if (!b.pose && !b.place) return [b.x + geo[i].w / 2, b.y + geo[i].h / 2, b.z + geo[i].d / 2];
    const [x, y, z] = worldCenter(b);
    return [x, y / PLATE_H, z];
  });
  // Height used for ordering: posed parts by where they are, rounded to plates.
  const level = (i: number) => (bricks[i].pose || bricks[i].place ? Math.round(mid[i][1] - geo[i].h / 2) : bricks[i].y);
  const center = (idx: number[]): [number, number, number] => {
    const c = [0, 0, 0];
    for (const i of idx) for (let k = 0; k < 3; k++) c[k] += mid[i][k];
    return c.map((v) => v / Math.max(idx.length, 1)) as [number, number, number];
  };
  const all = bricks.map((_, i) => i);
  const modelCenter = center(all);
  let radius = 4;
  for (const i of all)
    radius = Math.max(radius, Math.hypot(mid[i][0] - modelCenter[0], (mid[i][1] + geo[i].h / 2 - modelCenter[1]) * 0.4, mid[i][2] - modelCenter[2]));

  const placed = new Set<number>();
  // Posed sections (a tail, a leg) are built in the hand as sub-assemblies:
  // one may start from its lowest part, then grows by what clicks onto it.
  const lowest = new Map<number, number>();
  bricks.forEach((b, i) => {
    if ((b.seg ?? 0) <= 0) return;
    const k = lowest.get(b.seg!);
    if (k === undefined || b.y < bricks[k].y) lowest.set(b.seg!, i);
  });
  const started = new Set<number>();
  const placeable = (i: number) =>
    (bricks[i].y === 0 && !bricks[i].seg) ||
    [...links[i]].some((j) => placed.has(j)) ||
    ((bricks[i].seg ?? 0) > 0 && !started.has(bricks[i].seg!) && lowest.get(bricks[i].seg!) === i);
  // Chapters in the order modules were designed.
  const groupOf = (i: number) => (bricks[i] as PlacedBrick & { group?: string }).group ?? "Build";
  const chapterNames: string[] = [];
  for (let i = 0; i < n; i++) if (!chapterNames.includes(groupOf(i))) chapterNames.push(groupOf(i));
  const rank = new Map(chapterNames.map((c, k) => [c, k]));
  let chapter = 0;
  const steps: Step[] = [];
  const seenSub = new Set<string>();
  let last = modelCenter;

  // An imported model with its designer's steps (LDraw STEP lines) is built
  // in exactly those steps, as in the booklet.
  let official: number[][] | null = null;
  if (groups) official = groups; // already booklet-sized by the planner (a layer or an area, up to 12)
  else if (n > 0 && bricks.every((b) => b.step !== undefined)) {
    const by = new Map<number, number[]>();
    for (const i of all) by.set(bricks[i].step!, [...(by.get(bricks[i].step!) ?? []), i]);
    // A designer's step can add 20 parts at once; a booklet shows a handful.
    // Split big steps: bottom first, then near the last part, identical parts together.
    official = [...by].sort((a, b) => a[0] - b[0]).flatMap(([, g]) => splitStep(g));
  }

  function splitStep(g: number[]): number[][] {
    if (g.length <= STEP_MAX) return [g];
    const left = [...g].sort((a, b) => level(a) - level(b));
    const out: number[][] = [];
    while (left.length) {
      const first = left.shift()!;
      const chunk = [first];
      // Same part, same colour first (four tiles go on together), then the nearest.
      left.sort((a, b) => {
        const same = (i: number) => (bricks[i].partId === bricks[first].partId && bricks[i].color === bricks[first].color ? 0 : 1);
        const d = (i: number) => Math.hypot(mid[i][0] - mid[first][0], (mid[i][1] - mid[first][1]) * 0.4, mid[i][2] - mid[first][2]);
        return same(a) - same(b) || level(a) - level(b) || d(a) - d(b);
      });
      while (chunk.length < STEP_MAX && left.length && level(left[0]) - level(first) <= 3) chunk.push(left.shift()!);
      out.push(chunk);
    }
    return out;
  }

  while (placed.size < n) {
    let seed: number, group: number[];
    if (official) {
      group = official[steps.length];
      seed = group[0];
    } else {
      // Current chapter (and leftovers of earlier ones) first; move on when it's done or blocked.
      let frontier = all.filter((i) => !placed.has(i) && placeable(i) && rank.get(groupOf(i))! <= chapter);
      while (!frontier.length && chapter < chapterNames.length - 1) {
        chapter++;
        frontier = all.filter((i) => !placed.has(i) && placeable(i) && rank.get(groupOf(i))! <= chapter);
      }
      if (!frontier.length) frontier = all.filter((i) => !placed.has(i) && placeable(i));
      // Disconnected leftovers (shouldn't happen for generated designs): place them anyway, lowest first.
      if (!frontier.length) frontier = all.filter((i) => !placed.has(i));
      const dist = (i: number, c: number[]) => Math.hypot(mid[i][0] - c[0], mid[i][2] - c[2]);
      // Earlier chapters' leftovers first, then lowest, then nearest the last step.
      frontier.sort((a, b) => rank.get(groupOf(a))! - rank.get(groupOf(b))! || level(a) - level(b) || dist(a, last) - dist(b, last));
      seed = frontier[0];
      group = [seed];
      const sameLevel = frontier
        .filter((i) => i !== seed && level(i) === level(seed) && gridOf(bricks[i]) === gridOf(bricks[seed]) && groupOf(i) === groupOf(seed))
        .sort((a, b) => dist(a, center([seed])) - dist(b, center([seed])));
      for (const i of sameLevel) {
        if (group.length >= per) break;
        if (dist(i, center(group)) > 7) break;
        group.push(i);
      }
    }
    group.forEach((i) => {
      placed.add(i);
      if ((bricks[i].seg ?? 0) > 0) started.add(bricks[i].seg!);
    });
    // A joint completed by this step: say what clicks onto what.
    let tip: string | undefined;
    for (const i of group)
      for (const j of bricks[i].joints ?? [])
        for (const k of byJoint.get(j) ?? [])
          if (k !== i && placed.has(k) && gridOf(bricks[k]) !== gridOf(bricks[i]) && !tip) {
            const [a, b] = [groupOf(i), groupOf(k)].map((g) => g.toLowerCase());
            tip = a === b ? `Click the ball into the socket — the ${a} bends here.` : `Click the ${a} onto the ${b}'s ball joint.`;
          }

    const c = center(group);
    const out = Math.hypot(c[0] - modelCenter[0], c[2] - modelCenter[2]);
    const outward = Math.atan2(c[2] - modelCenter[2], c[0] - modelCenter[0]);
    // Blend the outward direction with the default ¾ view (shortest way round).
    let delta = outward - DEFAULT_AZIMUTH;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const azimuth = out < 1.5 ? DEFAULT_AZIMUTH : DEFAULT_AZIMUTH + delta * 0.55;

    const subs = new Map<string, SubAssembly>();
    for (const i of group) {
      const b = bricks[i];
      if (!PARTS[b.partId]?.components) continue;
      const key = `${b.partId}:${b.color}`;
      const s = subs.get(key);
      if (s) s.count++;
      else subs.set(key, { partId: b.partId, color: b.color, count: 1, components: componentsOf(b.partId, b.color) });
    }
    // Only explain a sub-assembly the first time it appears.
    const fresh = [...subs.values()].filter((s) => !seenSub.has(`${s.partId}:${s.color}`));
    fresh.forEach((s) => seenSub.add(`${s.partId}:${s.color}`));

    steps.push({
      chapter: groupOf(seed),
      parts: group.map((i) => ({ index: i, partId: bricks[i].partId, color: bricks[i].color })),
      subassemblies: fresh,
      center: c,
      azimuth,
      layer: level(seed),
      tip,
      seconds: group.length * 8 + fresh.reduce((a, s) => a + s.count * s.components.length * 6, 0),
    });
    last = c;
  }

  // Load-test each partial model; flag steps that leave a weak overhang.
  const order: number[] = [];
  steps.forEach((s) => {
    order.push(...s.parts.map((p) => p.index));
    const st = analyzeStability(order.map((i) => bricks[i]));
    if (st.worst > 1 && Number.isFinite(st.worst)) {
      const weakest = st.weak[0];
      const b = weakest ? bricks.find((x) => x.uid === weakest.a) : undefined;
      s.warn = `Hold ${b ? PARTS[b.partId].name : "the new part"} gently: it's carrying ${Math.round(st.worst * 100)}% of what its studs grip until a later step ties it in.`;
    }
  });

  // Chapter index: runs of consecutive steps with the same module.
  const chapters: Instructions["chapters"] = [];
  steps.forEach((s, k) => {
    const last = chapters[chapters.length - 1];
    if (last && last.name === s.chapter) last.steps++;
    else chapters.push({ name: s.chapter, first: k, steps: 1 });
  });
  return { bricks, steps, chapters, modelCenter, radius };
}
