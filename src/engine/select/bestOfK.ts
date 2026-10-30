// Best-of-K (Blox-Net, docs/research/papers-2026-10.md §1): build the target a
// few ways and keep the best build. "Best" may only use what is known at build
// time — the target and our own build — never a designer's: fit to the target,
// how much of the build holds together, repeats, and pieces relative to the
// leanest candidate. Measured with scripts/c5-bestofk.mjs (docs/engine/c5-best-of-k.md).

import type { SculptOptions } from "../sculpt";

/** One way to build. `shell` puts the interior fill (shell.ts) in first. */
export type Variant = { name: string; opts: Partial<SculptOptions>; shell?: boolean };

/** The pool that was measured: the app default (S8) and three settings each better on some targets. */
export const VARIANTS: Variant[] = [
  { name: "default", opts: {} },
  { name: "float", opts: { NO_FLOAT: false } },
  { name: "minfill85", opts: { NO_FLOAT: false, MIN_FILL: 0.85 } },
  { name: "shell", opts: { NO_FLOAT: false }, shell: true },
];

/** What the selector reads from a candidate build. pieces = parts + 2 per made part (made parts count as 3). */
export type Candidate = { fit: number; held: number; repeats: number; pieces: number };

/** Economy exponent: tied with ½ on the gate models, better on the held-out set (see the doc). */
const ECON = 1;

/** Index of the best candidate; ties keep the earlier one (the default first). */
export function pickBest(cands: Candidate[]): number {
  const lean = Math.min(...cands.map((c) => c.pieces));
  let best = 0, bestS = -Infinity;
  cands.forEach((c, i) => {
    const s = c.fit * c.held * (1 - c.repeats) * (lean / Math.max(1, c.pieces)) ** ECON;
    if (s > bestS) [best, bestS] = [i, s];
  });
  return best;
}
