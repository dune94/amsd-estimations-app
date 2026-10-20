// ── Measured baselines ─────────────────────────────────────────────────────
// Adds the measured code facts to baseline stories that have them, and proposes new rows from delivered work.
// Pure functions: neither changes its inputs, and nothing here writes a file (the scripts write only where told).

import type { BaselineStory } from '../config/index.js';

type Measured = NonNullable<BaselineStory['measured']>;
export type CalibrationRow = { key: string } & Measured;
export interface DeliveredRow { key: string; acceptedSp: number; description?: string; measured: Measured }

export function mergeMeasured(baselines: BaselineStory[], calibration: CalibrationRow[]): BaselineStory[] {
  const byKey = new Map(calibration.map(({ key, ...measured }) => [key, measured as Measured]));
  return baselines.map(b => (byKey.has(b.key) ? { ...b, measured: { ...byKey.get(b.key)! } } : { ...b }));
}

/** Delivered stories that are not yet measured baselines, as proposed baseline rows for a person to review. */
export function proposeRows(delivered: DeliveredRow[], baselines: BaselineStory[]): BaselineStory[] {
  const measuredKeys = new Set(baselines.filter(b => b.measured).map(b => b.key));
  return delivered.filter(d => !measuredKeys.has(d.key)).map(d => ({
    key: d.key, tshirt: '', sp: d.acceptedSp, description: d.description ?? '',
    signals: { issueType: 'Story', externalDependency: d.measured.external > 0, filesImpacted: d.measured.changed + d.measured.dependent, newComponent: d.measured.newFiles > 0 },
    measured: { ...d.measured },
  }));
}
