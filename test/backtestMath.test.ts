import { describe, expect, it } from 'vitest';
import { backtestReport, withinOneBand } from '../src/engine/backtestMath.js';

const BANDS = [1, 2, 3, 5, 8, 13];
const row = (key: string, forecastSp: number, formulaSp: number, acceptedSp: number | null = null) => ({ key, forecastSp, formulaSp, acceptedSp });

describe('withinOneBand', () => {
  it('is true for the same or an adjacent band and false for two or more', () => {
    expect(withinOneBand(5, 5, BANDS)).toBe(true);
    expect(withinOneBand(5, 8, BANDS)).toBe(true);
    expect(withinOneBand(3, 8, BANDS)).toBe(false);
  });
});

describe('backtestReport', () => {
  it('reports the share within one band and compares it with the threshold', () => {
    const seven = [...Array.from({ length: 7 }, (_, i) => row(`K-${i}`, 5, 5)), row('K-8', 1, 13)];
    const r = backtestReport(seven, BANDS, 0.88);
    expect(r).toMatchObject({ n: 8, withinOneBand: 7, share: 0.875, passes: false });
    const eight = [...Array.from({ length: 8 }, (_, i) => row(`K-${i}`, 5, 5)), row('K-9', 1, 13)];
    expect(backtestReport(eight, BANDS, 0.88)).toMatchObject({ n: 9, withinOneBand: 8, passes: true });
  });

  it('reports the mean error against the formula and against the accepted SP', () => {
    const r = backtestReport([row('A', 5, 3, 5), row('B', 8, 5, null)], BANDS, 0.5);
    expect(r.meanErrorVsFormula).toBe(2.5);
    expect(r.meanErrorVsAccepted).toBe(0);
  });

  it('has no accepted-SP error when nothing was accepted, and does not pass an empty set', () => {
    expect(backtestReport([row('A', 5, 5)], BANDS, 0.5).meanErrorVsAccepted).toBeNull();
    expect(backtestReport([], BANDS, 0.5)).toMatchObject({ n: 0, share: 0, passes: false });
  });
});
