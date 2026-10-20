import { describe, expect, it } from 'vitest';
import type { BaselineStory } from '../src/config/index.js';
import { baselineEvidence, bandDistance } from '../src/engine/baselineEvidence.js';

const BANDS = [1, 2, 3, 5, 8, 13];

function story(key: string, sp: number, over: Partial<NonNullable<BaselineStory['measured']>> | null): BaselineStory {
  return {
    key, tshirt: 'S', sp, description: 'sample',
    signals: { issueType: 'Story', externalDependency: false, filesImpacted: 1, newComponent: false },
    ...(over === null ? {} : {
      measured: { changed: 3, dependent: 4, tests: 1, external: 0, newFiles: 0, blastRadius: 8, scope: 'Medium', complexity: 'Low', risk: 'Low', cDrivers: 0, rDrivers: 0, ...over },
    }),
  } as BaselineStory;
}

describe('bandDistance', () => {
  it('counts bands between two SP values', () => {
    expect(bandDistance(5, 8, BANDS)).toBe(1);
    expect(bandDistance(3, 8, BANDS)).toBe(2);
    expect(bandDistance(5, 5, BANDS)).toBe(0);
  });
  it('sends a value exactly between two bands to the higher one', () => {
    expect(bandDistance(10.5, 13, BANDS)).toBe(0); // 10.5 is 2.5 from 8 and 2.5 from 13: the tie goes to 13
    expect(bandDistance(10.5, 8, BANDS)).toBe(1);
  });
});

describe('baselineEvidence', () => {
  const levels = { scope: 'Medium', complexity: 'Low', risk: 'Low', blastRadius: 10 };

  it('counts support only from measured baselines at the same three levels', () => {
    const baselines = [
      story('B-1', 3, {}),
      story('B-2', 3, { risk: 'High' }),
      story('B-3', 5, { scope: 'High' }),
      story('B-4', 3, null),
      story('B-5', 5, {}),
    ];
    const ev = baselineEvidence(levels, baselines, 2);
    expect(ev.support).toBe(2);
    expect(ev.observedSp.sort()).toEqual([3, 5]);
    expect(ev.medianObservedSp).toBe(4);
  });

  it('returns no median when nothing supports the levels', () => {
    const ev = baselineEvidence(levels, [story('B-1', 3, { scope: 'High' })], 2);
    expect(ev.support).toBe(0);
    expect(ev.medianObservedSp).toBeNull();
  });

  it('lists the closest measured baselines by blast radius', () => {
    const baselines = [story('B-1', 3, { blastRadius: 40 }), story('B-2', 5, { blastRadius: 11 }), story('B-3', 2, { blastRadius: 10 }), story('B-4', 3, null)];
    const ev = baselineEvidence(levels, baselines, 2);
    expect(ev.closest.map(c => c.key)).toEqual(['B-3', 'B-2']);
    expect(ev.closest[0]).toEqual({ key: 'B-3', sp: 2, blastRadius: 10 });
  });
});
