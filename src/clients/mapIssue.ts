// ── Raw Jira issue -> engine IssueSignals mapper ────────────────────────────
// Applies the sp-field-priority fallback chain (harvested from
// the reporting scripts) to resolve previousSp.

import { spFieldPriority, tshirtToSp } from '../config/index.js';
import type { IssueSignals } from '../engine/types.js';
import { parseAcceptanceCriteria } from './acParser.js';
import type { RawJiraIssue } from './types.js';

function resolvePreviousSp(fields: RawJiraIssue['fields']): number | null {
  for (const entry of spFieldPriority) {
    switch (entry.priority) {
      case 1:
        // "PI-10 Plan page baseline" has no direct Jira field; not resolvable from a raw
        // issue alone. Skipped here — callers with baseline data should override previousSp.
        break;
      case 2:
        if (typeof fields.originalEstimateSp === 'number') return fields.originalEstimateSp;
        break;
      case 3:
        if (fields.tshirtSize && fields.tshirtSize in tshirtToSp) {
          return tshirtToSp[fields.tshirtSize];
        }
        break;
      case 4:
        if (typeof fields.storyPointsFallback === 'number') return fields.storyPointsFallback;
        break;
    }
  }
  return null;
}

export function mapJiraIssueToSignals(raw: RawJiraIssue): IssueSignals {
  const f = raw.fields;
  const descriptionText = f.descriptionText ?? '';

  return {
    key: raw.key,
    issueType: f.issuetype?.name ?? 'Story',
    summary: f.summary ?? '',
    description: descriptionText,
    acceptanceCriteria: parseAcceptanceCriteria(descriptionText),
    labels: f.labels ?? [],
    priority: f.priority?.name ?? 'Medium',
    rbuValue: f.rbu ?? null,
    linkedIssuesCount: f.linkedIssueKeys?.length ?? 0,
    subtasksCount: f.subtaskEstimatesSp?.length ?? 0,
    subtaskEstimatesSp: f.subtaskEstimatesSp ?? [],
    components: f.components ?? [],
    previousSp: resolvePreviousSp(f),
  };
}
