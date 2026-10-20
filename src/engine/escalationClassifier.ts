// ── Escalation Classifier ────────────────────────────────────────────────────
// Deterministic, rule-based only. Decides whether a story WOULD benefit from
// an LLM deep-dive, and always reports why (or why not) — but never calls an
// LLM itself. This is the non-LLM v1: escalation is surfaced as a flag +
// reasons for a human (or a future LLM-enabled path) to act on.

import { thresholds } from '../config/index.js';
import type { BaselineComparator, EffortClassification, EscalationResult, PertResult } from './types.js';

export function classifyEscalation(
  effort: EffortClassification,
  pert: PertResult,
  comparator: BaselineComparator | null,
): EscalationResult {
  const reasons: string[] = [];

  if (effort.acStatus === 'missing') {
    reasons.push('Acceptance criteria are missing — draft ACs required before a confident estimate');
  }
  if (effort.acStatus === 'ambiguous') {
    reasons.push('Acceptance criteria contain vague/unmeasurable terms');
  }

  if (!comparator || comparator.similarityScore < 0.5) {
    reasons.push(
      comparator
        ? `Best historical comparator (${comparator.key}) has low similarity (${(comparator.similarityScore * 100).toFixed(0)}%)`
        : 'No historical comparator found at all',
    );
  }

  if (!pert.convergence.converged) {
    reasons.push(
      `OpenSpec vs SpecKit lenses diverged by ${pert.convergence.gapPct}% (threshold ${thresholds.escalation.wideDivergenceThresholdPct}%)`,
    );
  }

  if (effort.tier === 'Hard' && (!comparator || comparator.similarityScore < 0.6)) {
    reasons.push('Hard-tier story with low-confidence brownfield/comparator signal');
  }

  return {
    flagged: reasons.length > 0,
    reasons: reasons.length > 0 ? reasons : ['Converged within threshold, AC complete, adequate historical comparator — no escalation needed'],
  };
}
