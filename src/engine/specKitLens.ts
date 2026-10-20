// ── SpecKit Lens (Optimistic / O) ────────────────────────────────────────────
// Approximates pi-estimation-api/manifest.md "SpecKit Bottom-Up" method
// without an LLM: sums real sub-task SP if available (ground truth),
// otherwise proxies from acceptance-criteria count with a tier floor.

import { thresholds } from '../config/index.js';
import type { EffortTier, IssueSignals, PertLensResult } from './types.js';

export function specKitLens(issue: IssueSignals, effortTier: EffortTier): PertLensResult {
  if (issue.subtaskEstimatesSp.length > 0) {
    const sum = Math.round(issue.subtaskEstimatesSp.reduce((a, b) => a + b, 0) * 10) / 10;
    return {
      value: sum,
      rationale: [
        `Summed ${issue.subtaskEstimatesSp.length} sub-task SP estimate(s): [${issue.subtaskEstimatesSp.join(', ')}] = ${sum} SP`,
      ],
    };
  }

  const { perAcSp, tierFloorSp } = thresholds.specKitLens;
  const acCount = issue.acceptanceCriteria.length;
  const proxy = acCount * perAcSp;
  const floor = tierFloorSp[effortTier] ?? 1;
  const value = Math.round(Math.max(proxy, floor) * 10) / 10;

  return {
    value,
    rationale: [
      `No sub-task estimates found — proxying from AC count: ${acCount} ACs × ${perAcSp} SP = ${Math.round(proxy * 10) / 10} SP`,
      `Applied ${effortTier}-tier floor of ${floor} SP: max(${Math.round(proxy * 10) / 10}, ${floor}) = ${value} SP`,
    ],
  };
}
