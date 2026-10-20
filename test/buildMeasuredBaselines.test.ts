import { describe, expect, it } from 'vitest';
import type { BaselineStory } from '../src/config/index.js';
import { mergeMeasured, proposeRows, type CalibrationRow, type DeliveredRow } from '../src/engine/measuredBaselines.js';

const base = (key: string, sp = 3): BaselineStory => ({
  key, tshirt: 'S', sp, description: 'sample', signals: { issueType: 'Story', externalDependency: false, filesImpacted: 1, newComponent: false },
});
const m = { changed: 3, dependent: 4, tests: 1, external: 1, newFiles: 0, blastRadius: 10, scope: 'Medium', complexity: 'Low', risk: 'Low', cDrivers: 0, rDrivers: 1 };
const cal = (key: string): CalibrationRow => ({ key, ...m });

describe('mergeMeasured', () => {
  it('adds the measured block to matching keys only and leaves the rest alone', () => {
    const input = [base('B-1'), base('B-2')];
    const out = mergeMeasured(input, [cal('B-1'), cal('B-9')]);
    expect(out[0].measured).toEqual(m);
    expect(out[1]).toEqual(base('B-2'));
    expect(out).toHaveLength(2);
  });

  it('does not change its input', () => {
    const input = [base('B-1')];
    const before = JSON.stringify(input);
    mergeMeasured(input, [cal('B-1')]);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('proposeRows', () => {
  const delivered = (key: string): DeliveredRow => ({ key, acceptedSp: 5, description: 'Delivered work', measured: m });

  it('proposes rows for delivered stories that are not yet measured baselines', () => {
    const rows = proposeRows([delivered('D-1'), delivered('B-1'), delivered('B-2')], [{ ...base('B-1'), measured: m }, base('B-2')]);
    expect(rows.map(r => r.key)).toEqual(['D-1', 'B-2']);
    expect(rows[0]).toMatchObject({ sp: 5, measured: m, signals: { externalDependency: true, filesImpacted: 7, newComponent: false } });
  });

  it('does not change its inputs', () => {
    const baselines = [base('B-1')];
    const before = JSON.stringify(baselines);
    proposeRows([delivered('D-1')], baselines);
    expect(JSON.stringify(baselines)).toBe(before);
  });
});
