// Spec: the estimation alignment manifest (Appendix A + B).
// Bands changed 2026-10-18 (Bradley): total goes to the closest SP, ties go up — never rounds down.
import { describe, expect, it } from 'vitest';
import { scoreComplexity, bandForTotal, formatScoreLine, SP_SCALE } from '../src/engine/complexityScore.js';
import type { Rating } from '../src/engine/complexityScore.js';

const r = (s: string) => s.split('/') as [Rating, Rating, Rating];

describe('points per rating (deck slide 3)', () => {
  it('Complexity 0/2/4, Work 0/4/8, Risk 0/1/3', () => {
    expect(scoreComplexity('L', 'L', 'L').total).toBe(0);
    expect(scoreComplexity('M', 'L', 'L').total).toBe(2);
    expect(scoreComplexity('H', 'L', 'L').total).toBe(4);
    expect(scoreComplexity('L', 'M', 'L').total).toBe(4);
    expect(scoreComplexity('L', 'H', 'L').total).toBe(8);
    expect(scoreComplexity('L', 'L', 'M').total).toBe(1);
    expect(scoreComplexity('L', 'L', 'H').total).toBe(3);
  });
});

describe('Appendix B — acceptance cases', () => {
  it.each([
    ['L/L/L', 0, 1], ['M/L/L', 2, 2], ['M/L/M', 3, 3], ['M/M/L', 6, 5], ['M/H/L', 10, 8], ['H/H/M', 13, 13],
  ])('slide 4 example %s scores %i -> %i SP', (ratings, total, sp) => {
    const s = scoreComplexity(...r(ratings));
    expect(s.total).toBe(total);
    expect(s.storyPoints).toBe(sp);
  });

  it('PRJ-2388 as rated in the deck (M/H/M) = 11 -> 13 SP (closest)', () => {
    expect(scoreComplexity('M', 'H', 'M')).toMatchObject({ total: 11, storyPoints: 13 });
  });

  it('PRJ-2388 if Work is Medium (M/M/M) = 7 -> 8 SP (closest)', () => {
    expect(scoreComplexity('M', 'M', 'M')).toMatchObject({ total: 7, storyPoints: 8 });
  });

  it('High on all three = 15 -> 13 SP, not a split', () => {
    const s = scoreComplexity('H', 'H', 'H');
    expect(s.total).toBe(15);
    expect(s.storyPoints).toBe(13);
  });

  it.each([[0, 1], [1, 1], [2, 2], [3, 3], [4, 5], [6, 5], [7, 8], [10, 8], [11, 13], [15, 13]])('boundary total %i -> %i SP', (total, sp) => {
    expect(bandForTotal(total)).toBe(sp);
  });

  it('every one of the 27 combinations lands on the 1/2/3/5/8/13 scale', () => {
    const L: Rating[] = ['L', 'M', 'H'];
    for (const c of L) for (const w of L) for (const k of L) {
      const sp = scoreComplexity(c, w, k).storyPoints;
      expect(SP_SCALE).toContain(sp);
      expect(Number.isInteger(sp)).toBe(true);
      expect([4, 6, 7, 9, 10, 11, 12]).not.toContain(sp);
    }
  });

  it('rejects totals outside 0-15 and unknown ratings', () => {
    expect(() => bandForTotal(16)).toThrow();
    expect(() => bandForTotal(-1)).toThrow();
    expect(() => scoreComplexity('X' as Rating, 'L', 'L')).toThrow();
  });
});

describe('Appendix A — deck reference stories (slide 6)', () => {
  // [key, team SP, ratings, total, scored SP]
  it.each([
    ['PRJ-2633', 1, 'L/L/L', 0, 1], ['PRJ-2965', 1, 'L/L/M', 1, 1],
    ['PRJ-2047', 2, 'L/L/L', 0, 1], ['PRJ-163', 2, 'L/M/M', 5, 5],
    ['PRJ-1253', 3, 'M/M/L', 6, 5], ['PRJ-2979', 3, 'M/L/M', 3, 3],
    ['PRJ-2724', 5, 'M/M/L', 6, 5], ['PRJ-2650', 5, 'M/M/L', 6, 5],
    ['PRJ-2904', 8, 'H/M/M', 9, 8], ['PRJ-2461', 8, 'L/H/M', 9, 8],
    ['PRJ-2050', 13, 'H/H/M', 13, 13], ['PRJ-2042', 13, 'M/H/H', 13, 13],
    ['PRJ-2362', 5, 'L/M/H', 7, 8],
  ])('%s (team %i SP) %s = %i -> %i SP', (_key, _team, ratings, total, sp) => {
    const s = scoreComplexity(...r(ratings as string));
    expect(s.total).toBe(total);
    expect(s.storyPoints).toBe(sp);
  });

  it('9 of the 12 deck references score their team points (3 known ≠)', () => {
    const refs: [number, string][] = [[1, 'L/L/L'], [1, 'L/L/M'], [2, 'L/L/L'], [2, 'L/M/M'], [3, 'M/M/L'], [3, 'M/L/M'],
      [5, 'M/M/L'], [5, 'M/M/L'], [8, 'H/M/M'], [8, 'L/H/M'], [13, 'H/H/M'], [13, 'M/H/H']];
    const matches = refs.filter(([team, rt]) => scoreComplexity(...r(rt)).storyPoints === team).length;
    expect(matches).toBe(9);
  });
});

describe('estimate comment Score line (manifest change 4)', () => {
  it('formats the deck slide 9 example', () => {
    expect(formatScoreLine(scoreComplexity('M', 'M', 'M'))).toBe('Score:  C M(2) + W M(4) + R M(1) = 7 → 8 SP');
  });
});
