import { PARTS } from "./parts";
import type { Why } from "./grid";

/** A placement's reasons in words: the terms that decided it, biggest first. */
export function whyText(w: Why): string {
  if (w.role === "kept") return "the original designer's part, kept where it still fits";
  if (w.role === "made") return "made to measure: no real part fills this gap";
  const parts: string[] = [];
  const fill = w.cover + w.air ? Math.round((w.cover / (w.cover + w.air)) * 100) : 0;
  parts.push(`fills ${w.cover} cells of the shape (${fill}% of the part is on target)`);
  if (w.engaged) parts.push(`${w.engaged} stud${w.engaged === 1 ? "" : "s"} locked to parts already placed`);
  if (w.finish > 0) parts.push("studs where the design shows studs");
  if (w.finish < 0) parts.push("leaves studs on a smooth surface (penalised)");
  if (w.prior > 0) parts.push(`designers place it this way ×${Math.round(Math.expm1(w.prior / 3))}`);
  if (w.motif) parts.push(`technique: ${w.motif}`);
  if (w.repeat) parts.push("stacked on its twin (penalised)");
  if (Number.isFinite(w.margin) && w.runnerUp) parts.push(`beat ${PARTS[w.runnerUp]?.name ?? w.runnerUp} by ${w.margin.toFixed(2)}`);
  return parts.join(" · ");
}
