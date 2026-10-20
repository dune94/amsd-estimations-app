// ── Baseline evidence ──────────────────────────────────────────────────────
// What the delivered, measured baseline stories say about an estimate: how many sit at the same Scope / Complexity /
// Risk levels, what they actually came to, and which are closest by blast radius. Pure functions; no I/O.

import type { BaselineStory } from '../config/index.js';

export interface Analogue { key: string; sp: number; blastRadius: number }
export interface BaselineEvidence { support: number; observedSp: number[]; medianObservedSp: number | null; closest: Analogue[] }
export interface Levels { scope: string; complexity: string; risk: string; blastRadius: number }

/** Index of the band nearest to a value; a value exactly between two bands goes to the higher one. */
function nearestBand(value: number, bands: number[]): number {
  let best = 0; let bestGap = Infinity;
  bands.forEach((b, i) => {
    const gap = Math.abs(value - b);
    if (gap <= bestGap) { best = i; bestGap = gap; }
  });
  return best;
}

export function bandDistance(a: number, b: number, bands: number[]): number {
  return Math.abs(nearestBand(a, bands) - nearestBand(b, bands));
}

export function baselineEvidence(levels: Levels, baselines: BaselineStory[], k: number): BaselineEvidence {
  const measured = baselines.filter(b => b.measured);
  const same = measured.filter(b => b.measured!.scope === levels.scope && b.measured!.complexity === levels.complexity && b.measured!.risk === levels.risk);
  const observedSp = same.map(b => b.sp);
  const sorted = [...observedSp].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const medianObservedSp = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const closest = [...measured]
    .sort((x, y) => Math.abs(x.measured!.blastRadius - levels.blastRadius) - Math.abs(y.measured!.blastRadius - levels.blastRadius) || x.key.localeCompare(y.key))
    .slice(0, k)
    .map(b => ({ key: b.key, sp: b.sp, blastRadius: b.measured!.blastRadius }));
  return { support: same.length, observedSp, medianObservedSp, closest };
}
