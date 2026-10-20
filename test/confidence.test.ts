import { describe, expect, it } from 'vitest';
import { confidenceConfig, type ConfidenceConfig } from '../src/config/index.js';
import { computeConfidence, type ConfidenceInput } from '../src/engine/confidence.js';

const CFG: ConfidenceConfig = { minSupport: 3, maxRange: 3, bandDistance: 1, majorUnreadShare: 0.5, minorLowThreshold: 3, bands: [1, 2, 3, 5, 8, 13] };

function input(over: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    acStatus: 'complete', noCodeFacts: false, attachmentsRead: 2, attachmentsNotRead: [], droppedDrivers: 0,
    support: 5, base: 20, upper: 30, estimateSp: 5, medianObservedSp: 5, ...over,
  };
}
const codes = (i: ConfidenceInput, cfg = CFG) => computeConfidence(i, cfg).reasons.map(r => r.code).sort();

describe('computeConfidence', () => {
  it('is High when there are no reasons', () => {
    expect(computeConfidence(input(), CFG)).toEqual({ level: 'High', reasons: [] });
  });

  it('is Low when acceptance criteria are missing', () => {
    const c = computeConfidence(input({ acStatus: 'missing' }), CFG);
    expect(c.level).toBe('Low');
    expect(c.reasons.find(r => r.code === 'ac_missing')?.severity).toBe('major');
  });

  it('is Low when there are no code facts, and skips the code-based reasons', () => {
    const c = computeConfidence(input({ noCodeFacts: true, support: 0, base: 0, upper: 0, estimateSp: null, medianObservedSp: null }), CFG);
    expect(c.level).toBe('Low');
    expect(c.reasons.map(r => r.code)).toEqual(['no_code_facts']);
  });

  it('lists each unread attachment with its reason', () => {
    const c = computeConfidence(input({ attachmentsRead: 3, attachmentsNotRead: [{ filename: 'notes.msg', reason: 'type .msg not read' }] }), CFG);
    const r = c.reasons.find(x => x.code === 'attachments_unread');
    expect(r?.severity).toBe('minor');
    expect(r?.text).toContain('notes.msg');
    expect(r?.text).toContain('type .msg not read');
  });

  it('is Low when half or more of the attachments were not read', () => {
    const c = computeConfidence(input({ attachmentsRead: 1, attachmentsNotRead: [{ filename: 'a.msg', reason: 'r' }] }), CFG);
    expect(c.level).toBe('Low');
    expect(c.reasons.find(r => r.code === 'attachments_unread_majority')?.severity).toBe('major');
  });

  it('is Medium for one or two minor reasons', () => {
    expect(computeConfidence(input({ acStatus: 'ambiguous' }), CFG).level).toBe('Medium');
    expect(computeConfidence(input({ acStatus: 'ambiguous', droppedDrivers: 1 }), CFG).level).toBe('Medium');
  });

  it('is Low for three minor reasons', () => {
    const i = input({ acStatus: 'ambiguous', droppedDrivers: 1, support: 1 });
    expect(codes(i)).toEqual(['ac_ambiguous', 'drivers_dropped', 'thin_support']);
    expect(computeConfidence(i, CFG).level).toBe('Low');
  });

  it('flags a wide range and a distant observed median', () => {
    expect(codes(input({ base: 10, upper: 40 }))).toEqual(['wide_range']);
    expect(codes(input({ estimateSp: 13, medianObservedSp: 5 }))).toEqual(['far_from_observed']);
  });

  it('takes every threshold from the configuration', () => {
    const i = input({ support: 2 });
    expect(codes(i, CFG)).toEqual(['thin_support']);
    expect(codes(i, { ...CFG, minSupport: 2 })).toEqual([]);
    expect(computeConfidence(input({ acStatus: 'ambiguous', droppedDrivers: 1 }), { ...CFG, minorLowThreshold: 2 }).level).toBe('Low');
  });

  it('loads neutral defaults from src/config/confidence.json', () => {
    expect(confidenceConfig).toEqual(CFG);
  });
});
