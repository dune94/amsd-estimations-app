// ── Engine orchestrator ──────────────────────────────────────────────────────
// Ties the effort classifier, RBU classifier, 3-lens PERT engine, and
// escalation classifier together into a single EstimateResult. Pure,
// deterministic, no I/O, no LLM.

import { classifyEffort } from './effortClassifier.js';
import { classifyEscalation } from './escalationClassifier.js';
import { findBaselineComparator } from './openSpecLens.js';
import { computePert, spToTshirt } from './pert.js';
import { classifyRbu } from './rbuClassifier.js';
import type { EstimateResult, IssueSignals } from './types.js';

export function estimate(issue: IssueSignals): EstimateResult {
  const effort = classifyEffort(issue);
  const rbu = classifyRbu(issue.rbuValue);
  const pert = computePert(issue, effort.tier);
  const comparator = findBaselineComparator(issue);
  const escalation = classifyEscalation(effort, pert, comparator);
  const tshirt = spToTshirt(pert.pertSp);

  const deltaSp = issue.previousSp !== null ? Math.round((pert.pertSp - issue.previousSp) * 10) / 10 : null;

  return {
    issueKey: issue.key,
    summary: issue.summary,
    issueType: issue.issueType,
    priority: issue.priority,
    effort,
    rbu,
    pert,
    tshirt,
    baselineComparator: comparator,
    escalation,
    previousSp: issue.previousSp,
    deltaSp,
    generatedAt: new Date().toISOString(),
  };
}

export * from './types.js';
