// ── OpenSpec Lens (Most Likely / M) ──────────────────────────────────────────
// Top-down, product-lens analogy sizing: nearest-neighbor comparison against
// the baseline calibration set, scaled by effort-tier distance.
// Approximates pi-estimation-api/manifest.md "OpenSpec Top-Down" method
// without an LLM.

import { baselineStories, classificationSignals, thresholds } from '../config/index.js';
import type { BaselineComparator, EffortTier, IssueSignals, PertLensResult } from './types.js';

const TIER_INDEX: Record<EffortTier, number> = { Easy: 0, Medium: 1, Hard: 2 };

function tshirtToTier(tshirt: string): EffortTier {
  if (tshirt === 'XS' || tshirt === 'S') return 'Easy';
  if (tshirt === 'M') return 'Medium';
  return 'Hard'; // L, XL
}

function hasAnyLabel(labels: string[], keywords: string[]): boolean {
  const lower = labels.map(l => l.toLowerCase());
  return keywords.some(k => lower.includes(k.toLowerCase()));
}

function deriveIssueComparableSignals(issue: IssueSignals) {
  return {
    issueType: issue.issueType,
    externalDependency: hasAnyLabel(issue.labels, classificationSignals.externalDependencyLabels),
    filesImpacted: issue.components.length,
    newComponent: hasAnyLabel(issue.labels, classificationSignals.newServiceLabels),
  };
}

function similarityScore(
  a: ReturnType<typeof deriveIssueComparableSignals>,
  b: (typeof baselineStories)[number]['signals'],
): number {
  let score = 1.0;
  if (a.issueType.toLowerCase() !== b.issueType.toLowerCase()) score -= 0.2;
  if (a.externalDependency !== b.externalDependency) score -= 0.3;
  if (a.newComponent !== b.newComponent) score -= 0.3;
  score -= Math.min(0.2, Math.abs(a.filesImpacted - b.filesImpacted) * 0.05);
  return Math.max(0, score);
}

export function findBaselineComparator(issue: IssueSignals): BaselineComparator | null {
  const signals = deriveIssueComparableSignals(issue);
  let best: BaselineComparator | null = null;

  for (const story of baselineStories) {
    const score = similarityScore(signals, story.signals);
    if (!best || score > best.similarityScore) {
      best = { key: story.key, sp: story.sp, description: story.description, similarityScore: score };
    }
  }

  return best;
}

export function openSpecLens(issue: IssueSignals, effortTier: EffortTier): PertLensResult {
  const comparator = findBaselineComparator(issue);

  if (!comparator) {
    // Should not happen with a non-empty baseline set, but fail safe.
    return { value: 0, rationale: ['No baseline comparator available — OpenSpec lens could not be computed'] };
  }

  const baselineStory = baselineStories.find(s => s.key === comparator.key)!;
  const baselineTier = tshirtToTier(baselineStory.tshirt);
  const tierStepDiff = TIER_INDEX[effortTier] - TIER_INDEX[baselineTier];
  const scalingFactor = Math.pow(thresholds.openSpecLens.tierScalingFactorPerStep, tierStepDiff);
  const value = Math.round(comparator.sp * scalingFactor * 10) / 10;

  return {
    value,
    rationale: [
      `Closest baseline: ${comparator.key} (${comparator.sp} SP, similarity ${(comparator.similarityScore * 100).toFixed(0)}%)`,
      `Baseline tier: ${baselineTier}, this issue's tier: ${effortTier} (${tierStepDiff >= 0 ? '+' : ''}${tierStepDiff} step(s))`,
      `Scaled: ${comparator.sp} × ${scalingFactor.toFixed(2)} = ${value} SP`,
    ],
  };
}
