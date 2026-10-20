// ── Deterministic Effort Classifier ─────────────────────────────────────────
// Encodes the Easy/Medium/Hard rules from pi-estimation-api/manifest.md
// "Effort Classification" section. Pure function, no LLM, fully auditable.

import { classificationSignals, thresholds } from '../config/index.js';
import type { EffortClassification, IssueSignals } from './types.js';

function hasAnyLabel(labels: string[], keywords: string[]): string[] {
  const lower = labels.map(l => l.toLowerCase());
  return keywords.filter(k => lower.includes(k.toLowerCase()));
}

function isAcAmbiguous(acceptanceCriteria: string[]): boolean {
  const vague = thresholds.escalation.acAmbiguityVagueTerms.map(t => t.toLowerCase());
  const text = acceptanceCriteria.join(' ').toLowerCase();
  return vague.some(term => text.includes(term));
}

export function classifyEffort(issue: IssueSignals): EffortClassification {
  const reasons: string[] = [];

  // 1. Start with ACs — missing ACs forces Hard pending draft ACs (manifest rule 1).
  const acStatus: EffortClassification['acStatus'] =
    issue.acceptanceCriteria.length === 0
      ? 'missing'
      : isAcAmbiguous(issue.acceptanceCriteria)
        ? 'ambiguous'
        : 'complete';

  if (acStatus === 'missing') {
    reasons.push('AC-INCOMPLETE: no acceptance criteria found — defaulting to Hard pending draft ACs');
    return { tier: 'Hard', acStatus, reasons };
  }

  // 2. Hard gates — any one of these forces Hard regardless of other signals.
  const spikeMatches = hasAnyLabel(issue.labels, classificationSignals.spikeLabels);
  if (spikeMatches.length > 0) {
    reasons.push(`Spike/POC label present: ${spikeMatches.join(', ')}`);
    return { tier: 'Hard', acStatus, reasons };
  }

  const newServiceMatches = hasAnyLabel(issue.labels, classificationSignals.newServiceLabels);
  if (newServiceMatches.length > 0) {
    reasons.push(`New service/package label present: ${newServiceMatches.join(', ')}`);
    return { tier: 'Hard', acStatus, reasons };
  }

  const crossTeamMatches = hasAnyLabel(issue.labels, classificationSignals.crossTeamLabels);
  if (crossTeamMatches.length > 0) {
    reasons.push(`Cross-team/third-party dependency label present: ${crossTeamMatches.join(', ')}`);
    return { tier: 'Hard', acStatus, reasons };
  }

  const noPriorExpMatches = hasAnyLabel(issue.labels, classificationSignals.noPriorExperienceLabels);
  if (noPriorExpMatches.length > 0) {
    reasons.push(`No-prior-experience label present: ${noPriorExpMatches.join(', ')}`);
    return { tier: 'Hard', acStatus, reasons };
  }

  if (issue.components.length >= 4) {
    reasons.push(`Impacts ${issue.components.length} components (>= 4 threshold) — Hard per file/component-count rule`);
    return { tier: 'Hard', acStatus, reasons };
  }

  // 3. Weighted scoring for Easy vs Medium ONLY (manifest rules 2-3). All real
  // Hard triggers are the explicit gates above — this section never escalates
  // to Hard on its own, since the manifest's Medium-tier conditions are
  // independent ORs, not signals that should stack into Hard.
  let score = 0;

  const externalDepMatches = hasAnyLabel(issue.labels, classificationSignals.externalDependencyLabels);
  if (externalDepMatches.length > 0) {
    score += 1;
    reasons.push(`Known external dependency label present: ${externalDepMatches.join(', ')} (at minimum Medium)`);
  }

  if (issue.components.length >= 2 && issue.components.length <= 3) {
    score += 1;
    reasons.push(`Impacts ${issue.components.length} components (2-3 range) — Medium signal`);
  }

  if (acStatus === 'ambiguous') {
    score += 1;
    reasons.push('Acceptance criteria present but contain vague/unmeasurable terms');
  }

  if (issue.linkedIssuesCount > 0) {
    score += 0.5;
    reasons.push(`${issue.linkedIssuesCount} linked issue(s) — moderate integration signal`);
  }

  const tier: EffortClassification['tier'] = score >= 1 ? 'Medium' : 'Easy';

  if (reasons.length === 0) {
    reasons.push('No Medium/Hard signals detected — clear scope, no external deps, single-component impact');
  }

  return { tier, acStatus, reasons };
}
