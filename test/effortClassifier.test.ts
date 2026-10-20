import { describe, expect, it } from 'vitest';
import { classifyEffort } from '../src/engine/effortClassifier.js';
import type { IssueSignals } from '../src/engine/types.js';

function baseIssue(overrides: Partial<IssueSignals> = {}): IssueSignals {
  return {
    key: 'TEST-1',
    issueType: 'Story',
    summary: 'Test issue',
    description: '',
    acceptanceCriteria: ['Given X, when Y, then Z'],
    labels: [],
    priority: 'Medium',
    rbuValue: null,
    linkedIssuesCount: 0,
    subtasksCount: 0,
    subtaskEstimatesSp: [],
    components: ['comp-a'],
    previousSp: null,
    ...overrides,
  };
}

describe('classifyEffort', () => {
  it('flags missing ACs as Hard with AC-INCOMPLETE reason', () => {
    const result = classifyEffort(baseIssue({ acceptanceCriteria: [] }));
    expect(result.tier).toBe('Hard');
    expect(result.acStatus).toBe('missing');
    expect(result.reasons.join(' ')).toContain('AC-INCOMPLETE');
  });

  it('classifies a clean single-component story as Easy', () => {
    const result = classifyEffort(baseIssue());
    expect(result.tier).toBe('Easy');
    expect(result.acStatus).toBe('complete');
  });

  it('forces Hard for a spike label regardless of other signals', () => {
    const result = classifyEffort(baseIssue({ labels: ['spike'] }));
    expect(result.tier).toBe('Hard');
  });

  it('forces Hard for a new-service label', () => {
    const result = classifyEffort(baseIssue({ labels: ['new-service'] }));
    expect(result.tier).toBe('Hard');
  });

  it('forces Hard when 4+ components are impacted', () => {
    const result = classifyEffort(baseIssue({ components: ['a', 'b', 'c', 'd'] }));
    expect(result.tier).toBe('Hard');
  });

  it('classifies Medium for a known-integration external-dependency label with 2-3 components', () => {
    const result = classifyEffort(
      baseIssue({ labels: ['connect-api'], components: ['a', 'b'] }),
    );
    expect(result.tier).toBe('Medium');
  });

  it('flags ambiguous ACs when vague terms are present', () => {
    const result = classifyEffort(
      baseIssue({ acceptanceCriteria: ['The system must be fast and scalable'] }),
    );
    expect(result.acStatus).toBe('ambiguous');
  });
});
