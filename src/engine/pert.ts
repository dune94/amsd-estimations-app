// ── PERT combiner ────────────────────────────────────────────────────────────
// Combines the three deterministic lenses into a PERT estimate, per
// pi-estimation-api/manifest.md "PERT Formula & Convergence Rule".

import { thresholds, tshirtScale } from '../config/index.js';
import { brownfieldRiskLens } from './brownfieldLens.js';
import { openSpecLens } from './openSpecLens.js';
import { specKitLens } from './specKitLens.js';
import type { EffortTier, IssueSignals, PertResult } from './types.js';

export function computePert(issue: IssueSignals, effortTier: EffortTier): PertResult {
  const mostLikely = openSpecLens(issue, effortTier);
  const optimistic = specKitLens(issue, effortTier);
  const pessimistic = brownfieldRiskLens(issue, effortTier, mostLikely.value);

  const O = optimistic.value;
  const M = mostLikely.value;
  const P = pessimistic.value;

  const pertSp = Math.round(((O + 4 * M + P) / 6) * 10) / 10;
  const sd = Math.round(((P - O) / 6) * 10) / 10;
  const ci68: [number, number] = [
    Math.max(0, Math.round((pertSp - sd) * 10) / 10),
    Math.round((pertSp + sd) * 10) / 10,
  ];
  const ci95: [number, number] = [
    Math.max(0, Math.round((pertSp - 2 * sd) * 10) / 10),
    Math.round((pertSp + 2 * sd) * 10) / 10,
  ];

  const maxOM = Math.max(O, M) || 1; // avoid divide-by-zero
  const gapPct = Math.round((Math.abs(M - O) / maxOM) * 1000) / 10;
  const converged = gapPct <= thresholds.convergenceGapThresholdPct;

  return {
    optimistic,
    mostLikely,
    pessimistic,
    pertSp,
    sd,
    ci68,
    ci95,
    convergence: { converged, gapPct, basis: 'openspec-vs-speckit' },
  };
}

export function spToTshirt(sp: number): string {
  for (const entry of tshirtScale) {
    if (sp >= entry.minSp && sp <= entry.maxSp) return entry.tshirt;
  }
  // Above the top of the scale — return the largest tier rather than throw.
  return tshirtScale[tshirtScale.length - 1].tshirt;
}
