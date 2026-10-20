// ── Brownfield Risk Lens (Pessimistic / P) ──────────────────────────────────
// Approximates pi-estimation-api/manifest.md "Brownfield Risk" method without
// an LLM: derives worst-case SP from the effort tier plus any matched
// brownfield-risk labels (legacy/tech-debt/deprecated/brownfield).

import { classificationSignals, thresholds } from '../config/index.js';
import type { EffortTier, IssueSignals, PertLensResult } from './types.js';

function hasAnyLabel(labels: string[], keywords: string[]): string[] {
  const lower = labels.map(l => l.toLowerCase());
  return keywords.filter(k => lower.includes(k.toLowerCase()));
}

export function brownfieldRiskLens(
  issue: IssueSignals,
  effortTier: EffortTier,
  mostLikelySp: number,
): PertLensResult {
  const multiplier = thresholds.brownfieldLens.pessimisticMultiplierByTier[effortTier] ?? 1.5;
  const riskLabelMatches = hasAnyLabel(issue.labels, classificationSignals.brownfieldRiskLabels);
  const riskDelta = riskLabelMatches.length * thresholds.brownfieldLens.brownfieldLabelRiskDeltaSp;

  const value = Math.round((mostLikelySp * multiplier + riskDelta) * 10) / 10;

  const rationale = [
    `Base worst-case: ${mostLikelySp} SP × ${multiplier} (${effortTier} tier multiplier) = ${Math.round(mostLikelySp * multiplier * 10) / 10} SP`,
  ];
  if (riskLabelMatches.length > 0) {
    rationale.push(
      `+${riskDelta} SP for ${riskLabelMatches.length} brownfield-risk label(s): ${riskLabelMatches.join(', ')}`,
    );
  } else {
    rationale.push('No brownfield-risk labels matched — no additional risk delta applied');
  }

  return { value, rationale };
}
