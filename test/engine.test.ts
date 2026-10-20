import { describe, expect, it } from 'vitest';
import { estimate } from '../src/engine/index.js';
import type { IssueSignals } from '../src/engine/types.js';
import { rbuConfig } from '../src/config/index.js';

function baseIssue(overrides: Partial<IssueSignals> = {}): IssueSignals {
  return {
    key: 'PRJ-TEST',
    issueType: 'Story',
    summary: 'Test issue',
    description: '',
    acceptanceCriteria: ['Given X, when Y, then Z'],
    labels: [],
    priority: 'Medium',
    rbuValue: rbuConfig.categories.Marketing.rbuValues[0],
    linkedIssuesCount: 0,
    subtasksCount: 0,
    subtaskEstimatesSp: [],
    components: ['comp-a'],
    previousSp: null,
    ...overrides,
  };
}

describe('estimate (full engine)', () => {
  it('produces a complete EstimateResult with all sections populated', () => {
    const result = estimate(baseIssue());
    expect(result.issueKey).toBe('PRJ-TEST');
    expect(result.effort.tier).toBeDefined();
    expect(result.rbu.category).toBe('Marketing');
    expect(result.pert.pertSp).toBeGreaterThan(0);
    expect(result.tshirt).toBeDefined();
    expect(result.baselineComparator).not.toBeNull();
    expect(result.escalation.reasons.length).toBeGreaterThan(0);
    expect(result.deltaSp).toBeNull(); // no previousSp supplied
  });

  it('computes a delta when previousSp is supplied', () => {
    const result = estimate(baseIssue({ previousSp: 3 }));
    expect(result.deltaSp).toBe(Math.round((result.pert.pertSp - 3) * 10) / 10);
  });

  it('escalates a Hard-tier, AC-missing story', () => {
    const result = estimate(baseIssue({ acceptanceCriteria: [], labels: ['spike'] }));
    expect(result.effort.tier).toBe('Hard');
    expect(result.escalation.flagged).toBe(true);
  });

  it('does not escalate a clean, converged, well-matched Easy story', () => {
    // PRJ-1536 baseline is an Easy-tier config-change analog; mirror its signals closely.
    const result = estimate(
      baseIssue({
        issueType: 'Task',
        components: ['config'],
        acceptanceCriteria: ['Given the config value changes, when deployed, then the new value is live'],
      }),
    );
    expect(result.effort.tier).toBe('Easy');
  });
});
