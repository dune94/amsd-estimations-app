import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import type { EstimateResult } from '../src/engine/types.js';

function sampleResult(issueKey: string, sp = 5): EstimateResult {
  return {
    issueKey,
    effort: { tier: 'Easy', acStatus: 'complete', reasons: ['test'] },
    rbu: { category: 'Marketing', matchedValue: 'Unit A1' },
    pert: {
      optimistic: { value: sp - 1, rationale: [] },
      mostLikely: { value: sp, rationale: [] },
      pessimistic: { value: sp + 1, rationale: [] },
      pertSp: sp,
      sd: 0.3,
      ci68: [sp - 0.3, sp + 0.3],
      ci95: [sp - 0.6, sp + 0.6],
      convergence: { converged: true, gapPct: 5, basis: 'openspec-vs-speckit' },
    },
    tshirt: 'S',
    baselineComparator: null,
    escalation: { flagged: false, reasons: ['ok'] },
    previousSp: null,
    deltaSp: null,
    generatedAt: new Date().toISOString(),
  };
}

describe('EstimatesDb (SQLite)', () => {
  it('round-trips an estimate via save/get', () => {
    const db = openDb(':memory:');
    db.saveEstimate(sampleResult('PRJ-1'));
    const fetched = db.getEstimate('PRJ-1');
    expect(fetched?.issueKey).toBe('PRJ-1');
    expect(fetched?.pert.pertSp).toBe(5);
  });

  it('returns null for an unknown issue key', () => {
    const db = openDb(':memory:');
    expect(db.getEstimate('NOPE')).toBeNull();
  });

  it('upserts — a second save for the same key overwrites, does not duplicate', () => {
    const db = openDb(':memory:');
    db.saveEstimate(sampleResult('PRJ-1', 5));
    db.saveEstimate(sampleResult('PRJ-1', 8));
    expect(db.getEstimate('PRJ-1')?.pert.pertSp).toBe(8);
    expect(db.listEstimates().length).toBe(1);
  });

  it('records a historical comp without throwing', () => {
    const db = openDb(':memory:');
    expect(() => db.recordHistoricalComp('PRJ-1', 8, 'closed at 8 SP')).not.toThrow();
  });
});
