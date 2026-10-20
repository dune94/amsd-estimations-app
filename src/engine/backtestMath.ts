// ── Back-test maths ────────────────────────────────────────────────────────
// How well the pipeline's forecast (made from the pre-change ticket and code) matches the formula applied to the real
// delivered change. Pure functions; the threshold comes from configuration.

import { bandDistance } from './baselineEvidence.js';

export interface BacktestRow { key: string; forecastSp: number; formulaSp: number; acceptedSp: number | null }
export interface BacktestReport {
  n: number; withinOneBand: number; share: number;
  meanErrorVsFormula: number; meanErrorVsAccepted: number | null; passes: boolean;
}

export function withinOneBand(forecast: number, actual: number, bands: number[]): boolean {
  return bandDistance(forecast, actual, bands) <= 1;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function backtestReport(rows: BacktestRow[], bands: number[], minShare: number): BacktestReport {
  const within = rows.filter(r => withinOneBand(r.forecastSp, r.formulaSp, bands)).length;
  const share = rows.length === 0 ? 0 : within / rows.length;
  const accepted = rows.filter(r => r.acceptedSp !== null);
  return {
    n: rows.length, withinOneBand: within, share,
    meanErrorVsFormula: rows.length === 0 ? 0 : mean(rows.map(r => r.forecastSp - r.formulaSp)),
    meanErrorVsAccepted: accepted.length === 0 ? null : mean(accepted.map(r => r.forecastSp - r.acceptedSp!)),
    passes: rows.length > 0 && share >= minShare,
  };
}
