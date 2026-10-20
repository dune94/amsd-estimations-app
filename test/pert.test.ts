import { describe, expect, it } from 'vitest';
import { computePert, spToTshirt } from '../src/engine/pert.js';
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

describe('computePert', () => {
  it('produces P >= M >= O in the typical case (pessimistic >= most-likely >= optimistic)', () => {
    const result = computePert(baseIssue(), 'Easy');
    expect(result.pessimistic.value).toBeGreaterThanOrEqual(result.mostLikely.value);
  });

  it('computes PERT SP via the (O + 4M + P) / 6 formula', () => {
    const result = computePert(baseIssue(), 'Easy');
    const { optimistic, mostLikely, pessimistic, pertSp } = result;
    const expected = Math.round(((optimistic.value + 4 * mostLikely.value + pessimistic.value) / 6) * 10) / 10;
    expect(pertSp).toBe(expected);
  });

  it('computes SD as (P - O) / 6', () => {
    const result = computePert(baseIssue(), 'Easy');
    const expectedSd = Math.round(((result.pessimistic.value - result.optimistic.value) / 6) * 10) / 10;
    expect(result.sd).toBe(expectedSd);
  });

  it('sums sub-task estimates for the optimistic lens when present (ground truth beats proxy)', () => {
    const result = computePert(baseIssue({ subtaskEstimatesSp: [2, 3, 1] }), 'Easy');
    expect(result.optimistic.value).toBe(6);
  });

  it('flags convergence as diverged when OpenSpec/SpecKit gap exceeds 15%', () => {
    // Force a huge O/M gap: many sub-tasks (large O) vs default single-AC baseline comparison (M).
    const result = computePert(baseIssue({ subtaskEstimatesSp: Array(20).fill(5) }), 'Easy');
    expect(result.convergence.converged).toBe(false);
    expect(result.convergence.gapPct).toBeGreaterThan(15);
  });
});

describe('spToTshirt', () => {
  it('maps boundary values correctly', () => {
    expect(spToTshirt(0)).toBe('XS');
    expect(spToTshirt(1)).toBe('XS');
    expect(spToTshirt(2)).toBe('S');
    expect(spToTshirt(6)).toBe('S');
    expect(spToTshirt(7)).toBe('M');
    expect(spToTshirt(14)).toBe('M');
    expect(spToTshirt(15)).toBe('L');
    expect(spToTshirt(24)).toBe('L');
    expect(spToTshirt(25)).toBe('XL');
  });

  it('falls back to the largest tier above the top of the scale instead of throwing', () => {
    expect(spToTshirt(999)).toBe('XL');
  });
});
